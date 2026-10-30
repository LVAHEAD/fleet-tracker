"""Mapon API: машины и прицепы, группы, тахограф, история водителя, стоянки, объекты.
Не больше 3 одновременных запросов (лимит Mapon — 5)."""
import threading
from datetime import datetime, timedelta, timezone

import requests

from fetat.config import MAPON_API_KEY
from fetat.clients import http
from fetat.utils.geo import _wkt_points
from fetat.utils.timefmt import _iso_utc, _lv_time, _utc_iso
from fetat.utils.log import warn


MAPON_API_URL = "https://mapon.com/api/v1/unit/list.json"


MAPON_GROUP_UNITS_URL = "https://mapon.com/api/v1/unit_groups/list_units.json"


MAPON_UNITS_TTL = 45


# v3.20: один процесс gunicorn (общий кеш) — 4 одновременных запроса к Mapon (лимит Mapon 5)
MAPON_SEM = threading.BoundedSemaphore(4)


_units_lock = threading.Lock()


_units_cache = {"units": None, "at": 0.0}


def mapon_get(url, params, timeout=20):
    """GET к Mapon с ограничением параллельности. Возвращает data или бросает RuntimeError
    с кодом ошибки Mapon в тексте."""
    import time
    for attempt in range(3):
        with MAPON_SEM:
            resp = http.get(url, params=params, timeout=timeout)
        resp.raise_for_status()
        data = resp.json()
        if isinstance(data, dict) and "error" in data:
            err = data["error"] or {}
            msg = str(err.get("msg", "API error"))
            # v3.20: «Request limit reached» — подождать и повторить, а не ронять строку
            if "limit" in msg.lower() and attempt < 2:
                time.sleep(0.8 * (attempt + 1))
                continue
            raise RuntimeError(f"Mapon {err.get('code', '')}: {msg}")
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


REEFER_TTL = 60


_reefer_lock = threading.Lock()


_reefer_cache = {"at": 0.0, "by_id": None}


def fetch_reefer_units():
    """unit/list с include reefer + fuel + driver + weights (кеш REEFER_TTL сек, один запрос на всех).
    v3.34: weights — вес с CAN тягача (состав, оси) для тревоги рефа «выключен при грузе»."""
    import time
    with _reefer_lock:
        if _reefer_cache["by_id"] is None or time.time() - _reefer_cache["at"] > REEFER_TTL:
            units = mapon_get(MAPON_API_URL, {"key": MAPON_API_KEY, "include[]": ["reefer", "fuel", "driver", "weights"]},
                              timeout=40)["data"]["units"]
            _reefer_cache["by_id"] = {u.get("unit_id"): u for u in units}
            _reefer_cache["at"] = time.time()
        return _reefer_cache["by_id"]


def _person_name(x):
    """Имя из записи водителя Mapon: строка или dict с name / surname / full_name."""
    if isinstance(x, str):
        return x.strip()
    if not isinstance(x, dict):
        return ""
    full = (x.get("full_name") or x.get("fullname") or "").strip()
    if full:
        return full
    return " ".join(filter(None, [str(x.get(k) or "").strip() for k in ("name", "driver_name", "first_name")]
                           + [str(x.get(k) or "").strip() for k in ("surname", "driver_surname", "last_name")]))


def unit_driver_names(unit_id):
    """v3.29: водитель, привязанный к машине в Mapon (не карта тахографа): unit/list с include driver.
    Формат поля у Mapon точно не известен — разбираем мягко; нет данных — []."""
    try:
        u = (fetch_reefer_units() or {}).get(unit_id) or {}
    except Exception as _e:
        warn("mapon:107", _e)
        return []
    raw = u.get("drivers") if u.get("drivers") is not None else u.get("driver")
    items = raw if isinstance(raw, list) else [raw]
    return [n for n in (_person_name(x) for x in items) if n]


MAPON_TACHO_URL = "https://mapon.com/api/v1/unit_data/driving_time_extended.json"


TACHO_ERR_TTL = 60               # сбой запроса к Mapon — не дольше минуты
TACHO_TTL = 300                 # данные тахографа обновляем не чаще раза в 5 минут на машину


_tacho_cache = {}               # unit_id -> {"at": ts, "data": dict|None, "error": str|None}


_tacho_lock = threading.Lock()


def driver_has_data(d):
    """Есть ли у водителя в тахографе данные (карта читается): хоть одно число в now / today / week.
    Второй слот Mapon «NO CARD / NO DATA» приходит записью без чисел."""
    for blk in ("now", "today", "week"):
        v = d.get(blk)
        if isinstance(v, dict) and any(x is not None for x in v.values()):
            return True
    return False


