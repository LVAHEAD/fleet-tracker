"""Машины и прицепы из Mapon: список, Truck Info, ближайшие, выгрузки юнитов и объектов, служебная проверка."""
import re

from flask import Blueprint, current_app, jsonify, request

from fetat.clients.mapon import (
    _check_daily_activities, fetch_group_unit_ids, fetch_units, get_driver_rests, get_tacho,
    MAPON_API_URL, MAPON_BASE, mapon_get, MAPON_TACHO_URL, unit_stops,
)
from fetat.config import HEAD_TRUCK_GROUP_ID, MAPON_API_KEY
from fetat.domain.points import find_unit_exact
from fetat.domain.tacho import WEEKLY_FULL_SEC, weekly_status
from fetat.domain.trailers import is_trailer
from fetat.utils.geo import haversine_km, _wkt_center
from fetat.utils.timefmt import _hm, _lv, _utc_iso

bp = Blueprint("mapon", __name__)


@bp.route("/api/units")
def api_units():
    """Список машин из группы HEAD TRUCK — для дропдауна на фронтенде."""
    if not MAPON_API_KEY:
        return jsonify({"error": "MAPON_API_KEY не настроен на сервере"}), 500
    try:
        all_units = fetch_units(MAPON_API_KEY)
        group_ids = fetch_group_unit_ids(MAPON_API_KEY, HEAD_TRUCK_GROUP_ID)
        result = [
            {"unit_id": u["unit_id"], "number": u.get("number") or u.get("label"), "kind": "truck"}
            for u in all_units
            if u["unit_id"] in group_ids
        ]
        # v1.70: прицепы (type == "trailer") — после тягачей
        result.sort(key=lambda x: x["number"] or "")
        result += sorted(({"unit_id": u["unit_id"], "number": u.get("number") or u.get("label"), "kind": "trailer"}
                          for u in all_units if is_trailer(u) and u["unit_id"] not in group_ids),
                         key=lambda x: x["number"] or "")
        return jsonify({"units": result})
    except Exception as e:
        return jsonify({"error": str(e)}), 502


def _find_unit(q_raw):
    norm = lambda x: re.sub(r"[^0-9a-zа-я]", "", str(x or "").lower())
    q = norm(q_raw)
    if not q:
        return None
    units = fetch_units(MAPON_API_KEY)
    return (next((u for u in units if str(u["unit_id"]) == q), None)
            or next((u for u in units if norm(u.get("number")) == q or norm(u.get("label")) == q), None)
            or next((u for u in units if q in norm(u.get("number")) or q in norm(u.get("label"))), None))


@bp.route("/api/truck-info")
def api_truck_info():
    if not MAPON_API_KEY:
        return jsonify({"error": "MAPON_API_KEY не настроен"}), 500
    try:
        unit = _find_unit(request.args.get("unit"))
    except Exception as e:
        return jsonify({"error": f"Mapon: {e}"}), 502
    if not unit:
        return jsonify({"error": "трак не найден"}), 404
    uid = unit["unit_id"]
    out = {"unit_id": uid, "number": unit.get("number") or unit.get("label"), "drivers": []}
    tacho, terr = get_tacho(uid)
    if not tacho:
        out["tacho_error"] = terr
    for d in (tacho or {}).get("drivers") or []:
        week, today = d.get("week") or {}, d.get("today") or {}
        row = {"name": " ".join(filter(None, [d.get("driver_name"), d.get("driver_surname")])) or "—",
               "state": d.get("current_state"),
               "today_left": _hm(today.get("driving_remaining")) if today.get("driving_remaining") is not None else None,
               "week_left": _hm(week.get("driving_remaining")) if week.get("driving_remaining") is not None else None,
               "ext_left": week.get("10h_driving_extensions_remaining"),
               "short_left": week.get("9h_rest_shortening_remaining"),
               "mapon_weekly": _lv(week["weekly_rest_start"]) if week.get("weekly_rest_start") else None}
        did = d.get("driver_id")
        if did:
            w, werr = weekly_status(did)
            if w:
                row["weekly"] = [{"from": _lv(x["start"]), "to": _lv(x["end"]), "hours": x["hours"],
                                  "full": x["full"], "nocard": any(s in ("can", "unkn") for s in x["src"])}
                                 for x in w["weekly"]]
                row["ongoing"] = w.get("ongoing")
                row["resting"] = _hm(w.get("resting_sec")) if w.get("resting_sec") else None
                if w.get("can_go"):
                    row["can_go"] = _lv(w["can_go"])
                if w.get("deadline"):
                    import time
                    row["deadline"] = _lv(w["deadline"])
                    row["deadline_in"] = _hm(w["deadline"] - time.time())
                    row["need"] = "45 ч" if w["need_sec"] >= WEEKLY_FULL_SEC else "24 ч (можно сокращённый)"
                row["weekly_error"] = w.get("error")
                hist, _ = get_driver_rests(did)
                row["cards"] = [{"at": _lv(c["ts"]), "what": "вставил" if c["what"] == "CARD_INSERTED" else "вынул"}
                                for c in (hist or {}).get("cards", [])][-6:]
            else:
                row["weekly_error"] = werr
        out["drivers"].append(row)
    try:
        out["stops"] = [{"from": _lv(x["start"]), "to": "сейчас" if x["now"] else _lv(x["end"]),
                         "hours": _hm(x["end"] - x["start"]), "address": x["address"]}
                        for x in unit_stops(uid)][-8:]
    except Exception as e:
        out["stops_error"] = str(e)
    return jsonify(out)


