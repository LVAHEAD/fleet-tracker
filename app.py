"""
Fleet ETA Tracker — веб-версия Mapon + Google Routes ETA Calculator
Версия: 3.04

История изменений — CHANGELOG.md. План рефакторинга — REFACTOR.md.
"""

import json
import math
import re
import os
from datetime import datetime, timezone, timedelta

import requests
from flask import Flask, jsonify, render_template, request

from fetat import APP_VERSION
from fetat.config import (
    MAPON_API_KEY, GOOGLE_API_KEY, GOOGLE_MAPS_JS_KEY, HEAD_TRUCK_GROUP_ID,
    RIGA_UTC_OFFSET, WEST_EUROPE_OFFSET, DATA_DIR,
    SHEET_ID, ADDRESS_SHEET, FREIGHT_SHEET, SETTINGS_SHEET, GOOGLE_PROJECT_ID, FLEET_ADMINS,
)
from fetat.utils.geo import (
    haversine_km, parse_gps, _GPS_RE, _encode_polyline, _decode_polyline,
    _wkt_center, _wkt_points, _point_in_poly,
)
from fetat.utils.timefmt import (
    format_duration, round_to_15min, time_now_ts, _iso_ts, _iso_utc, _utc_iso, _hm, _lv, _lv_time, _now_ms,
)
from fetat.utils.text import normalize, _hkey

from fetat.clients.mapon import (
    ACT_DAYS, ACT_TTL, GROUP_IDS_TTL, MAPON_ACTIVITIES_URL, MAPON_API_URL, MAPON_BASE,
    MAPON_GROUP_UNITS_URL, MAPON_OBJ_TTL, MAPON_SEM, MAPON_TACHO_URL, MAPON_UNITS_TTL,
    REEFER_TTL, TACHO_TTL, _act_cache, _act_lock, _check_daily_activities, _fetch_units_raw,
    _group_ids_cache, _mobj_cache, _reefer_cache, _reefer_lock, _tacho_cache, _tacho_lock,
    _units_cache, _units_lock, fetch_group_unit_ids, fetch_reefer_units, fetch_units,
    get_driver_rests, get_tacho, mapon_get, mapon_objects, unit_stops,
)
from fetat.clients.google_routes import (
    ALONG_ROUTE_MAX_OFF_KM, ALONG_ROUTE_TTL, ROUTES_API_URL, ROUTES_FREE_MONTH,
    ROUTE_CACHE_TTL, _along_cache, _along_lookup, _along_remember, _quota_day,
    _road_distance_km_google, _route_cache, _route_cache_lock, _route_stat, _route_stats,
    road_distance_km_google,
)
from fetat.clients.geocode import (
    GEO_CACHE_TTL, GEO_UA, NOMINATIM_URL, PHOTON_URL, _geo_cache, _geo_last_nominatim,
    _geo_lock, _geo_nominatim, _geo_photon, geocode, geocode_city,
)
from fetat.clients.sheets import (
    _sheets_token, read_sheet_values,
)
from fetat.clients.monitoring import (
    _gusage_cache, _monitoring_sum,
)
from fetat.clients.firestore import (
    FS_BASE, _fs_check, _fs_decode, _fs_headers, _fs_lock, _fs_tok,
)
from fetat.clients.nakordoni import (
    BANS_PAUSE, BANS_URL, BansBadRequest, BansRateLimited, _bans_cache, _bans_cc,
    _bans_fetch_group, _bans_fetch_lock, _bans_get, _bans_lock, _bans_store, _bans_window,
)

