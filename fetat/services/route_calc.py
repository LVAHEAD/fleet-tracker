"""From → To: маршрут по точкам строго по порядку (Routes API + правила паромов/Инсбрука),
запреты по пути, похожие рейсы."""
from datetime import datetime, timedelta, timezone

import requests

from fetat.clients.google_routes import (
    _route_cache, _route_cache_lock, ROUTE_CACHE_TTL, _route_stat, ROUTES_API_URL,
)
from fetat.clients.mapon import fetch_units
from fetat.config import GOOGLE_API_KEY, MAPON_API_KEY, WEST_EUROPE_OFFSET
from fetat.domain.bans import bans_hits_text, bans_on_route, needs_at_night_ban
from fetat.domain.freights import similar_freights
from fetat.domain.points import resolve_point
from fetat.domain.routing_rules import pick_waypoints_by_country
from fetat.domain.tacho import FRESH_SOLO_TACHO, tacho_eta


MAX_INTERMEDIATES = 25      # лимит Routes API на промежуточные точки (вместе с паромами/Инсбруком)


def compute_multi_route(points, api_key):
    """v1.50: кеш 15 мин по набору точек (повторное "Рассчитать" не тратит запрос)."""
    import time
    key = tuple((round(p["lat"], 4), round(p["lng"], 4), p.get("country")) for p in points)
    now = time.time()
    with _route_cache_lock:
        hit = _route_cache.get(("multi",) + key)
        if hit and now - hit[0] < ROUTE_CACHE_TTL:
            _route_stat("cache_hits", "multi")
            return hit[1]
        _route_stat("calls", "multi")
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


def route_calc(payload):
    """From → To. payload: {"from": ["OI-4310", "IT20", ...], "to": ["SE25", "59.9, 10.8", ...]}
    (старый формат {"from": "ES30", "to": "SE25"} тоже принимается). Каждое поле — машина / GPS /
    код региона / город. Пустые поля пропускаются, маршрут строго по порядку from1..fromN -> to1..toM.
    Возвращает (ответ, HTTP-код)."""
    if not GOOGLE_API_KEY:
        return {"error": "GOOGLE_API_KEY не настроен на сервере"}, 500


    def as_list(v):
        if isinstance(v, list):
            return [str(x).strip() for x in v if str(x or "").strip()]
        v = str(v or "").strip()
        return [v] if v else []

    froms = as_list(payload.get("from"))
    tos = as_list(payload.get("to"))
    if not froms and not tos:
        return {"error": "Заполните хотя бы одно поле — From или To"}, 400

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
                    return {"error": f"{field}{n}: {e}"}, 400
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

        return result, 200
    except Exception as e:
        return {"error": str(e)}, 502