@bp.route("/api/nearest-units")
def api_nearest_units():
    """v1.72: ближайшие к машине прицепы (kind=trailer) или тягачи (kind=truck) — для окна сцепки.
    /api/nearest-units?unit=OI-4310&kind=trailer -> {"items": [{"number", "km", "state"}...]} (до 3 шт.)"""
    if not MAPON_API_KEY:
        return jsonify({"error": "MAPON_API_KEY не настроен"}), 500
    try:
        units = fetch_units(MAPON_API_KEY)
        truck_ids = fetch_group_unit_ids(MAPON_API_KEY, HEAD_TRUCK_GROUP_ID)
    except Exception as e:
        return jsonify({"error": f"Mapon: {e}"}), 502
    me = find_unit_exact(units, request.args.get("unit"))
    if not me or me.get("lat") is None:
        return jsonify({"items": []})
    want_trailer = request.args.get("kind") != "truck"
    items = []
    for o in units:
        if o is me or o.get("lat") is None or o.get("lng") is None:
            continue
        if want_trailer and not is_trailer(o):
            continue
        if not want_trailer and o.get("unit_id") not in truck_ids:
            continue
        items.append({"number": o.get("number") or o.get("label"),
                      "km": round(haversine_km(me["lat"], me["lng"], o["lat"], o["lng"]), 3),
                      "state": (o.get("state") or {}).get("name")})
    items.sort(key=lambda x: x["km"])
    return jsonify({"items": items[:3]})


@bp.route("/api/mapon-units")
def api_mapon_units():
    """v1.69: служебная выгрузка ВСЕХ юнитов Mapon с группами — найти прицепы.
    /api/mapon-units            — таблица: id, номер, label, группы, тип, координаты, статус, поля
    /api/mapon-units?unit=<номер>&raw=1 — сырые данные одного юнита (с include рефки/температуры)"""
    import json
    if not MAPON_API_KEY:
        return jsonify({"error": "MAPON_API_KEY не настроен"}), 500
    # группы юнитов: id -> имя, и юнит -> [группы]
    groups, unit_groups, gerr = {}, {}, None
    try:
        gl = mapon_get(MAPON_BASE + "unit_groups/list.json", {"key": MAPON_API_KEY}).get("data") or {}
        glist = gl if isinstance(gl, list) else (gl.get("groups") or gl.get("unit_groups") or [])
        for g in glist:
            if not isinstance(g, dict):
                continue
            gid = g.get("id")
            groups[gid] = g.get("name") or g.get("title") or str(gid)
            try:
                for uid in fetch_group_unit_ids(MAPON_API_KEY, gid):
                    unit_groups.setdefault(uid, []).append(groups[gid])
            except Exception:
                pass
    except Exception as e:
        gerr = str(e)
    q = re.sub(r"[^0-9a-zа-я]", "", str(request.args.get("unit") or "").lower())
    if q and request.args.get("raw") == "1":
        out = {}
        for inc in (["reefer", "temperature", "fuel", "in_object", "driver", "device", "can"], []):
            try:
                params = {"key": MAPON_API_KEY}
                if inc:
                    params["include[]"] = inc
                units = mapon_get(MAPON_API_URL, params, timeout=40)["data"]["units"]
            except Exception as e:
                out[f"include={inc or 'нет'}"] = f"ошибка: {e}"
                continue
            norm = lambda x: re.sub(r"[^0-9a-zа-я]", "", str(x or "").lower())
            u = next((u for u in units if str(u.get("unit_id")) == q
                      or q == norm(u.get("number")) or q == norm(u.get("label"))), None)
            out[f"include={inc or 'нет'}"] = u if u else "юнит не найден"
            out["группы"] = unit_groups.get((u or {}).get("unit_id"), [])
            break
        return current_app.response_class(json.dumps(out, ensure_ascii=False, indent=1),
                                  mimetype="application/json; charset=utf-8")
    try:
        units = fetch_units(MAPON_API_KEY, force=True)
    except Exception as e:
        return jsonify({"error": f"unit/list: {e}"}), 502
    rows = []
    for u in units:
        st = u.get("state") or {}
        rows.append({"unit_id": u.get("unit_id"), "number": u.get("number"), "label": u.get("label"),
                     "groups": unit_groups.get(u.get("unit_id"), []),
                     "type": u.get("type") or u.get("vehicle_type") or u.get("unit_type"),
                     "title": u.get("vehicle_title"),
                     "gps": f"{u['lat']:.5f}, {u['lng']:.5f}" if u.get("lat") is not None else "",
                     "state": st.get("name"), "last_update": u.get("last_update"),
                     "fields": sorted(u.keys())})
    rows.sort(key=lambda r: (",".join(r["groups"]), str(r["number"] or r["label"] or "")))
    return current_app.response_class(json.dumps({"count": len(rows), "groups": groups, "groups_error": gerr,
                                          "units": rows}, ensure_ascii=False, indent=1),
                              mimetype="application/json; charset=utf-8")