from fetat.domain.regions import (
    GEONAMES_CODES_ADDED, OUR_COUNTRIES, REGION_CODES, _country_at,
    _load_geonames_codes, get_region_country, nearest_region_code,
)
from fetat.domain.routing_rules import (
    BENELUX_FR, ES_PT, GEDSER, HELSINGBORG, HELSINGOR, INNSBRUCK, PUTTGARDEN, RODBY,
    ROSTOCK_FERRY, SCANDI, _ferry_pair_for_country, fleet_waypoints, pick_waypoints,
    pick_waypoints_by_country,
)
from fetat.domain.tacho import (
    BREAK_SEC, CONT_DRIVE_SEC, FORTNIGHT_MAX_SEC, FRESH_SOLO_TACHO, REST_MARGIN_DAILY,
    REST_MARGIN_WEEKLY, TACHO_SPEED_KMH, TEAM_DAY_SEC, WEEKLY_FULL_SEC, WEEKLY_MIN_SEC,
    WEEKLY_PERIOD_SEC, WEEK_MAX_SEC, _next_monday_utc, calc_eta, tacho_eta, tacho_summary,
    weekly_for_tacho, weekly_status,
)
from fetat.domain.trailers import (
    HITCH_BASE_KM, HITCH_DRIVING_KM, HITCH_STANDING_KM, REEFER_DEV_WARN, REEFER_FUEL_LOW_L,
    REEFER_STALE_SEC, TRAILER_FAR_KM, find_hitch, is_trailer, reefer_summary,
)
from fetat.domain.addresses import (
    ADDRESS_TTL_SEC, ADDRESS_TYPES, BASE_COUNTRY_WORDS, BASE_FALLBACK, BASE_NAME_KEYS,
    DOVOZ_COUNTRY_WORDS, _addr_cache, address_public, base_point, dovoz_country, find_address,
    get_addresses, is_base_word, parse_address_rows,
)
from fetat.domain.freights import (
    COUNTRY_ALIASES, FREIGHT_NEAR_KM, FREIGHT_ROAD_FACTOR, _client_key, _frt_cache, _pct,
    _region_ll, _set_cache, contract_of, get_contract_clients, get_freights,
    parse_freight_rows, parse_freight_value, parse_region_cell, parse_trip_date,
    similar_freights,
)
from fetat.domain.points import (
    DONE_HISTORY_DAYS, DONE_LEFT_KM, DONE_MIN_STOP_SEC, DONE_RADIUS_KM, DONE_STOPS_TTL,
    NEAR_LABEL_MAX_KM, ON_TARGET_OBJ_KM, ON_TARGET_RADIUS_KM, STATUS_RU, _done_stops_cache,
    find_unit_by_label, find_unit_exact, looks_like_gps_or_code, on_target, points_done,
    recent_stops, resolve_fleet_target, resolve_place_label, resolve_point, resolve_target,
    target_badge_info,
)
from fetat.domain.bans import (
    AT_NIGHT_FROM, AT_NIGHT_UNTIL, BANS_ADR_WORDS, BANS_COOLDOWN_429, BANS_FULL_TYPES,
    BANS_GROUP, BANS_MANUAL_MIN, BANS_ROUTE_STEP_KM, BANS_TTL, BRAND_WMI, COUNTRY_TZ,
    _at_night_bans, _ban_window_utc, _bans_build, _bans_refresh, _drive_intervals, _is_adr,
    bans_cached, bans_hits_text, bans_on_route, country_chain, fetch_bans, needs_at_night_ban,
    route_countries, unit_brand,
)

from fetat.store.fleet_store import (
    FLEET_COLL, FLEET_FIELD_RE, FLEET_LOCK_MS, FLEET_STORE, FLEET_TRASH_MS, FLEET_VALUE_MAX,
    FleetStoreFS, FleetStoreMem, _fleet_can_delete, _fleet_clean, _fleet_rid, _fleet_row_out,
    _fp,
)
from fetat.services.route_calc import (
    route_calc,
    MAX_INTERMEDIATES, _compute_multi_route, compute_multi_route,
)
from fetat.services.fleet_calc import (
    calc_row,
    UNLOAD_STOP_SEC, calc_extra_stops,
)

app = Flask(__name__)


# ---------- v1.33: Mapon — кеш списка машин и ограничение параллельных запросов ----------
# Mapon допускает максимум 5 одновременных запросов (ошибка 1011 "Request limit reached").
# Раньше каждая строка Флота при "Обновить всё" запрашивала весь список машин —
# теперь список берётся один раз и живёт в памяти MAPON_UNITS_TTL секунд.
import threading


# ---------- Правила принудительных маршрутов (обход Швейцарии, паромы на Скандинавию) ----------
# Пока применяются только во вкладке From -> To (/api/route), где обе точки заданы
# кодами регионов — страна извлекается из первых двух букв кода. Для вкладки "Флот"
# (текущая позиция машины из Mapon) страна отправления неизвестна без обратного
# геокодинга, поэтому там правила пока не применяются.


# ---------- v1.29: база фрахтов (лист "Фрахты") ----------


# ---------- Routes ----------

# v1.84 (2.0a): кто вошёл — IAP кладёт e-mail в заголовок "accounts.google.com:user@gmail.com".
# Без IAP (локально / до включения) — None. Заголовку можно верить только за IAP.
def current_user_email():
    v = request.headers.get("X-Goog-Authenticated-User-Email") or ""
    v = v.split(":", 1)[-1].strip().lower()
    return v or None


