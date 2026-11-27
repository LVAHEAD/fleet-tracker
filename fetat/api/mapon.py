"""Машины и прицепы из Mapon: список, Truck Info, ближайшие, выгрузки юнитов и объектов, служебная проверка."""
import math
import re
import time as _time

from flask import Blueprint, current_app, jsonify, request

from fetat.clients.mapon import (
    _check_daily_activities, driver_has_data, fetch_group_unit_ids, fetch_units, get_driver_history, get_driver_rests,
    get_tacho, unit_stop_at, _route_list,
    ACT_DAYS, MAPON_API_URL, MAPON_BASE, mapon_get, MAPON_TACHO_URL, unit_moving, unit_stops,
)
from fetat.config import HEAD_TRUCK_GROUP_ID, MAPON_API_KEY
from fetat.domain.points import find_unit_exact, object_at
from fetat.domain.regions import nearest_region_code
from fetat.domain.rests_history import long_history
from fetat.domain.tacho import _team, tacho_no_subscription, tacho_panel, WEEKLY_FULL_SEC, WEEKLY_MIN_SEC, WEEKLY_PERIOD_SEC, designate_weekly, weekly_compensation, weekly_late, weekly_status
from fetat.domain.trailers import is_trailer, reefer_log, reefer_log_events
from fetat.utils.geo import haversine_km, _wkt_center, _wkt_vertices
from fetat.utils.timefmt import _hm, _lv, _utc_iso
from fetat.utils.log import warn

bp = Blueprint("mapon", __name__)


def _near_code(lat, lng):
    """Код региона рядом (до 150 км по прямой), иначе None."""
    if lat is None or lng is None:
        return None
    code, d = nearest_region_code(lat, lng)
    return code if code and d <= 150 else None