@bp.route("/api/mapon-objects")
def api_mapon_objects():
    """Объекты Mapon: /api/mapon-objects (таблица) или ?format=csv (файл для Excel)."""
    if not MAPON_API_KEY:
        return jsonify({"error": "MAPON_API_KEY не настроен"}), 500
    try:
        objs = (mapon_get(MAPON_BASE + "object/list.json", {"key": MAPON_API_KEY}, timeout=60)
                .get("data") or {}).get("objects") or []
    except Exception as e:
        return jsonify({"error": f"object/list: {e}"}), 502
    groups = {}
    try:
        gl = mapon_get(MAPON_BASE + "object/list_groups.json", {"key": MAPON_API_KEY}).get("data") or {}
        for g in gl.get("groups") or gl.get("object_groups") or (gl if isinstance(gl, list) else []):
            if isinstance(g, dict):
                groups[str(g.get("id"))] = g.get("name") or g.get("title") or ""
    except Exception:
        pass
    rows = []
    for o in objs:
        lat, lng, n = _wkt_center(o.get("wkt"))
        rows.append({"id": o.get("id"), "name": (o.get("name") or "").strip(),
                     "group": groups.get(str(o.get("group_id")), str(o.get("group_id") or "")),
                     "lat": lat, "lng": lng, "points": n,
                     "gps": f"{lat:.5f}, {lng:.5f}" if lat is not None else "",
                     "created": (o.get("created") or "")[:10], "updated": (o.get("updated") or "")[:10],
                     "private": o.get("private")})
    rows.sort(key=lambda r: r["name"].lower())
    if request.args.get("format") == "csv":
        import csv, io
        buf = io.StringIO()
        w = csv.writer(buf, delimiter=";")
        w.writerow(["id", "Name", "Group", "GPS", "Точек в полигоне", "Создан", "Изменён"])
        for r in rows:
            w.writerow([r["id"], r["name"], r["group"], r["gps"], r["points"], r["created"], r["updated"]])
        return current_app.response_class("\ufeff" + buf.getvalue(), mimetype="text/csv; charset=utf-8",
                                  headers={"Content-Disposition": "attachment; filename=mapon_objects.csv"})
    import json
    return current_app.response_class(json.dumps({"count": len(rows), "groups": sorted(set(r["group"] for r in rows)),
                                          "objects": rows}, ensure_ascii=False, indent=1),
                              mimetype="application/json; charset=utf-8")


