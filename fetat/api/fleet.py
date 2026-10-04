"""Общий Флот: чтение, синхронизация полей, 🔒 блокировка, корзина и восстановление, перенос из браузера;
v3.22 — завершённые трипы (архив навсегда)."""
import json
import re

from flask import Blueprint, jsonify, request

from fetat.api.meta import current_user_email
from fetat.config import FLEET_ADMINS
from fetat.domain.dispatchers import _disp_cache, can_assign, get_dispatchers
from fetat.store.fleet_store import (
    _fleet_can_delete, _fleet_clean, FLEET_DONE, FLEET_FIELD_RE, FLEET_LOCK_MS, _fleet_rid, _fleet_row_out,
    FLEET_STORE, FLEET_TRASH_MS, chg_apply, done_out, done_record, fleet_owner,
)
from fetat.utils.timefmt import _now_ms

bp = Blueprint("fleet", __name__)


def _fleet_user():
    return current_user_email() or "local"


@bp.route("/api/fleet")
def api_fleet():
    """Общий Флот. Без since — все живые строки; с since (мс) — изменения с этого момента,
    включая удалённые (deleted=true). now — метка для следующего запроса."""
    now = _now_ms()
    since = request.args.get("since")
    try:
        if since:
            docs = FLEET_STORE.query(int(since) - 2000)   # запас на разницу часов инстансов
            return jsonify({"ok": True, "now": now, "user": _fleet_user(),
                            "changes": [dict(_fleet_row_out(d), deleted=_gone(d["meta"])) for d in docs]})
        docs = FLEET_STORE.query(None)
        live, trash = [], []
        for d in docs:
            m = d["meta"]
            if m.get("completed"):
                # v3.22: завершённый трип лежит в архиве fleet_done; из fleet_rows стираем через FLEET_TRASH_MS
                if now - (m.get("completed_at") or 0) > FLEET_TRASH_MS:
                    try:
                        FLEET_STORE.purge(d["id"])
                    except Exception:
                        pass
                continue
            if m.get("deleted"):
                if now - (m.get("deleted_at") or 0) > FLEET_TRASH_MS:
                    try:
                        FLEET_STORE.purge(d["id"])
                    except Exception:
                        pass
                else:
                    trash.append(_fleet_row_out(d))
            else:
                live.append(_fleet_row_out(d))
        live.sort(key=lambda x: (x["meta"].get("created_at") or 0, str(x["row"]["id"])))
        return jsonify({"ok": True, "now": now, "user": _fleet_user(), "rows": live, "trash_count": len(trash),
                        "admin": _fleet_user() in FLEET_ADMINS, "can_assign": can_assign(_fleet_user()),
                        "lock_ms": FLEET_LOCK_MS})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 503


def _gone(meta):
    """Строки больше нет во Флоте: удалена или завершена (v3.22)."""
    return bool(meta.get("deleted") or meta.get("completed"))


# ---------- v3.22: «✓ Завершён» ----------
def can_complete(user, d):
    """Завершить / вернуть трип: хозяин трипа или назначающий (админ или «Назначает = да» в листе «Диспетчеры»)."""
    u = str(user or "").lower()
    if u == "local" or can_assign(u):
        return True
    owner = fleet_owner(d)
    return not owner or u == owner


@bp.route("/api/fleet/complete", methods=["POST"])
def api_fleet_complete():
    """{id} — трип целиком в архив fleet_done (навсегда), во Флоте строка помечается завершённой."""
    body = request.get_json(force=True, silent=True) or {}
    user, now = _fleet_user(), _now_ms()
    try:
        rid = _fleet_rid(body.get("id"))
        d = FLEET_STORE.get(rid)
        if d is None or _gone(d["meta"]):
            return jsonify({"ok": False, "error": "строки уже нет во Флоте"}), 404
        if not can_complete(user, d):
            return jsonify({"ok": False, "error": "завершить трип может его хозяин или назначающий"}), 403
        FLEET_DONE.put(rid, done_record(d, user, now))
        FLEET_STORE.patch(rid, meta={"completed": True, "completed_by": user, "completed_at": now,
                                     "updated_by": user, "updated_at": now, "lock_by": "", "lock_until": 0})
        return jsonify({"ok": True, "now": now})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 503


