"""Блокнот ФЕТАТ: баги, фичи, мысли со скриншотами (Firestore, коллекция fetat_notebook).

Скриншот сжимается в браузере (JPEG ~1280 px) и приходит вместе с миниатюрой ~200 px.
Список отдаёт только миниатюры, полный скриншот — в GET /api/notebook/<id>.
Видят и пишут все вошедшие (IAP); править и удалять — автор и админы (FLEET_ADMINS).
"""
import uuid
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request

from fetat.api.meta import current_user_email
from fetat.clients.firestore import fs_delete, fs_get, fs_insert, fs_query, fs_update
from fetat.config import FLEET_ADMINS

bp = Blueprint("notebook", __name__)

NB_COLLECTION = "fetat_notebook"
NB_CATEGORIES = ("Bug", "Feature", "Thought")
NB_TITLE_MAX = 200
NB_DESC_MAX = 4000
NB_IMAGE_MAX = 750_000   # символов data URL; документ Firestore — до 1 МБ
NB_THUMB_MAX = 80_000
NB_LIST_FIELDS = ["title", "category", "description", "author", "created_at", "updated_at", "thumb", "has_image"]


def _now():
    return datetime.now(timezone.utc).isoformat()


def _can_edit(user, record):
    return bool(user) and (user == record.get("author") or user in FLEET_ADMINS)


def _image_url(v, limit):
    """Проверка data URL картинки. None — нет картинки; ValueError — плохая."""
    if not v:
        return None
    if not isinstance(v, str) or not v.startswith("data:image/") or ";base64," not in v[:40]:
        raise ValueError("картинка должна быть data:image/…;base64")
    if len(v) > limit:
        raise ValueError(f"картинка слишком большая ({len(v) // 1024} КБ)")
    return v


def _clean_fields(data, partial):
    """Текстовые поля из запроса. partial — только присланные (для PATCH)."""
    out = {}
    if not partial or "title" in data:
        title = str(data.get("title") or "").strip()[:NB_TITLE_MAX]
        if not title:
            raise ValueError("нужно название")
        out["title"] = title
    if not partial or "category" in data:
        cat = data.get("category")
        out["category"] = cat if cat in NB_CATEGORIES else "Thought"
    if not partial or "description" in data:
        out["description"] = str(data.get("description") or "").strip()[:NB_DESC_MAX]
    return out


@bp.route("/api/notebook", methods=["POST"])
def notebook_add():
    """Новая запись. JSON: title, category (Bug|Feature|Thought), description, image, thumb (data URL)."""
    user = current_user_email()
    if not user:
        return jsonify({"error": "нужен вход через Google"}), 401
    data = request.get_json(silent=True) or {}
    try:
        record = _clean_fields(data, partial=False)
        image = _image_url(data.get("image"), NB_IMAGE_MAX)
        thumb = _image_url(data.get("thumb"), NB_THUMB_MAX) if image else None
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    now = _now()
    record.update(author=user, created_at=now, updated_at=now,
                  image=image, thumb=thumb, has_image=bool(image))
    rid = uuid.uuid4().hex
    try:
        saved = fs_insert(NB_COLLECTION, rid, record)
    except Exception as e:
        return jsonify({"error": f"Firestore: {e}"}), 502
    saved.pop("image", None)
    saved["can_edit"] = True
    return jsonify(saved), 201


@bp.route("/api/notebook", methods=["GET"])
def notebook_list():
    """Список (новые сверху), без полных скриншотов. Параметры: limit, offset, category."""
    try:
        limit = max(1, min(int(request.args.get("limit", 50)), 500))
        offset = max(0, int(request.args.get("offset", 0)))
    except ValueError:
        return jsonify({"error": "limit/offset — числа"}), 400
    category = request.args.get("category")
    try:
        docs = fs_query(NB_COLLECTION, fields=NB_LIST_FIELDS)
    except Exception as e:
        return jsonify({"error": f"Firestore: {e}"}), 502
    if category in NB_CATEGORIES:
        docs = [d for d in docs if d.get("category") == category]
    docs.sort(key=lambda d: d.get("created_at") or "", reverse=True)
    user = current_user_email()
    items = docs[offset:offset + limit]
    for d in items:
        d["can_edit"] = _can_edit(user, d)
    return jsonify({"items": items, "total": len(docs), "offset": offset, "limit": limit})


@bp.route("/api/notebook/<rid>", methods=["GET"])
def notebook_get(rid):
    """Запись целиком, со скриншотом."""
    try:
        record = fs_get(NB_COLLECTION, rid)
    except Exception as e:
        return jsonify({"error": f"Firestore: {e}"}), 502
    if not record:
        return jsonify({"error": "запись не найдена"}), 404
    record["can_edit"] = _can_edit(current_user_email(), record)
    return jsonify(record)


@bp.route("/api/notebook/<rid>", methods=["PATCH"])
def notebook_update(rid):
    """Правка title / category / description — автор или админ."""
    user = current_user_email()
    if not user:
        return jsonify({"error": "нужен вход через Google"}), 401
    try:
        record = fs_get(NB_COLLECTION, rid, fields=["author"])
    except Exception as e:
        return jsonify({"error": f"Firestore: {e}"}), 502
    if not record:
        return jsonify({"error": "запись не найдена"}), 404
    if not _can_edit(user, record):
        return jsonify({"error": "править может только автор"}), 403
    try:
        updates = _clean_fields(request.get_json(silent=True) or {}, partial=True)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    if updates:
        updates.update(updated_at=_now(), updated_by=user)
        try:
            fs_update(NB_COLLECTION, rid, updates)
        except Exception as e:
            return jsonify({"error": f"Firestore: {e}"}), 502
    try:
        saved = fs_get(NB_COLLECTION, rid, fields=NB_LIST_FIELDS)
    except Exception as e:
        return jsonify({"error": f"Firestore: {e}"}), 502
    saved["can_edit"] = True
    return jsonify(saved)


@bp.route("/api/notebook/<rid>", methods=["DELETE"])
def notebook_delete(rid):
    """Удалить запись — автор или админ."""
    user = current_user_email()
    if not user:
        return jsonify({"error": "нужен вход через Google"}), 401
    try:
        record = fs_get(NB_COLLECTION, rid, fields=["author"])
    except Exception as e:
        return jsonify({"error": f"Firestore: {e}"}), 502
    if not record:
        return jsonify({"error": "запись не найдена"}), 404
    if not _can_edit(user, record):
        return jsonify({"error": "удалить может только автор"}), 403
    try:
        fs_delete(NB_COLLECTION, rid)
    except Exception as e:
        return jsonify({"error": f"Firestore: {e}"}), 502
    return jsonify({"deleted": True, "id": rid})