def get_tacho(unit_id, max_age=None):
    """Данные тахографа по машине (кеш TACHO_TTL). Возвращает (data, error)."""
    import time
    now = time.time()
    with _tacho_lock:
        c = _tacho_cache.get(unit_id)
        ttl = max_age if max_age is not None else TACHO_TTL
        if c and c.get("fail"):
            ttl = min(ttl, TACHO_ERR_TTL)   # сбой Mapon не держим 5 мин — ↻ через минуту спросит заново
        if c and now - c["at"] < ttl:
            return c["data"], c["error"]
    try:
        d = mapon_get(MAPON_TACHO_URL, {"key": MAPON_API_KEY, "unit_id": unit_id}).get("data") or {}
        drivers = [v for k, v in sorted(d.items()) if k.startswith("driver") and isinstance(v, dict)]
        has = [v for v in drivers if driver_has_data(v)]
        if has and len(has) < len(drivers):
            drivers = has      # NU-8704: второй слот «NO CARD / NO DATA» — не второй водитель, экипажем машину не считаем
        data, err = ({"drivers": drivers} if drivers else None), (None if drivers else "нет данных водителя")
        fail = False
    except Exception as e:
        data, err, fail = None, str(e), True
    with _tacho_lock:
        _tacho_cache[unit_id] = {"at": now, "data": data, "error": err, "fail": fail}
    return data, err


MAPON_ACTIVITIES_URL = "https://mapon.com/api/v1/driver/daily_activities.json"


ACT_TTL = 1800                  # история водителя — не чаще раза в 30 мин


ACT_DAYS = 28                   # глубина истории (до 31 дня у Mapon); v3.233: 21 → 28


_act_cache = {}                 # driver_id -> {"at", "data", "error"}


_act_lock = threading.Lock()


ACT_FULL_TTL = 21600            # v3.124: полные ACT_DAYS дней — раз в 6 ч


ACT_FRESH_DAYS = 3              # v3.124: в промежутке (каждые ACT_TTL) докачиваем только свежие дни


def _parse_acts(d, now):
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
    return acts


def _merge_acts(old, fresh, from_f):
    """Старые активности до from_f остаются, всё позже заменяется свежим окном."""
    keep = [a for a in old if a["start"] < from_f]
    seen = {(a["start"], a["status"]) for a in keep}
    for a in fresh:
        if (a["start"], a["status"]) not in seen:
            keep.append(a)
    return keep


def _derive_rests(acts, now):
    acts = sorted(acts, key=lambda a: a["start"])
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
    return {"rests": rests, "cards": cards, "from": now - ACT_DAYS * 86400}


def get_driver_rests(driver_id, max_age=None):
    """Отдыхи водителя за ACT_DAYS дней: склеенные подряд идущие REST (включая время
    без карты — Mapon заливает его REST с источником can/unkn), конец обрезан по "сейчас".
    v3.124: раз в ACT_FULL_TTL качаем все дни, в промежутках (ACT_TTL) — только свежие ACT_FRESH_DAYS.
    Возвращает ({"rests": [{start, end, src}], "cards": [...]}, error)."""
    import time
    now = time.time()
    with _act_lock:
        c = _act_cache.get(driver_id)
        if c and now - c["at"] < (max_age if max_age is not None else ACT_TTL):
            return c["data"], c["error"]
    old = c.get("acts") if c else None
    full = not old or now - c.get("full_at", 0) >= ACT_FULL_TTL
    days = ACT_DAYS if full else ACT_FRESH_DAYS
    data, err, acts, full_at = None, None, None, c.get("full_at", 0) if c else 0
    try:
        d = mapon_get(MAPON_ACTIVITIES_URL, {
            "key": MAPON_API_KEY, "driver": driver_id,
            "from": _iso_utc(now - days * 86400), "till": _iso_utc(now),
            "include": "card_events"}, timeout=30)
        fresh = _parse_acts(d, now)
        if full:
            acts, full_at = fresh, now
        else:
            acts = _merge_acts(old, fresh, now - days * 86400)
        data = _derive_rests(acts, now)
    except Exception as e:
        err = str(e)
        if old:                                  # сбой докачки — живём на прошлых данных, но в кеш пишем ошибку недолго
            data, err = _derive_rests(old, now), None
            acts = old
    with _act_lock:
        _act_cache[driver_id] = {"at": now, "data": data, "error": err, "acts": acts, "full_at": full_at}
    return data, err