@app.route("/")
def index():
    return render_template("index.html", google_maps_js_key=GOOGLE_MAPS_JS_KEY, app_version=APP_VERSION,
                           user_email=current_user_email())


@app.route("/api/me")
def api_me():
    return jsonify({"email": current_user_email(), "iap": current_user_email() is not None})


@app.route("/api/units")
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


# ---------- v1.51: счётчик запросов к Google Routes (Cloud Monitoring) ----------


@app.route("/api/google-usage")
def api_google_usage():
    import time
    now = time.time()
    if _gusage_cache["data"] and now - _gusage_cache["at"] < 600 and request.args.get("refresh") != "1":
        return jsonify(_gusage_cache["data"])
    try:
        from zoneinfo import ZoneInfo
        pt = ZoneInfo("America/Los_Angeles")
    except Exception:
        pt = timezone(timedelta(hours=-7))
    end = datetime.now(timezone.utc)
    local = end.astimezone(pt)
    day0 = local.replace(hour=0, minute=0, second=0, microsecond=0)
    month0 = day0.replace(day=1)
    out = {"free": ROUTES_FREE_MONTH, "local_day": _route_stats.get("day"),
           "calls_local": _route_stats.get("calls", 0) if _route_stats.get("day") == _quota_day() else 0,
           "cache_hits": _route_stats.get("cache_hits", 0) if _route_stats.get("day") == _quota_day() else 0}
    try:
        import google.auth
        import google.auth.transport.requests
        creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/monitoring.read"])
        creds.refresh(google.auth.transport.requests.Request())
        out["month"] = _monitoring_sum(creds.token, month0.astimezone(timezone.utc), end)
        out["today"] = _monitoring_sum(creds.token, day0.astimezone(timezone.utc), end)
        # прогноз на месяц по среднему за прошедшие дни
        import calendar
        days_in = calendar.monthrange(local.year, local.month)[1]
        elapsed = max(1.0, (local - month0).total_seconds() / 86400)
        out["forecast"] = int(out["month"] / elapsed * days_in)
    except Exception as e:
        out["error"] = str(e)
    _gusage_cache.update(at=now, data=out)
    return jsonify(out)


# ---------- v1.58: история изменений для блокнота [.] (с v3.00 — из CHANGELOG.md) ----------
CHANGELOG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "CHANGELOG.md")


def read_changelog():
    try:
        with open(CHANGELOG_PATH, encoding="utf-8") as f:
            return f.read()
    except OSError:
        return ""


def parse_changelog(doc):
    """Записи вида "1.57 (2026-09-27) — текст" + строки с отступом. Старая нумерация
    "4 (2026-09-23)" тоже понимается. Возвращает [{ver, date, title, text}] свежие первыми."""
    items, cur = [], None
    for line in (doc or "").splitlines():
        m = re.match(r"^(\d+(?:\.\d+)?) \((\d{4})-(\d{2})-(\d{2})\)\s*[—-]?\s*(.*)$", line)
        if m:
            cur = {"ver": m.group(1), "date": f"{m.group(4)}.{m.group(3)}.{m.group(2)}",
                   "title": m.group(5).strip(), "lines": []}
            items.append(cur)
            continue
        if cur is None:
            continue
        if line.startswith("---") or (line and not line.startswith(" ")):
            cur = None if not line.startswith("---") else None
            continue
        if line.strip():
            cur["lines"].append(line.strip())
    out = []
    for it in items:
        out.append({"ver": it["ver"], "date": it["date"], "title": it["title"],
                    "text": "\n".join(it["lines"])})
    return out


@app.route("/api/changelog")
def api_changelog():
    return jsonify({"version": APP_VERSION, "items": parse_changelog(read_changelog())})


# ---------- v1.42: Truck Info — недельные отдыхи, карты, стоянки ----------


def _find_unit(q_raw):
    norm = lambda x: re.sub(r"[^0-9a-zа-я]", "", str(x or "").lower())
    q = norm(q_raw)
    if not q:
        return None
    units = fetch_units(MAPON_API_KEY)
    return (next((u for u in units if str(u["unit_id"]) == q), None)
            or next((u for u in units if norm(u.get("number")) == q or norm(u.get("label")) == q), None)
            or next((u for u in units if q in norm(u.get("number")) or q in norm(u.get("label"))), None))


