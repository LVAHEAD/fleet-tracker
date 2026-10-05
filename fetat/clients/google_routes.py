"""Google Routes API: км и время по дорогам, кеш маршрутов, точки вдоль маршрута, счётчик запросов."""
import atexit
import threading
from datetime import datetime, timedelta, timezone

import requests

from fetat.utils.geo import _decode_polyline, _encode_polyline, haversine_km


ROUTES_API_URL = "https://routes.googleapis.com/directions/v2:computeRoutes"


# v1.50 / v3.13: кеш маршрутов. До v3.13 кеш жил в памяти одного процесса: 2 воркера × N инстансов
# Cloud Run, сброс при каждом деплое и засыпании — поэтому «кеш сэкономил 0». С v3.13 кеш общий,
# в Firestore (коллекция routes_cache), плюс память процесса как первый уровень.
#   • плечо точка → точка не меняется, пока не меняются сами точки: живёт LEG_TTL (30 дней);
#   • машина → первая непройденная: прошлый ответ отдаём, пока машина в TRUCK_MOVE_KM от места
#     прошлого запроса и не прошло ROUTE_CACHE_TTL; дальше — остаток по уже известной линии маршрута
#     (ALONG_ROUTE_*); новый запрос к Google — только при сходе с маршрута или когда линия устарела.
ROUTE_CACHE_TTL = 15 * 60


LEG_TTL = 30 * 24 * 3600


TRUCK_MOVE_KM = 3.0


ROUTES_CACHE_COLL = "routes_cache"


ROUTES_STATS_COLL = "routes_stats"


_route_cache = {}


# v3.24: RLock — повторный захват тем же потоком не вешает процесс (страховка от deadlock,
# как в From → To до v3.24). Счётчик _route_stat всё равно вызываем вне замка.
_route_cache_lock = threading.RLock()


_route_stats = {"day": None, "calls": 0, "cache_hits": 0}   # v1.51: за сутки квоты (по времени Google)


_ctx = threading.local()      # v3.13: кто и зачем считает (для разбивки в счётчике)


_stats_buf = {}               # v3.13: счётчики, ещё не отправленные в Firestore


_stats_flush = {"at": 0.0, "day": None}


STATS_FLUSH_SEC = 60


def _shared_on():
    """Общий кеш и общие счётчики — только с настоящим Firestore (локально и в тестах — память)."""
    import os
    return os.environ.get("FLEET_STORE") != "memory"


def set_route_ctx(why=None, user=None):
    """v3.13: причина расчёта (edit / all / auto / sync / route) и пользователь — для разбивки запросов."""
    _ctx.why = _slug(why) or "other"
    _ctx.user = _slug((user or "").split("@")[0]) or "anon"


def _slug(v):
    import re
    return re.sub(r"[^a-z0-9_]", "_", str(v or "").lower())[:30]


def _quota_day():
    return quota_day_of(datetime.now(timezone.utc))


def quota_day_of(dt_utc):
    """Сутки квоты Google (полночь по Тихоокеанскому времени), в которые попадает момент dt_utc."""
    try:
        from zoneinfo import ZoneInfo
        return dt_utc.astimezone(ZoneInfo("America/Los_Angeles")).strftime("%Y-%m-%d")
    except Exception:
        return (dt_utc - timedelta(hours=7)).strftime("%Y-%m-%d")


def _riga_hour():
    """v3.15: час по Риге "00".."23" — для почасового лога запросов."""
    from fetat.utils.timefmt import to_riga
    return to_riga(datetime.now(timezone.utc)).strftime("%H")


def hourly_from_stats(st):
    """v3.15: {"10": {"c": 3, "h": 20}, ...} из ключей c_hr_HH / h_hr_HH."""
    out = {}
    for k, v in (st or {}).items():
        if k.startswith(("c_hr_", "h_hr_")):
            hh = k[5:]
            out.setdefault(hh, {"c": 0, "h": 0})[k[0]] = int(v or 0)
    return out


def own_forecast(st, days_in_month, now_hour=None):
    """v3.15: прогноз на месяц по нашему темпу: запросы в Google за часы с первой записи
    сегодня по текущий час включительно, в среднем за час × 24 × дней в месяце."""
    hourly = hourly_from_stats(st)
    if not hourly:
        return None
    if now_hour is None:
        now_hour = _riga_hour()
    # сутки Google начинаются в 10:00 по Риге (полночь по Тихоокеанскому) — часы идут 10..23, 00..09
    order = [f"{(10 + i) % 24:02d}" for i in range(24)]
    start = min(order.index(h) for h in hourly if h in order)
    end = order.index(now_hour) if now_hour in order else len(order) - 1
    if end < start:
        end = start
    hours = order[start:end + 1]
    calls = sum(hourly.get(h, {}).get("c", 0) for h in hours)
    return {"hours": len(hours), "calls": calls,
            "per_hour": round(calls / len(hours), 1),
            "forecast": int(round(calls / len(hours) * 24 * days_in_month))}