@bp.route("/api/mapon-check")
def api_mapon_check():
    """Проверка прав ключа на новые методы: /api/mapon-check?unit=<номер или id>&raw=1"""
    import time
    if not MAPON_API_KEY:
        return jsonify({"error": "MAPON_API_KEY не настроен"}), 500
    now = int(time.time())
    import json
    norm = lambda x: re.sub(r"[^0-9a-zа-я]", "", str(x or "").lower())
    q = norm(request.args.get("unit"))
    raw = request.args.get("raw") == "1"
    out = {}
    try:
        units = fetch_units(MAPON_API_KEY)
        group_ids = fetch_group_unit_ids(MAPON_API_KEY, HEAD_TRUCK_GROUP_ID)
    except Exception as e:
        return jsonify({"error": f"unit/list: {e}"}), 502
    pool = [u for u in units if u["unit_id"] in group_ids] or units
    unit = None
    if q:
        unit = next((u for u in units if str(u["unit_id"]) == q), None) or next(
            (u for u in units if q in norm(u.get("number")) or q in norm(u.get("label"))), None)
        if not unit:
            return jsonify({"error": f"трак '{request.args.get('unit')}' не найден"}), 404
    unit = unit or (pool[0] if pool else None)
    if not unit:
        return jsonify({"error": "трак не найден"}), 404
    uid = unit["unit_id"]
    out["трак"] = {"unit_id": uid, "номер": unit.get("number") or unit.get("label")}

    # 1) тахограф -> driver_id
    drivers = []
    try:
        d = mapon_get(MAPON_TACHO_URL, {"key": MAPON_API_KEY, "unit_id": uid}).get("data") or {}
        drivers = [v for k, v in sorted(d.items()) if k.startswith("driver") and isinstance(v, dict)]
        out["driving_time_extended"] = {"ok": True, "водители": [
            {"driver_id": x.get("driver_id"),
             "имя": " ".join(filter(None, [x.get("driver_name"), x.get("driver_surname")])),
             "состояние": x.get("current_state")} for x in drivers]}
    except Exception as e:
        out["driving_time_extended"] = {"ok": False, "ошибка": str(e)}

    # 2) daily_activities по каждому водителю
    da = {}
    for x in drivers:
        did = x.get("driver_id")
        if not did:
            continue
        try:
            da[str(did)] = _check_daily_activities(did, now)
            if raw:
                da[str(did)]["raw"] = mapon_get(MAPON_BASE + "driver/daily_activities.json",
                    {"key": MAPON_API_KEY, "driver": did,
                     "from": _utc_iso(now - 2 * 86400), "till": _utc_iso(now)})
        except Exception as e:
            err = {"ok": False, "ошибка": str(e)}
            try:   # кусок сырого ответа, чтобы увидеть формат
                r0 = mapon_get(MAPON_BASE + "driver/daily_activities.json",
                               {"key": MAPON_API_KEY, "driver": did,
                                "from": _utc_iso(now - 86400), "till": _utc_iso(now)})
                err["образец"] = json.dumps(r0, ensure_ascii=False)[:1500]
            except Exception:
                pass
            da[str(did)] = err
    out["driver/daily_activities"] = da or {"ok": False, "ошибка": "нет driver_id от тахографа"}

    # 3) route/list за 2 суток
    try:
        d = mapon_get(MAPON_BASE + "route/list.json",
                      {"key": MAPON_API_KEY, "unit_id": uid,
                       "from": _utc_iso(now - 2 * 86400), "till": _utc_iso(now)}, timeout=30)
        rts = [r for u in (d.get("data") or {}).get("units") or [] for r in (u.get("routes") or [])]
        stops = [r for r in rts if r.get("type") == "stop"]
        res = {"ok": True, "поездок": sum(1 for r in rts if r.get("type") == "route"),
               "стоянок": len(stops),
               "последние_стоянки": [{"с": (s.get("start") or {}).get("time"),
                                      "по": (s.get("end") or {}).get("time"),
                                      "адрес": (s.get("start") or {}).get("address")} for s in stops[-5:]]}
        if raw:
            res["raw"] = rts[-6:]
        out["route/list"] = res
    except Exception as e:
        out["route/list"] = {"ok": False, "ошибка": str(e)}

    # 4) объекты
    try:
        objs = (mapon_get(MAPON_BASE + "object/list.json", {"key": MAPON_API_KEY}).get("data") or {}).get("objects") or []
        out["object/list"] = {"ok": True, "объектов": len(objs),
                              "примеры": [o.get("name") for o in objs[:10]]}
    except Exception as e:
        out["object/list"] = {"ok": False, "ошибка": str(e)}

    resp = current_app.response_class(json.dumps(out, ensure_ascii=False, indent=2),
                              mimetype="application/json; charset=utf-8")
    return resp
