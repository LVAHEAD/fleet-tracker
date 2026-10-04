"""Точки и таргеты: разбор ввода (код, GPS, город, адрес, машина), подписи, ✓ пройдено, «на объекте»."""
from datetime import datetime, timedelta, timezone

from fetat.clients.geocode import geocode, geocode_city
from fetat.clients.mapon import mapon_objects, unit_stops
from fetat.config import MAPON_API_KEY, WEST_EUROPE_OFFSET
from fetat.domain.addresses import (
    address_public, base_point, dovoz_country, find_address, is_base_word,
)
from fetat.domain.regions import (
    get_region_country, nearest_region_code, OUR_COUNTRIES, REGION_CODES,
)
from fetat.utils.geo import haversine_km, parse_gps, _point_in_poly
from fetat.utils.text import normalize
from fetat.utils.timefmt import format_duration


STATUS_RU = {"standing": "стоит", "driving": "едет"}


def find_unit_by_label(units, label_query):
    q = normalize(label_query)
    return [
        u for u in units
        if q in normalize(u.get("label", "")) or q in normalize(u.get("number", ""))
    ]


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


NEAR_LABEL_MAX_KM = 80      # дальше этого "около XX" в подписи не показываем (страну всё равно берём)


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


DONE_RADIUS_KM = 0.5        # стоял ближе 500 м от точки


DONE_MIN_STOP_SEC = 15 * 60 # не меньше 15 мин


DONE_LEFT_KM = 1.0          # и уже уехал дальше 1 км (иначе ещё грузится/ждёт)


DONE_HISTORY_DAYS = 4       # v3.17: смотрим последние 96 ч (дальше — запомненные ✓ строки)


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


def points_done(pts, manual, unit, units, seen=None):
    """pts — строки точек (① + следующие), manual — [True/False/None] ручные отметки,
    seen — [время|None] уже запомненные в строке авто-✓ (v3.17: не теряются, когда стоянка
    уходит из окна истории Mapon).
    -> список {done, auto, at}: пройдена ли точка (ручная отметка важнее автоматической)."""
    seen = seen or []
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
        seen_at = seen[i] if i < len(seen) and isinstance(seen[i], str) and seen[i] else None
        if t is not None and m is None and seen_at is None and unit.get("lat") is not None:
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
        elif m is None and seen_at:
            info.update(done=True, auto=True, at=seen_at, kept=True)
        elif m is None and auto_at:
            info.update(done=True, auto=True,
                        at=(datetime.fromtimestamp(auto_at, timezone.utc) + timedelta(hours=WEST_EUROPE_OFFSET)).strftime("%d/%m %H:%M"))
        out.append(info)
    return out


ON_TARGET_OBJ_KM = 0.5      # объект Mapon относится к таргету, если таргет внутри или центр ближе 500 м


ON_TARGET_RADIUS_KM = 0.3   # без объекта — трак в радиусе 300 м от точки таргета


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
