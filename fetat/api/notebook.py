"""Блокнот ФЕТАТ: баги, фичи, правила, данные… со скриншотами и комментариями (Firestore, fetat_notebook).

Скриншот сжимается в браузере (JPEG ~1280 px) и приходит вместе с миниатюрой ~200 px.
Список отдаёт только миниатюры, полный скриншот — в GET /api/notebook/<id>.
Видят, пишут и комментируют все вошедшие (IAP); править и удалять запись — автор и админы (FLEET_ADMINS),
комментарий — его автор и админы. Страница со всей таблицей — /notebook.
"""
import uuid
from datetime import datetime, timezone

from flask import Blueprint, jsonify, render_template, request

from fetat import APP_VERSION
from fetat.api.meta import current_user_email
from fetat.clients.firestore import fs_delete, fs_get, fs_insert, fs_query, fs_update
from fetat.config import FLEET_ADMINS

bp = Blueprint("notebook", __name__)

NB_COLLECTION = "fetat_notebook"
NB_CATEGORIES = ("Bug", "Feature", "Design", "Rule", "Data", "Discuss")
NB_LEGACY_CATEGORY = {"Thought": "Discuss"}   # до 3.08 была «Мысль»
NB_STATUSES = ("new", "work", "done", "later", "rejected")   # v3.15: + отклонено
NB_TITLE_MAX = 200
NB_DESC_MAX = 4000
NB_WHERE_MAX = 40
NB_COMMENT_MAX = 2000
NB_COMMENTS_MAX = 200
NB_IMAGE_MAX = 750_000   # символов data URL; документ Firestore — до 1 МБ
NB_THUMB_MAX = 80_000
NB_LIST_FIELDS = ["title", "category", "description", "where", "status", "priority", "author",
                  "created_at", "updated_at", "updated_by", "thumb", "has_image", "comments"]


def _now():
    return datetime.now(timezone.utc).isoformat()


def _can_edit(user, author):
    return bool(user) and (user == author or user in FLEET_ADMINS)


def _norm(rec, user):
    """Старые записи к текущему виду + права текущего пользователя."""
    rec["category"] = NB_LEGACY_CATEGORY.get(rec.get("category"), rec.get("category"))
    if rec.get("category") not in NB_CATEGORIES:
        rec["category"] = "Discuss"
    if rec.get("status") not in NB_STATUSES:
        rec["status"] = "new"
    rec.setdefault("where", "")
    rec.setdefault("priority", None)
    comments = rec.get("comments") if isinstance(rec.get("comments"), list) else []
    for c in comments:
        c["can_delete"] = _can_edit(user, c.get("author"))
    rec["comments"] = comments
    rec["can_edit"] = _can_edit(user, rec.get("author"))
    return rec


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
    """Поля записи из запроса. partial — только присланные (для PATCH)."""
    out = {}

    def has(k):
        return not partial or k in data

    if has("title"):
        title = str(data.get("title") or "").strip()[:NB_TITLE_MAX]
        if not title:
            raise ValueError("нужно название")
        out["title"] = title
    if has("category"):
        cat = NB_LEGACY_CATEGORY.get(data.get("category"), data.get("category"))
        out["category"] = cat if cat in NB_CATEGORIES else "Discuss"
    if has("description"):
        out["description"] = str(data.get("description") or "").strip()[:NB_DESC_MAX]
    if has("where"):
        out["where"] = str(data.get("where") or "").strip()[:NB_WHERE_MAX]
    if has("status"):
        st = data.get("status")
        out["status"] = st if st in NB_STATUSES else "new"
    if has("priority"):
        p = data.get("priority")
        try:
            p = int(p) if p not in (None, "") else None
        except (TypeError, ValueError):
            raise ValueError("приоритет — число 1–10")
        if p is not None and not 1 <= p <= 10:
            raise ValueError("приоритет — число 1–10")
        out["priority"] = p
    if "image" in data:
        image = _image_url(data.get("image"), NB_IMAGE_MAX)
        thumb = _image_url(data.get("thumb"), NB_THUMB_MAX) if image else None
        out.update(image=image, thumb=thumb, has_image=bool(image))
    elif not partial:
        out.update(image=None, thumb=None, has_image=False)
    return out


def _load(rid, fields=None):
    """Запись или (ответ, код) с ошибкой."""
    try:
        rec = fs_get(NB_COLLECTION, rid, fields=fields)
    except Exception as e:
        return None, (jsonify({"error": f"Firestore: {e}"}), 502)
    if not rec:
        return None, (jsonify({"error": "запись не найдена"}), 404)
    return rec, None


@bp.route("/notebook")
def notebook_page():
    """Страница со всей таблицей блокнота."""
    return render_template("notebook.html", app_version=APP_VERSION, user_email=current_user_email())


@bp.route("/api/notebook", methods=["POST"])
def notebook_add():
    """Новая запись. JSON: title, category, description, where, status, priority, image, thumb."""
    user = current_user_email()
    if not user:
        return jsonify({"error": "нужен вход через Google"}), 401
    try:
        record = _clean_fields(request.get_json(silent=True) or {}, partial=False)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    now = _now()
    record.update(author=user, created_at=now, updated_at=now, comments=[])
    try:
        saved = fs_insert(NB_COLLECTION, uuid.uuid4().hex, record)
    except Exception as e:
        return jsonify({"error": f"Firestore: {e}"}), 502
    saved.pop("image", None)
    return jsonify(_norm(saved, user)), 201