def get_driver_history(driver_id, days=3):
    """Лента водителя за days суток из кеша get_driver_rests: подряд идущие куски одного статуса
    (DRIVING / WORK / REST / AVAILABLE) склеены (зазор ≤ 2 мин), события карты — отдельным списком.
    Возвращает ({"acts": [{start, end, status, src}], "cards": [{ts, what}]}, error)."""
    import time
    _, err = get_driver_rests(driver_id)
    with _act_lock:
        c = _act_cache.get(driver_id)
        acts = list(c.get("acts") or []) if c else []
    if not acts:
        return None, err or "нет данных"
    since = time.time() - max(1, min(int(days), ACT_DAYS)) * 86400
    segs, cards = [], []
    for a in sorted(acts, key=lambda x: x["start"]):
        if a["status"] in ("CARD_INSERTED", "CARD_REMOVED"):
            if a["start"] >= since:
                cards.append({"ts": a["start"], "what": a["status"]})
            continue
        if a["status"] not in ("REST", "DRIVING", "WORK", "AVAILABLE") or a["end"] <= a["start"] or a["end"] < since:
            continue
        s = max(a["start"], since)
        last = segs[-1] if segs else None
        if last and last["status"] == a["status"] and s - last["end"] <= 120:
            last["end"] = max(last["end"], a["end"])
            last["src"].add(a["src"] or "?")
        else:
            segs.append({"start": s, "end": a["end"], "status": a["status"], "src": {a["src"] or "?"}})
    for g in segs:
        g["src"] = sorted(g["src"])
    return {"acts": segs, "cards": cards}, None


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
            except Exception as _e:
                warn("mapon:251", _e)
                continue
            if out and abs(s_ts - out[-1]["end"]) <= 60 and out[-1]["address"] == st.get("address"):
                out[-1]["end"] = e_ts
                out[-1]["now"] = not e_raw
            else:
                out.append({"start": s_ts, "end": e_ts, "address": st.get("address"),
                            "lat": st.get("lat"), "lng": st.get("lng"), "now": not e_raw})
    return [x for x in out if x["end"] - x["start"] >= min_sec or x["now"]]


