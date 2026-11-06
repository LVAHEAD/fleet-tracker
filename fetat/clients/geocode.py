"""Геокодинг: Nominatim (OpenStreetMap) с запасным Photon, кеш на сутки."""
import re
import threading

import requests


NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"


# v1.62: геокодинг города/адреса. Nominatim с общих IP Cloud Run часто отвечает 429
# (Too many requests) — поэтому: кеш на 24 ч, не чаще 1 запроса в секунду к Nominatim,
# а при 429/ошибке — запасной геокодер Photon (тоже OpenStreetMap, без ключа).
PHOTON_URL = "https://photon.komoot.io/api/"


GEO_CACHE_TTL = 24 * 3600


GEO_CACHE_MAX = 2000   # v3.68: ключ — текст запроса, без лимита кеш рос бы до перезапуска


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
    if len(_geo_cache) > GEO_CACHE_MAX:
        for k, v in sorted(_geo_cache.items(), key=lambda kv: kv[1][0])[:GEO_CACHE_MAX // 4]:
            _geo_cache.pop(k, None)
    return res


def geocode_city(q):
    """Город/адрес с названием и страной найденного места: (lat, lng, display_name, cc)."""
    g = geocode(q)
    if not g:
        return None, None, None, None
    return g["lat"], g["lng"], g["name"], g["cc"]


NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse"
_cc_cache = {}


def country_at(lat, lng):
    """v3.286: код страны (ES, FR…) по координате — обратный геокодинг Nominatim, кеш на сутки (ключ — 3 знака, ≈100 м).
    Нет ответа / ошибка — None (вызывающий откатывается на ближайший код региона)."""
    import time
    key = (round(float(lat), 3), round(float(lng), 3))
    now = time.time()
    hit = _cc_cache.get(key)
    if hit and now - hit[0] < GEO_CACHE_TTL:
        return hit[1]
    cc = None
    try:
        with _geo_lock:
            wait = 1.05 - (time.time() - _geo_last_nominatim[0])
            if wait > 0:
                time.sleep(wait)
            _geo_last_nominatim[0] = time.time()
        resp = requests.get(NOMINATIM_REVERSE_URL, params={"lat": key[0], "lon": key[1], "format": "json", "zoom": 3, "addressdetails": 1},
                            headers=GEO_UA, timeout=8)
        resp.raise_for_status()
        cc = ((resp.json().get("address") or {}).get("country_code") or "").upper() or None
    except Exception as e:
        print(f"country_at failed for {key}: {type(e).__name__}", flush=True)
        return None
    _cc_cache[key] = (now, cc)
    if len(_cc_cache) > GEO_CACHE_MAX:
        for k, v in sorted(_cc_cache.items(), key=lambda kv: kv[1][0])[:GEO_CACHE_MAX // 4]:
            _cc_cache.pop(k, None)
    return cc