@bp.route("/api/units")
def api_units():
    """Список машин из группы HEAD TRUCK — для дропдауна на фронтенде."""
    if not MAPON_API_KEY:
        return jsonify({"error": "MAPON_API_KEY не настроен на сервере"}), 500
    try:
        all_units = fetch_units(MAPON_API_KEY)
        group_ids = fetch_group_unit_ids(MAPON_API_KEY, HEAD_TRUCK_GROUP_ID)
        # v3.38: у тягачей — где стоят / едут и курс: слой «все машины» на картах Локатора и From → To
        result = [
            {"unit_id": u["unit_id"], "number": u.get("number") or u.get("label"), "kind": "truck",
             "lat": u.get("lat"), "lng": u.get("lng"),
             "st": "driving" if (u.get("state") or {}).get("name") == "driving" else "standing",
             "dir": next((u.get(k) for k in ("direction", "course", "heading", "angle")
                          if isinstance(u.get(k), (int, float))), None),
             # v3.41: скорость, сколько в текущем состоянии (сек) и ближайший код региона — для подсказки на карте
             "spd": u.get("speed") if isinstance(u.get("speed"), (int, float)) else None,
             "dur": (u.get("state") or {}).get("duration"),
             "code": _near_code(u.get("lat"), u.get("lng"))}
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


@bp.route("/api/positions")
def api_positions():
    """v3.299: лёгкий список позиций тягачей для живой карты Флота — номер, координаты, едет / стоит, курс.
    Без прицепов, кодов регионов, скорости и длительности; тот же кеш Mapon, что у /api/units."""
    if not MAPON_API_KEY:
        return jsonify({"error": "MAPON_API_KEY не настроен на сервере"}), 500
    try:
        all_units = fetch_units(MAPON_API_KEY)
        group_ids = fetch_group_unit_ids(MAPON_API_KEY, HEAD_TRUCK_GROUP_ID)
        result = [
            {"number": u.get("number") or u.get("label"), "kind": "truck", "lat": u.get("lat"), "lng": u.get("lng"),
             "st": "driving" if (u.get("state") or {}).get("name") == "driving" else "standing",
             "dir": next((u.get(k) for k in ("direction", "course", "heading", "angle")
                          if isinstance(u.get(k), (int, float))), None)}
            for u in all_units
            if u["unit_id"] in group_ids and u.get("lat") is not None and u.get("lng") is not None
        ]
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


_drv_index = {"at": 0, "rows": []}


DRV_INDEX_TTL = 600             # индекс «водитель → трак» — раз в 10 мин, тахограф каждой машины и так в кеше на 5 мин


def _driver_index():
    """Водители с картой в тахографах тягачей группы HEAD TRUCK: [{name, unit_id, number, state, driver_id}]."""
    import time
    from concurrent.futures import ThreadPoolExecutor
    if time.time() - _drv_index["at"] < DRV_INDEX_TTL and _drv_index["rows"]:
        return _drv_index["rows"]
    group_ids = fetch_group_unit_ids(MAPON_API_KEY, HEAD_TRUCK_GROUP_ID)
    units = [u for u in fetch_units(MAPON_API_KEY) if u["unit_id"] in group_ids]

    def one(u):
        try:
            tacho, _ = get_tacho(u["unit_id"])
        except Exception as e:
            warn("mapon:drv_index", e)
            return []
        return [{"name": " ".join(filter(None, [d.get("driver_name"), d.get("driver_surname")])),
                 "unit_id": u["unit_id"], "number": u.get("number") or u.get("label"),
                 "state": d.get("current_state"), "driver_id": d.get("driver_id")}
                for d in (tacho or {}).get("drivers") or [] if driver_has_data(d)]

    with ThreadPoolExecutor(max_workers=6) as ex:
        rows = [r for part in ex.map(one, units) for r in part if r["name"]]
    _drv_index.update(at=time.time(), rows=rows)
    return rows


@bp.route("/api/driver-search")
def api_driver_search():
    """Поиск водителя по имени / фамилии среди тех, у кого сейчас карта в тахографе тягача."""
    if not MAPON_API_KEY:
        return jsonify({"error": "MAPON_API_KEY не настроен"}), 500
    norm = lambda x: re.sub(r"[^0-9a-zа-яёāčēģīķļņšūž]", "", str(x or "").lower())
    q = norm(request.args.get("q"))
    if len(q) < 2:
        return jsonify({"drivers": []})
    try:
        rows = _driver_index()
    except Exception as e:
        return jsonify({"error": f"Mapon: {e}"}), 502
    hit = [r for r in rows if q in norm(r["name"])][:15]
    return jsonify({"drivers": [{"name": r["name"], "unit_id": r["unit_id"], "number": r["number"],
                                 "state": r["state"]} for r in hit]})


def _unit_st(u):
    """v3.328: едет / стоит (как в /api/positions) — для значка найденного трака."""
    return "driving" if (u.get("state") or {}).get("name") == "driving" else "standing"


def _unit_dir(u):
    return next((u.get(k) for k in ("direction", "course", "heading", "angle") if isinstance(u.get(k), (int, float))), None)


def _track_ts(v, default):
    """Время из параметра: ts, «ГГГГ-ММ-ДД», «ГГГГ-ММ-ДД ЧЧ:ММ» или ISO с Z — всё в UTC."""
    from datetime import datetime, timezone
    v = (v or "").strip()
    if not v:
        return default
    try:
        return float(v)
    except ValueError:
        pass
    for f in ("%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(v, f).replace(tzinfo=timezone.utc).timestamp()
        except ValueError:
            continue
    raise ValueError(f"не понял время «{v}»")


@bp.route("/api/unit-track")
def api_unit_track():
    """Трек трака из Mapon route/list: ?unit=номер&from=ГГГГ-ММ-ДД[ ЧЧ:ММ]&to=…[&format=csv] (время UTC, до 31 суток; по умолчанию последние 2 суток)."""
    import csv
    import io
    from fetat.utils.geo import _decode_polyline
    if not MAPON_API_KEY:
        return jsonify({"error": "MAPON_API_KEY не настроен"}), 500
    try:
        till = _track_ts(request.args.get("to"), _time.time())
        frm = _track_ts(request.args.get("from"), till - 2 * 86400)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    if till <= frm:
        return jsonify({"error": "интервал пустой"}), 400
    if till - frm > 31 * 86400:
        return jsonify({"error": "не больше 31 суток"}), 400
    try:
        unit = _find_unit(request.args.get("unit"))
    except Exception as e:
        return jsonify({"error": f"Mapon: {e}"}), 502
    if not unit:
        return jsonify({"error": "трак не найден"}), 404
    raw, a = [], frm
    try:
        while a < till:                       # Mapon — кусками по 7 суток
            b = min(till, a + 7 * 86400)
            raw += _route_list(unit["unit_id"], a, b)
            a = b
    except Exception as e:
        return jsonify({"error": f"Mapon route/list: {e}"}), 502
    segs, seen = [], set()
    for r in raw:
        st, en = r.get("start") or {}, r.get("end") or {}
        key = (r.get("type"), st.get("time"))
        if key in seen:                       # куски на границе недель не дублируем
            continue
        seen.add(key)
        pts = []
        pl = r.get("polyline")
        if isinstance(pl, str) and pl:
            try:
                pts = [[float(x), float(y)] for x, y in _decode_polyline(pl)]
            except Exception as _e:
                warn("mapon:track", _e)
        segs.append({"type": r.get("type"), "start": st.get("time"), "end": en.get("time"),
                     "start_lat": st.get("lat"), "start_lng": st.get("lng"), "start_address": st.get("address"),
                     "end_lat": en.get("lat"), "end_lng": en.get("lng"), "end_address": en.get("address"),
                     "distance_km": round(float(r.get("distance") or 0) / 1000, 1), "points": pts})
    segs.sort(key=lambda x: x["start"] or "")
    if request.args.get("format") == "csv":
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["seg", "type", "start", "end", "km", "lat", "lng", "address"])
        for i, g in enumerate(segs):
            if g["points"]:
                for lat, lng in g["points"]:
                    w.writerow([i, g["type"], g["start"], g["end"], g["distance_km"], lat, lng, ""])
            else:
                w.writerow([i, g["type"], g["start"], g["end"], g["distance_km"], g["start_lat"], g["start_lng"], g["start_address"] or ""])
        return current_app.response_class(buf.getvalue(), mimetype="text/csv; charset=utf-8")
    return jsonify({"unit": unit.get("number") or unit.get("label"), "unit_id": unit["unit_id"],
                    "from": _utc_iso(frm), "till": _utc_iso(till), "segments": segs})


@bp.route("/api/truck-rest-stop")
def api_truck_rest_stop():
    """v3.360: где трак стоял во время отдыха водителя (Truck Info, клик по строке отдыха): ?unit=номер&from=ts&to=ts."""
    if not MAPON_API_KEY:
        return jsonify({"error": "MAPON_API_KEY не настроен"}), 500
    try:
        frm, till = float(request.args.get("from")), float(request.args.get("to"))
    except (TypeError, ValueError):
        return jsonify({"error": "нет интервала"}), 400
    if till <= frm:
        return jsonify({"error": "интервал пустой"}), 400
    try:
        unit = _find_unit(request.args.get("unit"))
    except Exception as e:
        return jsonify({"error": f"Mapon: {e}"}), 502
    if not unit:
        return jsonify({"error": "трак не найден"}), 404
    st, err = unit_stop_at(unit["unit_id"], frm, till)
    if not st:
        return jsonify({"error": err}), 404
    return jsonify({"lat": st["lat"], "lng": st["lng"], "address": st.get("address") or "",
                    "from": _lv(st["start"]), "to": "сейчас" if st["now"] else _lv(st["end"]),
                    "hours": _hm(st["end"] - st["start"])})


BASE_IDLE_SEC = 66 * 3600      # v3.392: отдых от 66 ч на Базе — простой, каденцию недельного не начинает (Nizomov, 11.11)
BASE_IDLE_KM = 15.0      # район Базы: Румбула (11 км) тоже считается
_base_idle_cache = {}


def _base_idle(uid, rest, dbg=None):
    """Отдых от 66 ч, где трак всё время был в районе Базы (до 15 км от Baza Parking из «Адресов» или от запасной точки Базы;
    OM-8211 01–08.11 стоял и на Базе, и в Румбуле, 11 км). Две пробы Mapon по 3 ч: начало и середина отдыха — обе в районе Базы (конец не смотрим: OM-8211 08.11 до конца отдыха успел съездить в Эстонию с другим водителем).
    Нет данных — не простой. dbg — список для разбора: что вернул Mapon и сколько км до Базы."""
    if rest["end"] - rest["start"] < BASE_IDLE_SEC:
        return False
    key = (uid, int(rest["start"]), int(rest["end"]))
    if key in _base_idle_cache:
        if dbg is not None:
            dbg.extend(_base_idle_cache[key][1])
        return _base_idle_cache[key][0]
    from fetat.domain.addresses import BASE_FALLBACK, base_point
    infos = []
    blat, blng, _n = base_point()
    mid = (rest["start"] + rest["end"]) / 2
    H3 = 3 * 3600
    res = True
    for a, b in ((rest["start"], rest["start"] + H3), (mid - H3 / 2, mid + H3 / 2)):
        st, err = unit_stop_at(uid, a, b)
        info = {"from": int(a), "to": int(b), "err": err}
        if not st:
            if dbg is not None:
                dbg.extend(infos + [info])
            return False                  # не кешируем: Mapon мог не ответить
        km = min(haversine_km(st["lat"], st["lng"], blat, blng),
                 haversine_km(st["lat"], st["lng"], BASE_FALLBACK[0], BASE_FALLBACK[1]))
        ok = km <= BASE_IDLE_KM
        info.update(lat=st["lat"], lng=st["lng"], address=st.get("address") or "", km_to_base=round(km, 2), idle=ok)
        infos.append(info)
        res = res and ok
    _base_idle_cache[key] = (res, infos)
    if dbg is not None:
        dbg.extend(infos)
    return res


@bp.route("/api/truck-info")
def api_truck_info():
    """Truck Info: данные машины из Mapon (GET, по номеру)."""
    if not MAPON_API_KEY:
        return jsonify({"error": "MAPON_API_KEY не настроен"}), 500
    try:
        unit = _find_unit(request.args.get("unit"))
    except Exception as e:
        return jsonify({"error": f"Mapon: {e}"}), 502
    if not unit:
        return jsonify({"error": "трак не найден"}), 404
    uid = unit["unit_id"]
    if is_trailer(unit):   # v3.258: у прицепа нет водителей и тахографа — страница покажет лог рефа (/api/reefer-log)
        return jsonify({"unit_id": uid, "number": unit.get("number") or unit.get("label"), "trailer": True, "drivers": [],
                        "lat": unit.get("lat"), "lng": unit.get("lng"), "st": _unit_st(unit), "dir": _unit_dir(unit)})
    try:
        days = max(1, min(int(request.args.get("days") or 3), ACT_DAYS))
    except ValueError:
        days = 3
    out = {"unit_id": uid, "number": unit.get("number") or unit.get("label"), "drivers": [], "days": days,
           "lat": unit.get("lat"), "lng": unit.get("lng"), "st": _unit_st(unit), "dir": _unit_dir(unit)}
    tacho, terr = get_tacho(uid)
    if not tacho:
        out["tacho_error"] = terr
    else:
        try:                                    # v3.362: панель «Tachograph» как всплывашка Флота (static/tacho-pop.js), без плана поездки
            out["panel"] = tacho_panel(tacho)
        except Exception as _e:
            out["panel_error"] = str(_e)[:120]
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
            moving = None
            if tacho and not _team(tacho):   # v3.327: одиночка — отдых «без карты» не там, где трак ехал
                try:
                    moving = unit_moving(uid)
                except Exception as _e:
                    warn("truck-info:moving", _e)
            w, werr = weekly_status(did, moving=moving)
            if w:
                hist_cur, _ = get_driver_rests(did)
                lh = long_history(did, hist_cur)          # v3.355: окно Mapon + хранилище (до 56 дн.)
                cur_starts = {x["start"] for x in w["weekly"]}
                # v3.361: отдых, начатый до начала данных (идёт с края окна), берём, если виден уже от 45 ч (edge — начало раньше)
                older = [{"start": r["start"], "end": r["end"], "full": r["end"] - r["start"] >= WEEKLY_FULL_SEC,
                          "src": r["src"], "clipped": False, "edge": r["start"] <= lh["from"] + 60}
                         for r in lh["rests"]
                         if r["end"] - r["start"] >= WEEKLY_MIN_SEC
                         and (r["start"] > lh["from"] + 60 or r["end"] - r["start"] >= WEEKLY_FULL_SEC)
                         and r["start"] <= lh["window_from"] + 60 and r["start"] not in cur_starts]
                wsrc = older + list(w["weekly"])
                row["weekly"] = [{"from": _lv(x["start"]), "to": _lv(x["end"]), "hours": _hm(x["end"] - x["start"]),
                                  "full": x["full"], "nocard": any(s in ("can", "unkn") for s in x["src"]),
                                  "clipped": x.get("clipped", False), "ts": x["start"], "te": x["end"], "edge": bool(x.get("edge"))}
                                 for x in wsrc]
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
                hist = lh
                row["comp_days"] = max(1, int((_time.time() - lh["from"]) // 86400))
                row["comp"] = [{"from": _lv(c["start"]), "to": _lv(c["end"]), "hours": _hm(c["hours"]),
                                "deficit": _hm(c["deficit"]),      # v3.301: ЧЧ:ММ (раньше — целые часы вверх)
                                "left": _hm(c["left"]) if c["left"] >= 60 else None,
                                "deadline": _lv(c["deadline"]), "status": c["status"],
                                "until21": _lv(c["end"] + 21 * 86400).split(" ")[0],
                                "done_at": _lv(c["done_at"]).split(" ")[0] if c.get("done_at") else None,
                                "ts": c["start"], "te": c["end"], "dts": c.get("done_start"), "dte": c.get("done_at")}      # v3.357: «до» = конец отдыха + 21 день
                               for c in weekly_compensation(hist)]
                # правило диспетчеров (только Truck Info): недельный — один в неделе, самый длинный; остальные — «большая 9-ка»
                all_rests = (hist or {}).get("rests") or []
                idle_dbg = []
                idle = [r for r in all_rests if _base_idle(uid, r, idle_dbg)]      # v3.392: простой на Базе — вне цепочки недельных
                row["idle_dbg"] = idle_dbg
                desig = designate_weekly(all_rests, (hist or {}).get("from") or 0, idle)
                for x, src in zip(row["weekly"], wsrc):   # недельный — если лежит внутри выбранного (допуск 1 мин)
                    x["daily"] = not any(d["start"] - 60 <= src["start"] and src["end"] <= d["end"] + 60 for d in desig)
                    x["base_idle"] = any(abs(r["start"] - src["start"]) <= 60 and abs(r["end"] - src["end"]) <= 60 for r in idle)
                    if x["base_idle"]:
                        x["daily"] = False
                late = weekly_late(desig)
                for x, src in zip(row["weekly"], wsrc):   # v3.383: недельный начался позже 6 суток от прошлого — «поздно на Х ч»
                    for d, lt in zip(desig, late):
                        if lt and d["start"] - 60 <= src["start"] and src["end"] <= d["end"] + 60:
                            x["late"] = _hm(lt)
                if not desig and idle and not w.get("ongoing"):
                    # v3.399: выехали с Базы после простоя, недельного после него ещё нет — срок 6 суток от конца простоя (как у Мапон)
                    import time
                    dl = max(r["end"] for r in idle) + WEEKLY_PERIOD_SEC
                    row["deadline"], row["deadline_in"] = _lv(dl), _hm(dl - time.time())
                    row["need"] = "24 ч (можно сокращённый)"
                if desig and not w.get("ongoing"):
                    import time
                    last = desig[-1]
                    red = last["end"] - last["start"] < WEEKLY_FULL_SEC
                    dl = last["end"] + WEEKLY_PERIOD_SEC
                    row["deadline"], row["deadline_in"] = _lv(dl), _hm(dl - time.time())
                    row["need"] = "45 ч" if red else "24 ч (можно сокращённый)"
                    # «или-или» (23.11): последний недельный сокращённый и окно 6 суток от прошлого недельного ещё открыто —
                    # успеют встать ещё на 24ку до конца окна, тогда последний станет «9кой»; не успеют — он остаётся недельным
                    if red and len(desig) >= 2:
                        wend = desig[-2]["end"] + WEEKLY_PERIOD_SEC
                        if wend > time.time():
                            row["alt"] = {"until": _lv(wend), "until_in": _hm(wend - time.time()),
                                          "from": _lv(last["start"]), "to": _lv(last["end"])}
                row["cards"] = [{"at": _lv(c["ts"]), "what": "вставил" if c["what"] == "CARD_INSERTED" else "вынул"}
                                for c in (hist or {}).get("cards", [])][-6:]
            else:
                row["weekly_error"] = werr
            hist, herr = get_driver_history(did, days)
            if hist:
                row["history"] = [{"from": _lv(g["start"]), "to": _lv(g["end"]), "status": g["status"],
                                   "hours": _hm(g["end"] - g["start"]), "src": g["src"]} for g in hist["acts"]]
                row["history_cards"] = [{"at": _lv(c["ts"]), "what": c["what"]} for c in hist["cards"]]
            else:
                row["history_error"] = herr
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
            except Exception as _e:
                warn("mapon:179", _e)
                pass
    except Exception as e:
        gerr = str(e)
    q = re.sub(r"[^0-9a-zа-я]", "", str(request.args.get("unit") or "").lower())
    if q and request.args.get("raw") == "1":
        out = {}
        for inc in (["reefer", "temperature", "fuel", "in_object", "driver", "device", "can", "weights"], []):
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


_objs_cache = {"t": 0.0, "objs": None}   # v3.55: кеш списка объектов Mapon


@bp.route("/api/mapon-object-at")
def api_mapon_object_at():
    """v3.231: объект Mapon у точки ?lat=&lng= (карточка адреса): {"object": {"name", "group"} | null}."""
    try:
        lat, lng = float(request.args.get("lat")), float(request.args.get("lng"))
    except (TypeError, ValueError):
        return jsonify({"error": "нужны lat и lng"}), 400
    if not MAPON_API_KEY:
        return jsonify({"error": "MAPON_API_KEY не настроен"}), 500
    try:
        return jsonify({"object": object_at(lat, lng, request.args.get("strict") == "1")})
    except Exception as e:
        warn("mapon:object_at", e)
        return jsonify({"error": "Mapon недоступен"}), 502


@bp.route("/api/mapon-objects")
def api_mapon_objects():
    """Объекты Mapon: /api/mapon-objects (таблица) или ?format=csv (файл для Excel)."""
    if not MAPON_API_KEY:
        return jsonify({"error": "MAPON_API_KEY не настроен"}), 500
    import time
    now = time.time()
    if _objs_cache["objs"] is None or now - _objs_cache["t"] > 600:   # v3.55: список объектов — кеш на 10 минут
        try:
            _objs_cache["objs"] = (mapon_get(MAPON_BASE + "object/list.json", {"key": MAPON_API_KEY}, timeout=60)
                                   .get("data") or {}).get("objects") or []
            _objs_cache["t"] = now
        except Exception as e:
            if _objs_cache["objs"] is None:
                return jsonify({"error": f"object/list: {e}"}), 502
    objs = _objs_cache["objs"]
    groups = {}
    try:
        gl = mapon_get(MAPON_BASE + "object/list_groups.json", {"key": MAPON_API_KEY}).get("data") or {}
        for g in gl.get("groups") or gl.get("object_groups") or (gl if isinstance(gl, list) else []):
            if isinstance(g, dict):
                groups[str(g.get("id"))] = g.get("name") or g.get("title") or ""
    except Exception as _e:
        warn("mapon:248", _e)
        pass
    rows = []
    for o in objs:
        lat, lng, n = _wkt_center(o.get("wkt"))
        rows.append({"id": o.get("id"), "name": (o.get("name") or "").strip(),
                     "group": groups.get(str(o.get("group_id")), str(o.get("group_id") or "")),
                     "lat": lat, "lng": lng, "points": n,
                     "gps": f"{lat:.5f}, {lng:.5f}" if lat is not None else "",
                     "created": (o.get("created") or "")[:10], "updated": (o.get("updated") or "")[:10],
                     "private": o.get("private"),
                     "poly": _wkt_vertices(o.get("wkt")) if n else []})
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


def _tacho_subscriptions():
    """v3.30: тахограф по тягачам группы HEAD: нет подписки (1015) / нет карт / ошибка / есть данные."""
    import json
    from concurrent.futures import ThreadPoolExecutor
    try:
        units = fetch_units(MAPON_API_KEY)
        ids = set(fetch_group_unit_ids(MAPON_API_KEY, HEAD_TRUCK_GROUP_ID))
    except Exception as e:
        return jsonify({"error": f"unit/list: {e}"}), 502
    trucks = [u for u in units if u.get("unit_id") in ids and not is_trailer(u)]
    with ThreadPoolExecutor(max_workers=4) as ex:
        res = list(ex.map(lambda u: get_tacho(u["unit_id"]), trucks))
    nosub, nocard, err, ok = [], [], {}, []
    for u, (data, e) in zip(trucks, res):
        num = u.get("number") or u.get("label") or str(u.get("unit_id"))
        if data:
            ok.append(num)
        elif tacho_no_subscription(e):
            nosub.append(num)
        elif e == "нет данных водителя":
            nocard.append(num)
        else:
            err[num] = e
    out = {"тягачей": len(trucks),
           "нет подписки на тахограф (Mapon 1015 — Tachograph remote download)": sorted(nosub),
           "подписка есть, карт в тахографе нет сейчас": sorted(nocard),
           "другая ошибка": err,
           "тахограф отвечает": len(ok)}
    return current_app.response_class(json.dumps(out, ensure_ascii=False, indent=1),
                                      mimetype="application/json; charset=utf-8")

def _shift_segments(unit_id, frm, till):
    """Отрезки route/list за [frm, till] кусками по 7 суток: [(тип, start_ts, end_ts, метры)]."""
    import time
    from datetime import datetime, timezone
    out, a = [], frm
    while a < till:
        b = min(till, a + 7 * 86400)
        d = mapon_get(MAPON_BASE + "route/list.json",
                      {"key": MAPON_API_KEY, "unit_id": unit_id, "from": _utc_iso(a), "till": _utc_iso(b)}, timeout=40)
        for u in (d.get("data") or {}).get("units") or []:
            for r in u.get("routes") or []:
                k = r.get("type")
                if k not in ("route", "stop"):
                    continue
                try:
                    f = lambda t: datetime.strptime(t, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp()
                    s_ts = f((r.get("start") or {})["time"])
                    e_raw = (r.get("end") or {}).get("time")
                    e_ts = f(e_raw) if e_raw else min(b, time.time())
                except Exception:
                    continue
                dist = float(r.get("distance") or 0)
                if k == "route" and e_ts - s_ts >= 1800 and dist > 0 and dist / (e_ts - s_ts) * 3.6 < 45:
                    continue            # паром (≥30 мин и медленно, как в gps_shift): не вождение и не км
                out.append((k, s_ts, e_ts, dist))
        a = b
    out.sort(key=lambda x: x[1])
    uniq, seen = [], set()
    for x in out:                       # куски на границе недель не дублируем
        if (x[0], x[1]) not in seen:
            seen.add((x[0], x[1]))
            uniq.append(x)
    return uniq


def _shifts_from_segments(segs, rest_h, min_km, frm, till):
    """Смена = поездки между стоянками >= rest_h часов. Смены на краях окна (неполные) отбрасываем."""
    shifts, cur = [], None
    for k, s, e, m in segs:
        if k == "stop":
            if e - s >= rest_h * 3600:
                if cur:
                    shifts.append(cur)
                cur = None
            continue
        if cur is None:
            cur = {"s": s, "e": e, "m": m, "drive": e - s}
        else:
            cur["e"] = e
            cur["m"] += m
            cur["drive"] += e - s
    if cur:
        shifts.append(cur)
    out = [x for x in shifts if x["s"] > frm + rest_h * 3600 and x["e"] < till - 600 and x["m"] / 1000 >= min_km]
    return out


TEAM_DAY_OVER_SEC = 10.5 * 3600      # как TEAM_HIST_DAY_SEC: больше за сутки — одиночке нельзя, значит экипаж


def _days_from_segments(segs, frm, till):
    """{день UTC (ts начала): [метры, секунды в движении]} по полным суткам окна; отрезок через полночь делим по времени."""
    days = {}
    for k, s, e, m in segs:
        if k != "route" or e <= s:
            continue
        a = s
        while a < e:
            d0 = a - a % 86400
            b = min(e, d0 + 86400)
            part = days.setdefault(d0, [0.0, 0.0])
            part[0] += m * (b - a) / (e - s)
            part[1] += b - a
            a = b
    first = frm - frm % 86400 + 86400          # первые и последние сутки окна неполные
    last = till - till % 86400
    return {d: v for d, v in days.items() if first <= d < last}


def _crew_row(num, segs, frm, till, min_km):
    """Строка рейтинга экипажа или None: трак — экипаж, если ≥3 суток и ≥25% рабочих суток с вождением > 10,5 ч."""
    import statistics
    days = _days_from_segments(segs, frm, till)
    work = {d: v for d, v in days.items() if v[0] / 1000 >= min_km}
    if not work:
        return None
    over = sum(1 for v in work.values() if v[1] > TEAM_DAY_OVER_SEC)
    if over < 3 or over < 0.25 * len(work):
        return None
    kms = [v[0] / 1000 for v in work.values()]
    drive_h = sum(v[1] for v in work.values()) / 3600
    return {"truck": num, "shifts": len(work), "avg": round(statistics.mean(kms)),
            "median": round(statistics.median(kms)), "max": round(max(kms)),
            "speed": round(sum(kms) / drive_h, 1) if drive_h else None,
            "drive_h": round(drive_h / len(work), 1), "over": over, "total": round(sum(kms))}


def _shift_km_ranking():
    """/api/mapon-check?shiftkm=1&days=30&rest_h=9&min_km=100[&format=csv] — км за смену по GPS (route/list), ранг по среднему."""
    import json, time, statistics
    from concurrent.futures import ThreadPoolExecutor
    try:
        days = max(3, min(int(request.args.get("days") or 30), 60))
        rest_h = max(4.0, min(float(request.args.get("rest_h") or 9), 24.0))
        mode = "shift" if request.args.get("mode") == "shift" else "crew"
        min_km = max(0.0, float(request.args.get("min_km") or (100 if mode == "shift" else 300)))
    except ValueError:
        return jsonify({"error": "days / rest_h / min_km — числа"}), 400
    try:
        units = fetch_units(MAPON_API_KEY)
        ids = set(fetch_group_unit_ids(MAPON_API_KEY, HEAD_TRUCK_GROUP_ID))
    except Exception as e:
        return jsonify({"error": f"unit/list: {e}"}), 502
    trucks = [u for u in units if u.get("unit_id") in ids and not is_trailer(u)]
    till = time.time()
    frm = till - days * 86400

    def one(u):
        try:
            return _shift_segments(u["unit_id"], frm, till), None
        except Exception as e:
            return [], str(e)[:120]
    with ThreadPoolExecutor(max_workers=4) as ex:
        res = list(ex.map(one, trucks))
    rows, errs = [], {}
    diag = {"ok": 0, "moving": 0, "segs": 0, "max_km": 0}
    cand = []
    for u, (segs, e) in zip(trucks, res):
        num = u.get("number") or u.get("label") or str(u.get("unit_id"))
        if e:
            errs[num] = e
            continue
        diag["ok"] += 1
        diag["segs"] += len(segs)
        if any(x[0] == "route" for x in segs):
            diag["moving"] += 1
            dd = _days_from_segments(segs, frm, till)
            wk = [v for v in dd.values() if v[0] / 1000 >= min_km]
            cand.append({"truck": num, "work": len(wk), "over": sum(1 for v in wk if v[1] > TEAM_DAY_OVER_SEC),
                         "max_h": round(max((v[1] for v in dd.values()), default=0) / 3600, 1),
                         "max_km": round(max((v[0] for v in dd.values()), default=0) / 1000)})
            if mode == "crew":
                dm = max((v[0] for v in dd.values()), default=0)
            else:
                dm = max((x["m"] for x in _shifts_from_segments(segs, rest_h, 0, frm, till)), default=0)
            diag["max_km"] = max(diag["max_km"], round(dm / 1000))
        if mode == "crew":
            row = _crew_row(num, segs, frm, till, min_km)
            if row:
                rows.append(row)
            continue
        if _crew_row(num, segs, frm, till, 300):     # экипаж: смены склеиваются, ему — режим «Экипажи»
            diag["crews_skipped"] = diag.get("crews_skipped", 0) + 1
            continue
        sh = _shifts_from_segments(segs, rest_h, min_km, frm, till)
        if not sh:
            continue
        kms = [x["m"] / 1000 for x in sh]
        drive_h = sum(x["drive"] for x in sh) / 3600
        rows.append({"truck": num, "shifts": len(sh), "avg": round(statistics.mean(kms)),
                     "median": round(statistics.median(kms)), "max": round(max(kms)),
                     "speed": round(sum(kms) / drive_h, 1) if drive_h else None,
                     "drive_h": round(drive_h / len(sh), 1), "total": round(sum(kms))})
    rows.sort(key=lambda r: -r["avg"])
    for i, r in enumerate(rows, 1):
        r["n"] = i
    if request.args.get("format") == "csv":
        import csv, io
        buf = io.StringIO()
        cols = ["n", "truck", "shifts", "avg", "median", "max", "speed", "drive_h", "total"] + (["over"] if mode == "crew" else [])
        w = csv.writer(buf, delimiter=";")
        u = "суток" if mode == "crew" else "смен"
        w.writerow(["#", "Трак", u.capitalize(), f"Км за {'сутки' if mode == 'crew' else 'смену'} (среднее)", "Медиана", "Макс", "Км/ч в движении", f"Ч в движении ({'в сутки' if mode == 'crew' else 'за смену'})", "Всего км"] + (["Суток >10,5 ч"] if mode == "crew" else []))
        for r in rows:
            w.writerow([r.get(c) for c in cols])
        return current_app.response_class("\ufeff" + buf.getvalue(), mimetype="text/csv; charset=utf-8",
                                          headers={"Content-Disposition": "attachment; filename=shift_km.csv"})
    out = {"mode": mode, "период, дней": days, "смена = между стоянками от, ч": rest_h, "смены короче, км — не считаем": min_km,
           "тягачей": len(trucks), "trucks": len(trucks), "в рейтинге": len(rows), "in_rating": len(rows), "diag": dict(diag, top=sorted(cand, key=lambda c: (-c["over"], -c["max_h"]))[:6], max_day_h=max((c["max_h"] for c in cand), default=0)), "ошибки": errs, "errors": errs, "рейтинг": rows, "rating": rows}
    return current_app.response_class(json.dumps(out, ensure_ascii=False, indent=1),
                                      mimetype="application/json; charset=utf-8")


# v3.258: лог рефа прицепа — включения за N суток (Mapon reefer/historic_period; нужны права ключа на reefer/*)
REEFER_LOG_TTL = 300
_reefer_log_cache = {}


def _iso_z(ts):
    from datetime import datetime, timezone
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


@bp.route("/api/reefer-log")
def api_reefer_log():
    """/api/reefer-log?unit=<номер или id>&days=14 — интервалы работы рефа, сводка, время UTC (ISO)."""
    import time
    if not MAPON_API_KEY:
        return jsonify({"error": "MAPON_API_KEY не настроен"}), 500
    try:
        days = max(1, min(int(request.args.get("days") or 14), 30))
    except ValueError:
        days = 14
    try:
        unit = _find_unit(request.args.get("unit"))
    except Exception as e:
        return jsonify({"error": f"Mapon: {e}"}), 502
    if not unit:
        return jsonify({"error": "юнит не найден"}), 404
    uid = unit["unit_id"]
    key = (uid, days)
    hit = _reefer_log_cache.get(key)
    if hit and time.time() - hit[0] < REEFER_LOG_TTL:
        return jsonify(hit[1])
    till = int(time.time())
    frm = till - days * 86400
    try:
        d = mapon_get(MAPON_BASE + "reefer/historic_period.json",
                      {"key": MAPON_API_KEY, "unit_id": uid, "from": _iso_z(frm), "till": _iso_z(till)}, timeout=40)
    except Exception as e:
        return jsonify({"error": f"Mapon: {e}"}), 502
    data = d.get("data") if isinstance(d, dict) else None
    state = (data or {}).get("state") if isinstance(data, dict) else None
    out = {"unit_id": uid, "number": unit.get("number") or unit.get("label"), "days": days,
           "from": _iso_z(frm), "till": _iso_z(till)}
    if not isinstance(state, dict) or not state:
        out["no_reefer"] = True       # у юнита нет данных рефа за период
    else:
        res = reefer_log(reefer_log_events(state), frm, till)
        iso = lambda t: _iso_z(t) if t else None
        out["on"] = [{"from": _iso_z(o["from"]), "till": _iso_z(o["till"]), "min": round(o["min"], 1), "kind": o["kind"]} for o in res["on"]]
        sm = dict(res["summary"])
        sm["last_on"], sm["last_ok"] = iso(sm["last_on"]), iso(sm["last_ok"])
        sm["total_min"], sm["longest_idle_min"] = round(sm["total_min"]), round(sm["longest_idle_min"])
        out["summary"] = sm
    _reefer_log_cache[key] = (time.time(), out)
    return jsonify(out)



# v3.257: пробный запрос истории рефа прицепа — есть ли у Mapon история за N суток (не для постоянной работы)
REEFER_PROBE_METHODS = ("reefer/runmodes", "reefer/list_temperature_data", "reefer/alert_list")


@bp.route("/api/reefer-probe")
def api_reefer_probe():
    """/api/reefer-probe?unit=<номер или id>&days=14[&m=reefer/runmodes][&raw=1]: что отдают методы reefer/* Mapon за период.
    Показывает число записей, первую / последнюю запись и ключи; raw=1 — сырой ответ (до 20 КБ на метод)."""
    import json
    from datetime import datetime, timedelta, timezone
    if not MAPON_API_KEY:
        return jsonify({"error": "MAPON_API_KEY не настроен"}), 500
    norm = lambda x: re.sub(r"[^0-9a-zа-я]", "", str(x or "").lower())
    q = norm(request.args.get("unit"))
    if not q:
        return jsonify({"error": "укажите ?unit=<номер или id прицепа>"}), 400
    try:
        days = max(1, min(60, int(request.args.get("days") or 14)))
    except ValueError:
        days = 14
    try:
        units = fetch_units(MAPON_API_KEY)
    except Exception as e:
        return jsonify({"error": f"unit/list: {e}"}), 502
    unit = next((u for u in units if str(u["unit_id"]) == q), None) or next(
        (u for u in units if q in norm(u.get("number")) or q in norm(u.get("label"))), None)
    if not unit:
        return jsonify({"error": f"юнит '{request.args.get('unit')}' не найден"}), 404
    till = datetime.now(timezone.utc).replace(microsecond=0)
    frm = till - timedelta(days=days)
    fmt = lambda d: d.strftime("%Y-%m-%dT%H:%M:%SZ")
    raw = request.args.get("raw") == "1"
    methods = [request.args["m"]] if request.args.get("m") else REEFER_PROBE_METHODS
    out = {"юнит": {"unit_id": unit["unit_id"], "номер": unit.get("number") or unit.get("label")},
           "период": {"from": fmt(frm), "till": fmt(till), "суток": days}, "методы": {}}
    for m in methods:
        if not str(m).startswith(("reefer/", "unit_data/")):
            out["методы"][m] = {"ok": False, "ошибка": "только reefer/* и unit_data/*"}
            continue
        try:
            d = mapon_get(f"https://mapon.com/api/v1/{m}.json",
                          {"key": MAPON_API_KEY, "unit_id": unit["unit_id"], "from": fmt(frm), "till": fmt(till)}, timeout=40)
            data = d.get("data") if isinstance(d, dict) else d
            items = data if isinstance(data, list) else None
            if items is None and isinstance(data, dict):   # вложенный список (units → [..]) — берём самый длинный
                lists = [v for v in data.values() if isinstance(v, list)]
                items = max(lists, key=len) if lists else None
            info = {"ok": True, "тип": type(data).__name__}
            if items is not None:
                info["записей"] = len(items)
                if items:
                    info["первая"], info["последняя"] = items[0], items[-1]
                    if isinstance(items[0], dict):
                        info["ключи"] = sorted(items[0].keys())
            else:
                info["ответ"] = data
            if raw:
                info["raw"] = json.dumps(data, ensure_ascii=False)[:20000]
            out["методы"][m] = info
        except Exception as e:
            out["методы"][m] = {"ok": False, "ошибка": str(e)[:300]}
    return jsonify(out)


@bp.route("/api/mapon-check")
def api_mapon_check():
    """Проверка прав ключа на новые методы: /api/mapon-check?unit=<номер или id>&raw=1
    v3.30: /api/mapon-check?tacho=1 — тахограф по всем тягачам группы: у кого нет подписки (Mapon 1015)."""
    import time
    if not MAPON_API_KEY:
        return jsonify({"error": "MAPON_API_KEY не настроен"}), 500
    if request.args.get("tacho") == "1":
        return _tacho_subscriptions()
    if request.args.get("shiftkm") == "1":
        return _shift_km_ranking()
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
             "состояние": x.get("current_state"),
             "есть_данные": driver_has_data(x),           # False — слот «NO CARD / NO DATA», в тахо-расчёте не водитель
             "now": x.get("now"), "today": x.get("today"), "week": x.get("week")} for x in drivers]}
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
            except Exception as _e:
                warn("mapon:372", _e)
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


# ---------- v3.368: история стоянок — где паркуются (Локатор: зона / город) ----------
@bp.route("/api/stops-where")
def api_stops_where():
    """/api/stops-where?code=ES46 | city=Barcelona [&days=28][&min_h=2][&format=csv] -> статистика и топ мест."""
    from fetat.domain.stops_history import status, where
    try:
        days = int(request.args.get("days") or 0) or None
        min_h = float(request.args.get("min_h") or 2)
    except ValueError:
        return jsonify({"error": "days / min_h — числа"}), 400
    code, city = request.args.get("code") or "", request.args.get("city") or ""
    if not code.strip() and not city.strip():
        return jsonify({"error": "нужен code (ES46) или city"}), 400
    try:
        names = {str(u["unit_id"]): (u.get("number") or u.get("label")) for u in fetch_units(MAPON_API_KEY)}
    except Exception:
        names = {}
    res = where(code=code, city=city, days=days, min_h=min_h, names=names, from_side=request.args.get("from_side") or None)
    try:
        from fetat.domain.parking_notes import attach
        attach(res["top"])
    except Exception as e:   # заметки не должны ронять отчёт
        warn("parking:attach", e)
    res["collector"] = status()
    if request.args.get("format") == "csv":
        import csv
        import io
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["n", "hours", "units", "lat", "lng", "address"])
        for t in res["top"]:
            w.writerow([t["n"], t["hours"], t["units"], t["lat"], t["lng"], t["address"]])
        return buf.getvalue(), 200, {"Content-Type": "text/csv; charset=utf-8"}
    return jsonify(res)