def _route_stat(kind, what=None):
    """kind: "calls" (ушло в Google) | "cache_hits" (взято из кеша); what — truck / leg / multi."""
    import time
    day = _quota_day()
    if _route_stats["day"] != day:
        _route_stats.update(day=day, calls=0, cache_hits=0)
    _route_stats[kind] += 1
    if not _shared_on():
        return
    short = "c" if kind == "calls" else "h"
    why = getattr(_ctx, "why", None) or "other"
    user = getattr(_ctx, "user", None) or "anon"
    keys = [short, f"{short}_why_{why}"]
    if what:
        keys.append(f"{short}_kind_{what}")
    if short == "c":
        keys.append(f"c_user_{user}")
    keys.append(f"{short}_hr_{_riga_hour()}")      # v3.15: почасовой лог (час по Риге)
    with _route_cache_lock:
        if _stats_flush["day"] not in (None, day):
            _stats_buf.clear()          # сутки сменились до отправки — старое уже не важно
        _stats_flush["day"] = day
        for k in keys:
            _stats_buf[k] = _stats_buf.get(k, 0) + 1
        due = time.time() - _stats_flush["at"] >= STATS_FLUSH_SEC
        if due:
            _stats_flush["at"] = time.time()
    if due:
        threading.Thread(target=flush_route_stats, daemon=True).start()


def flush_route_stats():
    """Отправить накопленные счётчики в Firestore (routes_stats/<сутки Google>)."""
    from fetat.clients.firestore import fs_increment
    with _route_cache_lock:
        buf, day = dict(_stats_buf), _stats_flush["day"]
        _stats_buf.clear()
    if not buf or not day:
        return
    try:
        fs_increment(ROUTES_STATS_COLL, day, buf)
    except Exception:
        with _route_cache_lock:          # не получилось — вернуть в буфер до следующего раза
            for k, v in buf.items():
                _stats_buf[k] = _stats_buf.get(k, 0) + v


def _flush_at_exit():
    """v3.25: при остановке процесса (Cloud Run гасит инстанс ночью, деплой) — отправить ещё не отправленные
    счётчики; раньше копились до 60 с и терялись. Только с настоящим Firestore."""
    if _shared_on() and _stats_buf:
        flush_route_stats()


atexit.register(_flush_at_exit)


def read_route_stats(day=None):
    """Общие счётчики за сутки Google (с учётом ещё не отправленных из этого процесса)."""
    out = {}
    if _shared_on():
        try:
            from fetat.clients.firestore import fs_get
            out = fs_get(ROUTES_STATS_COLL, day or _quota_day()) or {}
            out.pop("id", None)
        except Exception:
            out = {}
    with _route_cache_lock:
        if _stats_flush["day"] == (day or _quota_day()):
            for k, v in _stats_buf.items():
                out[k] = int(out.get(k) or 0) + v
    return {k: int(v or 0) for k, v in out.items()}


def read_route_stats_days():
    """v3.21: счётчики за все сутки Google, что есть в Firestore: {"2026-10-04": {...}, ...}.
    Сегодня — с ещё не отправленными из этого процесса. Без Firestore — только сегодня."""
    out = {}
    if _shared_on():
        try:
            from fetat.clients.firestore import fs_query
            for doc in fs_query(ROUTES_STATS_COLL):
                day = doc.pop("id", None)
                if day:
                    out[day] = {k: int(v or 0) for k, v in doc.items() if isinstance(v, (int, float, str))
                                and str(v).lstrip("-").isdigit()}
        except Exception:
            out = {}
    today = _quota_day()
    out[today] = read_route_stats(today)
    return out


# v1.59 / v3.14: «ведение по маршруту». Линию маршрута берём у Google один раз, дальше машину ведём
# по ней сами: находим ближайший отрезок линии (проекция на отрезок, а не только на вершины —
# на трассе вершины бывают редко) и считаем остаток км по линии, без запроса к Google.
# Новый запрос — только если машина ушла с линии дальше ALONG_ROUTE_MAX_OFF_KM, сменилась точка
# (другой ключ) или линии больше ALONG_ROUTE_TTL. Маршрут считаем без пробок (TRAFFIC_UNAWARE),
# а другую дорогу ловит сход с линии — поэтому линия живёт сутки (v3.21; было 3 ч: каждая машина,
# даже стоящая на отдыхе, дёргала Google раз в 3 ч). Стоящая машина — на начале своей же линии.
ALONG_ROUTE_TTL = 24 * 3600


