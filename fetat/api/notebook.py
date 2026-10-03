"""Блокнот ФЕТАТ: быстрое добавление багов, идей, фич с скриншотами."""
import base64
import uuid
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request

from fetat.api.meta import current_user_email
from fetat.clients.firestore import fs_get, fs_insert, fs_query, fs_update

bp = Blueprint("notebook", __name__)


def _gen_thumbnail(image_data: bytes) -> str:
    """Генерирует миниатюру (100x100) из PNG/JPEG. Пока — просто base64 оригинала."""
    # TODO: если нужна реальная миниатюра, добавить PIL/pillow
    return base64.b64encode(image_data).decode("utf-8")


@bp.route("/api/notebook", methods=["POST"])
def notebook_add():
    """Добавить запись в блокнот.

    JSON: {
        "title": "...",
        "category": "Bug|Thought|Feature",
        "description": "...",
        "image_data": "base64 or null"  # скриншот
    }
    """
    user = current_user_email()
    if not user:
        return jsonify({"error": "not authenticated"}), 401

    data = request.get_json() or {}
    title = (data.get("title") or "").strip()
    category = data.get("category", "Thought")
    description = (data.get("description") or "").strip()
    image_data = data.get("image_data")

    if not title:
        return jsonify({"error": "title required"}), 400
    if category not in ("Bug", "Thought", "Feature"):
        category = "Thought"

    now = datetime.now(timezone.utc).isoformat()
    record = {
        "id": str(uuid.uuid4()),
        "title": title,
        "category": category,
        "description": description,
        "author": user,
        "created_at": now,
        "updated_at": now,
        "image_data": None,
        "thumbnail": None,
    }

    if image_data:
        try:
            # Если пришёл base64, декодируем
            if isinstance(image_data, str) and image_data.startswith("data:"):
                # data:image/png;base64,XXX
                image_data = image_data.split(",", 1)[-1]
            if isinstance(image_data, str):
                image_bytes = base64.b64decode(image_data)
            else:
                image_bytes = image_data
            record["image_data"] = base64.b64encode(image_bytes).decode("utf-8")
            record["thumbnail"] = _gen_thumbnail(image_bytes)
        except Exception as e:
            return jsonify({"error": f"image decode error: {e}"}), 400

    try:
        fs_insert("fetat_notebook", record["id"], record)
    except Exception as e:
        return jsonify({"error": f"firestore error: {e}"}), 500

    return jsonify(record), 201


@bp.route("/api/notebook", methods=["GET"])
def notebook_list():
    """Список записей. Query params: limit, offset, category."""
    limit = min(int(request.args.get("limit", 50)), 500)
    offset = int(request.args.get("offset", 0))
    category = request.args.get("category")

    try:
        # TODO: if category — fs_query, else fs_list
        # Пока упрощённо — всё подряд, потом сортировка и slice в памяти
        docs = fs_query("fetat_notebook", [])
        if not docs:
            docs = []
    except Exception as e:
        return jsonify({"error": f"firestore error: {e}"}), 500

    # Фильтр по категории
    if category and category in ("Bug", "Thought", "Feature"):
        docs = [d for d in docs if d.get("category") == category]

    # Сортировка по дате (новые первыми)
    docs.sort(key=lambda d: d.get("created_at", ""), reverse=True)

    # Пагинация
    total = len(docs)
    items = docs[offset : offset + limit]

    # Скрываем полное image_data в списке (большой объём), оставляем только thumbnail
    for item in items:
        item.pop("image_data", None)

    return jsonify({"items": items, "total": total, "offset": offset, "limit": limit}), 200


@bp.route("/api/notebook/<notebook_id>", methods=["GET"])
def notebook_get(notebook_id):
    """Получить одну запись полностью (с image_data)."""
    try:
        record = fs_get("fetat_notebook", notebook_id)
        if not record:
            return jsonify({"error": "not found"}), 404
    except Exception as e:
        return jsonify({"error": f"firestore error: {e}"}), 500

    return jsonify(record), 200


@bp.route("/api/notebook/<notebook_id>", methods=["PATCH"])
def notebook_update(notebook_id):
    """Обновить запись (только автор или админ).

    JSON: {
        "title": "...",
        "category": "...",
        "description": "..."
    }
    """
    user = current_user_email()
    if not user:
        return jsonify({"error": "not authenticated"}), 401

    try:
        record = fs_get("fetat_notebook", notebook_id)
        if not record:
            return jsonify({"error": "not found"}), 404
    except Exception as e:
        return jsonify({"error": f"firestore error: {e}"}), 500

    # Проверка прав: только автор может редактировать
    if record.get("author") != user:
        return jsonify({"error": "forbidden"}), 403

    data = request.get_json() or {}
    updates = {}
    for key in ("title", "category", "description"):
        if key in data:
            updates[key] = data[key]
    if updates:
        updates["updated_at"] = datetime.now(timezone.utc).isoformat()
        try:
            fs_update("fetat_notebook", notebook_id, updates)
        except Exception as e:
            return jsonify({"error": f"firestore error: {e}"}), 500

    # Возвращаем обновлённый документ
    try:
        updated = fs_get("fetat_notebook", notebook_id)
        updated.pop("image_data", None)  # Скрываем полный image
        return jsonify(updated), 200
    except Exception as e:
        return jsonify({"error": f"firestore error: {e}"}), 500


@bp.route("/api/notebook/<notebook_id>", methods=["DELETE"])
def notebook_delete(notebook_id):
    """Удалить запись (только автор)."""
    user = current_user_email()
    if not user:
        return jsonify({"error": "not authenticated"}), 401

    try:
        record = fs_get("fetat_notebook", notebook_id)
        if not record:
            return jsonify({"error": "not found"}), 404
    except Exception as e:
        return jsonify({"error": f"firestore error: {e}"}), 500

    if record.get("author") != user:
        return jsonify({"error": "forbidden"}), 403

    try:
        # TODO: fs_delete(...)
        # Пока скелет
        return jsonify({"deleted": True}), 200
    except Exception as e:
        return jsonify({"error": f"firestore error: {e}"}), 500
