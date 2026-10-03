"""Google Routes API: км и время по дорогам, кеш маршрутов, точки вдоль маршрута, счётчик запросов."""
import threading
from datetime import datetime, timedelta, timezone

import requests

from fetat.utils.geo import _decode_polyline, _encode_polyline, haversine_km


ROUTES_API_URL = "https://routes.googleapis.com/directions/v2:computeRoutes"


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


ROUTES_FREE_MONTH = 10000
