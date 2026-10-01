"""
Fleet ETA Tracker — веб-версия Mapon + Google Routes ETA Calculator
Версия: 3.00

История изменений — CHANGELOG.md. План рефакторинга — REFACTOR.md.
"""

import json
import math
import re
import os
from datetime import datetime, timezone, timedelta

import requests
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)

MAPON_API_KEY = os.environ.get("MAPON_API_KEY", "")
GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY", "")
# Ключ для клиентского Maps JavaScript API (виден в браузере — это нормально для
# этого типа ключа, если он ограничен по HTTP referrer в Google Cloud Console).
# Если не задан отдельно, используется тот же GOOGLE_API_KEY.
GOOGLE_MAPS_JS_KEY = os.environ.get("GOOGLE_MAPS_JS_KEY", GOOGLE_API_KEY)
HEAD_TRUCK_GROUP_ID = int(os.environ.get("HEAD_TRUCK_GROUP_ID", "62269"))
APP_VERSION = "3.00"

MAPON_API_URL = "https://mapon.com/api/v1/unit/list.json"
MAPON_GROUP_UNITS_URL = "https://mapon.com/api/v1/unit_groups/list_units.json"
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
ROUTES_API_URL = "https://routes.googleapis.com/directions/v2:computeRoutes"

RIGA_UTC_OFFSET = 3
WEST_EUROPE_OFFSET = RIGA_UTC_OFFSET - 1

STATUS_RU = {"standing": "стоит", "driving": "едет"}

# Справочник кодов регионов (NO01, SE25 и т.п.) → координаты.
# Сгенерирован из файла GPS_Codes.xlsx; с v3.00 лежит в data/region_codes.json.
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
with open(os.path.join(DATA_DIR, "region_codes.json"), encoding="utf-8") as _f:
    REGION_CODES = json.load(_f)


# ---------- Вспомогательные функции (перенесены из Colab-версии) ----------

def format_duration(seconds):
    days, rem = divmod(int(seconds or 0), 86400)
    hours, rem = divmod(rem, 3600)
    minutes = rem // 60
    if days > 0:
        return f"{days}д {hours}ч {minutes}м"
    return f"{hours}ч {minutes}м"


def normalize(s):
    return str(s or "").lower().replace(" ", "").replace("-", "")


def find_unit_by_label(units, label_query):
    q = normalize(label_query)
    return [
        u for u in units
        if q in normalize(u.get("label", "")) or q in normalize(u.get("number", ""))
    ]