ALONG_ROUTE_MAX_OFF_KM = 2.0


_along_cache = {}   # (target, waypoints) -> {"at", "pts", "cum", "scale"}


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


def _project(lat, lng, a, b):
    """Ближайшая к (lat, lng) точка отрезка a–b: (доля 0..1 вдоль отрезка, расстояние км).
    Локально плоская проекция — на отрезках линии маршрута (единицы км) этого достаточно."""
    import math
    kx = 111.32 * math.cos(math.radians(lat))
    ky = 110.57
    ax, ay = (a[1] - lng) * kx, (a[0] - lat) * ky
    bx, by = (b[1] - lng) * kx, (b[0] - lat) * ky
    dx, dy = bx - ax, by - ay
    l2 = dx * dx + dy * dy
    t = 0.0 if l2 <= 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / l2))
    px, py = ax + t * dx, ay + t * dy
    return t, math.hypot(px, py)


def _along_lookup(tkey, lat, lng, now):
    c = _along_cache.get(tkey)
    if not c or now - c["at"] > ALONG_ROUTE_TTL:
        return None
    pts, cum = c["pts"], c["cum"]
    best = None   # (расстояние, индекс начала отрезка, доля)
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        # грубый отсев: оба конца отрезка далеко по широте/долготе
        if (min(a[0], b[0]) - lat > 0.1 or lat - max(a[0], b[0]) > 0.1
                or min(a[1], b[1]) - lng > 0.2 or lng - max(a[1], b[1]) > 0.2):
            continue
        t, d = _project(lat, lng, a, b)
        if best is None or d < best[0]:
            best = (d, i, t)
    if best is None or best[0] > ALONG_ROUTE_MAX_OFF_KM:
        return None
    d, i, t = best
    seg = cum[i + 1] - cum[i]
    remain = max(0.0, (cum[-1] - cum[i] - t * seg) * c["scale"] + d)
    return remain, _encode_polyline([(lat, lng)] + pts[i + 1:])


def _doc_id(key):
    import hashlib
    return hashlib.sha1(repr(key).encode("utf-8")).hexdigest()[:32]


def _shared_get(key):
    if not _shared_on():
        return None
    try:
        from fetat.clients.firestore import fs_get
        return fs_get(ROUTES_CACHE_COLL, _doc_id(key))
    except Exception:
        return None


def _shared_put(key, data):
    if not _shared_on():
        return
    def put():
        try:
            from fetat.clients.firestore import fs_set
            fs_set(ROUTES_CACHE_COLL, _doc_id(key), data)
        except Exception:
            pass
    threading.Thread(target=put, daemon=True).start()


def _wps_key(waypoints):
    return tuple((round(a, 4), round(b, 4)) for a, b in (waypoints or []))


def road_distance_km_google(lat1, lng1, lat2, lng2, api_key, waypoints=None, kind="truck"):
    """(км, линия маршрута). kind="leg" — плечо между двумя неподвижными точками,
    kind="truck" — от машины до точки (начало маршрута движется)."""
    if kind == "leg":
        return _leg_route(lat1, lng1, lat2, lng2, api_key, waypoints)
    return _truck_route(lat1, lng1, lat2, lng2, api_key, waypoints)


def _leg_route(lat1, lng1, lat2, lng2, api_key, waypoints):
    import time
    key = ("leg", round(lat1, 4), round(lng1, 4), round(lat2, 4), round(lng2, 4), _wps_key(waypoints))
    now = time.time()
    with _route_cache_lock:
        hit = _route_cache.get(key)
    if hit and now - hit[0] < LEG_TTL:
        _route_stat("cache_hits", "leg")
        return hit[1]
    doc = _shared_get(key)
    if doc and now - float(doc.get("at") or 0) < LEG_TTL and doc.get("dist") is not None:
        res = (float(doc["dist"]), doc.get("poly"))
        with _route_cache_lock:
            _route_cache[key] = (float(doc["at"]), res)
        _route_stat("cache_hits", "leg")
        return res
    _route_stat("calls", "leg")
    res = _road_distance_km_google(lat1, lng1, lat2, lng2, api_key, waypoints)
    with _route_cache_lock:
        _trim(now)
        _route_cache[key] = (now, res)
    _shared_put(key, {"at": now, "dist": res[0], "poly": res[1] or ""})
    return res


