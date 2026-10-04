"""Mapon API: машины и прицепы, группы, тахограф, история водителя, стоянки, объекты.
Не больше 3 одновременных запросов (лимит Mapon — 5)."""
import threading
from datetime import datetime, timedelta, timezone

import requests

from fetat.config import MAPON_API_KEY
from fetat.utils.geo import _wkt_points
from fetat.utils.timefmt import _iso_utc, _lv_time, _utc_iso


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
            resp = requests.get(url, params=params, timeout=timeout)
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
    """unit/list с include reefer + fuel (кеш REEFER_TTL сек, один запрос на всех)."""
    import time
    with _reefer_lock:
        if _reefer_cache["by_id"] is None or time.time() - _reefer_cache["at"] > REEFER_TTL:
            units = mapon_get(MAPON_API_URL, {"key": MAPON_API_KEY, "include[]": ["reefer", "fuel"]},
                              timeout=40)["data"]["units"]
            _reefer_cache["by_id"] = {u.get("unit_id"): u for u in units}
            _reefer_cache["at"] = time.time()
        return _reefer_cache["by_id"]


MAPON_TACHO_URL = "https://mapon.com/api/v1/unit_data/driving_time_extended.json"


TACHO_TTL = 300                 # данные тахографа обновляем не чаще раза в 5 минут на машину


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


MAPON_ACTIVITIES_URL = "https://mapon.com/api/v1/driver/daily_activities.json"


ACT_TTL = 1800                  # история водителя — не чаще раза в 30 мин


ACT_DAYS = 21                   # глубина истории (до 31 дня у Mapon)


_act_cache = {}                 # driver_id -> {"at", "data", "error"}


_act_lock = threading.Lock()


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
            except Exception:
                continue
            if out and abs(s_ts - out[-1]["end"]) <= 60 and out[-1]["address"] == st.get("address"):
                out[-1]["end"] = e_ts
                out[-1]["now"] = not e_raw
            else:
                out.append({"start": s_ts, "end": e_ts, "address": st.get("address"),
                            "lat": st.get("lat"), "lng": st.get("lng"), "now": not e_raw})
    return [x for x in out if x["end"] - x["start"] >= min_sec or x["now"]]


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
                except Exception:
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
            items.append({"name": (o.get("name") or "").strip(), "poly": pts,
                          "bbox": (min(la), max(la), min(ln), max(ln)),
                          "c": (sum(la) / len(la), sum(ln) / len(ln))})
    except Exception:
        if _mobj_cache["items"] is not None:
            return _mobj_cache["items"]
    _mobj_cache.update(at=now, items=items)
    return items