@app.route("/api/truck-info")
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


# ---------- v1.52: выгрузка объектов Mapon (object/list) ----------


@app.route("/api/nearest-units")
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


@app.route("/api/mapon-units")
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
        return app.response_class(json.dumps(out, ensure_ascii=False, indent=1),
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
    return app.response_class(json.dumps({"count": len(rows), "groups": groups, "groups_error": gerr,
                                          "units": rows}, ensure_ascii=False, indent=1),
                              mimetype="application/json; charset=utf-8")


@app.route("/api/mapon-objects")
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
        return app.response_class("\ufeff" + buf.getvalue(), mimetype="text/csv; charset=utf-8",
                                  headers={"Content-Disposition": "attachment; filename=mapon_objects.csv"})
    import json
    return app.response_class(json.dumps({"count": len(rows), "groups": sorted(set(r["group"] for r in rows)),
                                          "objects": rows}, ensure_ascii=False, indent=1),
                              mimetype="application/json; charset=utf-8")


# ---------- v1.41: служебная проверка новых методов Mapon ----------


@app.route("/api/mapon-check")
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

    resp = app.response_class(json.dumps(out, ensure_ascii=False, indent=2),
                              mimetype="application/json; charset=utf-8")
    return resp


# ---------- v1.79: "точка пройдена" ✓ — по истории стоянок трака в Mapon ----------


@app.route("/api/calc", methods=["POST"])
def api_calc():
    """Строка Флота — fetat/services/fleet_calc.py: calc_row."""
    body, code = calc_row(request.get_json(force=True, silent=True) or {})
    return jsonify(body), code


@app.route("/api/route", methods=["POST"])
def api_route():
    """From → To — fetat/services/route_calc.py: route_calc."""
    body, code = route_calc(request.get_json(force=True, silent=True) or {})
    return jsonify(body), code


@app.route("/api/region-codes")
def api_region_codes():
    """v1.24, Локатор: все коды регионов одним списком [{code, lat, lng, place}]."""
    return jsonify({"codes": [
        {"code": code, "lat": v["lat"], "lng": v["lng"], "place": v.get("place", "")}
        for code, v in sorted(REGION_CODES.items())
    ]})


@app.route("/api/locate", methods=["POST"])
def api_locate():
    """
    v1.24, Локатор. body: {"q": "SE25" | "Jönköping" | "59.93, 10.86" | "OI-3194"}
    Возвращает точку и ближайший код региона (для кода — сам код).
    """
    payload = request.get_json(force=True, silent=True) or {}
    q = str(payload.get("q", "")).strip()
    if not q:
        return jsonify({"error": "Введите код, город, GPS или машину"}), 400

    units_cache = {}
    def units_getter():
        if "units" not in units_cache:
            units_cache["units"] = fetch_units(MAPON_API_KEY)
        return units_cache["units"]

    try:
        try:
            pt = resolve_point(q, units_getter)
        except ValueError as e:
            return jsonify({"error": str(e)}), 404

        exact = q.upper().replace(" ", "")
        if exact in REGION_CODES:
            code, dist = exact, 0.0
        else:
            code, dist = nearest_region_code(pt["lat"], pt["lng"])
        info = REGION_CODES.get(code, {})
        return jsonify({
            "lat": pt["lat"], "lng": pt["lng"],
            "label": pt["label"],
            "is_truck": pt["is_truck"],
            "is_code": exact in REGION_CODES,
            "code": code,
            "code_place": info.get("place", ""),
            "code_lat": info.get("lat"), "code_lng": info.get("lng"),
            "dist_km": round(dist, 1),
            "address": pt.get("address"),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 502


@app.route("/api/addresses")
def api_addresses():
    """v1.28: адресная база для подсказок. ?refresh=1 — перечитать таблицу сейчас."""
    import time
    items = get_addresses(force=request.args.get("refresh") == "1")
    return jsonify({
        "addresses": [{**address_public(a), "lat": a["lat"], "lng": a["lng"]} for a in items],
        "problems": _addr_cache["problems"],
        "error": _addr_cache["error"],
        "loaded_at": (datetime.fromtimestamp(_addr_cache["loaded_at"], timezone.utc)
                      + timedelta(hours=WEST_EUROPE_OFFSET)).strftime("%d/%m %H:%M") if _addr_cache["loaded_at"] else None,
    })


@app.route("/api/freights")
def api_freights():
    """v1.29: состояние базы фрахтов (для вкладки [.]). ?refresh=1 — перечитать сейчас."""
    get_freights(force=request.args.get("refresh") == "1")
    la = _frt_cache["loaded_at"]
    return jsonify({
        "stats": _frt_cache["stats"],
        "contract_clients": get_contract_clients(force=request.args.get("refresh") == "1"),
        "settings_error": _set_cache["error"],
        "error": _frt_cache["error"],
        "loaded_at": (datetime.fromtimestamp(la, timezone.utc) + timedelta(hours=WEST_EUROPE_OFFSET)).strftime("%d/%m %H:%M") if la else None,
    })


# ---------- v1.36/v1.38/v1.84: запреты движения грузовиков (nakordoni.eu, бесплатный JSON-фид) ----------


@app.route("/api/bans")
def api_bans():
    """Запреты движения из nakordoni.eu (кеш 3 ч; ?refresh=1 — не чаще раза в 10 мин)."""
    import time
    now = time.time()
    with _bans_lock:
        age = now - _bans_cache["at"]
        stale = _bans_cache["data"] is None or age > BANS_TTL or bool(
            (_bans_cache["data"] or {}).get("missing"))
        manual = request.args.get("refresh") == "1" and age > BANS_MANUAL_MIN
    if stale or manual:
        # если уже качает фоновое обновление — ждём его (до 40 с), а не шлём второй поток запросов
        if _bans_fetch_lock.acquire(timeout=40):
            try:
                _bans_refresh(max_age=BANS_MANUAL_MIN if manual else BANS_TTL)
            finally:
                _bans_fetch_lock.release()
    with _bans_lock:
        data = _bans_cache["data"]
        loaded = _bans_cache["at"]
        err = _bans_cache["error"]
    loaded_txt = ((datetime.fromtimestamp(loaded, timezone.utc) + timedelta(hours=WEST_EUROPE_OFFSET))
                  .strftime("%d/%m %H:%M")) if data else None
    if data is None:
        return jsonify({"error": err or "нет данных — попробуйте позже"}), 502
    return jsonify({**data, "error": err, "loaded_at": loaded_txt})


# ---------- v2.00: общий Флот на сервере (Firestore через REST, без лишних библиотек) ----------


def _fleet_user():
    return current_user_email() or "local"


@app.route("/api/fleet")
def api_fleet():
    """Общий Флот. Без since — все живые строки; с since (мс) — изменения с этого момента,
    включая удалённые (deleted=true). now — метка для следующего запроса."""
    now = _now_ms()
    since = request.args.get("since")
    try:
        if since:
            docs = FLEET_STORE.query(int(since) - 2000)   # запас на разницу часов инстансов
            return jsonify({"ok": True, "now": now, "user": _fleet_user(),
                            "changes": [dict(_fleet_row_out(d), deleted=bool(d["meta"].get("deleted"))) for d in docs]})
        docs = FLEET_STORE.query(None)
        live, trash = [], []
        for d in docs:
            m = d["meta"]
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
                        "admin": _fleet_user() in FLEET_ADMINS, "lock_ms": FLEET_LOCK_MS})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 503


@app.route("/api/fleet/sync", methods=["POST"])
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
                if op.get("new"):
                    meta.update(created_by=user, created_at=now, deleted=False)
                unset = [k for k in (op.get("unset") or []) if FLEET_FIELD_RE.match(str(k)) and k != "id"]
                FLEET_STORE.patch(rid, _fleet_clean(op.get("set")), unset, meta)
            done += 1
        except Exception as e:
            errors.append({"id": op.get("id"), "error": str(e)})
    code = 200 if not errors else (207 if done else 503)
    return jsonify({"ok": not errors, "now": now, "done": done, "errors": errors}), code


@app.route("/api/fleet/lock", methods=["POST"])
def api_fleet_lock():
    """v2.02: 🔒 строку правит один человек. {id} — занять/продлить на 60 с, {id, release:true} — отпустить.
    Занято другим — 409 {locked_by}."""
    body = request.get_json(force=True, silent=True) or {}
    user, now = _fleet_user(), _now_ms()
    try:
        rid = _fleet_rid(body.get("id"))
        d = FLEET_STORE.get(rid)
        if d is None or d["meta"].get("deleted"):
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


@app.route("/api/fleet/trash")
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


@app.route("/api/fleet/restore", methods=["POST"])
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


@app.route("/api/fleet/import", methods=["POST"])
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


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port, debug=False)