@bp.route("/api/fleet/reopen", methods=["POST"])
def api_fleet_reopen():
    """{id} — вернуть завершённый трип во Флот (из архива; запись архива убирается)."""
    body = request.get_json(force=True, silent=True) or {}
    user, now = _fleet_user(), _now_ms()
    try:
        rid = _fleet_rid(body.get("id"))
        rec = FLEET_DONE.get(rid)
        if rec is None:
            return jsonify({"ok": False, "error": "в завершённых такого трипа нет"}), 404
        row = json.loads(rec.get("row") or "{}")
        meta = json.loads(rec.get("meta") or "{}")
        if not can_complete(user, {"data": row, "meta": meta}):
            return jsonify({"ok": False, "error": "вернуть трип может его хозяин или назначающий"}), 403
        row.pop("id", None)
        FLEET_STORE.patch(rid, _fleet_clean(row), (), {
            "created_by": meta.get("created_by") or user, "created_at": meta.get("created_at") or now,
            "deleted": False, "completed": False, "completed_by": "", "completed_at": 0,
            "updated_by": user, "updated_at": now, "edited_at": now})
        FLEET_DONE.remove(rid)
        return jsonify({"ok": True, "now": now})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 503


@bp.route("/api/fleet/done")
def api_fleet_done():
    """Завершённые трипы, свежие сверху. ?limit=50, ?q= — поиск по машине и точкам."""
    try:
        limit = max(1, min(int(request.args.get("limit", 50)), 1000))
    except ValueError:
        limit = 50
    q = str(request.args.get("q") or "").strip().lower()
    user = _fleet_user()
    try:
        recs = FLEET_DONE.all()
        if q:
            recs = [r for r in recs if q in (str(r.get("unit")) + " " + str(r.get("points"))).lower()]
        recs.sort(key=lambda r: -int(r.get("completed_at") or 0))
        out = []
        for r in recs[:limit]:
            x = done_out(r)
            x["can_reopen"] = can_assign(user) or user == "local" or not x["owner"] or user.lower() == x["owner"]
            out.append(x)
        return jsonify({"ok": True, "rows": out, "total": len(recs)})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 503


# v3.17: поля, которые браузер пишет сам (не человек): не меняют «кто изменил»
AUTO_FIELDS = {"doneSeen", "chg"}


@bp.route("/api/fleet/sync", methods=["POST"])
def api_fleet_sync():
    """ops: [{id, set:{поле: значение}, unset:[поля], new:true} | {id, delete:true}]."""
    body = request.get_json(force=True, silent=True) or {}
    ops = body.get("ops") or []
    if not isinstance(ops, list) or len(ops) > 300:
        return jsonify({"ok": False, "error": "плохой запрос"}), 400
    user, now, done, errors = _fleet_user(), _now_ms(), 0, []
    for op in ops:
        try:
            rid = _fleet_rid(op.get("id"))
            if op.get("delete"):
                d = FLEET_STORE.get(rid)
                if d is None:
                    done += 1
                    continue
                if not _fleet_can_delete(user, d):
                    raise PermissionError("удалить строку может только тот, кто её создал, или её диспетчер")
                FLEET_STORE.patch(rid, meta={"deleted": True, "deleted_by": user, "deleted_at": now,
                                             "updated_by": user, "updated_at": now, "lock_by": "", "lock_until": 0})
            else:
                meta = {"updated_by": user, "updated_at": now, "edited_at": now}
                keys = set((op.get("set") or {}).keys()) | set(op.get("unset") or [])
                if not op.get("new") and keys and keys <= AUTO_FIELDS:
                    meta = {"updated_at": now}   # v3.17: служебное поле — не «правка» человека
                if op.get("new"):
                    meta.update(created_by=user, created_at=now, deleted=False)
                unset = [k for k in (op.get("unset") or []) if FLEET_FIELD_RE.match(str(k)) and k != "id"]
                data = _fleet_clean(op.get("set"))
                if not op.get("new") and ("disp" in data or "disp" in unset):
                    _check_disp_change(user, rid, data.get("disp", ""))
                # v3.20: метки чужой правки. Снять их (поле chg) может только хозяин трипа.
                cur = None if op.get("new") else FLEET_STORE.get(rid)
                if "chg" in data or "chg" in unset:
                    if cur is None or (fleet_owner(cur) and user.lower() != fleet_owner(cur)):
                        data.pop("chg", None)
                        unset = [k for k in unset if k != "chg"]
                elif cur is not None:
                    chg = chg_apply(cur, user, data, unset, now)
                    if chg is not None:
                        if chg:
                            data["chg"] = chg
                        else:
                            unset = unset + ["chg"]
                if not data and not unset:
                    done += 1
                    continue
                FLEET_STORE.patch(rid, data, unset, meta)
            done += 1
        except Exception as e:
            errors.append({"id": op.get("id"), "error": str(e)})
    code = 200 if not errors else (207 if done else 503)
    return jsonify({"ok": not errors, "now": now, "done": done, "errors": errors}), code


def _check_disp_change(user, rid, new_disp):
    """v3.11: сменить диспетчера строки может только назначающий (админ или «Назначает = да»).
    Если значение не меняется — пропускаем (браузер может прислать то же самое)."""
    d = FLEET_STORE.get(rid)
    if d is None:
        return
    cur = str(d["data"].get("disp") or d["meta"].get("created_by") or "").lower()
    if str(new_disp or "").lower() == cur:
        return
    if not can_assign(user):
        raise PermissionError("назначать диспетчера строки может только назначающий (см. лист «Диспетчеры»)")


