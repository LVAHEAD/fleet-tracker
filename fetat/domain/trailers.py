"""Прицепы: тип юнита, сводка рефа, угадывание сцепки тягач–прицеп."""
from datetime import datetime, timedelta, timezone

from fetat.utils.timefmt import ts_west
from fetat.domain.addresses import base_point
from fetat.utils.geo import haversine_km
from fetat.utils.timefmt import _iso_ts, time_now_ts


HITCH_DRIVING_KM = 0.5     # оба едут и ближе 500 м — сцепка


HITCH_STANDING_KM = 0.05   # оба стоят и ближе 50 м — вероятно сцепка


HITCH_BASE_KM = 1.5        # на Базе прицепы стоят кучей — сцепку не угадываем


REEFER_DEV_WARN = 3.0      # отклонение возврата от уставки, °C — подсветка


REEFER_STALE_SEC = 2 * 3600


REEFER_FUEL_LOW_L = 40     # v1.71: мало топлива в баке рефа, л


TRUCK_FUEL_LOW_L = 100    # v3.30: мало топлива у тягача (сумма баков), л


TRAILER_FAR_KM = 1.0       # v1.71: привязанный прицеп дальше — предупреждение


def truck_fuel(u):
    """v3.30: топливо тягача из unit/list (include fuel), л -> {"l", "parts", "low"} или None.
    Литры — сумма баков (как «Total fuel» в Mapon); проценты пропускаем; CAN берём, только если баков нет."""
    items = []
    for f in (u or {}).get("fuel") or []:
        if not isinstance(f, dict) or not isinstance(f.get("value"), (int, float)):
            continue
        if str(f.get("units") or f.get("unit") or "").strip() == "%":
            continue
        tag = " ".join(str(f.get(k) or "") for k in ("type", "name", "source", "title")).lower()
        items.append(("can" in tag, float(f["value"])))
    tanks = [v for is_can, v in items if not is_can]
    can = [v for is_can, v in items if is_can]
    parts = tanks or can[:1]
    if not parts:
        return None
    total = sum(parts)
    return {"l": round(total), "parts": [round(v) for v in parts], "low": total < TRUCK_FUEL_LOW_L}


def is_trailer(u):
    return str((u or {}).get("type") or "").lower() == "trailer"


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
                      "at": ts_west(at).strftime("%d/%m %H:%M") if at else None})
    warn = any(c["dev"] is not None and abs(c["dev"]) > REEFER_DEV_WARN and not c["stale"] for c in comps)
    return {"type": rf.get("refrigerator_type"), "compartments": comps, "fuel_l": fuel,
            "fuel_low": fuel_low, "warn": warn}


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