@bp.route("/api/stops-collect")
def api_stops_collect():
    """Ручной запуск сбора стоянок (первая выгрузка за ~28 дней) в фоне; ответ — состояние сборщика."""
    import threading

    from fetat.domain.stops_history import _unit_ids, collect_all, status
    if not MAPON_API_KEY:
        return jsonify({"error": "MAPON_API_KEY не настроен"}), 500
    st = status()
    if not st.get("running") and _time.time() - (st.get("last") or 0) >= 3600:   # v3.391: не чаще раза в час
        try:
            ids = _unit_ids()
        except Exception as e:
            return jsonify({"error": f"Mapon: {e}"}), 502
        threading.Thread(target=collect_all, args=(ids,), daemon=True).start()
    return jsonify(dict(status(), started=True))


# ---------- v3.381: заметки о паркингах ----------
@bp.route("/api/parking-note", methods=["POST"])
def api_parking_note():
    """POST {lat, lng, ok: yes|no|"", pay: paid|free|"", tags: [...], text} -> сохранённая заметка места."""
    from fetat.api.meta import current_user_email
    from fetat.domain.parking_notes import TAGS, save
    d = request.get_json(silent=True) or {}
    try:
        lat, lng = float(d["lat"]), float(d["lng"])
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "нужны lat и lng"}), 400
    return jsonify({"note": save(lat, lng, d, current_user_email()), "tags": TAGS})


@bp.route("/api/parking-map")
def api_parking_map():
    """Слой «Паркинги»: ?s=&w=&n=&e=границы карты &z=зум -> {places: [...], с заметками}."""
    from fetat.domain.parking_notes import attach
    from fetat.domain.stops_history import places
    try:
        s_, w_, n_, e_ = (float(request.args[k]) for k in ("s", "w", "n", "e"))
        z = int(float(request.args.get("z") or 12))
    except (KeyError, ValueError):
        return jsonify({"error": "нужны s, w, n, e (границы) и z"}), 400
    try:
        names = {str(u["unit_id"]): (u.get("number") or u.get("label")) for u in fetch_units(MAPON_API_KEY)}
    except Exception:
        names = {}
    res = places(s_, w_, n_, e_, zoom=z, min_n=2 if z < 9 else 1, names=names)
    try:
        attach(res)
    except Exception as e:
        warn("parking:attach", e)
    return jsonify({"places": res})