def _truck_route(lat1, lng1, lat2, lng2, api_key, waypoints):
    import time
    tkey = ("truck", round(lat2, 4), round(lng2, 4), _wps_key(waypoints))
    now = time.time()
    with _route_cache_lock:
        mem = _route_cache.get(tkey)
    res = _truck_from_entry(mem, tkey, lat1, lng1, now)
    if res is None:
        doc = _shared_get(tkey)
        if doc and doc.get("dist") is not None and (not mem or float(doc.get("at") or 0) > mem["at"]):
            entry = {"at": float(doc["at"]), "olat": float(doc["olat"]), "olng": float(doc["olng"]),
                     "res": (float(doc["dist"]), doc.get("poly"))}
            with _route_cache_lock:
                _route_cache[tkey] = entry
                _along_remember(tkey, entry["res"][0], entry["res"][1], entry["at"])
            res = _truck_from_entry(entry, tkey, lat1, lng1, now)
    if res is not None:
        _route_stat("cache_hits", "truck")
        return res
    _route_stat("calls", "truck")
    res = _road_distance_km_google(lat1, lng1, lat2, lng2, api_key, waypoints)
    entry = {"at": now, "olat": lat1, "olng": lng1, "res": res}
    with _route_cache_lock:
        _trim(now)
        _route_cache[tkey] = entry
        _along_remember(tkey, res[0], res[1], now)
    _shared_put(tkey, {"at": now, "olat": lat1, "olng": lng1, "dist": res[0], "poly": res[1] or ""})
    return res


def _truck_from_entry(entry, tkey, lat, lng, now):
    """Ответ из кеша для машины: рядом с местом прошлого запроса — прошлый ответ;
    иначе — остаток по известной линии маршрута, если машина на ней."""
    if not entry:
        return None
    if now - entry["at"] < ROUTE_CACHE_TTL and haversine_km(lat, lng, entry["olat"], entry["olng"]) <= TRUCK_MOVE_KM:
        return entry["res"]
    with _route_cache_lock:
        return _along_lookup(tkey, lat, lng, now)


def _trim(now):
    """Не раздувать память процесса (вызывать под _route_cache_lock)."""
    if len(_route_cache) > 3000:
        for k in list(_route_cache):
            v = _route_cache[k]
            at = v["at"] if isinstance(v, dict) else v[0]
            ttl = LEG_TTL if k and k[0] == "leg" else ALONG_ROUTE_TTL
            if now - at >= ttl:
                _route_cache.pop(k, None)
    if len(_along_cache) > 500:
        for k in [k for k, v in _along_cache.items() if now - v["at"] >= ALONG_ROUTE_TTL]:
            _along_cache.pop(k, None)


def choose_shortest(lat1, lng1, lat2, lng2, api_key, options):
    """v3.26: какой из вариантов промежуточных точек короче по дорогам — спросить Google каждый (options —
    [[(lat, lng), ...], ...]). Решение хранится LEG_TTL (30 дней) на сетке ~10 км (0,1°): для машины,
    которая едет, не спрашиваем заново на каждом шаге. Возвращает индекс короткого варианта."""
    import time
    key = ("corr", round(lat1, 1), round(lng1, 1), round(lat2, 1), round(lng2, 1),
           tuple(_wps_key(o) for o in options))
    now = time.time()
    with _route_cache_lock:
        hit = _route_cache.get(key)
    if hit and now - hit[0] < LEG_TTL:
        _route_stat("cache_hits", "corridor")
        return hit[1]
    doc = _shared_get(key)
    if doc and now - float(doc.get("at") or 0) < LEG_TTL and doc.get("idx") is not None:
        idx = int(doc["idx"])
        with _route_cache_lock:
            _route_cache[key] = (float(doc["at"]), idx)
        _route_stat("cache_hits", "corridor")
        return idx
    kms = []
    for wps in options:
        _route_stat("calls", "corridor")
        kms.append(_road_distance_km_google(lat1, lng1, lat2, lng2, api_key, wps)[0])
    idx = min(range(len(kms)), key=lambda i: kms[i])
    with _route_cache_lock:
        _trim(now)
        _route_cache[key] = (now, idx)
    _shared_put(key, {"at": now, "idx": idx, "kms": [round(k, 1) for k in kms]})
    return idx


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


ROUTES_FREE_MONTH = 10000