@bp.route("/api/dispatchers")
def api_dispatchers():
    """v3.11: список диспетчеров из листа «Диспетчеры» + может ли текущий пользователь назначать."""
    force = request.args.get("refresh") == "1"
    lst = get_dispatchers(force=force)
    return jsonify({"ok": True, "dispatchers": lst, "source": _disp_cache["source"],
                    "error": _disp_cache["error"], "user": _fleet_user(),
                    "can_assign": can_assign(_fleet_user())})


@bp.route("/api/fleet/lock", methods=["POST"])
def api_fleet_lock():
    """v2.02: 🔒 строку правит один человек. {id} — занять/продлить на 60 с, {id, release:true} — отпустить.
    Занято другим — 409 {locked_by}."""
    body = request.get_json(force=True, silent=True) or {}
    user, now = _fleet_user(), _now_ms()
    try:
        rid = _fleet_rid(body.get("id"))
        d = FLEET_STORE.get(rid)
        if d is None or _gone(d["meta"]):
            return jsonify({"ok": True, "now": now, "none": True})
        m = d["meta"]
        other = m.get("lock_by") and m.get("lock_by") != user and (m.get("lock_until") or 0) > now
        if body.get("release"):
            if m.get("lock_by") == user:
                FLEET_STORE.patch(rid, meta={"lock_by": "", "lock_until": 0, "updated_at": now})
            return jsonify({"ok": True, "now": now})
        if other:
            return jsonify({"ok": False, "now": now, "locked_by": m["lock_by"], "lock_until": m["lock_until"]}), 409
        FLEET_STORE.patch(rid, meta={"lock_by": user, "lock_until": now + FLEET_LOCK_MS, "updated_at": now})
        return jsonify({"ok": True, "now": now, "lock_until": now + FLEET_LOCK_MS})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 503


@bp.route("/api/fleet/trash")
def api_fleet_trash():
    """v2.02: корзина — удалённые за последние 24 ч, новые сверху."""
    now = _now_ms()
    try:
        out = []
        for d in FLEET_STORE.query(None):
            m = d["meta"]
            if m.get("deleted") and now - (m.get("deleted_at") or 0) <= FLEET_TRASH_MS:
                out.append(_fleet_row_out(d))
        out.sort(key=lambda x: -(x["meta"].get("deleted_at") or 0))
        return jsonify({"ok": True, "now": now, "rows": out})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 503


@bp.route("/api/fleet/restore", methods=["POST"])
def api_fleet_restore():
    body = request.get_json(force=True, silent=True) or {}
    user, now = _fleet_user(), _now_ms()
    try:
        rid = _fleet_rid(body.get("id"))
        d = FLEET_STORE.get(rid)
        if d is None:
            return jsonify({"ok": False, "error": "строка уже удалена насовсем"}), 404
        FLEET_STORE.patch(rid, meta={"deleted": False, "deleted_by": "", "deleted_at": 0,
                                     "updated_by": user, "updated_at": now, "edited_at": now})
        return jsonify({"ok": True, "now": now})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 503


@bp.route("/api/fleet/import", methods=["POST"])
def api_fleet_import():
    """Перенос Флота из браузера: новые строки с новыми id; пропускаем то, что на сервере уже есть
    (тот же номер машины и тот же таргет) и пустые строки."""
    body = request.get_json(force=True, silent=True) or {}
    rows_in = body.get("rows") or []
    if not isinstance(rows_in, list) or len(rows_in) > 500:
        return jsonify({"ok": False, "error": "плохой запрос"}), 400
    norm = lambda s: re.sub(r"[\s\-]", "", str(s or "")).upper()
    try:
        existing = [d for d in FLEET_STORE.query(None) if not d["meta"].get("deleted")]
        have = {(norm(d["data"].get("unit")), norm(d["data"].get("target"))) for d in existing}
        used = {d["id"] for d in existing}
        user, now = _fleet_user(), _now_ms()
        import random
        added = skipped = 0
        for i, r in enumerate(rows_in):
            if not isinstance(r, dict) or not (r.get("unit") or r.get("target")):
                skipped += 1
                continue
            key = (norm(r.get("unit")), norm(r.get("target")))
            if key in have:
                skipped += 1
                continue
            rid = str(now * 100 + i)
            while rid in used:
                rid = str(now * 100 + random.randint(0, 99999))
            used.add(rid)
            have.add(key)
            FLEET_STORE.patch(rid, _fleet_clean(r), (), {"created_by": user, "created_at": now + i, "deleted": False,
                                                          "updated_by": user, "updated_at": now})
            added += 1
        return jsonify({"ok": True, "added": added, "skipped": skipped, "now": _now_ms()})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 503