@bp.route("/api/notebook", methods=["GET"])
def notebook_list():
    """Список (новые сверху), без полных скриншотов. Параметры: limit, offset, category, status."""
    try:
        limit = max(1, min(int(request.args.get("limit", 50)), 1000))
        offset = max(0, int(request.args.get("offset", 0)))
    except ValueError:
        return jsonify({"error": "limit/offset — числа"}), 400
    try:
        docs = fs_query(NB_COLLECTION, fields=NB_LIST_FIELDS)
    except Exception as e:
        return jsonify({"error": f"Firestore: {e}"}), 502
    user = current_user_email()
    docs = [_norm(d, user) for d in docs]
    category, status = request.args.get("category"), request.args.get("status")
    if category in NB_CATEGORIES:
        docs = [d for d in docs if d["category"] == category]
    if status in NB_STATUSES:
        docs = [d for d in docs if d["status"] == status]
    docs.sort(key=lambda d: d.get("created_at") or "", reverse=True)
    return jsonify({"items": docs[offset:offset + limit], "total": len(docs), "offset": offset, "limit": limit})


@bp.route("/api/notebook/<rid>", methods=["GET"])
def notebook_get(rid):
    """Запись целиком, со скриншотом и комментариями."""
    rec, err = _load(rid)
    if err:
        return err
    return jsonify(_norm(rec, current_user_email()))


@bp.route("/api/notebook/<rid>", methods=["PATCH"])
def notebook_update(rid):
    """Правка любых полей записи, включая скриншот (image: null — убрать) — автор или админ."""
    user = current_user_email()
    if not user:
        return jsonify({"error": "нужен вход через Google"}), 401
    rec, err = _load(rid, fields=["author"])
    if err:
        return err
    if not _can_edit(user, rec.get("author")):
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
    rec, err = _load(rid)
    if err:
        return err
    return jsonify(_norm(rec, user))


@bp.route("/api/notebook/<rid>", methods=["DELETE"])
def notebook_delete(rid):
    """Удалить запись — автор или админ."""
    user = current_user_email()
    if not user:
        return jsonify({"error": "нужен вход через Google"}), 401
    rec, err = _load(rid, fields=["author"])
    if err:
        return err
    if not _can_edit(user, rec.get("author")):
        return jsonify({"error": "удалить может только автор"}), 403
    try:
        fs_delete(NB_COLLECTION, rid)
    except Exception as e:
        return jsonify({"error": f"Firestore: {e}"}), 502
    return jsonify({"deleted": True, "id": rid})


def _save_comments(rid, comments, user):
    # комментарий — не правка записи: updated_* не трогаем (иначе в карточке «изм. …»)
    fs_update(NB_COLLECTION, rid, {"comments": comments, "commented_at": _now()})


@bp.route("/api/notebook/<rid>/comments", methods=["POST"])
def notebook_comment_add(rid):
    """Комментарий к записи — любой вошедший. JSON: text."""
    user = current_user_email()
    if not user:
        return jsonify({"error": "нужен вход через Google"}), 401
    text = str((request.get_json(silent=True) or {}).get("text") or "").strip()[:NB_COMMENT_MAX]
    if not text:
        return jsonify({"error": "пустой комментарий"}), 400
    rec, err = _load(rid, fields=["comments"])
    if err:
        return err
    comments = rec.get("comments") if isinstance(rec.get("comments"), list) else []
    if len(comments) >= NB_COMMENTS_MAX:
        return jsonify({"error": "слишком много комментариев"}), 400
    comments.append({"id": uuid.uuid4().hex[:12], "author": user, "at": _now(), "text": text})
    try:
        _save_comments(rid, comments, user)
    except Exception as e:
        return jsonify({"error": f"Firestore: {e}"}), 502
    return jsonify({"comments": _norm({"comments": comments}, user)["comments"]}), 201


@bp.route("/api/notebook/<rid>/comments/<cid>", methods=["DELETE"])
def notebook_comment_delete(rid, cid):
    """Удалить комментарий — его автор или админ."""
    user = current_user_email()
    if not user:
        return jsonify({"error": "нужен вход через Google"}), 401
    rec, err = _load(rid, fields=["comments"])
    if err:
        return err
    comments = rec.get("comments") if isinstance(rec.get("comments"), list) else []
    hit = next((c for c in comments if c.get("id") == cid), None)
    if not hit:
        return jsonify({"error": "комментарий не найден"}), 404
    if not _can_edit(user, hit.get("author")):
        return jsonify({"error": "удалить может только автор"}), 403
    comments = [c for c in comments if c is not hit]
    try:
        _save_comments(rid, comments, user)
    except Exception as e:
        return jsonify({"error": f"Firestore: {e}"}), 502
    return jsonify({"comments": _norm({"comments": comments}, user)["comments"]})