def haversine_km(lat1, lng1, lat2, lng2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def round_to_15min(dt: datetime) -> datetime:
    discard = timedelta(minutes=dt.minute % 15, seconds=dt.second, microseconds=dt.microsecond)
    dt -= discard
    if discard >= timedelta(minutes=7.5):
        dt += timedelta(minutes=15)
    return dt


def calc_eta(dist_km):
    duration_h = dist_km / 70
    now_utc = datetime.now(timezone.utc)
    eta_utc = now_utc + timedelta(hours=duration_h)
    eta_local = round_to_15min(eta_utc + timedelta(hours=WEST_EUROPE_OFFSET))
    return duration_h, eta_local


# ---------- v1.33: Mapon — кеш списка машин и ограничение параллельных запросов ----------
# Mapon допускает максимум 5 одновременных запросов (ошибка 1011 "Request limit reached").
# Раньше каждая строка Флота при "Обновить всё" запрашивала весь список машин —
# теперь список берётся один раз и живёт в памяти MAPON_UNITS_TTL секунд.
import threading
MAPON_UNITS_TTL = 45
MAPON_SEM = threading.BoundedSemaphore(3)   # наши одновременные запросы к Mapon (запас до лимита 5)
_units_lock = threading.Lock()
_units_cache = {"units": None, "at": 0.0}


def mapon_get(url, params, timeout=20):
    """GET к Mapon с ограничением параллельности. Возвращает data или бросает RuntimeError
    с кодом ошибки Mapon в тексте."""
    with MAPON_SEM:
        resp = requests.get(url, params=params, timeout=timeout)
    resp.raise_for_status()
    data = resp.json()
    if isinstance(data, dict) and "error" in data:
        err = data["error"] or {}
        raise RuntimeError(f"Mapon {err.get('code', '')}: {err.get('msg', 'API error')}")
    return data


def _fetch_units_raw(api_key):
    return mapon_get(MAPON_API_URL, {"key": api_key})["data"]["units"]


def fetch_units(api_key, force=False):
    """Список машин Mapon из кеша (MAPON_UNITS_TTL сек). Параллельные запросы ждут
    одну общую загрузку, а не шлют каждый свою."""
    import time
    with _units_lock:
        if force or _units_cache["units"] is None or time.time() - _units_cache["at"] > MAPON_UNITS_TTL:
            _units_cache["units"] = _fetch_units_raw(api_key)
            _units_cache["at"] = time.time()
        return _units_cache["units"]


# ---------- v1.70: прицепы (Mapon type == "trailer") — рефка, сцепка с тягачом ----------
REEFER_TTL = 60
_reefer_lock = threading.Lock()
_reefer_cache = {"at": 0.0, "by_id": None}
HITCH_DRIVING_KM = 0.5     # оба едут и ближе 500 м — сцепка
HITCH_STANDING_KM = 0.05   # оба стоят и ближе 50 м — вероятно сцепка
HITCH_BASE_KM = 1.5        # на Базе прицепы стоят кучей — сцепку не угадываем
REEFER_DEV_WARN = 3.0      # отклонение возврата от уставки, °C — подсветка
REEFER_STALE_SEC = 2 * 3600
REEFER_FUEL_LOW_L = 40     # v1.71: мало топлива в баке рефа, л
TRAILER_FAR_KM = 1.0       # v1.71: привязанный прицеп дальше — предупреждение


def is_trailer(u):
    return str((u or {}).get("type") or "").lower() == "trailer"


def fetch_reefer_units():
    """unit/list с include reefer + fuel (кеш REEFER_TTL сек, один запрос на всех)."""
    import time
    with _reefer_lock:
        if _reefer_cache["by_id"] is None or time.time() - _reefer_cache["at"] > REEFER_TTL:
            units = mapon_get(MAPON_API_URL, {"key": MAPON_API_KEY, "include[]": ["reefer", "fuel"]},
                              timeout=40)["data"]["units"]
            _reefer_cache["by_id"] = {u.get("unit_id"): u for u in units}
            _reefer_cache["at"] = time.time()
        return _reefer_cache["by_id"]


def _iso_ts(s):
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00")).timestamp()
    except Exception:
        return None


def reefer_summary(u):
    """Рефка прицепа -> {type, compartments:[{n, on, set, ret, sup, dev, stale, at}], fuel_l, warn}."""
    rf = (u or {}).get("reefer")
    fuel = next((f.get("value") for f in (u or {}).get("fuel") or []
                 if isinstance(f, dict) and f.get("value") is not None), None)
    fuel_low = fuel is not None and fuel < REEFER_FUEL_LOW_L
    if not isinstance(rf, dict):
        return {"compartments": [], "fuel_l": fuel, "fuel_low": fuel_low} if fuel is not None else None
    try:
        count = int(rf.get("refrigerator_compartment_count") or 0)
    except (TypeError, ValueError):
        count = 0
    now = time_now_ts()
    comps = []
    keys = sorted((k for k in rf if str(k).isdigit()), key=int)
    for k in keys:
        if count and int(k) >= count:
            continue
        c = rf.get(k) or {}
        t = c.get("temperature") or {}
        val = lambda n: (t.get(n) or {}).get("value")
        state = str((c.get("state") or {}).get("value") or "").lower()
        ret, sp, sup = val("return"), val("setpoint"), val("supply")
        at = _iso_ts((t.get("return") or {}).get("gmt") or (c.get("state") or {}).get("gmt"))
        on = state == "on"
        dev = round(ret - sp, 1) if on and isinstance(ret, (int, float)) and isinstance(sp, (int, float)) else None
        comps.append({"n": int(k) + 1, "on": on, "set": sp, "ret": ret, "sup": sup, "dev": dev,
                      "stale": bool(at and now - at > REEFER_STALE_SEC),
                      "at": (datetime.fromtimestamp(at, timezone.utc) + timedelta(hours=WEST_EUROPE_OFFSET)).strftime("%d/%m %H:%M") if at else None})
    warn = any(c["dev"] is not None and abs(c["dev"]) > REEFER_DEV_WARN and not c["stale"] for c in comps)
    return {"type": rf.get("refrigerator_type"), "compartments": comps, "fuel_l": fuel,
            "fuel_low": fuel_low, "warn": warn}


def time_now_ts():
    import time
    return time.time()


def find_hitch(unit, units, truck_ids):
    """Сцепка: для прицепа — тягач рядом, для тягача — прицеп рядом.
    Mapon их не связывает, угадываем по координатам. -> {"number", "sure", "km"} или None."""
    lat, lng = unit.get("lat"), unit.get("lng")
    if lat is None or lng is None:
        return None
    try:
        blat, blng, _ = base_point()
        if haversine_km(lat, lng, blat, blng) <= HITCH_BASE_KM:
            return None
    except Exception:
        pass
    me_trailer = is_trailer(unit)
    driving = ((unit.get("state") or {}).get("name") == "driving")
    best = None
    for o in units:
        if o is unit or o.get("lat") is None or o.get("lng") is None:
            continue
        if me_trailer and o.get("unit_id") not in truck_ids:
            continue
        if not me_trailer and not is_trailer(o):
            continue
        o_driving = (o.get("state") or {}).get("name") == "driving"
        d = haversine_km(lat, lng, o["lat"], o["lng"])
        if driving and o_driving and d <= HITCH_DRIVING_KM:
            sure = True
        elif not driving and not o_driving and d <= HITCH_STANDING_KM:
            sure = False
        else:
            continue
        if best is None or (sure, -d) > (best["sure"], -best["km"]):
            best = {"number": o.get("number") or o.get("label"), "sure": sure, "km": round(d, 3)}
    return best


# ---------- v1.33: тахограф (Mapon unit_data/driving_time_extended) и ETA по нему ----------
MAPON_TACHO_URL = "https://mapon.com/api/v1/unit_data/driving_time_extended.json"
TACHO_TTL = 300                 # данные тахографа обновляем не чаще раза в 5 минут на машину
TACHO_SPEED_KMH = 70
REST_MARGIN_DAILY = 3600        # запас к каждому суточному отдыху (смена, осмотр, заправка) — 1 ч
REST_MARGIN_WEEKLY = 1800       # запас к недельному отдыху — 30 мин
BREAK_SEC = 2700                # перерыв 45 мин (одиночка), без запаса
CONT_DRIVE_SEC = 16200          # 4:30 непрерывного вождения
_tacho_cache = {}               # unit_id -> {"at": ts, "data": dict|None, "error": str|None}
_tacho_lock = threading.Lock()


def get_tacho(unit_id):
    """Данные тахографа по машине (кеш TACHO_TTL). Возвращает (data, error)."""
    import time
    now = time.time()
    with _tacho_lock:
        c = _tacho_cache.get(unit_id)
        if c and now - c["at"] < TACHO_TTL:
            return c["data"], c["error"]
    try:
        d = mapon_get(MAPON_TACHO_URL, {"key": MAPON_API_KEY, "unit_id": unit_id}).get("data") or {}
        drivers = [v for k, v in sorted(d.items()) if k.startswith("driver") and isinstance(v, dict)]
        data, err = ({"drivers": drivers} if drivers else None), (None if drivers else "нет данных водителя")
    except Exception as e:
        data, err = None, str(e)
    with _tacho_lock:
        _tacho_cache[unit_id] = {"at": now, "data": data, "error": err}
    return data, err


# ---------- v1.42: недельный отдых по истории водителя (Mapon driver/daily_activities) ----------
MAPON_ACTIVITIES_URL = "https://mapon.com/api/v1/driver/daily_activities.json"
ACT_TTL = 1800                  # история водителя — не чаще раза в 30 мин
ACT_DAYS = 21                   # глубина истории (до 31 дня у Mapon)
WEEKLY_MIN_SEC = 24 * 3600      # отдых от 24 ч — недельный (сокращённый)
WEEKLY_FULL_SEC = 45 * 3600     # от 45 ч — обычный недельный
WEEKLY_PERIOD_SEC = 144 * 3600  # следующий недельный — не позже 6×24 ч после конца прошлого
_act_cache = {}                 # driver_id -> {"at", "data", "error"}
_act_lock = threading.Lock()


def _iso_utc(ts):
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def get_driver_rests(driver_id):
    """Отдыхи водителя за ACT_DAYS дней: склеенные подряд идущие REST (включая время
    без карты — Mapon заливает его REST с источником can/unkn), конец обрезан по "сейчас".
    Возвращает ({"rests": [{start, end, src}], "cards": [...]}, error)."""
    import time
    now = time.time()
    with _act_lock:
        c = _act_cache.get(driver_id)
        if c and now - c["at"] < ACT_TTL:
            return c["data"], c["error"]
    data, err = None, None
    try:
        d = mapon_get(MAPON_ACTIVITIES_URL, {
            "key": MAPON_API_KEY, "driver": driver_id,
            "from": _iso_utc(now - ACT_DAYS * 86400), "till": _iso_utc(now),
            "include": "card_events"}, timeout=30)
        rows = d.get("data") if isinstance(d, dict) else d
        acts = []
        for day in rows or []:
            items = day.get("activities") if isinstance(day, dict) else day
            for a in items or []:
                if not isinstance(a, dict):
                    continue
                try:
                    s, e = int(float(a.get("start") or 0)), int(float(a.get("end") or 0))
                except (TypeError, ValueError):
                    continue
                acts.append({"start": s, "end": min(e, int(now)), "status": a.get("status"),
                             "src": a.get("source")})
        acts.sort(key=lambda a: a["start"])
        rests, cards, cur = [], [], None
        for a in acts:
            if a["status"] in ("CARD_INSERTED", "CARD_REMOVED"):
                cards.append({"ts": a["start"], "what": a["status"]})
                continue
            if a["status"] not in ("REST", "DRIVING", "WORK", "AVAILABLE") or a["end"] <= a["start"]:
                continue
            if a["status"] == "REST":
                if cur and a["start"] - cur["end"] <= 120:
                    cur["end"] = max(cur["end"], a["end"])
                    cur["src"].add(a["src"] or "?")
                else:
                    cur = {"start": a["start"], "end": a["end"], "src": {a["src"] or "?"}}
                    rests.append(cur)
            else:
                cur = None
        for r in rests:
            r["src"] = sorted(r["src"])
        data = {"rests": rests, "cards": cards, "from": now - ACT_DAYS * 86400}
    except Exception as e:
        err = str(e)
    with _act_lock:
        _act_cache[driver_id] = {"at": now, "data": data, "error": err}
    return data, err


def weekly_status(driver_id, now_ts=None):
    """Недельный отдых водителя по истории:
    last — последний отдых от 24 ч (идёт сейчас или завершён), prev — предыдущий;
    deadline — начать следующий недельный не позже (конец last + 144 ч);
    need_sec — какой нужен следующий (после сокращённого — 45 ч, иначе 24 ч).
    Если недельный отдых идёт прямо сейчас — ongoing=True, can_go — когда он станет
    достаточным (начало + need текущего)."""
    import time
    now = float(now_ts or time.time())
    hist, err = get_driver_rests(driver_id)
    if not hist:
        return None, err
    weekly = [r for r in hist["rests"] if r["end"] - r["start"] >= WEEKLY_MIN_SEC
              and r["start"] > hist["from"] + 60]          # отдых, обрезанный началом окна, не берём
    last_rest = hist["rests"][-1] if hist["rests"] else None
    ongoing_rest = last_rest if last_rest and now - last_rest["end"] < 1800 else None
    res = {"weekly": [{"start": r["start"], "end": r["end"], "hours": round((r["end"] - r["start"]) / 3600, 1),
                       "full": r["end"] - r["start"] >= WEEKLY_FULL_SEC, "src": r["src"]} for r in weekly][-4:],
           "ongoing": False, "resting_sec": 0}
    if ongoing_rest:
        res["resting_sec"] = int(now - ongoing_rest["start"])
    if not weekly:
        res["error"] = f"за {ACT_DAYS} дн. нет отдыха от 24 ч"
        return res, None
    last = weekly[-1]
    prev = weekly[-2] if len(weekly) >= 2 else None
    ongoing = ongoing_rest is last
    # какой недельный нужен "этот" (для идущего) и следующий
    prev_reduced = prev is not None and prev["end"] - prev["start"] < WEEKLY_FULL_SEC
    if ongoing:
        need_now = WEEKLY_FULL_SEC if prev_reduced else WEEKLY_MIN_SEC
        can_go = last["start"] + need_now
        # если отдых дойдёт до 45 ч — следующий может быть сокращённым; считаем по минимуму
        end_est = max(now, can_go)
        full_now = end_est - last["start"] >= WEEKLY_FULL_SEC
        res.update(ongoing=True, can_go=can_go, need_now=need_now,
                   deadline=end_est + WEEKLY_PERIOD_SEC,
                   need_sec=WEEKLY_MIN_SEC if full_now else WEEKLY_FULL_SEC)
    else:
        last_reduced = last["end"] - last["start"] < WEEKLY_FULL_SEC
        res.update(deadline=last["end"] + WEEKLY_PERIOD_SEC,
                   need_sec=WEEKLY_FULL_SEC if last_reduced else WEEKLY_MIN_SEC)
    return res, None


def weekly_for_tacho(tacho):
    """Недельный отдых экипажа: самый ранний срок и самый длинный нужный отдых из водителей."""
    best = None
    for d in tacho.get("drivers") or []:
        did = d.get("driver_id")
        if not did:
            continue
        w, _ = weekly_status(did)
        if not w or not w.get("deadline"):
            continue
        if best is None or w["deadline"] < best["deadline"]:
            best = dict(w)
        best["need_sec"] = max(best["need_sec"], w["need_sec"])
    return best


def _hm(sec):
    sec = max(0, int(sec))
    return f"{sec // 3600}:{sec % 3600 // 60:02d}"


TEAM_DAY_SEC = 18 * 3600         # v1.47: экипаж — 18 ч вождения в сутки (20 — крайне редко, не считаем)
WEEK_MAX_SEC = 56 * 3600         # вождение за календарную неделю (пн 00:00 – вс 24:00 UTC)
FORTNIGHT_MAX_SEC = 90 * 3600    # за две соседние недели


def _next_monday_utc(ts):
    """Ближайший понедельник 00:00 UTC после ts (граница недели тахографа)."""
    d = datetime.fromtimestamp(ts, timezone.utc)
    mon = (d - timedelta(days=d.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    return (mon + timedelta(days=7)).timestamp()


def tacho_eta(tacho, dist_km, now_ts=None, weekly=None):
    """Симуляция рейса по данным тахографа (v1.46: только суточные нормы + недельный
    лимит вождения для одиночки; недельные отдыхи 24/45 НЕ учитываются — их решает диспетчер).
    Одиночка: 4:30 -> перерыв 45 мин; дневной лимит / окно смены -> суточный отдых
    (9 ч пока есть сокращения, иначе 11 ч) + 1 ч запаса; день 10 ч пока есть продления.
    Если уже стоит дольше суточного отдыха — может ехать сразу.
    Недельный лимит (одиночка): остаток недели из Mapon (правило 90 ч в нём учтено);
    кончился — стоп до пн 00:00 UTC; новая неделя = min(56, 90 − наезжено за прошлую).
    Экипаж: без перерывов, день = сумма остатков обоих (в пределах окна смены),
    суточный отдых 9 ч + 1 ч; недельный лимит не учитывается.
    Возвращает dict: eta_ts, stops [{kind, start, end}], team, first_limit_sec, week."""
    import time
    t = float(now_ts or time.time())
    v = TACHO_SPEED_KMH / 3600.0
    km_left = max(0.0, float(dist_km or 0))
    drivers = tacho["drivers"]
    team = len(drivers) >= 2
    d0 = next((d for d in drivers if d.get("current_state") == "DRIVING"), drivers[0])
    today = d0.get("today", {}) or {}
    week = d0.get("week", {}) or {}
    nowd = d0.get("now", {}) or {}

    ext_left = int(week.get("10h_driving_extensions_remaining") or 0)
    short_left = int(week.get("9h_rest_shortening_remaining") or 0)
    shift_end = t + float(today.get("shift_remaining") or 0)
    stops = []
    inf = float("inf")

    # недельный лимит — только одиночка
    if team:
        week_left = inf
        next_week_avail = inf
    else:
        week_left = float(week.get("driving_remaining") if week.get("driving_remaining") is not None else WEEK_MAX_SEC)
        nfw = week.get("next_fixed_week_driving_remaining")
        # нет данных Mapon — считаем, что на этой неделе уже наезжено (56 − остаток)
        next_week_avail = float(nfw) if nfw is not None else FORTNIGHT_MAX_SEC - (WEEK_MAX_SEC - week_left)
    week_end = _next_monday_utc(t)
    driven_this_week = 0.0          # сколько симуляция проехала в текущей неделе
    first_rollover = True
    week_info = {"left": None if team else week_left, "need": km_left / v, "next": None, "hit": False}

    def rollover():
        nonlocal week_left, week_end, driven_this_week, first_rollover, ext_left
        if not team:
            if first_rollover:
                avail = min(WEEK_MAX_SEC, next_week_avail - driven_this_week)
                week_info["next"] = max(0.0, avail)
            else:
                avail = min(WEEK_MAX_SEC, FORTNIGHT_MAX_SEC - driven_this_week)
            week_left = max(0.0, avail)
        first_rollover = False
        driven_this_week = 0.0
        week_end += 7 * 86400
        ext_left = 2

    def new_day():
        nonlocal day_left, shift_end, until_break, ext_left
        per_driver = 10 * 3600 if ext_left > 0 else 9 * 3600
        if not team and ext_left > 0:
            ext_left -= 1
        if team:
            day_left = TEAM_DAY_SEC           # v1.47: экипаж — всегда 18 ч вождения в сутки
            shift_end = t + 21 * 3600
            until_break = inf
        else:
            day_left = per_driver
            shift_end = t + (15 if short_left > 0 else 13) * 3600
            until_break = CONT_DRIVE_SEC

    if team:
        day_left = min(TEAM_DAY_SEC, sum(float((d.get("today") or {}).get("driving_remaining") or 0) for d in drivers))
        until_break = inf
    else:
        day_left = float(today.get("driving_remaining") or 0)
        cont = float(nowd.get("driving") or 0)
        until_break = max(0.0, CONT_DRIVE_SEC - cont)

    rest_now = float(nowd.get("rest") or 0) if d0.get("current_state") == "REST" else 0.0
    need_rest = 9 * 3600 if (team or short_left > 0) else 11 * 3600
    if rest_now >= need_rest:
        # v1.46: стоит дольше суточного отдыха (ожидание погрузки/выгрузки) — едет сразу
        new_day()
    elif not team and d0.get("current_state") == "REST" and 0 < rest_now < BREAK_SEC:
        # идёт перерыв 45 мин — дождаться конца
        stops.append({"kind": "break", "start": t, "end": t + BREAK_SEC - rest_now})
        t += BREAK_SEC - rest_now
        until_break = CONT_DRIVE_SEC
    elif not team and rest_now >= BREAK_SEC:
        until_break = CONT_DRIVE_SEC    # перерыв уже отбыт
    if rest_now >= 3 * 3600 and rest_now < need_rest and day_left < 3600:
        # на суточном отдыхе, дня не осталось — добыть отдых до нормы
        end = t + (need_rest - rest_now) + REST_MARGIN_DAILY
        stops.append({"kind": "daily", "start": t, "end": end})
        if need_rest == 9 * 3600 and not team:
            short_left -= 1
        t = end
        new_day()
    while t >= week_end:
        rollover()

    first_rest = True
    first_limit = None
    for _ in range(600):
        if km_left <= 1e-6:
            break
        seg_limits = {
            "km": km_left / v,
            "day": max(0.0, day_left),
            "shift": max(0.0, shift_end - t),
            "week": max(0.0, week_left),
            "break": until_break,
            "wk_boundary": max(0.0, week_end - t),
        }
        kind = min(seg_limits, key=seg_limits.get)
        seg = seg_limits[kind]
        if first_limit is None and kind not in ("km", "wk_boundary"):
            first_limit = seg
        t += seg
        km_left -= seg * v
        day_left -= seg
        week_left -= seg
        until_break -= seg
        driven_this_week += seg
        if kind == "km":
            break
        if kind == "wk_boundary":
            rollover()
            continue
        if kind == "break":
            stops.append({"kind": "break", "start": t, "end": t + BREAK_SEC})
            t += BREAK_SEC
            until_break = CONT_DRIVE_SEC
        elif kind == "week":
            # недельный лимит вождения исчерпан — стоим до пн 00:00 UTC
            week_info["hit"] = True
            stops.append({"kind": "weeklimit", "start": t, "end": week_end})
            t = week_end
            rollover()
            new_day()
        else:  # дневной лимит или окно смены -> суточный отдых
            if team:
                rest = 9 * 3600
            elif first_rest:
                rest = float(today.get("daily_rest_min") or 11 * 3600)
                if rest <= 9 * 3600 and short_left > 0:
                    short_left -= 1
            elif short_left > 0:
                rest = 9 * 3600
                short_left -= 1
            else:
                rest = 11 * 3600
            first_rest = False
            stops.append({"kind": "daily", "start": t, "end": t + rest + REST_MARGIN_DAILY})
            t += rest + REST_MARGIN_DAILY
            new_day()
        while t >= week_end:
            rollover()
    return {"eta_ts": t, "stops": stops, "team": team, "first_limit_sec": first_limit, "week": week_info}


def tacho_summary(tacho, sim=None, weekly=None):
    """Короткие строки для подсказки: "сегодня осталось 3:24", "отдых 26/09 01:15–11:15",
    недельный лимит вождения (одиночка)."""
    d0 = next((d for d in tacho["drivers"] if d.get("current_state") == "DRIVING"), tacho["drivers"][0])
    nowd, today = d0.get("now", {}) or {}, d0.get("today", {}) or {}
    loc = lambda ts: (datetime.fromtimestamp(ts, timezone.utc) + timedelta(hours=WEST_EUROPE_OFFSET)).strftime("%d/%m %H:%M")
    parts = []
    state = {"DRIVING": "едет", "REST": "отдыхает", "AVAILABLE": "готовность", "WORK": "работа"}.get(d0.get("current_state"), d0.get("current_state") or "")
    team = len(tacho["drivers"]) >= 2
    if team:
        parts.append("экипаж")
    if state:
        rest_now = float(nowd.get("rest") or 0)
        parts.append(state + (f" {_hm(rest_now)}" if d0.get("current_state") == "REST" and rest_now >= 3600 else ""))
    if d0.get("current_state") == "DRIVING" and nowd.get("driving_remaining") is not None:
        parts.append(f"до остановки {_hm(nowd.get('driving_remaining'))}")
    rest_now = float(nowd.get("rest") or 0) if d0.get("current_state") == "REST" else 0.0
    short_left = int((d0.get("week") or {}).get("9h_rest_shortening_remaining") or 0)
    if rest_now >= (9 * 3600 if (team or short_left > 0) else 11 * 3600):
        parts.append("суточный отдых выполнен — может ехать")
    else:
        parts.append(f"сегодня осталось {_hm(today.get('driving_remaining'))}")
    if sim and not team and sim.get("week"):
        w = sim["week"]
        if w.get("left") is not None:
            ok = w["left"] >= w["need"]
            parts.append(f"неделя: осталось {_hm(w['left'])}, нужно {_hm(w['need'])}"
                         + (" — хватает" if ok else f" — не хватает {_hm(w['need'] - w['left'])}"))
        if w.get("next") is not None:
            parts.append(f"с пн доступно {_hm(w['next'])} (правило 90 ч)")
    if sim:
        for st in [x for x in sim["stops"] if x["kind"] in ("daily", "weeklimit")][:3]:
            s_txt, e_txt = loc(st["start"]), loc(st["end"])
            same_day = s_txt[:5] == e_txt[:5]
            span = f"{s_txt}–{e_txt[-5:] if same_day else e_txt}"
            parts.append(f"отдых {span}" if st["kind"] == "daily" else f"стоп {span}: исчерпан лимит недели")
    return [p for p in parts if p]


_group_ids_cache = {}   # v1.70: group_id -> (ts, set) — состав группы меняется редко
GROUP_IDS_TTL = 600


def fetch_group_unit_ids(api_key, group_id):
    import time
    hit = _group_ids_cache.get(group_id)
    if hit and time.time() - hit[0] < GROUP_IDS_TTL:
        return hit[1]
    data = mapon_get(MAPON_GROUP_UNITS_URL, {"key": api_key, "id": group_id})
    ids = {u["id"] for u in data["data"]["units"]}
    _group_ids_cache[group_id] = (time.time(), ids)
    return ids


def resolve_target(target_str):
    """Определяет тип таргета (GPS / код региона / город) и возвращает (lat, lng)."""
    target_str = (target_str or "").strip()
    if not target_str:
        return None, None

    # 1. GPS: "lat, lng"
    if "," in target_str:
        parts = target_str.split(",")
        if len(parts) == 2:
            try:
                lat, lng = float(parts[0].strip()), float(parts[1].strip())
                return lat, lng
            except ValueError:
                pass

    # 2. Код региона (например NO01, SE25) — короткая буквенно-цифровая строка без пробелов
    key = target_str.upper().replace(" ", "")
    if key in REGION_CODES:
        return REGION_CODES[key]["lat"], REGION_CODES[key]["lng"]

    # v1.62: "lv" / "Латвия" — это База (Рига)
    if is_base_word(target_str):
        blat, blng, _ = base_point()
        return blat, blng

    # 3. Город/адрес — геокодинг (кеш + запасной геокодер)
    g = geocode(target_str)
    if not g:
        raise ValueError(f"Не удалось распознать таргет: {target_str}")
    return g["lat"], g["lng"]


# v1.37: страны, где мы реально ездим (погрузки/выгрузки + транзит) — для
# фильтра "Запретов" и проверки подозрительного геокодинга
OUR_COUNTRIES = {"ES", "PT", "FR", "BE", "LU", "NL", "DE", "DK", "SE", "NO",
                 "FI", "EE", "LV", "LT", "PL", "IT", "AT"}


# v1.62: геокодинг города/адреса. Nominatim с общих IP Cloud Run часто отвечает 429
# (Too many requests) — поэтому: кеш на 24 ч, не чаще 1 запроса в секунду к Nominatim,
# а при 429/ошибке — запасной геокодер Photon (тоже OpenStreetMap, без ключа).
PHOTON_URL = "https://photon.komoot.io/api/"
GEO_CACHE_TTL = 24 * 3600
_geo_cache = {}
_geo_lock = threading.Lock()
_geo_last_nominatim = [0.0]
GEO_UA = {"User-Agent": "fleet-eta-tracker/1.62 (dispatch tool; https://github.com/LVAHEAD/fleet-tracker)"}


def _geo_nominatim(q):
    import time
    with _geo_lock:
        wait = 1.05 - (time.time() - _geo_last_nominatim[0])
        if wait > 0:
            time.sleep(wait)
        _geo_last_nominatim[0] = time.time()
    resp = requests.get(
        NOMINATIM_URL,
        params={"q": q, "format": "json", "limit": 1, "addressdetails": 1, "accept-language": "ru"},
        headers=GEO_UA, timeout=15,
    )
    resp.raise_for_status()
    res = resp.json()
    if not res:
        return None
    r = res[0]
    cc = ((r.get("address") or {}).get("country_code") or "").upper() or None
    return {"lat": float(r["lat"]), "lng": float(r["lon"]), "name": r.get("display_name") or q, "cc": cc}


def _geo_photon(q):
    resp = requests.get(PHOTON_URL, params={"q": q, "limit": 1}, headers=GEO_UA, timeout=15)
    resp.raise_for_status()
    feats = (resp.json() or {}).get("features") or []
    if not feats:
        return None
    f = feats[0]
    lng, lat = f["geometry"]["coordinates"][:2]
    pr = f.get("properties") or {}
    parts = [pr.get("name"), pr.get("city") or pr.get("county"), pr.get("state"), pr.get("country")]
    name = ", ".join(dict.fromkeys(x for x in parts if x)) or q
    cc = (pr.get("countrycode") or "").upper() or None
    return {"lat": float(lat), "lng": float(lng), "name": name, "cc": cc}


def geocode(q):
    """dict(lat, lng, name, cc) или None, если место не найдено.
    Если оба геокодера недоступны — ValueError с понятным текстом."""
    import time
    key = re.sub(r"\s+", " ", str(q or "").strip().lower())
    if not key:
        return None
    now = time.time()
    hit = _geo_cache.get(key)
    if hit and now - hit[0] < GEO_CACHE_TTL:
        return hit[1]
    res, errors = None, []
    for fn in (_geo_nominatim, _geo_photon):
        try:
            res = fn(q)
            errors = []
            break
        except Exception as e:
            code = getattr(getattr(e, "response", None), "status_code", None)
            errors.append(f"{fn.__name__[5:]}: {code or type(e).__name__}")
    if errors:
        print(f"geocode failed for {q!r}: {errors}", flush=True)
        raise ValueError(f"Геокодер сейчас не отвечает ({'; '.join(errors)}). "
                         f"Попробуйте через минуту или введите код региона / GPS.")
    _geo_cache[key] = (now, res)
    return res


def geocode_city(q):
    """Город/адрес с названием и страной найденного места: (lat, lng, display_name, cc)."""
    g = geocode(q)
    if not g:
        return None, None, None, None
    return g["lat"], g["lng"], g["name"], g["cc"]


def resolve_place_label(target_str):
    """Возвращает (lat, lng, label) — то же, что resolve_target, плюс человекочитаемое
    название места (из REGION_CODES для кодов регионов, иначе сам ввод пользователя)."""
    key = (target_str or "").strip().upper().replace(" ", "")
    lat, lng = resolve_target(target_str)
    if lat is None:
        return None, None, None
    if key in REGION_CODES:
        label = f"{key} — {REGION_CODES[key]['place']}"
    else:
        label = target_str.strip()
    return lat, lng, label


# v1.50: кеш маршрутов Флота — если трак почти не сдвинулся (~1 км) и таргет тот же,
# 15 минут отдаём прошлый маршрут, не спрашивая Google (Ctrl+F5, "Обновить всё").
ROUTE_CACHE_TTL = 15 * 60
_route_cache = {}
_route_cache_lock = threading.Lock()
_route_stats = {"day": None, "calls": 0, "cache_hits": 0}   # v1.51: за сутки квоты (по времени Google)


def _quota_day():
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("America/Los_Angeles")).strftime("%Y-%m-%d")
    except Exception:
        return (datetime.now(timezone.utc) - timedelta(hours=7)).strftime("%Y-%m-%d")


def _route_stat(kind):
    day = _quota_day()
    if _route_stats["day"] != day:
        _route_stats.update(day=day, calls=0, cache_hits=0)
    _route_stats[kind] += 1


# v1.59: "по уже известному маршруту" — если к тому же таргету маршрут запрошен меньше часа
# назад, а трак едет по нему (ближе ~1.5 км к линии), остаток км считаем сами по линии,
# без запроса к Google. Новый маршрут — при смене таргета, сходе с маршрута или раз в час.
ALONG_ROUTE_TTL = 60 * 60
ALONG_ROUTE_MAX_OFF_KM = 1.5
_along_cache = {}   # (target, waypoints) -> {"at", "pts", "cum", "scale"}


def _encode_polyline(pts):
    out, plat, plng = [], 0, 0
    for la, ln in pts:
        for v, prev in ((round(la * 1e5), plat), (round(ln * 1e5), plng)):
            d = v - prev
            d = ~(d << 1) if d < 0 else d << 1
            while d >= 0x20:
                out.append(chr((0x20 | (d & 0x1F)) + 63))
                d >>= 5
            out.append(chr(d + 63))
        plat, plng = round(la * 1e5), round(ln * 1e5)
    return "".join(out)


def _along_remember(tkey, dist_km, polyline, now):
    try:
        pts = _decode_polyline(polyline or "")
        if len(pts) < 2:
            return
        cum = [0.0]
        for a, b in zip(pts, pts[1:]):
            cum.append(cum[-1] + haversine_km(a[0], a[1], b[0], b[1]))
        scale = (dist_km / cum[-1]) if cum[-1] > 0 else 1.0
        _along_cache[tkey] = {"at": now, "pts": pts, "cum": cum, "scale": scale}
    except Exception:
        pass


def _along_lookup(tkey, lat, lng, now):
    c = _along_cache.get(tkey)
    if not c or now - c["at"] > ALONG_ROUTE_TTL:
        return None
    pts, cum = c["pts"], c["cum"]
    best_i, best_d = None, float("inf")
    for i, (la, ln) in enumerate(pts):
        if abs(la - lat) > 0.1 or abs(ln - lng) > 0.2:
            continue
        d = haversine_km(lat, lng, la, ln)
        if d < best_d:
            best_i, best_d = i, d
    if best_i is None or best_d > ALONG_ROUTE_MAX_OFF_KM:
        return None
    remain = max(0.0, (cum[-1] - cum[best_i]) * c["scale"] + best_d)
    return remain, _encode_polyline([(lat, lng)] + pts[best_i:])


def road_distance_km_google(lat1, lng1, lat2, lng2, api_key, waypoints=None):
    import time
    key = (round(lat1, 2), round(lng1, 2), round(lat2, 4), round(lng2, 4),
           tuple((round(a, 4), round(b, 4)) for a, b in (waypoints or [])))
    tkey = key[2:]
    now = time.time()
    with _route_cache_lock:
        hit = _route_cache.get(key)
        if hit and now - hit[0] < ROUTE_CACHE_TTL:
            _route_stat("cache_hits")
            return hit[1]
        along = _along_lookup(tkey, lat1, lng1, now)
        if along:
            _route_stat("cache_hits")
            return along
        _route_stat("calls")
    res = _road_distance_km_google(lat1, lng1, lat2, lng2, api_key, waypoints)
    with _route_cache_lock:
        if len(_route_cache) > 2000:
            for k in [k for k, v in _route_cache.items() if now - v[0] >= ROUTE_CACHE_TTL]:
                _route_cache.pop(k, None)
        if len(_along_cache) > 500:
            for k in [k for k, v in _along_cache.items() if now - v["at"] >= ALONG_ROUTE_TTL]:
                _along_cache.pop(k, None)
        _route_cache[key] = (now, res)
        _along_remember(tkey, res[0], res[1], now)
    return res


def _road_distance_km_google(lat1, lng1, lat2, lng2, api_key, waypoints=None):
    """waypoints — необязательный список [(lat, lng), ...] промежуточных точек,
    через которые маршрут должен пройти в заданном порядке."""
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": api_key,
        "X-Goog-FieldMask": "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline",
    }
    body = {
        "origin": {"location": {"latLng": {"latitude": lat1, "longitude": lng1}}},
        "destination": {"location": {"latLng": {"latitude": lat2, "longitude": lng2}}},
        "travelMode": "DRIVE",
        "routingPreference": "TRAFFIC_UNAWARE",   # v1.50: без пробок — дешевле (Essentials), ETA и так км/70
    }
    if waypoints:
        body["intermediates"] = [
            {"location": {"latLng": {"latitude": wlat, "longitude": wlng}}}
            for wlat, wlng in waypoints
        ]
    resp = requests.post(ROUTES_API_URL, json=body, headers=headers, timeout=20)
    resp.raise_for_status()
    data = resp.json()
    if "routes" not in data or not data["routes"]:
        raise RuntimeError(f"Routes API вернул пустой ответ: {data}")
    route = data["routes"][0]
    # Если точки совпадают или стоят вплотную, Routes API может опустить
    # distanceMeters (поле с нулевым значением в ответе не передаётся) — считаем 0.
    distance_km = route.get("distanceMeters", 0) / 1000
    polyline = route.get("polyline", {}).get("encodedPolyline")
    return distance_km, polyline


# ---------- Правила принудительных маршрутов (обход Швейцарии, паромы на Скандинавию) ----------
# Пока применяются только во вкладке From -> To (/api/route), где обе точки заданы
# кодами регионов — страна извлекается из первых двух букв кода. Для вкладки "Флот"
# (текущая позиция машины из Mapon) страна отправления неизвестна без обратного
# геокодинга, поэтому там правила пока не применяются.

INNSBRUCK = (47.2692, 11.4041)
PUTTGARDEN = (54.5008, 11.2158)
RODBY = (54.6559, 11.3600)
ROSTOCK_FERRY = (54.1766, 12.0894)   # Warnemünde, паромный терминал у Ростока
GEDSER = (54.5730, 11.9250)
HELSINGOR = (56.0360, 12.6136)
HELSINGBORG = (56.0465, 12.6945)

BENELUX_FR = {"BE", "NL", "LU", "FR"}
ES_PT = {"ES", "PT"}
SCANDI = {"NO", "SE"}


# v1.27: дополнительные коды из GeoNames (data/region_codes_geonames.json, строится
# скриптом tools/build_region_codes.py). Добавляются только коды, которых нет в
# GPS_Codes.xlsx — ваши коды главнее. Нет файла — работаем как раньше.
def _load_geonames_codes():
    import json as _json
    path = os.path.join(DATA_DIR, "region_codes_geonames.json")
    try:
        with open(path, encoding="utf-8") as f:
            extra = _json.load(f).get("codes", {})
    except (OSError, ValueError):
        return 0
    added = 0
    for code, v in extra.items():
        code = code.upper()
        if code not in REGION_CODES and "lat" in v and "lng" in v:
            REGION_CODES[code] = {"lat": v["lat"], "lng": v["lng"], "place": v.get("place", ""), "src": "geonames"}
            added += 1
    return added


GEONAMES_CODES_ADDED = _load_geonames_codes()


def get_region_country(code_str):
    """Возвращает код страны (первые 2 буквы), если строка — известный код региона."""
    key = (code_str or "").strip().upper().replace(" ", "")
    return key[:2] if key in REGION_CODES else None


def _ferry_pair_for_country(other_country, other_lat, other_lng):
    """Южная пара паромных портов (материк -> Дания) для страны other_country."""
    if other_country == "IT":
        return (ROSTOCK_FERRY, GEDSER)
    if other_country in ES_PT or other_country in BENELUX_FR:
        return (PUTTGARDEN, RODBY)
    if other_country == "DE":
        d_rostock = haversine_km(other_lat, other_lng, ROSTOCK_FERRY[0], ROSTOCK_FERRY[1])
        d_puttgarden = haversine_km(other_lat, other_lng, PUTTGARDEN[0], PUTTGARDEN[1])
        return (ROSTOCK_FERRY, GEDSER) if d_rostock < d_puttgarden else (PUTTGARDEN, RODBY)
    return None


def pick_waypoints(from_str, from_lat, from_lng, to_str, to_lat, to_lng):
    """Старый интерфейс (страна только из кода региона) — оставлен для совместимости."""
    return pick_waypoints_by_country(
        get_region_country(from_str), from_lat, from_lng,
        get_region_country(to_str), to_lat, to_lng,
    )


def pick_waypoints_by_country(from_country, from_lat, from_lng, to_country, to_lat, to_lng):
    """Возвращает список [(lat,lng), ...] промежуточных точек по известным правилам
    для пары стран, или None, если ни одно правило не подходит."""
    if not from_country or not to_country:
        return None

    # Италия <-> Германия: всегда через Австрию (Инсбрук)
    if {from_country, to_country} == {"IT", "DE"}:
        return [INNSBRUCK]

    # v2.03: трак уже в Дании (после Рёдбю/Гедсера) — на Норвегию/Швецию только через Хельсингёр–Хельсингборг
    if from_country == "DK" and to_country in SCANDI:
        return [HELSINGOR, HELSINGBORG]
    if from_country in SCANDI and to_country == "DK":
        return [HELSINGBORG, HELSINGOR]

    # Паромы на/из Норвегии-Швеции
    if from_country in SCANDI and to_country not in SCANDI:
        pair = _ferry_pair_for_country(to_country, to_lat, to_lng)
        if pair:
            south_port, dk_port = pair
            # едем с севера на юг — сначала датская сторона паромов, потом материковая
            return [HELSINGBORG, HELSINGOR, dk_port, south_port]
    elif to_country in SCANDI and from_country not in SCANDI:
        pair = _ferry_pair_for_country(from_country, from_lat, from_lng)
        if pair:
            south_port, dk_port = pair
            # едем с юга на север
            return [south_port, dk_port, HELSINGOR, HELSINGBORG]

    return None


def fleet_waypoints(lat1, lng1, lat2, lng2):
    """v2.03: правила маршрутов (паромы на Скандинавию, Инсбрук) и для строк Флота —
    страны точек по ближайшему коду региона."""
    try:
        return pick_waypoints_by_country(_country_at(lat1, lng1), lat1, lng1, _country_at(lat2, lng2), lat2, lng2)
    except Exception:
        return None


# ---------- v1.22: ближайший код региона, машина как точка, многоточечный маршрут ----------

NEAR_LABEL_MAX_KM = 80      # дальше этого "около XX" в подписи не показываем (страну всё равно берём)
MAX_INTERMEDIATES = 25      # лимит Routes API на промежуточные точки (вместе с паромами/Инсбруком)


def nearest_region_code(lat, lng):
    """Ближайший код региона из REGION_CODES по прямой: (code, dist_km).
    Нужен, чтобы узнать страну точки, заданной GPS/городом/машиной, — по ней
    выбираются правила маршрутов. Для стран без кодов в справочнике (AT, CH,
    LU, HU...) вернётся код соседней страны."""
    best_code, best_d = None, float("inf")
    for code, v in REGION_CODES.items():
        d = haversine_km(lat, lng, v["lat"], v["lng"])
        if d < best_d:
            best_code, best_d = code, d
    return best_code, best_d


def find_unit_exact(units, query):
    """Точное совпадение номера/названия машины (без учёта регистра, пробелов и дефисов).
    Точное — чтобы город вроде "Oslo" случайно не совпал с частью номера."""
    q = normalize(query)
    if not q:
        return None
    for u in units:
        if q == normalize(u.get("number")) or q == normalize(u.get("label")):
            return u
    return None


# ---------- v1.28: адресная база из Google-таблицы ----------
# Таблица "Fleet Tracker — данные", лист "Адреса". Доступ — сервисный аккаунт
# Cloud Run (таблица расшарена на него "Читателем"), ключи не нужны.
SHEET_ID = os.environ.get("SHEET_ID", "1m0oM8cNixVDM1kgQKCZKPgF-aSQN-0loqdLc-dWkD7g")
ADDRESS_SHEET = os.environ.get("ADDRESS_SHEET", "Адреса")
ADDRESS_TTL_SEC = 600  # перечитываем лист не чаще раза в 10 минут
ADDRESS_TYPES = {"load", "unload", "port", "customs", "misc"}

_addr_cache = {"items": [], "problems": [], "loaded_at": 0.0, "error": None}


def _sheets_token():
    import google.auth
    import google.auth.transport.requests
    creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"])
    creds.refresh(google.auth.transport.requests.Request())
    return creds.token


def read_sheet_values(sheet_name, render="FORMATTED_VALUE"):
    """Все значения листа как список строк. render: FORMATTED_VALUE (как видно
    в таблице) или UNFORMATTED_VALUE (числа — числами)."""
    from urllib.parse import quote
    rng = quote(f"'{sheet_name}'", safe="")
    url = f"https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}/values/{rng}"
    resp = requests.get(url, headers={"Authorization": f"Bearer {_sheets_token()}"},
                        params={"valueRenderOption": render}, timeout=60)
    if resp.status_code == 403:
        raise RuntimeError("Нет доступа к таблице: расшарьте её на сервисный аккаунт приложения (Читатель)")
    resp.raise_for_status()
    return resp.json().get("values", [])


_GPS_RE = re.compile(r"(-?\d{1,2}\.\d+)\s*[,;]\s*(-?\d{1,3}\.\d+)")


def parse_gps(text):
    """Первая пара "lat, lng" в тексте -> (lat, lng) или None."""
    m = _GPS_RE.search(str(text or ""))
    if not m:
        return None
    lat, lng = float(m.group(1)), float(m.group(2))
    if -90 <= lat <= 90 and -180 <= lng <= 180:
        return lat, lng
    return None


def _hkey(h):
    """Заголовок колонки -> ключ: "Full address" -> "fulladdress", "Notes," -> "notes"."""
    return re.sub(r"[^a-z0-9]", "", str(h or "").lower())


def parse_address_rows(values):
    """values — строки листа "Адреса" (первая — заголовки). -> (items, problems)."""
    if not values:
        return [], []
    head = [_hkey(h) for h in values[0]]
    col = {k: i for i, k in enumerate(head) if k}
    alias_map = {"supplier": ("supplier", "suplier"), "notes": ("notes",), "fulladdress": ("fulladdress", "address")}

    def get(row, key):
        for k in alias_map.get(key, (key,)):
            i = col.get(k)
            if i is not None and i < len(row):
                return str(row[i] or "").strip()
        return ""

    items, problems = [], []
    for n, row in enumerate(values[1:], start=2):
        if not any(str(c or "").strip() for c in row):
            continue  # пустая строка
        name = get(row, "name")
        if not name:
            # v1.29: пустой Name — берём первую строку Full address (не GPS)
            for line in get(row, "fulladdress").splitlines():
                line = line.strip()
                if line and not parse_gps(line):
                    name = line
                    break
        if not name:
            problems.append(f"строка {n}: нет Name и адреса")
            continue
        gps = parse_gps(get(row, "gps")) or parse_gps(get(row, "fulladdress"))
        if not gps:
            problems.append(f"строка {n}: {name} — нет GPS")
            continue
        typ = get(row, "type").lower()
        full = get(row, "fulladdress")
        # "город" для подсказки: строка адреса с запятой и индексом/страной, иначе ничего
        city = ""
        for line in full.splitlines():
            if "," in line and not parse_gps(line):
                city = line.split(",")[0].strip()
        items.append({
            "name": name,
            "alias": get(row, "alias"),
            "type": typ if typ in ADDRESS_TYPES else ("misc" if typ else ""),
            "open": get(row, "open"),
            "notes": get(row, "notes"),
            "client": get(row, "client"),
            "supplier": get(row, "supplier"),
            "country": get(row, "country").upper()[:2],
            "city": city,
            "lat": gps[0], "lng": gps[1],
        })
    return items, problems


def get_addresses(force=False):
    """Адреса из таблицы с кешем на ADDRESS_TTL_SEC. Ошибка чтения не ломает
    приложение: остаётся последняя удачная копия, текст ошибки — в _addr_cache."""
    import time
    now = time.time()
    if force or now - _addr_cache["loaded_at"] > ADDRESS_TTL_SEC:
        try:
            items, problems = parse_address_rows(read_sheet_values(ADDRESS_SHEET))
            _addr_cache.update(items=items, problems=problems, loaded_at=now, error=None)
        except Exception as e:
            _addr_cache["error"] = str(e)
            _addr_cache["loaded_at"] = now - ADDRESS_TTL_SEC + 60  # повторить через минуту
    return _addr_cache["items"]


def find_address(query):
    """Точное совпадение по Name или Alias (без регистра/пробелов/дефисов).
    Если совпал только Supplier и склад у него один — тоже он."""
    q = normalize(query)
    if not q:
        return None
    try:
        items = get_addresses()
    except Exception:
        return None
    for a in items:
        if q == normalize(a["name"]) or (a["alias"] and q == normalize(a["alias"])):
            return a
    by_supplier = [a for a in items if a["supplier"] and q == normalize(a["supplier"])]
    if len(by_supplier) == 1:
        return by_supplier[0]
    if len(by_supplier) > 1:
        names = ", ".join(a["name"] for a in by_supplier[:6])
        raise ValueError(f"У {query} несколько складов — выберите конкретный: {names}")
    return None


def address_public(a):
    return {k: a[k] for k in ("name", "alias", "type", "open", "notes", "client", "supplier", "country", "city")}


# ---------- v1.29: база фрахтов (лист "Фрахты") ----------
FREIGHT_SHEET = os.environ.get("FREIGHT_SHEET", "Фрахты")
FREIGHT_ROAD_FACTOR = 1.25   # км по дорогам ~ км по прямой x 1.25 (для €/км старых рейсов)
FREIGHT_NEAR_KM = 150        # "соседний регион" — центры в пределах 150 км
COUNTRY_ALIASES = {"FIN": "FI", "EST": "EE", "LAT": "LV", "LTU": "LT", "SWE": "SE", "NOR": "NO",
                   "GER": "DE", "DEN": "DK", "ESP": "ES", "POL": "PL", "ITA": "IT", "UK": "GB"}

_frt_cache = {"items": [], "stats": {}, "loaded_at": 0.0, "error": None}


def parse_region_cell(text, pick_last):
    """"3xES30+ES46" / "FIN" / "SE(ST)" / "2xFIN" -> (code|None, country|None).
    Для погрузки берём первый регион, для выгрузки — последний."""
    t = re.sub(r"\([^)]*\)", "", str(text or "")).upper().replace(" ", "")
    tokens = [re.sub(r"^\d+X", "", tok) for tok in re.split(r"[+&,]", t) if tok]
    parsed = []
    for tok in tokens:
        m = re.match(r"^([A-Z]{2})(\d{2})", tok)
        if m:
            parsed.append((m.group(1) + m.group(2), m.group(1)))
            continue
        m = re.match(r"^([A-Z]{2,3})$", tok)
        if m:
            cc = COUNTRY_ALIASES.get(m.group(1), m.group(1))
            if len(cc) == 2:
                parsed.append((None, cc))
    if not parsed:
        return None, None
    return parsed[-1] if pick_last else parsed[0]


def parse_freight_value(v):
    """2400 / "2650+400" / "6729/5500" / "6200+" -> (цена|None, аутсорс?)."""
    if isinstance(v, (int, float)):
        return (float(v), False) if v > 0 else (None, False)
    t = str(v or "").strip().replace(" ", "")
    m = re.match(r"^(\d+(?:[.,]\d+)?)", t)
    if not m:
        return None, False
    price = float(m.group(1).replace(",", "."))
    return (price if price > 0 else None), ("/" in t)


def parse_trip_date(v, year):
    """"03.08." / "02+03.08." / "05.08.at 08:00" / serial -> date (последняя дата в ячейке)."""
    from datetime import date
    if isinstance(v, (int, float)) and v > 30000:
        return (datetime(1899, 12, 30) + timedelta(days=int(v))).date()
    found = re.findall(r"(\d{1,2})\.(\d{1,2})", str(v or ""))
    if not found or not year:
        return None
    d, mth = int(found[-1][0]), int(found[-1][1])
    try:
        return date(int(year), mth, d)
    except ValueError:
        return None


# ---------- v1.40: FIN/EE -> База ----------
# ~99% грузов в Финляндию и ~70% в Эстонию основная машина везёт до Базы (Рига),
# дальше отдельный довоз. Ввод страной (fin / FI / Финляндия / ee / Эстония)
# = маршрут до Базы + плашка "+довоз FI/EE". Конкретная точка в EE — напрямую.
BASE_FALLBACK = (56.94643, 24.03196)
BASE_NAME_KEYS = ("bazaparking", "baza", "база")
DOVOZ_COUNTRY_WORDS = {
    "FI": {"fi", "fin", "finland", "finnland", "suomi", "финляндия", "фин"},
    "EE": {"ee", "est", "estonia", "eesti", "эстония", "эст"},
}


# v1.62: "lv" / "Латвия" в поле From/To или таргете — это База в Риге
BASE_COUNTRY_WORDS = {"lv", "lat", "latvia", "latvija", "lettland", "латвия", "лат", "лв", "база", "baza"}


def is_base_word(raw):
    return re.sub(r"[\s.\-_]", "", str(raw or "")).lower() in BASE_COUNTRY_WORDS


def dovoz_country(raw):
    """"fin" / "FI" / "Финляндия" -> "FI"; "ee" / "Эстония" -> "EE"; иначе None."""
    k = re.sub(r"[\s.\-_]", "", str(raw or "")).lower()
    for cc, words in DOVOZ_COUNTRY_WORDS.items():
        if k in words:
            return cc
    return None


def base_point():
    """Координаты и имя Базы: из адресной базы (строка "Baza Parking"), иначе константа."""
    try:
        for a in get_addresses():
            if any(k in normalize(a["name"]) or k in normalize(a.get("alias")) for k in BASE_NAME_KEYS):
                return a["lat"], a["lng"], a["name"]
    except Exception:
        pass
    return BASE_FALLBACK[0], BASE_FALLBACK[1], "Baza Parking"


def _region_ll(code):
    v = REGION_CODES.get(code or "")
    return (v["lat"], v["lng"]) if v else (None, None)


def parse_freight_rows(values):
    if not values:
        return [], {}
    head = [_hkey(h) for h in values[0]]

    def find(pred):
        for i, k in enumerate(head):
            if pred(k):
                return i
        return None
    c_unl = find(lambda k: k.startswith("unloading") and "reg" in k)
    c_lod = find(lambda k: k.startswith("loading") and "reg" in k)
    c_ldt = find(lambda k: k.startswith("loadingdate"))
    c_ddt = find(lambda k: k.startswith("deliverydate"))
    c_frt = find(lambda k: k.startswith("freight"))
    c_cli = find(lambda k: k == "client")
    c_yr = find(lambda k: k == "year")

    def cell(row, i):
        return row[i] if i is not None and i < len(row) else ""

    items = []
    stats = {"rows": 0, "ok": 0, "no_price": 0, "no_region": 0}
    _b = base_point()
    base_ll = (_b[0], _b[1])
    for row in values[1:]:
        if not any(str(c or "").strip() for c in row):
            continue
        stats["rows"] += 1
        price, outsourced = parse_freight_value(cell(row, c_frt))
        if not price or price > 50000:
            stats["no_price"] += 1
            continue
        fcode, fcc = parse_region_cell(cell(row, c_lod), pick_last=False)
        tcode, tcc = parse_region_cell(cell(row, c_unl), pick_last=True)
        if not fcc or not tcc:
            stats["no_region"] += 1
            continue
        year = cell(row, c_yr)
        try:
            year = int(float(year)) if str(year).strip() else None
        except ValueError:
            year = None
        d = parse_trip_date(cell(row, c_ldt), year) or parse_trip_date(cell(row, c_ddt), year)
        flat, flng = _region_ll(fcode)
        tlat, tlng = _region_ll(tcode)
        if tcode is None and tcc in DOVOZ_COUNTRY_WORDS and tlat is None:
            # v1.40: "FIN"/"EE" без кода — фактически до Базы (для €/км)
            tlat, tlng = base_ll
        km = None
        if flat is not None and tlat is not None:
            km = haversine_km(flat, flng, tlat, tlng) * FREIGHT_ROAD_FACTOR
        items.append({
            "from_raw": str(cell(row, c_lod)).strip(), "to_raw": str(cell(row, c_unl)).strip(),
            "from_code": fcode, "from_cc": fcc, "to_code": tcode, "to_cc": tcc,
            "flat": flat, "flng": flng, "tlat": tlat, "tlng": tlng,
            "price": price, "outsourced": outsourced,
            "client": str(cell(row, c_cli)).strip(), "date": d, "km": km,
        })
        stats["ok"] += 1
    return items, stats


def get_freights(force=False):
    import time
    now = time.time()
    if force or now - _frt_cache["loaded_at"] > ADDRESS_TTL_SEC:
        try:
            items, stats = parse_freight_rows(read_sheet_values(FREIGHT_SHEET, "UNFORMATTED_VALUE"))
            _frt_cache.update(items=items, stats=stats, loaded_at=now, error=None)
        except Exception as e:
            _frt_cache["error"] = str(e)
            _frt_cache["loaded_at"] = now - ADDRESS_TTL_SEC + 60
    return _frt_cache["items"]


# ---------- v1.31: лист "Настройки" (контрактные клиенты) ----------
SETTINGS_SHEET = os.environ.get("SETTINGS_SHEET", "Настройки")
_set_cache = {"contract": [], "loaded_at": 0.0, "error": None}


def _client_key(name):
    """"Bama(2k)" -> "bama", "GreenFoodIberica(2k)" -> "greenfoodiberica"."""
    t = re.sub(r"\([^)]*\)", "", str(name or "")).lower()
    return re.sub(r"[^0-9a-zа-яё]", "", t)


def get_contract_clients(force=False):
    """Ключи контрактных клиентов из колонки "Контрактные клиенты" листа "Настройки"."""
    import time
    now = time.time()
    if force or now - _set_cache["loaded_at"] > ADDRESS_TTL_SEC:
        try:
            values = read_sheet_values(SETTINGS_SHEET)
            col = None
            if values:
                for i, h in enumerate(values[0]):
                    if "контракт" in str(h).lower():
                        col = i
                        break
            names = []
            if col is not None:
                names = [_client_key(r[col]) for r in values[1:] if col < len(r) and str(r[col]).strip()]
            _set_cache.update(contract=[n for n in names if n], loaded_at=now, error=None)
        except Exception as e:
            _set_cache["error"] = str(e)
            _set_cache["loaded_at"] = now - ADDRESS_TTL_SEC + 60
    return _set_cache["contract"]


def contract_of(client, contract_keys):
    """Ключ контрактника, если клиент контрактный (по началу названия), иначе None."""
    k = _client_key(client)
    for c in contract_keys:
        if k.startswith(c):
            return c
    return None


def _pct(sorted_vals, q):
    if not sorted_vals:
        return None
    i = (len(sorted_vals) - 1) * q
    lo, hi = int(i), min(int(i) + 1, len(sorted_vals) - 1)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (i - lo)


def similar_freights(a, b, route_km=None, limit=10):
    """a, b — точки начала и конца (dict с code/near_code/country/lat/lng).
    Уровни: 1 — те же коды, 2 — соседние регионы (<= FREIGHT_NEAR_KM), 3 — пара стран."""
    from datetime import date
    items = get_freights()
    fcode = a.get("code") or a.get("near_code")
    tcode = b.get("code") or b.get("near_code")
    fcc, tcc = a.get("country"), b.get("country")
    dovoz = b.get("dovoz")          # v1.40: To = "FIN"/"EE" через Базу
    found = {}
    for i, t in enumerate(items):
        lvl = None
        if dovoz:
            if t["to_cc"] != dovoz:
                continue
            if fcode and t["from_code"] == fcode:
                lvl = 1
            elif t["flat"] is not None and haversine_km(t["flat"], t["flng"], a["lat"], a["lng"]) <= FREIGHT_NEAR_KM:
                lvl = 2
            elif fcc and t["from_cc"] == fcc:
                lvl = 3
            if lvl:
                found[i] = lvl
            continue
        if fcode and tcode and t["from_code"] == fcode and t["to_code"] == tcode:
            lvl = 1
        elif (t["flat"] is not None and t["tlat"] is not None
              and haversine_km(t["flat"], t["flng"], a["lat"], a["lng"]) <= FREIGHT_NEAR_KM
              and haversine_km(t["tlat"], t["tlng"], b["lat"], b["lng"]) <= FREIGHT_NEAR_KM):
            lvl = 2
        elif fcc and tcc and t["from_cc"] == fcc and t["to_cc"] == tcc:
            lvl = 3
        if lvl:
            found[i] = lvl
    # v1.31: контрактные клиенты (фиксированные цены) — не в ориентир
    try:
        contract_keys = get_contract_clients()
    except Exception:
        contract_keys = []
    ctr = {i: contract_of(items[i]["client"], contract_keys) for i in found}
    market_found = {i: l for i, l in found.items() if not ctr[i]}

    # уровни выбираем по рыночным рейсам: 1; если мало — добавляем 2; если всё ещё мало — 3
    chosen = [i for i, l in market_found.items() if l == 1]
    if len(chosen) < 5:
        chosen += [i for i, l in market_found.items() if l == 2]
    if len(chosen) < 3:
        chosen += [i for i, l in market_found.items() if l == 3]
    levels_used = sorted({found[i] for i in chosen})

    trips = [items[i] | {"level": found[i], "contract": None} for i in chosen]
    trips.sort(key=lambda t: (t["date"] or date(1900, 1, 1)), reverse=True)  # свежие первыми

    # по одному последнему рейсу на каждого контрактника (с лучшего доступного уровня)
    by_client = {}
    for i, l in found.items():
        c = ctr[i]
        if not c:
            continue
        key = (-l, items[i]["date"] or date(1900, 1, 1))  # сначала ближе по уровню, потом свежее
        if c not in by_client or key > by_client[c][0]:
            by_client[c] = (key, i)
    contract_trips = [items[i] | {"level": found[i], "contract": c} for c, (key, i) in by_client.items()]
    contract_trips.sort(key=lambda t: (t["date"] or date(1900, 1, 1)), reverse=True)

    today = datetime.now(timezone.utc).date()
    recent = [t for t in trips if t["date"] and (today - t["date"]).days <= 365]
    basis, basis_label = (recent, "последние 12 мес.") if len(recent) >= 3 else (trips, "все годы")
    prices = sorted(t["price"] for t in basis)
    per_km = sorted(t["price"] / t["km"] for t in basis if t["km"])
    estimate = None
    if prices:
        med = _pct(prices, 0.5)
        estimate = {
            "n": len(prices), "basis": basis_label + ", без контрактов",
            "low": round(_pct(prices, 0.25)), "high": round(_pct(prices, 0.75)), "median": round(med),
            "eur_km_hist": round(_pct(per_km, 0.5), 2) if per_km else None,
            "eur_km_route": round(med / route_km, 2) if route_km else None,
        }

    def pub(t):
        return {
            "from": t["from_raw"], "to": t["to_raw"], "client": t["client"],
            "price": round(t["price"]), "outsourced": t["outsourced"],
            "eur_km": round(t["price"] / t["km"], 2) if t["km"] else None,
            "date": t["date"].strftime("%d.%m.%y") if t["date"] else "", "level": t["level"],
            "contract": bool(t.get("contract")),
        }
    return {
        "query": f"{fcode or fcc or '?'} → {(dovoz + ' (через Базу)') if dovoz else (tcode or tcc or '?')}",
        "total": len(trips), "levels": levels_used,
        "trips": [pub(t) for t in contract_trips] + [pub(t) for t in trips[:limit]],
        "estimate": estimate,
    }


def looks_like_gps_or_code(s):
    s = (s or "").strip()
    if s.upper().replace(" ", "") in REGION_CODES:
        return True
    parts = s.split(",")
    if len(parts) == 2:
        try:
            float(parts[0]); float(parts[1])
            return True
        except ValueError:
            pass
    return False


def resolve_point(raw, units_getter):
    """Разбирает одно поле From/To: машина / GPS / код региона / город.
    Возвращает dict: lat, lng, label, country, near_code, is_truck."""
    raw = (raw or "").strip()
    unit = None
    if not looks_like_gps_or_code(raw) and MAPON_API_KEY:
        unit = find_unit_exact(units_getter(), raw)

    if unit is not None:
        lat, lng = unit.get("lat"), unit.get("lng")
        if lat is None or lng is None:
            raise ValueError(f"У машины {raw} нет текущих координат в Mapon")
        state = unit.get("state", {}) or {}
        status_name = state.get("name")
        status_txt = f"{STATUS_RU.get(status_name, status_name or '')} {format_duration(state.get('duration', 0))}".strip()
        code, d = nearest_region_code(lat, lng)
        near = f", около {code}" if d <= NEAR_LABEL_MAX_KM else ""
        return {
            "lat": lat, "lng": lng,
            "label": f"{unit.get('number') or raw} ({status_txt}{near})",
            "country": code[:2] if code else None,
            "near_code": code,
            "code": code if d <= NEAR_LABEL_MAX_KM else None,
            "is_truck": True,
            "unit": unit,   # v1.83: марка для ночного запрета AT
        }

    # v1.62: "lv" / "Латвия" — просто База
    if is_base_word(raw):
        blat, blng, bname = base_point()
        code, d = nearest_region_code(blat, blng)
        return {
            "lat": blat, "lng": blng,
            "label": f"База ({bname})",
            "country": "LV",
            "near_code": code,
            "code": code if d <= NEAR_LABEL_MAX_KM else None,
            "is_truck": False,
        }

    # v1.40: страна через Базу (fin / ee ...) — маршрут до Базы + плашка "+довоз"
    dv = dovoz_country(raw)
    if dv:
        blat, blng, bname = base_point()
        code, d = nearest_region_code(blat, blng)
        return {
            "lat": blat, "lng": blng,
            "label": f"База ({bname})",
            "country": "LV",
            "near_code": code,
            "code": code if d <= NEAR_LABEL_MAX_KM else None,
            "is_truck": False,
            "dovoz": dv,
        }

    # v1.28: точка из адресной базы
    addr = None if looks_like_gps_or_code(raw) else find_address(raw)
    if addr is not None:
        lat, lng = addr["lat"], addr["lng"]
        code, d = nearest_region_code(lat, lng)
        near = f" (около {code})" if code and d <= NEAR_LABEL_MAX_KM else ""
        return {
            "lat": lat, "lng": lng,
            "label": f"{addr['name']}{near}",
            "country": addr["country"] or (code[:2] if code else None),
            "near_code": code,
            "code": code if d <= NEAR_LABEL_MAX_KM else None,
            "is_truck": False,
            "address": address_public(addr),
        }

    geo = None
    key0 = raw.upper().replace(" ", "")
    if key0 not in REGION_CODES and not parse_gps(raw):
        # v1.37: город/адрес — запоминаем, что нашёл геокодер, и проверяем на странность
        glat, glng, gname, gcc = geocode_city(raw)
        if glat is None:
            raise ValueError(f"Не удалось распознать: {raw}")
        short_name = ", ".join([x.strip() for x in gname.split(",")][:3])
        suspicious = len(raw.strip()) <= 4 or (gcc is not None and gcc not in OUR_COUNTRIES)
        geo = {"found": short_name, "cc": gcc, "suspicious": suspicious}
        lat, lng, label = glat, glng, f"{raw} → {short_name}"
    else:
        lat, lng, label = resolve_place_label(raw)
    if lat is None:
        raise ValueError(f"Не удалось распознать: {raw}")
    country = get_region_country(raw)
    near_code = None
    code = None
    if country:
        code = raw.strip().upper().replace(" ", "")  # введён сам код региона
    else:
        near_code, d = nearest_region_code(lat, lng)
        country = near_code[:2] if near_code else None
        if near_code and d <= NEAR_LABEL_MAX_KM:
            label = f"{label} (около {near_code})"
            code = near_code
    if geo and geo.get("cc") and not get_region_country(raw):
        country = geo["cc"]
    return {"lat": lat, "lng": lng, "label": label, "country": country,
            "near_code": near_code, "code": code, "is_truck": False, "geo": geo}


def compute_multi_route(points, api_key):
    """v1.50: кеш 15 мин по набору точек (повторное "Рассчитать" не тратит запрос)."""
    import time
    key = tuple((round(p["lat"], 4), round(p["lng"], 4), p.get("country")) for p in points)
    now = time.time()
    with _route_cache_lock:
        hit = _route_cache.get(("multi",) + key)
        if hit and now - hit[0] < ROUTE_CACHE_TTL:
            _route_stat("cache_hits")
            return hit[1]
        _route_stat("calls")
    res = _compute_multi_route(points, api_key)
    with _route_cache_lock:
        _route_cache[("multi",) + key] = (now, res)
    return res


def _compute_multi_route(points, api_key):
    """points — список dict из resolve_point в порядке следования (минимум 2).
    Один запрос к Routes API: точки пользователя — обычные intermediates (каждая
    начинает новый leg), паромы/Инсбрук — via-точки (через них маршрут проходит,
    но leg не разбивается). Так legs ответа = отрезкам между точками пользователя.
    Возвращает (legs, polyline), legs = [{dist_km, waypoints_applied}, ...]."""
    intermediates = []
    leg_rules = []
    for i in range(len(points) - 1):
        a, b = points[i], points[i + 1]
        wps = pick_waypoints_by_country(a["country"], a["lat"], a["lng"],
                                        b["country"], b["lat"], b["lng"]) or []
        leg_rules.append(bool(wps))
        for wlat, wlng in wps:
            intermediates.append({"via": True, "location": {"latLng": {"latitude": wlat, "longitude": wlng}}})
        if i + 1 < len(points) - 1:  # следующая точка пользователя — не финальная
            intermediates.append({"location": {"latLng": {"latitude": b["lat"], "longitude": b["lng"]}}})

    if len(intermediates) > MAX_INTERMEDIATES:
        raise ValueError(
            f"Слишком много точек: {len(intermediates)} промежуточных (вместе с паромами/Инсбруком), "
            f"Routes API допускает максимум {MAX_INTERMEDIATES}"
        )

    first, last = points[0], points[-1]
    body = {
        "origin": {"location": {"latLng": {"latitude": first["lat"], "longitude": first["lng"]}}},
        "destination": {"location": {"latLng": {"latitude": last["lat"], "longitude": last["lng"]}}},
        "travelMode": "DRIVE",
        "routingPreference": "TRAFFIC_UNAWARE",   # v1.50: без пробок — дешевле (Essentials), ETA и так км/70
    }
    if intermediates:
        body["intermediates"] = intermediates
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": api_key,
        "X-Goog-FieldMask": "routes.distanceMeters,routes.legs.distanceMeters,routes.polyline.encodedPolyline",
    }
    resp = requests.post(ROUTES_API_URL, json=body, headers=headers, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    if "routes" not in data or not data["routes"]:
        raise RuntimeError(f"Routes API вернул пустой ответ: {data}")
    route = data["routes"][0]
    api_legs = route.get("legs", [])
    legs = []
    for i in range(len(points) - 1):
        # поле с нулём Routes API не передаёт (как в фиксе v1.21) — считаем 0
        meters = api_legs[i].get("distanceMeters", 0) if i < len(api_legs) else 0
        legs.append({"dist_km": meters / 1000, "waypoints_applied": leg_rules[i]})
    polyline = route.get("polyline", {}).get("encodedPolyline")
    return legs, polyline


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
GOOGLE_PROJECT_ID = os.environ.get("GOOGLE_CLOUD_PROJECT") or "my-n8n-bot-496614"
ROUTES_FREE_MONTH = 10000
_gusage_cache = {"at": 0.0, "data": None}


def _monitoring_sum(token, start, end):
    """Сумма запросов к routes.googleapis.com за интервал (как на графике в консоли)."""
    secs = max(60, int((end - start).total_seconds()))
    params = {
        "filter": 'metric.type="serviceruntime.googleapis.com/api/request_count" '
                  'AND resource.type="consumed_api" AND resource.labels.service="routes.googleapis.com"',
        "interval.startTime": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "interval.endTime": end.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "aggregation.alignmentPeriod": f"{secs}s",
        "aggregation.perSeriesAligner": "ALIGN_SUM",
        "aggregation.crossSeriesReducer": "REDUCE_SUM",
    }
    r = requests.get(f"https://monitoring.googleapis.com/v3/projects/{GOOGLE_PROJECT_ID}/timeSeries",
                     params=params, headers={"Authorization": f"Bearer {token}"}, timeout=20)
    if r.status_code == 403:
        raise PermissionError("нет доступа к Cloud Monitoring: выдайте сервисному аккаунту роль Monitoring Viewer")
    r.raise_for_status()
    total = 0
    for ts in r.json().get("timeSeries") or []:
        for pt in ts.get("points") or []:
            v = pt.get("value") or {}
            total += int(v.get("int64Value") or v.get("doubleValue") or 0)
    return total


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
def _lv(ts):
    return (datetime.fromtimestamp(float(ts), timezone.utc) + timedelta(hours=RIGA_UTC_OFFSET)).strftime("%d.%m %H:%M")


def _find_unit(q_raw):
    norm = lambda x: re.sub(r"[^0-9a-zа-я]", "", str(x or "").lower())
    q = norm(q_raw)
    if not q:
        return None
    units = fetch_units(MAPON_API_KEY)
    return (next((u for u in units if str(u["unit_id"]) == q), None)
            or next((u for u in units if norm(u.get("number")) == q or norm(u.get("label")) == q), None)
            or next((u for u in units if q in norm(u.get("number")) or q in norm(u.get("label"))), None))


def unit_stops(unit_id, days=3, min_sec=2 * 3600):
    """Стоянки трака за days суток из route/list (куски, разрезанные полуночью, склеены)."""
    import time
    now = time.time()
    d = mapon_get("https://mapon.com/api/v1/route/list.json",
                  {"key": MAPON_API_KEY, "unit_id": unit_id,
                   "from": _iso_utc(now - days * 86400), "till": _iso_utc(now)}, timeout=30)
    out = []
    for u in (d.get("data") or {}).get("units") or []:
        for r in u.get("routes") or []:
            if r.get("type") != "stop":
                continue
            st = r.get("start") or {}
            try:
                s_ts = datetime.strptime(st.get("time"), "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp()
                e_raw = (r.get("end") or {}).get("time")
                e_ts = (datetime.strptime(e_raw, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp()
                        if e_raw else now)
            except Exception:
                continue
            if out and abs(s_ts - out[-1]["end"]) <= 60 and out[-1]["address"] == st.get("address"):
                out[-1]["end"] = e_ts
                out[-1]["now"] = not e_raw
            else:
                out.append({"start": s_ts, "end": e_ts, "address": st.get("address"),
                            "lat": st.get("lat"), "lng": st.get("lng"), "now": not e_raw})
    return [x for x in out if x["end"] - x["start"] >= min_sec or x["now"]]


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
def _wkt_center(wkt):
    """Центр объекта из WKT Mapon (по умолчанию широта первой): среднее вершин."""
    nums = re.findall(r"-?\d+(?:\.\d+)?", str(wkt or ""))
    pts = [(float(nums[i]), float(nums[i + 1])) for i in range(0, len(nums) - 1, 2)]
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    if not pts:
        return None, None, 0
    lat = sum(p[0] for p in pts) / len(pts)
    lng = sum(p[1] for p in pts) / len(pts)
    if abs(lat) > 90:                      # на случай долготы первой
        lat, lng = lng, lat
    return round(lat, 5), round(lng, 5), len(pts)


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
MAPON_BASE = "https://mapon.com/api/v1/"


def _utc_iso(ts):
    from datetime import datetime, timezone
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _lv_time(ts):
    from datetime import datetime, timezone, timedelta
    try:
        from zoneinfo import ZoneInfo
        tz = ZoneInfo("Europe/Riga")
    except Exception:
        tz = timezone(timedelta(hours=3))
    return datetime.fromtimestamp(int(ts), tz).strftime("%d.%m %H:%M")


def _check_daily_activities(driver_id, now, days=14):
    d = mapon_get(MAPON_BASE + "driver/daily_activities.json",
                  {"key": MAPON_API_KEY, "driver": driver_id,
                   "from": _utc_iso(now - days * 86400), "till": _utc_iso(now),
                   "include": "card_events,work_place_events"}, timeout=30)
    rows = d.get("data") if isinstance(d, dict) else d
    if isinstance(rows, dict):          # на случай {"data": {"days": [...]}} / {id: [...]}
        rows = next((v for v in rows.values() if isinstance(v, list)), [])
    rows = rows or []
    acts = []
    for day in rows:
        if isinstance(day, dict):
            acts += [a for a in (day.get("activities") or []) if isinstance(a, dict)]
        elif isinstance(day, list):     # день может прийти сразу списком интервалов
            acts += [a for a in day if isinstance(a, dict)]
    for a in acts:
        for k in ("start", "end", "duration"):
            try:
                a[k] = int(float(a.get(k) or 0))
            except (TypeError, ValueError):
                a[k] = 0
    sources, statuses = {}, {}
    for a in acts:
        sources[a.get("source")] = sources.get(a.get("source"), 0) + 1
        statuses[a.get("status")] = statuses.get(a.get("status"), 0) + 1
    # склеиваем соседние REST (через границу суток) и ищем длинные отдыхи
    rests, cur = [], None
    for a in sorted((a for a in acts if a.get("duration", 0) > 0), key=lambda a: a["start"]):
        if a.get("status") == "REST":
            if cur and a["start"] - cur["end"] <= 60:
                cur["end"] = a["end"]; cur["src"].add(a.get("source"))
            else:
                cur = {"start": a["start"], "end": a["end"], "src": {a.get("source")}}
                rests.append(cur)
        else:
            cur = None
    long_rests = [{"с": _lv_time(r["start"]), "по": _lv_time(r["end"]),
                   "часов": round((r["end"] - r["start"]) / 3600, 1),
                   "источник": ",".join(sorted(s or "?" for s in r["src"]))}
                  for r in rests if r["end"] - r["start"] >= 20 * 3600]
    shape = type(d).__name__ + (":" + type(rows[0]).__name__ if rows else "")
    return {"ok": True, "формат": shape, "дней": len(rows), "интервалов": len(acts),
            "источники": sources, "статусы": statuses,
            "отдыхи_от_20ч": long_rests,
            "карта_события": [{"когда": _lv_time(a["start"]), "что": a.get("status"), "unitId": a.get("unitId")}
                              for a in sorted(acts, key=lambda a: a["start"])
                              if a.get("status") in ("CARD_INSERTED", "CARD_REMOVED")][-12:]}


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


def calc_extra_stops(extras, units, unit, first, tacho, sim):
    """v1.64: точки 2..N строки Флота. Для каждой: км от машины по цепочке, км плеча,
    ETA (простой и по тахографу) с учётом UNLOAD_STOP_SEC на каждой предыдущей точке,
    запреты на плече, плашка кода региона, координаты и линия плеча для карты."""
    import time
    loc = lambda ts: (datetime.fromtimestamp(ts, timezone.utc) + timedelta(hours=WEST_EUROPE_OFFSET))
    now = time.time()
    prev_lat, prev_lng = first["target_lat"], first["target_lng"]
    cum_km = float(first.get("dist_km") or 0)
    # приезд на 1-ю точку
    prev_arr = sim["eta_ts"] if sim else now + cum_km / 70 * 3600
    out = []
    n_stops = 0          # сколько точек уже пройдено (на каждой UNLOAD_STOP_SEC)
    for tstr in extras:
        if not tstr:
            out.append({"empty": True})
            continue
        try:
            t = resolve_fleet_target(tstr, units, unit)
        except ValueError as e:
            out.append({"error": str(e)})
            break
        lat, lng = t.pop("lat"), t.pop("lng")
        if lat is None:
            out.append({"error": f"Не удалось распознать: {tstr}"})
            break
        leg_km, leg_poly = road_distance_km_google(prev_lat, prev_lng, lat, lng, GOOGLE_API_KEY,
                                                   fleet_waypoints(prev_lat, prev_lng, lat, lng))   # v2.03
        cum_km += leg_km
        n_stops += 1
        dwell = n_stops * UNLOAD_STOP_SEC
        simple_ts = now + cum_km / 70 * 3600 + dwell
        item = dict(t)
        item.update({
            "lat": lat, "lng": lng,
            "dist_km": round(cum_km, 1),
            "leg_km": round(leg_km, 1),
            "polyline": leg_poly,
            "eta_local": round_to_15min(loc(simple_ts)).strftime("%d/%m %H:%M"),
        })
        arr = simple_ts
        if tacho:
            try:
                sk = tacho_eta(tacho, cum_km)
                arr = sk["eta_ts"] + dwell
                item["eta_tacho"] = round_to_15min(loc(arr)).strftime("%d/%m %H:%M")
                item["tacho_rest_ahead"] = any(st["kind"] in ("daily", "weeklimit") for st in sk["stops"])
                item["tacho_weeklimit"] = bool(sk.get("week", {}).get("hit"))
            except Exception:
                pass
        item["badge"], item["badge_hint"] = target_badge_info(tstr, lat, lng, t.get("target_address"))
        if leg_poly and leg_km >= 5:
            try:
                hits, _bst = bans_on_route(leg_poly, leg_km, None, prev_arr + UNLOAD_STOP_SEC,
                                           at_night=needs_at_night_ban(unit))
                item["bans_route"] = bans_hits_text(hits, lambda ts: loc(ts).strftime("%d/%m %H:%M"))
            except Exception:
                pass
        out.append(item)
        prev_lat, prev_lng, prev_arr = lat, lng, arr
    return out


# v1.64: разбор таргета строки Флота (машина-перецеп / довоз / адресная база / код / GPS / город).
# Возвращает dict: lat, lng + поля для ответа (target_is_truck, target_unit, target_dovoz,
# target_address). Ошибки — ValueError с понятным текстом.
def resolve_fleet_target(target_str, units, unit=None):
    target_unit = None
    if target_str and not looks_like_gps_or_code(target_str):
        target_unit = find_unit_exact(units, target_str)
    if target_unit is not None:
        if unit is not None and (target_unit is unit or target_unit.get("unit_id") == unit.get("unit_id")):
            raise ValueError("Таргет — та же машина")
        if target_unit.get("lat") is None or target_unit.get("lng") is None:
            raise ValueError(f"У машины-таргета {target_str} нет координат в Mapon")
        return {"lat": target_unit["lat"], "lng": target_unit["lng"],
                "target_is_truck": True, "target_unit": target_unit.get("number")}
    if dovoz_country(target_str):
        blat, blng, _bn = base_point()
        return {"lat": blat, "lng": blng, "target_dovoz": dovoz_country(target_str)}
    addr = None
    if target_str and not looks_like_gps_or_code(target_str):
        addr = find_address(target_str)
    if addr is not None:
        return {"lat": addr["lat"], "lng": addr["lng"], "target_address": address_public(addr)}
    lat, lng = resolve_target(target_str)
    return {"lat": lat, "lng": lng}


def target_badge_info(target_str, lat, lng, address=None):
    """Плашка кода региона таргета: (badge, hint)."""
    key = str(target_str or "").strip().upper().replace(" ", "")
    if key in REGION_CODES:
        tcode, tcc, td = key, key[:2], 0.0
    else:
        tcode, td = nearest_region_code(lat, lng)
        tcc = (address or {}).get("country") or (tcode[:2] if tcode else None)
    badge = tcode if tcode and td <= NEAR_LABEL_MAX_KM else tcc
    hint = (f"{tcc} · около {tcode}" + (f" ({round(td)} км)" if td > NEAR_LABEL_MAX_KM else "")) if tcode else tcc
    return badge, hint


UNLOAD_STOP_SEC = 30 * 60   # v1.64: время на выгрузку/погрузку между точками одной машины

# ---------- v1.79: "точка пройдена" ✓ — по истории стоянок трака в Mapon ----------
DONE_RADIUS_KM = 0.5        # стоял ближе 500 м от точки
DONE_MIN_STOP_SEC = 15 * 60 # не меньше 15 мин
DONE_LEFT_KM = 1.0          # и уже уехал дальше 1 км (иначе ещё грузится/ждёт)
DONE_HISTORY_DAYS = 2       # смотрим последние 48 ч
DONE_STOPS_TTL = 600        # историю стоянок кешируем на 10 мин на машину
_done_stops_cache = {}      # unit_id -> (ts, stops)


def recent_stops(unit_id):
    import time
    hit = _done_stops_cache.get(unit_id)
    if hit and time.time() - hit[0] < DONE_STOPS_TTL:
        return hit[1]
    stops = unit_stops(unit_id, days=DONE_HISTORY_DAYS, min_sec=DONE_MIN_STOP_SEC)
    _done_stops_cache[unit_id] = (time.time(), stops)
    return stops


def points_done(pts, manual, unit, units):
    """pts — строки точек (① + следующие), manual — [True/False/None] ручные отметки.
    -> список {done, auto, at}: пройдена ли точка (ручная отметка важнее автоматической)."""
    out = []
    stops = None
    for i, tstr in enumerate(pts):
        m = manual[i] if i < len(manual) else None
        info = {"done": False, "auto": False, "at": None, "manual": m}
        auto_at = None
        t, lat, lng = None, None, None
        if tstr:
            try:
                t = resolve_fleet_target(tstr, units, unit)
                lat, lng = t.get("lat"), t.get("lng")
                if lat is not None:       # v1.80: код региона и у пройденной точки
                    info["badge"], info["badge_hint"] = target_badge_info(tstr, lat, lng, t.get("target_address"))
            except Exception:
                t = None
        if t is not None and m is None and unit.get("lat") is not None:
            try:
                # точка-машина (перецеп) двигается — по истории не проверяем
                if lat is not None and not t.get("target_is_truck") \
                        and haversine_km(unit["lat"], unit["lng"], lat, lng) > DONE_LEFT_KM:
                    if stops is None:
                        stops = recent_stops(unit.get("unit_id")) or []
                    for st in stops:
                        if st.get("now") or st.get("lat") is None:
                            continue
                        if haversine_km(st["lat"], st["lng"], lat, lng) <= DONE_RADIUS_KM:
                            auto_at = max(auto_at or 0, st["end"])
            except Exception:
                pass
        if m is True:
            info["done"] = True
        elif m is None and auto_at:
            info.update(done=True, auto=True,
                        at=(datetime.fromtimestamp(auto_at, timezone.utc) + timedelta(hours=WEST_EUROPE_OFFSET)).strftime("%d/%m %H:%M"))
        out.append(info)
    return out


@app.route("/api/calc", methods=["POST"])
def api_calc():
    """
    body: {"unit": "OI1779", "target": "43.30726, -8.48246" | "Oslo" | "NO01" | ""}
    Возвращает статус машины и, если задан target, расстояние/ETA по дорогам.
    """
    if not MAPON_API_KEY:
        return jsonify({"error": "MAPON_API_KEY не настроен на сервере"}), 500

    payload = request.get_json(force=True, silent=True) or {}
    unit_query = payload.get("unit", "")
    target_str = payload.get("target", "")

    if not unit_query:
        return jsonify({"error": "Не указана машина"}), 400

    try:
        units = fetch_units(MAPON_API_KEY)
        exact = find_unit_exact(units, unit_query)
        matches = [exact] if exact else find_unit_by_label(units, unit_query)
        if not matches:
            return jsonify({"error": f"Машина '{unit_query}' не найдена"}), 404
        if len(matches) > 1:
            return jsonify({
                "error": "Найдено несколько машин, уточните запрос",
                "candidates": [u.get("number") for u in matches],
            }), 409

        unit = matches[0]
        state = unit.get("state", {})
        status_name = state.get("name")
        duration_sec = state.get("duration", 0)

        result = {
            "number": unit.get("number"),
            "status": status_name,
            "status_ru": STATUS_RU.get(status_name, status_name),
            "duration_str": format_duration(duration_sec),
            "speed": unit.get("speed"),
            # v1.30: курс (градусы) для стрелки на плашке, если Mapon его отдаёт
            "direction": next((unit.get(k) for k in ("direction", "course", "heading", "angle")
                               if isinstance(unit.get(k), (int, float))), None),
            "last_update": unit.get("last_update"),
            "unit_lat": unit.get("lat"),
            "unit_lng": unit.get("lng"),
            "dist_km": None,
            "eta_local": None,
        }

        # v1.70: прицеп — рефка и тягач рядом; у тягача — прицеп рядом (Mapon их не связывает)
        trailer = is_trailer(unit)
        result["is_trailer"] = trailer
        try:
            truck_ids = fetch_group_unit_ids(MAPON_API_KEY, HEAD_TRUCK_GROUP_ID)
            h = find_hitch(unit, units, truck_ids)
            if h:
                result["hitch"] = h
        except Exception:
            pass
        if trailer:
            try:
                result["reefer"] = reefer_summary(fetch_reefer_units().get(unit.get("unit_id")))
            except Exception as e:
                result["reefer_error"] = str(e)
        # v1.71: прицеп, привязанный к тягачу вручную (строка Флота) — где он и что с рефкой
        lt = str(payload.get("trailer") or "").strip()
        if lt and not trailer:
            tu = find_unit_exact(units, lt)
            if tu is None:
                result["linked_trailer"] = {"number": lt, "error": "прицеп не найден в Mapon"}
            else:
                info = {"number": tu.get("number") or lt, "lat": tu.get("lat"), "lng": tu.get("lng"),
                        "status": (tu.get("state") or {}).get("name")}
                if None not in (unit.get("lat"), unit.get("lng"), tu.get("lat"), tu.get("lng")):
                    info["km"] = round(haversine_km(unit["lat"], unit["lng"], tu["lat"], tu["lng"]), 2)
                    info["far"] = info["km"] > TRAILER_FAR_KM
                try:
                    info["reefer"] = reefer_summary(fetch_reefer_units().get(tu.get("unit_id")))
                except Exception as e:
                    info["reefer_error"] = str(e)
                result["linked_trailer"] = info

        # v1.79: пройденные точки (✓) — считаем от машины сразу до первой непройденной
        pts_all = [target_str] + [str(x or "").strip() for x in (payload.get("extra") or [])][:11]
        manual = [(v if v in (True, False) else None) for v in (payload.get("done") or [])]
        active_extras = pts_all[1:]
        if any(pts_all):
            try:
                dn = points_done(pts_all, manual, unit, units)
            except Exception:
                dn = [{"done": False} for _ in pts_all]
            result["points_done"] = dn
            active = [i for i, p in enumerate(pts_all) if not dn[i]["done"]]
            result["active_idx"] = active
            if not active:
                result["all_done"] = True
                target_str, active_extras = "", []
            else:
                target_str = pts_all[active[0]]
                active_extras = [pts_all[i] for i in active[1:]]

        try:
            tgt = resolve_fleet_target(target_str, units, unit)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        target_lat, target_lng = tgt.pop("lat"), tgt.pop("lng")
        result.update(tgt)
        if target_lat is not None and not GOOGLE_API_KEY:
            return jsonify({"error": "GOOGLE_API_KEY не настроен на сервере"}), 500

        if target_lat is not None:
            cur_lat, cur_lng = unit["lat"], unit["lng"]
            wps = fleet_waypoints(cur_lat, cur_lng, target_lat, target_lng)   # v2.03: паромы/Инсбрук и во Флоте
            dist_km, polyline = road_distance_km_google(cur_lat, cur_lng, target_lat, target_lng, GOOGLE_API_KEY, wps)
            if wps:
                result["waypoints_applied"] = True
            _, eta_local = calc_eta(dist_km)
            result["dist_km"] = round(dist_km, 1)
            result["eta_local"] = eta_local.strftime("%d/%m %H:%M")
            result["target_lat"] = target_lat
            result["target_lng"] = target_lng
            result["route_polyline"] = polyline

        # v1.33: тахограф — ETA по режиму труда и отдыха + подробности
        tacho, sim = None, None
        try:
            tacho, terr = (None, None) if trailer else get_tacho(unit.get("unit_id"))
            if tacho:
                sim = None
                if result.get("dist_km") is not None:
                    sim = tacho_eta(tacho, result["dist_km"])
                    eta_t = round_to_15min(datetime.fromtimestamp(sim["eta_ts"], timezone.utc)
                                           + timedelta(hours=WEST_EUROPE_OFFSET))
                    result["eta_tacho"] = eta_t.strftime("%d/%m %H:%M")
                    result["tacho_rest_ahead"] = any(st["kind"] in ("daily", "weeklimit") for st in sim["stops"])
                    result["_sim_stops"] = sim["stops"]
                d0 = next((d for d in tacho["drivers"] if d.get("current_state") == "DRIVING"), tacho["drivers"][0])
                result["tacho_resting_now"] = d0.get("current_state") == "REST"
                result["tacho_team"] = len(tacho["drivers"]) >= 2
                result["tacho_summary"] = tacho_summary(tacho, sim)
                result["tacho_weeklimit"] = bool(sim and sim.get("week", {}).get("hit"))
            else:
                result["tacho_error"] = terr
        except Exception as e:
            result["tacho_error"] = str(e)

        # v1.64: следующие точки той же машины (2-я, 3-я выгрузка...) — цепочкой от
        # предыдущей точки, плюс UNLOAD_STOP_SEC на каждую предыдущую точку
        extras = active_extras   # v1.74: до 12 точек; v1.79: без пройденных
        if extras and result.get("target_lat") is not None:
            try:
                result["extra"] = calc_extra_stops(extras, units, unit, result, tacho, sim)
            except Exception as e:
                result["extra"] = [{"error": str(e)} for _ in extras]

        # v1.59: цепочка стран по маршруту (без времени)
        if result.get("route_polyline") and result.get("dist_km"):
            try:
                result["route_countries"] = country_chain(result["route_polyline"], result["dist_km"])
            except Exception:
                pass
        # v1.59: трак на объекте таргета (полигон Mapon или радиус вокруг точки)
        if result.get("target_lat") is not None:
            try:
                ot = on_target(unit["lat"], unit["lng"], result["target_lat"], result["target_lng"])
                if ot:
                    result["on_target"] = ot
            except Exception:
                pass

        # v1.45: полные запреты по пути (по тахо-симуляции, иначе без остановок)
        stops = result.pop("_sim_stops", None)
        # v1.60: трак на объекте или до таргета меньше 5 км — запреты не проверяем
        if (result.get("route_polyline") and result.get("dist_km")
                and result["dist_km"] >= 5 and not result.get("on_target")):
            try:
                hits, bst = bans_on_route(result["route_polyline"], result["dist_km"], stops,
                                         at_night=needs_at_night_ban(unit))
                loc = lambda ts: (datetime.fromtimestamp(ts, timezone.utc) + timedelta(hours=WEST_EUROPE_OFFSET)).strftime("%d/%m %H:%M")
                result["bans_route"] = bans_hits_text(hits, loc)
                result["bans_status"] = bst
            except Exception as e:
                result["bans_status"] = f"ошибка: {e}"

        # v1.31: страна машины и код региона таргета (плашки в таблице)
        try:
            if result.get("unit_lat") is not None:
                code, d = nearest_region_code(result["unit_lat"], result["unit_lng"])
                if code:
                    result["unit_country"] = code[:2]
                    result["unit_code_hint"] = f"{code[:2]} · около {code}" + (f" ({round(d)} км)" if d > NEAR_LABEL_MAX_KM else "")
            if result.get("target_lat") is not None:
                result["target_badge"], result["target_code_hint"] = target_badge_info(
                    target_str, result["target_lat"], result["target_lng"], result.get("target_address"))
        except Exception:
            pass

        return jsonify(result)

    except Exception as e:
        return jsonify({"error": str(e)}), 502


@app.route("/api/route", methods=["POST"])
def api_route():
    """
    body: {"from": ["OI-4310", "IT20", ...], "to": ["SE25", "59.9, 10.8", ...]}
    (старый формат {"from": "ES30", "to": "SE25"} тоже принимается).
    Каждое поле — машина (номер из Mapon) / GPS / код региона / город.
    Пустые поля пропускаются. Маршрут строго по порядку: from1..fromN -> to1..toM.
    Если точка всего одна — просто показываем её, без маршрута.
    """
    if not GOOGLE_API_KEY:
        return jsonify({"error": "GOOGLE_API_KEY не настроен на сервере"}), 500

    payload = request.get_json(force=True, silent=True) or {}

    def as_list(v):
        if isinstance(v, list):
            return [str(x).strip() for x in v if str(x or "").strip()]
        v = str(v or "").strip()
        return [v] if v else []

    froms = as_list(payload.get("from"))
    tos = as_list(payload.get("to"))
    if not froms and not tos:
        return jsonify({"error": "Заполните хотя бы одно поле — From или To"}), 400

    # Список машин из Mapon запрашиваем максимум один раз и только если он нужен
    units_cache = {}
    def units_getter():
        if "units" not in units_cache:
            units_cache["units"] = fetch_units(MAPON_API_KEY)
        return units_cache["units"]

    try:
        points = []
        for kind, values in (("L", froms), ("O", tos)):
            for n, raw in enumerate(values, start=1):
                try:
                    pt = resolve_point(raw, units_getter)
                except ValueError as e:
                    field = "From" if kind == "L" else "To"
                    return jsonify({"error": f"{field}{n}: {e}"}), 400
                pt.update({"kind": kind, "num": n, "raw": raw})
                points.append(pt)

        result = {
            "points": [
                {**{k: p[k] for k in ("kind", "num", "label", "lat", "lng", "is_truck", "code")},
                 "address": p.get("address"), "geo": p.get("geo"), "raw": p.get("raw"),
                 "dovoz": p.get("dovoz")}
                for p in points
            ],
            "legs": [],
            "dist_km": None,
            "duration_h": None,
            "route_polyline": None,
            "waypoints_applied": False,
        }

        if len(points) >= 2:
            legs, polyline = compute_multi_route(points, GOOGLE_API_KEY)
            total = 0.0
            for i, leg in enumerate(legs):
                a, b = points[i], points[i + 1]
                total += leg["dist_km"]
                result["legs"].append({
                    "from": f"{a['kind']}{a['num']}",
                    "to": f"{b['kind']}{b['num']}",
                    "from_code": a.get("code"),
                    "to_code": b.get("code"),
                    "dist_km": round(leg["dist_km"], 1),
                    "duration_h": round(leg["dist_km"] / 70, 3),
                    "waypoints_applied": leg["waypoints_applied"],
                })
            result["dist_km"] = round(total, 1)
            result["duration_h"] = round(total / 70, 3)  # 70 км/ч; в ч:мм форматирует фронт
            result["route_polyline"] = polyline
            result["waypoints_applied"] = any(l["waypoints_applied"] for l in legs)
            # v1.45: запреты по пути — при выезде сейчас, соло (4:30/45, 9 ч, отдых 11 ч)
            try:
                sim = tacho_eta(FRESH_SOLO_TACHO, total)
                # v1.83: ночь в Австрии — для MAN-тягача в первой точке; без тягача — "если MAN"
                tu = points[0].get("unit") if points[0].get("is_truck") else None
                at_n = needs_at_night_ban(tu) if tu else True
                hits, bst = bans_on_route(polyline, total, sim["stops"], at_night=at_n)
                loc = lambda ts: (datetime.fromtimestamp(ts, timezone.utc) + timedelta(hours=WEST_EUROPE_OFFSET)).strftime("%d/%m %H:%M")
                result["bans_route"] = bans_hits_text(hits, loc, "MAN без L" if tu else "если MAN")
                result["bans_status"] = bst
            except Exception as e:
                result["bans_status"] = f"ошибка: {e}"

        # v1.29: похожие рейсы из базы фрахтов — первая погрузка -> последняя выгрузка
        if len(points) >= 2:
            try:
                result["freights"] = similar_freights(points[0], points[-1], result["dist_km"])
            except Exception as e:
                result["freights"] = {"error": str(e)}

        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 502


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
# v1.84: кеш по странам. Раньше любой 429 посреди обновления выбрасывал всё, а после
# каждого деплоя / нового инстанса Cloud Run кеш пустой -> снова 6 запросов подряд,
# плюс вкладка и проверка запретов по пути могли качать фид одновременно (12 запросов).
# Теперь: одно обновление за раз (общий замок), удачные страны сохраняются сразу,
# после 429 — стоп и пауза (Retry-After, не меньше 30 мин), потом докачиваются только
# недостающие страны; пауза между запросами 3 с.
BANS_URL = "https://nakordoni.eu/api/truckban_json.php"
BANS_TTL = 3 * 3600          # данные о запретах меняются редко
BANS_MANUAL_MIN = 600        # "↻ Обновить" не чаще раза в 10 минут
BANS_COOLDOWN_429 = 1800     # после 429 не трогаем фид 30 минут
BANS_GROUP = 3               # стран в одном запросе: фид принимает не больше 3 (иначе 400)
BANS_PAUSE = 3.0             # пауза между запросами, сек
BANS_FULL_TYPES = {"Sunday", "Holiday", "General"}   # запрет по всей стране — выделяем
BANS_ADR_WORDS = ("dangerous", "adr", "hazard", "опасн", "небезпеч")  # ADR не возим — скрываем
_bans_cache = {"data": None, "at": 0.0, "error": None, "blocked_until": 0.0}
_bans_cc = {}                # v1.84: cc -> {"at", "upcoming": [...], "current": [...]}
_bans_window = {"w": None}
_bans_lock = threading.Lock()          # короткий — на чтение/запись кеша
_bans_fetch_lock = threading.Lock()    # v1.84: одно обновление фида за раз


class BansRateLimited(RuntimeError):
    def __init__(self, msg, retry_after=0):
        super().__init__(msg)
        self.retry_after = retry_after


class BansBadRequest(RuntimeError):
    pass


def _bans_get(params):
    r = requests.get(BANS_URL, params={"lang": "ru", **params}, timeout=20,
                     headers={"User-Agent": "fleet-eta-tracker"})
    if r.status_code == 429:
        try:
            ra = int(r.headers.get("Retry-After") or 0)
        except ValueError:
            ra = 0
        raise BansRateLimited("nakordoni: слишком много запросов (429)", ra)
    if r.status_code == 400:
        raise BansBadRequest(f"nakordoni: 400 для {params.get('country')}")
    r.raise_for_status()
    d = r.json()
    if not d.get("success", True):
        raise RuntimeError("nakordoni: success=false")
    return d


def _is_adr(b):
    t = f"{b.get('restriction_details') or ''} {b.get('restriction_type') or ''}".lower()
    return any(w in t for w in BANS_ADR_WORDS)


def _bans_store(codes, d):
    """v1.84: ответ по группе стран -> в кеш по странам (страна без запретов тоже отмечается)."""
    import time
    now = time.time()
    part = {c: {"at": now, "upcoming": [], "current": []} for c in codes}
    for key, dst in (("upcoming_bans", "upcoming"), ("current_bans", "current")):
        for b in d.get(key) or []:
            cc = b.get("country_code")
            if cc in part:
                part[cc][dst].append(b)
    with _bans_lock:
        _bans_cc.update(part)
        if d.get("window"):
            _bans_window["w"] = d["window"]


def _bans_fetch_group(codes):
    """Запрос по группе стран; если ответ обрезан или 400 — делим группу пополам;
    страну, на которую фид отвечает 400, пропускаем. 429 — пробрасываем (стоп)."""
    import time
    try:
        d = _bans_get({"country": ",".join(codes)})
    except BansBadRequest:
        time.sleep(BANS_PAUSE)
        if len(codes) > 1:
            half = len(codes) // 2
            _bans_fetch_group(codes[:half])
            _bans_fetch_group(codes[half:])
        else:
            _bans_store(codes, {})   # фид не знает страну — считаем "без запретов", не спрашиваем снова
        return
    time.sleep(BANS_PAUSE)
    if d.get("truncated") and len(codes) > 1:
        half = len(codes) // 2
        _bans_fetch_group(codes[:half])
        _bans_fetch_group(codes[half:])
        return
    _bans_store(codes, d)


def _bans_build():
    """Собрать данные вкладки из кеша по странам (даже если часть стран не скачалась)."""
    with _bans_lock:
        cc_data = dict(_bans_cc)
        window = _bans_window["w"]
    codes = sorted(OUR_COUNTRIES)
    seen, upcoming, current = set(), [], []
    for cc in codes:
        src = cc_data.get(cc)
        if not src:
            continue
        for key, dst in (("upcoming", upcoming), ("current", current)):
            for b in src[key]:
                if _is_adr(b) or b.get("country_code") not in OUR_COUNTRIES:
                    continue
                k = (key, b.get("country_code"), b.get("date"), b.get("time_from"), b.get("time_until"),
                     b.get("restriction_type"), b.get("restriction_details"))
                if k in seen:
                    continue
                seen.add(k)
                dst.append({
                    "cc": b.get("country_code"), "country": b.get("country_name"),
                    "date": b.get("date"), "from": b.get("time_from"), "until": b.get("time_until"),
                    "type": b.get("restriction_type"), "details": b.get("restriction_details"),
                    "min_weight": b.get("min_weight_tons"), "url": b.get("details_url"),
                    "full": b.get("restriction_type") in BANS_FULL_TYPES,
                })
    by_day = {}
    for b in upcoming:
        by_day.setdefault(b["date"], []).append(b)
    for lst in by_day.values():
        lst.sort(key=lambda b: (not b["full"], b["cc"] or "", b["from"] or ""))
    current.sort(key=lambda b: (not b["full"], b["cc"] or ""))
    return {
        "window": window,
        "now": current,
        "days": [{"date": d, "bans": by_day[d]} for d in sorted(by_day)],
        "countries": codes,
        "missing": [c for c in codes if c not in cc_data],
    }


def _bans_refresh(max_age=BANS_TTL):
    """v1.84: докачать страны старше max_age. Вызывать под _bans_fetch_lock.
    Удачные группы сохраняются сразу; на 429 — стоп и пауза."""
    import time
    now = time.time()
    with _bans_lock:
        if now < _bans_cache["blocked_until"]:
            return
        need = [c for c in sorted(OUR_COUNTRIES)
                if c not in _bans_cc or now - _bans_cc[c]["at"] > max_age]
    err = None
    try:
        for k in range(0, len(need), BANS_GROUP):
            _bans_fetch_group(need[k:k + BANS_GROUP])
    except BansRateLimited as e:
        err = str(e)
        with _bans_lock:
            _bans_cache["blocked_until"] = time.time() + max(BANS_COOLDOWN_429, e.retry_after)
    except Exception as e:
        err = str(e)
        with _bans_lock:
            _bans_cache["blocked_until"] = time.time() + 300
    with _bans_lock:
        have = bool(_bans_cc)
        oldest = min((v["at"] for v in _bans_cc.values()), default=0.0)
    data = _bans_build() if have else None
    if data and data["missing"] and not err:
        err = "нет данных по: " + ", ".join(data["missing"])
    with _bans_lock:
        if data:
            _bans_cache.update(data=data, at=oldest)
        _bans_cache["error"] = err


def fetch_bans():
    """Совместимость: полное обновление (все страны)."""
    with _bans_fetch_lock:
        _bans_refresh(max_age=0)
    return _bans_cache["data"]


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


# ---------- v1.45: запреты по пути (только предупреждение, ETA не сдвигается) ----------
BANS_ROUTE_STEP_KM = 10
COUNTRY_TZ = {"PT": "Europe/Lisbon", "FI": "Europe/Helsinki", "EE": "Europe/Tallinn",
              "LV": "Europe/Riga", "LT": "Europe/Vilnius"}   # остальные наши — CET
_cc_points = None


def _decode_polyline(enc):
    pts, i, lat, lng = [], 0, 0, 0
    while enc and i < len(enc):
        for which in (0, 1):
            shift = result = 0
            while True:
                b = ord(enc[i]) - 63
                i += 1
                result |= (b & 0x1F) << shift
                shift += 5
                if b < 0x20:
                    break
            d = ~(result >> 1) if result & 1 else result >> 1
            if which == 0:
                lat += d
            else:
                lng += d
        pts.append((lat / 1e5, lng / 1e5))
    return pts


def _country_at(lat, lng):
    """Страна точки — по ближайшему коду региона (быстрая плоская метрика)."""
    global _cc_points
    if _cc_points is None:
        _cc_points = [(v["lat"], v["lng"], c[:2]) for c, v in REGION_CODES.items()]
    k = math.cos(math.radians(lat))
    best, cc = float("inf"), None
    for la, ln, c in _cc_points:
        d = (la - lat) ** 2 + ((ln - lng) * k) ** 2
        if d < best:
            best, cc = d, c
    return cc


def route_countries(polyline, dist_km):
    """Страны по маршруту: [(cc, km_from, km_to)] в км Google-маршрута."""
    pts = _decode_polyline(polyline or "")
    if len(pts) < 2:
        return []
    cum = [0.0]
    for a, b in zip(pts, pts[1:]):
        cum.append(cum[-1] + haversine_km(a[0], a[1], b[0], b[1]))
    total = cum[-1] or 1.0
    scale = float(dist_km or total) / total
    segs, j, km = [], 0, 0.0
    while True:
        while j < len(pts) - 2 and cum[j + 1] < km:
            j += 1
        a, b = pts[j], pts[j + 1]
        f = 0.0 if cum[j + 1] == cum[j] else min(1.0, max(0.0, (km - cum[j]) / (cum[j + 1] - cum[j])))
        cc = _country_at(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f)
        g = km * scale
        if segs and segs[-1][0] == cc:
            segs[-1][2] = g
        else:
            if segs:
                segs[-1][2] = g
            segs.append([cc, g, g])
        if km >= total:
            break
        km = min(total, km + BANS_ROUTE_STEP_KM)
    segs[-1][2] = float(dist_km or total * scale)
    return [tuple(x) for x in segs]


def _drive_intervals(t0, stops, total_drive_sec):
    """Интервалы вождения [(t_start, t_end, sec_driven_before)] между остановками симуляции."""
    out, t, done = [], t0, 0.0
    for st in sorted(stops or [], key=lambda x: x["start"]):
        if done >= total_drive_sec:
            break
        if st["start"] > t:
            seg = min(st["start"] - t, total_drive_sec - done)
            out.append((t, t + seg, done))
            done += seg
        t = max(t, st["end"])
    if done < total_drive_sec:
        out.append((t, t + total_drive_sec - done, done))
    return out


def _ban_window_utc(b):
    """(start_ts, end_ts) запрета в UTC по местному времени страны."""
    try:
        from zoneinfo import ZoneInfo
        tz = ZoneInfo(COUNTRY_TZ.get(b["cc"], "Europe/Berlin"))
    except Exception:
        tz = timezone(timedelta(hours=RIGA_UTC_OFFSET - 1))
    try:
        day = datetime.strptime(b["date"], "%Y-%m-%d")
    except Exception:
        return None

    def at(hm, base):
        hm = (hm or "00:00")[:5]
        h, m = int(hm[:2]), int(hm[3:5])
        return base + timedelta(hours=h, minutes=m)
    s = at(b.get("from"), day)
    e = at(b.get("until") or "24:00", day)
    if e <= s:
        e += timedelta(days=1)
    return s.replace(tzinfo=tz).timestamp(), e.replace(tzinfo=tz).timestamp()


def bans_cached():
    """Данные о запретах из кеша; если кеша нет/устарел — обновление в фоне (не ждём).
    v1.84: через общий замок — не качает фид одновременно с вкладкой "Запреты"."""
    import time
    now = time.time()
    with _bans_lock:
        data = _bans_cache["data"]
        stale = data is None or now - _bans_cache["at"] > BANS_TTL or bool((data or {}).get("missing"))
        blocked = now < _bans_cache["blocked_until"]
    if stale and not blocked and _bans_fetch_lock.acquire(blocking=False):
        def job():
            try:
                _bans_refresh()
            finally:
                _bans_fetch_lock.release()
        threading.Thread(target=job, daemon=True).start()
    return data


# ---------- v1.83: ночной запрет Австрии для MAN (нет наклейки "L" / lärmarm) ----------
AT_NIGHT_FROM, AT_NIGHT_UNTIL = "22:00", "05:00"
BRAND_WMI = {"WMA": "MAN", "XLR": "DAF", "YV2": "VOLVO", "YB3": "VOLVO", "YV5": "VOLVO"}


def unit_brand(u):
    """Марка тягача из данных Mapon: make, затем название/метка, затем VIN (WMI). None — не знаем."""
    u = u or {}
    for k in ("make", "vehicle_make", "brand", "vehicle_title", "label"):
        t = str(u.get(k) or "").upper()
        for b in ("MAN", "DAF", "VOLVO"):
            if re.search(rf"\b{b}\b", t):
                return b
    vin = str(u.get("vin") or "").upper().strip()
    return BRAND_WMI.get(vin[:3]) if len(vin) >= 3 else None


def needs_at_night_ban(u):
    """Правило для всего парка (29.09.2026): все MAN без L-наклейки, DAF/Volvo — с ней."""
    return unit_brand(u) == "MAN" and not is_trailer(u)


def _at_night_bans(t0, horizon_sec):
    """Ночные окна 22:00–05:00 (Вена) на весь горизонт рейса — как запреты AT."""
    out = {}
    d0 = datetime.fromtimestamp(t0 - 86400, timezone.utc).date()
    for i in range(int(horizon_sec // 86400) + 3):
        b = {"cc": "AT", "date": (d0 + timedelta(days=i)).isoformat(), "from": AT_NIGHT_FROM,
             "until": AT_NIGHT_UNTIL, "type": "NightAT", "details": "ночной запрет для траков без L-наклейки"}
        w = _ban_window_utc(b)
        if w:
            out[(b["date"], "night")] = (b, w)
    return out


def bans_on_route(polyline, dist_km, stops=None, t0=None, at_night=False):
    """Полные запреты (воскресные/праздничные/общие), под которые попадает вождение
    по маршруту. Возвращает (hits, status): hits = [{cc, date, from, until, type,
    enter_ts}], status = "ok" | "loading".
    v1.83: at_night=True (MAN / "если MAN") — плюс ночной запрет Австрии 22:00–05:00."""
    import time
    data = bans_cached()
    if data is None and not at_night:
        return [], "loading"
    status = "ok" if data is not None else "loading"
    data = data or {}
    t0 = float(t0 or time.time())
    v = TACHO_SPEED_KMH / 3600.0
    drive = _drive_intervals(t0, stops, float(dist_km or 0) / v)
    bans = {}
    for b in (data.get("now") or []) + [x for d in data.get("days") or [] for x in d["bans"]]:
        if not b.get("full"):
            continue
        w = _ban_window_utc(b)
        if w:
            bans.setdefault(b["cc"], {})[(b["date"], b.get("from"), b.get("until"))] = (b, w)
    if at_night:
        horizon = (drive[-1][1] - t0) if drive else 0
        bans.setdefault("AT", {}).update(_at_night_bans(t0, horizon))
    hits = []
    for cc, km_a, km_b in route_countries(polyline, dist_km):
        if cc not in bans:
            continue
        sa, sb = km_a / v, km_b / v      # секунды вождения от старта до входа/выхода
        # время в стране, когда трак едет
        spans = []
        for ts, te, before in drive:
            x0, x1 = max(sa, before), min(sb, before + (te - ts))
            if x1 > x0:
                spans.append((ts + (x0 - before), ts + (x1 - before)))
        if not spans:
            continue
        enter = spans[0][0]
        for b, (ws, we) in bans[cc].values():
            if any(a < we and e > ws for a, e in spans):
                hits.append({"cc": cc, "date": b["date"], "from": b.get("from"), "until": b.get("until"),
                             "type": b.get("type"), "details": b.get("details"), "enter_ts": enter})
    hits.sort(key=lambda h: (h["date"], h["cc"]))
    return hits, status


def bans_hits_text(hits, loc, at_label="MAN без L"):
    TYPE_RU = {"Sunday": "воскр.", "Holiday": "праздн.", "General": "общий"}
    out = []
    for h in hits:
        if h.get("type") == "NightAT":   # v1.83
            out.append(f"AT ночь {h['date'][8:10]}/{h['date'][5:7]} 22–05 ({at_label}), въезд ~{loc(h['enter_ts'])}")
            continue
        d = datetime.strptime(h["date"], "%Y-%m-%d").strftime("%d/%m")
        out.append(f"{h['cc']} {d} {(h['from'] or '')[:5]}–{(h['until'] or '')[:5]} "
                   f"({TYPE_RU.get(h['type'], h['type'] or '')}), въезд ~{loc(h['enter_ts'])}")
    return out


# ---------- v1.59: цепочка стран и "на объекте" ----------
def country_chain(polyline, dist_km, min_km=15):
    """Страны по маршруту по порядку, без коротких "мерцаний" у границы (< min_km)."""
    segs = [(cc, a, b) for cc, a, b in route_countries(polyline, dist_km) if cc]
    keep = [s for s in segs if s[2] - s[1] >= min_km] or segs
    out = []
    for cc, _, _ in keep:
        if not out or out[-1] != cc:
            out.append(cc)
    return out


MAPON_OBJ_TTL = 6 * 3600
ON_TARGET_OBJ_KM = 0.5      # объект Mapon относится к таргету, если таргет внутри или центр ближе 500 м
ON_TARGET_RADIUS_KM = 0.3   # без объекта — трак в радиусе 300 м от точки таргета
_mobj_cache = {"at": 0.0, "items": None}


def _wkt_points(wkt):
    nums = re.findall(r"-?\d+(?:\.\d+)?", str(wkt or ""))
    pts = [(float(nums[i]), float(nums[i + 1])) for i in range(0, len(nums) - 1, 2)]
    if pts and any(abs(a) > 90 for a, _ in pts):
        pts = [(b, a) for a, b in pts]
    return pts


def _point_in_poly(lat, lng, poly):
    inside, n = False, len(poly)
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        if (a[1] > lng) != (b[1] > lng):
            x = a[0] + (lng - a[1]) * (b[0] - a[0]) / ((b[1] - a[1]) or 1e-12)
            if lat < x:
                inside = not inside
    return inside


def mapon_objects():
    import time
    now = time.time()
    if _mobj_cache["items"] is not None and now - _mobj_cache["at"] < MAPON_OBJ_TTL:
        return _mobj_cache["items"]
    items = []
    try:
        objs = (mapon_get("https://mapon.com/api/v1/object/list.json", {"key": MAPON_API_KEY}, timeout=60)
                .get("data") or {}).get("objects") or []
        for o in objs:
            pts = _wkt_points(o.get("wkt"))
            if len(pts) < 3:
                continue
            la = [p[0] for p in pts]
            ln = [p[1] for p in pts]
            items.append({"name": (o.get("name") or "").strip(), "poly": pts,
                          "bbox": (min(la), max(la), min(ln), max(ln)),
                          "c": (sum(la) / len(la), sum(ln) / len(ln))})
    except Exception:
        if _mobj_cache["items"] is not None:
            return _mobj_cache["items"]
    _mobj_cache.update(at=now, items=items)
    return items


def on_target(tlat, tlng, glat, glng):
    """Трак (tlat,tlng) у таргета (glat,glng)? По полигону объекта Mapon, связанного с таргетом,
    иначе по радиусу. -> {"how": "object"|"radius", "name": ...} или None."""
    best = None
    for o in mapon_objects():
        b = o["bbox"]
        if not (b[0] - 0.01 <= glat <= b[1] + 0.01 and b[2] - 0.02 <= glng <= b[3] + 0.02):
            continue
        inside = _point_in_poly(glat, glng, o["poly"])
        d = 0.0 if inside else haversine_km(glat, glng, o["c"][0], o["c"][1])
        if d <= ON_TARGET_OBJ_KM and (best is None or d < best[0]):
            best = (d, o)
    if best:
        o = best[1]
        b = o["bbox"]
        near_box = b[0] - 0.002 <= tlat <= b[1] + 0.002 and b[2] - 0.003 <= tlng <= b[3] + 0.003
        if near_box and (_point_in_poly(tlat, tlng, o["poly"]) or haversine_km(tlat, tlng, glat, glng) <= 0.1):
            return {"how": "object", "name": o["name"]}
        return None
    if haversine_km(tlat, tlng, glat, glng) <= ON_TARGET_RADIUS_KM:
        return {"how": "radius", "name": ""}
    return None


# ---------- v2.00: общий Флот на сервере (Firestore через REST, без лишних библиотек) ----------
# Документ коллекции fleet_rows = одна строка Флота. Поля строки лежат в map "data" как JSON-строки
# (правка по полю: два человека правят разные поля одной строки — ничего не теряется).
# Мета: created_by/at, updated_by/at (мс), deleted (+ by/at) — удалённое 24 ч лежит "в корзине".
FLEET_COLL = "fleet_rows"
FLEET_FIELD_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,40}$")
FLEET_VALUE_MAX = 30000          # байт JSON на одно поле
FLEET_TRASH_MS = 24 * 3600 * 1000
FS_BASE = f"https://firestore.googleapis.com/v1/projects/{GOOGLE_PROJECT_ID}/databases/(default)/documents"
_fs_tok = {"tok": None, "exp": 0.0}
_fs_lock = threading.Lock()


def _now_ms():
    import time
    return int(time.time() * 1000)


def _fs_headers():
    import time
    with _fs_lock:
        if not _fs_tok["tok"] or time.time() > _fs_tok["exp"]:
            import google.auth
            import google.auth.transport.requests
            creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/datastore"])
            creds.refresh(google.auth.transport.requests.Request())
            _fs_tok.update(tok=creds.token, exp=time.time() + 45 * 60)
        return {"Authorization": f"Bearer {_fs_tok['tok']}"}


def _fs_check(r):
    if r.status_code >= 400:
        try:
            msg = r.json().get("error", {}).get("message") or r.text
        except Exception:
            msg = r.text
        raise RuntimeError(f"Firestore {r.status_code}: {str(msg)[:300]}")
    return r


def _fp(name):
    return name if FLEET_FIELD_RE.match(name) else "`" + name.replace("`", "\\`") + "`"


def _fs_decode(doc):
    f = doc.get("fields") or {}

    def val(v):
        if v is None:
            return None
        if "integerValue" in v:
            return int(v["integerValue"])
        if "booleanValue" in v:
            return bool(v["booleanValue"])
        if "stringValue" in v:
            return v["stringValue"]
        return None
    data = {}
    for k, v in ((f.get("data") or {}).get("mapValue", {}).get("fields") or {}).items():
        try:
            data[k] = json.loads(v.get("stringValue", "null"))
        except Exception:
            data[k] = None
    rid = doc["name"].rsplit("/", 1)[-1]
    meta = {k: val(f.get(k)) for k in ("created_by", "created_at", "updated_by", "updated_at", "edited_at",
                                         "deleted", "deleted_by", "deleted_at", "lock_by", "lock_until")}
    return {"id": rid, "data": data, "meta": meta}


class FleetStoreFS:
    def query(self, since=None):
        q = {"from": [{"collectionId": FLEET_COLL}]}
        if since is not None:
            q["where"] = {"fieldFilter": {"field": {"fieldPath": "updated_at"}, "op": "GREATER_THAN_OR_EQUAL",
                                          "value": {"integerValue": str(int(since))}}}
        r = _fs_check(requests.post(f"{FS_BASE}:runQuery", json={"structuredQuery": q},
                                    headers=_fs_headers(), timeout=20))
        return [_fs_decode(x["document"]) for x in r.json() if x.get("document")]

    def patch(self, rid, set_data=None, unset=(), meta=None):
        fields, mask = {}, []
        if set_data:
            fields["data"] = {"mapValue": {"fields": {k: {"stringValue": json.dumps(v, ensure_ascii=False)}
                                                      for k, v in set_data.items()}}}
            mask += [f"data.{_fp(k)}" for k in set_data]
        for k in unset or ():
            mask.append(f"data.{_fp(k)}")
        for k, v in (meta or {}).items():
            mask.append(k)
            if isinstance(v, bool):
                fields[k] = {"booleanValue": v}
            elif isinstance(v, int):
                fields[k] = {"integerValue": str(v)}
            elif v is None:
                fields[k] = {"nullValue": None}
            else:
                fields[k] = {"stringValue": str(v)}
        _fs_check(requests.patch(f"{FS_BASE}/{FLEET_COLL}/{rid}", params=[("updateMask.fieldPaths", m) for m in mask],
                                 json={"fields": fields}, headers=_fs_headers(), timeout=20))

    def purge(self, rid):
        _fs_check(requests.delete(f"{FS_BASE}/{FLEET_COLL}/{rid}", headers=_fs_headers(), timeout=20))

    def get(self, rid):
        r = requests.get(f"{FS_BASE}/{FLEET_COLL}/{rid}", headers=_fs_headers(), timeout=20)
        if r.status_code == 404:
            return None
        return _fs_decode(_fs_check(r).json())


class FleetStoreMem:
    """Для локальной проверки без Firestore (FLEET_STORE=memory)."""
    def __init__(self):
        self.docs = {}

    def query(self, since=None):
        out = []
        for rid, d in self.docs.items():
            if since is None or (d["meta"].get("updated_at") or 0) >= since:
                out.append({"id": rid, "data": dict(d["data"]), "meta": dict(d["meta"])})
        return out

    def patch(self, rid, set_data=None, unset=(), meta=None):
        d = self.docs.setdefault(rid, {"data": {}, "meta": {}})
        d["data"].update(json.loads(json.dumps(set_data or {})))
        for k in unset or ():
            d["data"].pop(k, None)
        d["meta"].update(meta or {})

    def purge(self, rid):
        self.docs.pop(rid, None)

    def get(self, rid):
        d = self.docs.get(rid)
        return {"id": rid, "data": dict(d["data"]), "meta": dict(d["meta"])} if d else None


FLEET_STORE = FleetStoreMem() if os.environ.get("FLEET_STORE") == "memory" else FleetStoreFS()


def _fleet_user():
    return current_user_email() or "local"


# v2.02: кто может удалять любую строку (кроме создателя и диспетчера строки)
FLEET_ADMINS = {e.strip().lower() for e in (os.environ.get("FLEET_ADMINS") or "vladimirs.head@gmail.com").split(",") if e.strip()}
FLEET_LOCK_MS = 60 * 1000


def _fleet_can_delete(user, d):
    if user in FLEET_ADMINS:
        return True
    created = str(d["meta"].get("created_by") or "").lower()
    disp = str(d["data"].get("disp") or "").lower()
    if not created or created == "local":
        return True
    return user.lower() in (created, disp)


def _fleet_row_out(d):
    row = dict(d["data"])
    try:
        row["id"] = int(d["id"])
    except ValueError:
        row["id"] = d["id"]
    return {"row": row, "meta": {k: v for k, v in d["meta"].items() if v is not None}}


def _fleet_rid(v):
    s = str(v if v is not None else "").strip()
    if not re.fullmatch(r"\d{1,17}", s):
        raise ValueError(f"плохой id строки: {v!r}")
    return s


def _fleet_clean(fields):
    out = {}
    for k, v in (fields or {}).items():
        if k == "id" or not FLEET_FIELD_RE.match(str(k)):
            continue
        if len(json.dumps(v, ensure_ascii=False)) > FLEET_VALUE_MAX:
            raise ValueError(f"поле {k} слишком большое")
        out[k] = v
    return out


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


FRESH_SOLO_TACHO = {"drivers": [{
    "current_state": "REST", "now": {"rest": 11 * 3600, "driving": 0},
    "today": {"driving_remaining": 9 * 3600, "shift_remaining": 13 * 3600, "daily_rest_min": 11 * 3600},
    "week": {"driving_remaining": 56 * 3600, "10h_driving_extensions_remaining": 2,
             "9h_rest_shortening_remaining": 3, "weekly_rest_min": 45 * 3600}}]}


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port, debug=False)
