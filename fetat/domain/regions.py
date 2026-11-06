"""Коды регионов (ESxx, NO01…): справочник, страна по коду, ближайший код, страна точки."""
import json
import math
import os

from fetat.config import DATA_DIR
from fetat.utils.geo import haversine_km


with open(os.path.join(DATA_DIR, "region_codes.json"), encoding="utf-8") as _f:
    REGION_CODES = json.load(_f)


# v1.37: страны, где мы реально ездим (погрузки/выгрузки + транзит) — для
# фильтра "Запретов" и проверки подозрительного геокодинга
OUR_COUNTRIES = {"ES", "PT", "FR", "BE", "LU", "NL", "DE", "DK", "SE", "NO",
                 "FI", "EE", "LV", "LT", "PL", "IT", "AT",
                 "HU", "CZ", "SK", "SI", "HR", "RO", "BG"}   # 17.10: + транзит / Балканы (решено Владимиром)


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


def nearest_region_code(lat, lng, country=None):
    """Ближайший код региона из REGION_CODES по прямой: (code, dist_km).
    Нужен, чтобы узнать страну точки, заданной GPS/городом/машиной, — по ней
    выбираются правила маршрутов. Для стран без кодов в справочнике (AT, CH,
    LU, HU...) вернётся код соседней страны.
    v3.285: country (ES, FR…) — страна точки известна (адресная база): ищем среди кодов этой страны, иначе у границы
    (La Jonquera → FR66 вместо ES17) выигрывает центр соседнего региона. Нет кодов этой страны — как без country."""
    cc = (country or "").strip().upper()[:2]
    best_code, best_d = None, float("inf")
    for code, v in REGION_CODES.items():
        if cc and code[:2] != cc:
            continue
        d = haversine_km(lat, lng, v["lat"], v["lng"])
        if d < best_d:
            best_code, best_d = code, d
    if best_code is None and cc:
        return nearest_region_code(lat, lng)
    return best_code, best_d


BORDER_NEAR_KM = 60.0   # v3.286: центр зоны другой страны не дальше чем на столько дальше ближайшего — точка «у границы»


def nearest_region_code_geo(lat, lng, country=None):
    """v3.286: как nearest_region_code, но для точки без адреса (страна неизвестна) у границы страну берём по координате
    (обратный геокодинг, кеш): иначе выигрывает центр соседней страны. Вдали от границы запросов нет."""
    code, d = nearest_region_code(lat, lng, country)
    if country or not code:
        return code, d
    other = min((haversine_km(lat, lng, v["lat"], v["lng"]) for c, v in REGION_CODES.items() if c[:2] != code[:2]), default=None)
    if other is None or other - d > BORDER_NEAR_KM:
        return code, d
    try:
        from fetat.clients.geocode import country_at
        cc = country_at(lat, lng)
    except Exception:
        cc = None
    if cc and cc != code[:2]:
        return nearest_region_code(lat, lng, cc)
    return code, d


_cc_points = None


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