def unit_passes(unit_id, days=4):
    """v3.49: где трак был за days суток — для проездных точек (границы без остановки).
    -> [{"end": ts, "pts": [(lat, lng), ...]}]: короткие стоянки (любой длины), начало / конец отрезков движения и,
    если Mapon отдаёт трек (include polyline), точки трека. Ошибка — пустой список."""
    import time
    from fetat.utils.geo import _decode_polyline
    now = time.time()
    base = {"key": MAPON_API_KEY, "unit_id": unit_id, "from": _iso_utc(now - days * 86400), "till": _iso_utc(now)}
    try:
        try:
            d = mapon_get("https://mapon.com/api/v1/route/list.json", dict(base, **{"include[]": "polyline"}), timeout=30)
        except Exception:
            d = mapon_get("https://mapon.com/api/v1/route/list.json", base, timeout=30)
    except Exception as _e:
        warn("mapon:275", _e)
        return []

    def ts_of(x):
        t = (x or {}).get("time")
        if not t:   # у идущего сейчас отрезка конца ещё нет — это норма
            return None
        try:
            return datetime.strptime(t, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp()
        except Exception as _e:
            warn("mapon:281", _e)
            return None

    out = []
    for u in (d.get("data") or {}).get("units") or []:
        for r in u.get("routes") or []:
            pts = []
            for k in ("start", "end"):
                p = r.get(k) or {}
                if p.get("lat") is not None and p.get("lng") is not None:
                    pts.append((float(p["lat"]), float(p["lng"])))
            pl = r.get("polyline")
            if r.get("type") == "route" and isinstance(pl, str) and pl:
                try:
                    pts += [(float(a), float(b)) for a, b in _decode_polyline(pl)]
                except Exception as _e:
                    warn("mapon:296", _e)
                    pass
            end = ts_of(r.get("end")) or now
            if pts and end < now - 60:
                out.append({"end": end, "pts": pts})
    return out


# v3.15: сколько трак ехал по суткам за неделю (по GPS, отрезки "route" из route/list) —
# подстраховка определения экипажа, когда во втором слоте тахографа сейчас нет карты.
DRIVE_DAYS_TTL = 6 * 3600


_drive_days_cache = {}          # unit_id -> {"at", "data"}


def unit_driving_days(unit_id, days=7):
    """{"YYYY-MM-DD": секунды движения} по суткам UTC за days дней (кеш DRIVE_DAYS_TTL).
    Ошибка — пустой dict (определение экипажа тогда только по тахографу)."""
    import time
    now = time.time()
    c = _drive_days_cache.get(unit_id)
    if c and now - c["at"] < DRIVE_DAYS_TTL:
        return c["data"]
    out = {}
    try:
        d = mapon_get("https://mapon.com/api/v1/route/list.json",
                      {"key": MAPON_API_KEY, "unit_id": unit_id,
                       "from": _iso_utc(now - days * 86400), "till": _iso_utc(now)}, timeout=30)
        for u in (d.get("data") or {}).get("units") or []:
            for r in u.get("routes") or []:
                if r.get("type") != "route":
                    continue
                try:
                    s_raw = (r.get("start") or {}).get("time")
                    e_raw = (r.get("end") or {}).get("time")
                    s_ts = datetime.strptime(s_raw, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp()
                    e_ts = (datetime.strptime(e_raw, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp()
                            if e_raw else now)
                except Exception as _e:
                    warn("mapon:335", _e)
                    continue
                # отрезок через полночь делим по суткам
                while s_ts < e_ts:
                    day0 = datetime.fromtimestamp(s_ts, timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
                    nxt = min(e_ts, (day0 + timedelta(days=1)).timestamp())
                    k = day0.strftime("%Y-%m-%d")
                    out[k] = out.get(k, 0) + (nxt - s_ts)
                    s_ts = nxt
    except Exception:
        return c["data"] if c else {}
    _drive_days_cache[unit_id] = {"at": now, "data": out}
    return out


ROUTE_SEG_TTL = 300             # v3.104: смена по GPS — история свежая, кеш 5 минут


_route_seg_cache = {}           # unit_id -> {"at", "data"}


def unit_route_segments(unit_id, hours=48):
    """v3.104: поездки и стоянки трака за последние hours часов (route/list) — для смены по GPS:
    [{"k": "route" | "stop", "s": ts, "e": ts, "m": метры}] по времени. Идущая поездка / стоянка (без конца) —
    до сейчас. Кеш ROUTE_SEG_TTL. Ошибка — прежние данные или [] (расчёт тогда без поправки по GPS)."""
    import time
    if not MAPON_API_KEY:
        return []
    now = time.time()
    c = _route_seg_cache.get(unit_id)
    if c and now - c["at"] < ROUTE_SEG_TTL:
        return c["data"]
    out = []
    try:
        d = mapon_get("https://mapon.com/api/v1/route/list.json",
                      {"key": MAPON_API_KEY, "unit_id": unit_id,
                       "from": _iso_utc(now - hours * 3600), "till": _iso_utc(now)}, timeout=30)
        for u in (d.get("data") or {}).get("units") or []:
            for r in u.get("routes") or []:
                k = r.get("type")
                if k not in ("route", "stop"):
                    continue
                try:
                    s_raw = (r.get("start") or {}).get("time")
                    e_raw = (r.get("end") or {}).get("time")
                    s_ts = datetime.strptime(s_raw, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp()
                    e_ts = (datetime.strptime(e_raw, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp()
                            if e_raw else now)
                except Exception as _e:
                    warn("mapon:route_seg", _e)
                    continue
                out.append({"k": k, "s": s_ts, "e": e_ts, "m": float(r.get("distance") or 0)})
        out.sort(key=lambda x: x["s"])
    except Exception:
        return c["data"] if c else []
    _route_seg_cache[unit_id] = {"at": now, "data": out}
    return out


MAPON_BASE = "https://mapon.com/api/v1/"


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


MAPON_OBJ_TTL = 6 * 3600


_mobj_cache = {"at": 0.0, "items": None}


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
            items.append({"name": (o.get("name") or "").strip(), "gid": str(o.get("group_id") or ""), "poly": pts,
                          "bbox": (min(la), max(la), min(ln), max(ln)),
                          "c": (sum(la) / len(la), sum(ln) / len(ln))})
    except Exception:
        if _mobj_cache["items"] is not None:
            return _mobj_cache["items"]
    _mobj_cache.update(at=now, items=items)
    return items


_mgrp_cache = {"at": 0.0, "m": None}


def mapon_group_names():
    """v3.231: {id группы объектов: название} из object/list_groups (кеш на MAPON_OBJ_TTL); ошибка — прежний кеш или {}."""
    import time
    now = time.time()
    if _mgrp_cache["m"] is not None and now - _mgrp_cache["at"] < MAPON_OBJ_TTL:
        return _mgrp_cache["m"]
    m = {}
    try:
        gl = mapon_get("https://mapon.com/api/v1/object/list_groups.json", {"key": MAPON_API_KEY}).get("data") or {}
        for g in gl.get("groups") or gl.get("object_groups") or (gl if isinstance(gl, list) else []):
            if isinstance(g, dict):
                m[str(g.get("id"))] = g.get("name") or g.get("title") or ""
    except Exception:
        if _mgrp_cache["m"] is not None:
            return _mgrp_cache["m"]
    _mgrp_cache.update(at=now, m=m)
    return m

