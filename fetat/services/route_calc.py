"""From → To: маршрут по точкам строго по порядку (Routes API + правила паромов/Инсбрука),
запреты по пути, похожие рейсы."""

import requests

from fetat.utils.timefmt import ceil_15_ts, ceil_15min, ts_west
from fetat.clients.google_routes import (
    _route_cache, _route_cache_lock, ROUTE_CACHE_TTL, _route_stat, ROUTES_API_URL,
)
from fetat.clients.mapon import fetch_units, get_tacho, unit_driving_days
from fetat.config import GOOGLE_API_KEY, MAPON_API_KEY
from fetat.domain.bans import bans_hits_text, bans_on_route, needs_at_night_ban
from fetat.domain.freights import similar_freights
from fetat.domain.points import find_unit_exact, looks_like_gps_or_code, resolve_point, target_badge_info
from fetat.domain.routing_rules import waypoints_label
from fetat.domain.regions import nearest_region_code
from fetat.domain.tacho import FRESH_SOLO_TACHO, calc_seed, country_tz, crew_mode, tacho_eta
from fetat.services.corridors import clean_corridor, corridor_info, resolve_waypoints
from fetat.services.fleet_calc import truck_seed
from fetat.domain.routing_rules import swiss_bypass_candidates
from fetat.utils.log import warn
from fetat.clients import http


MAX_INTERMEDIATES = 25      # лимит Routes API на промежуточные точки (вместе с паромами/Инсбруком)


def compute_multi_route(points, api_key, corridor=None):
    """v1.50: кеш 15 мин по набору точек (повторное "Рассчитать" не тратит запрос).
    v3.32: corridor — коридор обхода Швейцарии, выбранный диспетчером (входит в ключ кеша)."""
    import time
    key = tuple((round(p["lat"], 4), round(p["lng"], 4), p.get("country")) for p in points) + ((corridor,) if corridor else ())
    now = time.time()
    # v3.24: счётчик _route_stat — только вне замка: он сам берёт _route_cache_lock (с Firestore),
    # вызов под замком вешал From → To навсегда и вместе с ним все расчёты Флота.
    with _route_cache_lock:
        hit = _route_cache.get(("multi",) + key)
    if hit and now - hit[0] < ROUTE_CACHE_TTL:
        _route_stat("cache_hits", "multi")
        return hit[1]
    _route_stat("calls", "multi")
    res = _compute_multi_route(points, api_key, corridor)
    with _route_cache_lock:
        _route_cache[("multi",) + key] = (now, res)
    return res


def _compute_multi_route(points, api_key, corridor=None):
    """points — список dict из resolve_point в порядке следования (минимум 2).
    Один запрос к Routes API: точки пользователя — обычные intermediates (каждая
    начинает новый leg), паромы/Инсбрук — via-точки (через них маршрут проходит,
    но leg не разбивается). Так legs ответа = отрезкам между точками пользователя.
    Возвращает (legs, polyline), legs = [{dist_km, waypoints_applied}, ...]."""
    intermediates = []
    leg_rules = []
    for i in range(len(points) - 1):
        a, b = points[i], points[i + 1]
        wps = resolve_waypoints(a["country"], a["lat"], a["lng"],
                                b["country"], b["lat"], b["lng"], corridor) or []
        leg_rules.append(waypoints_label(wps))     # v3.26: подпись правила («через Монблан», «паромы»), "" — без правила
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
    resp = http.post(ROUTES_API_URL, json=body, headers=headers, timeout=30)
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
        legs.append({"dist_km": meters / 1000, "waypoints_applied": bool(leg_rules[i]), "rule": leg_rules[i]})
    polyline = route.get("polyline", {}).get("encodedPolyline")
    return legs, polyline


def _as_list(v):
    if isinstance(v, list):
        return [str(x).strip() for x in v if str(x or "").strip()]
    v = str(v or "").strip()
    return [v] if v else []


def _resolve_points(froms, tos):
    """Точки по порядку from1..fromN, to1..toM. -> (points, None) или (None, (ответ, 400))."""
    # Список машин из Mapon запрашиваем максимум один раз и только если он нужен
    units_cache = {}

    def units_getter():
        if "units" not in units_cache:
            units_cache["units"] = fetch_units(MAPON_API_KEY)
        return units_cache["units"]

    points = []
    for kind, values in (("L", froms), ("O", tos)):
        for n, raw in enumerate(values, start=1):
            try:
                pt = resolve_point(raw, units_getter)
            except ValueError as e:
                field = "From" if kind == "L" else "To"
                return None, ({"error": f"{field}{n}: {e}"}, 400)
            pt.update({"kind": kind, "num": n, "raw": raw})
            points.append(pt)
    return points, None


def _point_view(p):
    """Точка для ответа. v3.121: + badge (код зоны до 50 км, дальше — страна) и данные машины для плашек карты."""
    out = {**{k: p[k] for k in ("kind", "num", "label", "lat", "lng", "is_truck", "code")},
           "address": p.get("address"), "geo": p.get("geo"), "raw": p.get("raw"), "dovoz": p.get("dovoz")}
    try:
        out["badge"] = target_badge_info(p.get("raw"), p["lat"], p["lng"], p.get("address"))[0]
    except Exception:
        out["badge"] = None
    if p.get("is_truck"):
        u = p.get("unit") or {}
        out["unit_no"] = u.get("number") or p.get("raw")
        out["st"] = "driving" if (u.get("state") or {}).get("name") == "driving" else "standing"
        out["dir"] = next((u.get(k) for k in ("direction", "course", "heading", "angle") if u.get(k) is not None), None)
    return out


def _add_corridor(result, points, corridor):
    """v3.32: первый отрезок, где действует обход Швейцарии, — для кнопок выбора коридора."""
    for a, b in zip(points, points[1:]):
        cc = swiss_bypass_candidates(a["country"], a["lat"], a["lng"], b["country"], b["lat"], b["lng"])
        if cc:
            wps = resolve_waypoints(a["country"], a["lat"], a["lng"], b["country"], b["lat"], b["lng"], corridor)
            info = corridor_info(cc, wps, corridor, (a["lat"], a["lng"], b["lat"], b["lng"]))
            info["countries"] = [a["country"], b["country"]]
            result["corridor"] = info
            break


def _add_legs(result, points, legs, polyline):
    """Отрезки, общие км / часы (70 км/ч; в ч:мм форматирует фронт), линия. -> total км."""
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
            "rule": leg.get("rule") or "",
        })
    result["dist_km"] = round(total, 1)
    result["duration_h"] = round(total / 70, 3)
    result["route_polyline"] = polyline
    result["waypoints_applied"] = any(l["waypoints_applied"] for l in legs)
    return total


def _add_eta(result, points, total, crew=None, crew_seen=None):
    """v3.39: ETD | В пути | ETA при выезде сейчас — тот же движок, что Флот и калькулятор:
    From1 — машина → по её тахографу, иначе соло со свежего дня. -> расклад (sim) или None."""
    import time as _time
    sim = None
    try:
        start = ceil_15_ts(_time.time())
        tu0 = points[0].get("unit") if points[0].get("is_truck") else None
        tk = _truck_tacho(tu0, crew, crew_seen) if tu0 else None
        sim = tacho_eta(tk or FRESH_SOLO_TACHO, total, now_ts=start)
        etd = start
        for stp in sim["stops"]:                  # стоит на отдыхе / перерыве — выезд после него
            if abs(stp["start"] - etd) < 1:
                etd = stp["end"]
            else:
                break
        fmt = lambda ts: ceil_15min(ts_west(ts)).strftime("%d/%m %H:%M")
        result["etd"], result["eta"] = fmt(etd), fmt(sim["eta_ts"])
        result["eta_src"] = "по тахографу машины" if tk else "соло со свежего дня"
        result["eta_week_hit"] = bool(sim["week"]["hit"])
    except Exception as e:
        result["eta_error"] = str(e)
    return sim


def _add_bans(result, points, polyline, total, sim):
    """v1.45: запреты по пути — при выезде сейчас (стоянки — из того же расклада)."""
    try:
        if sim is None:
            sim = tacho_eta(FRESH_SOLO_TACHO, total)
        # v1.83: ночь в Австрии — для MAN-тягача в первой точке; без тягача — "если MAN"
        tu = points[0].get("unit") if points[0].get("is_truck") else None
        at_n = needs_at_night_ban(tu) if tu else True
        hits, bst = bans_on_route(polyline, total, sim["stops"], at_night=at_n)
        loc = lambda ts: ts_west(ts).strftime("%d/%m %H:%M")
        result["bans_route"] = bans_hits_text(hits, loc, "MAN без L" if tu else "если MAN")
        result["bans_status"] = bst
    except Exception as e:
        result["bans_status"] = f"ошибка: {e}"


def route_calc(payload):
    """From → To. payload: {"from": ["OI-4310", "IT20", ...], "to": ["SE25", "59.9, 10.8", ...]}
    (старый формат {"from": "ES30", "to": "SE25"} тоже принимается). Каждое поле — машина / GPS /
    код региона / город. Пустые поля пропускаются, маршрут строго по порядку from1..fromN -> to1..toM.
    Возвращает (ответ, HTTP-код)."""
    if not GOOGLE_API_KEY:
        return {"error": "GOOGLE_API_KEY не настроен на сервере"}, 500

    froms = _as_list(payload.get("from"))
    tos = _as_list(payload.get("to"))
    if not froms and not tos:
        return {"error": "Заполните хотя бы одно поле — From или To"}, 400

    try:
        points, err = _resolve_points(froms, tos)
        if err:
            return err

        result = {
            "points": [_point_view(p) for p in points],
            "legs": [],
            "dist_km": None,
            "duration_h": None,
            "route_polyline": None,
            "waypoints_applied": False,
        }

        if len(points) >= 2:
            corridor = clean_corridor(payload.get("corridor"))      # v3.32: коридор выбрал диспетчер
            legs, polyline = compute_multi_route(points, GOOGLE_API_KEY, corridor)
            _add_corridor(result, points, corridor)
            total = _add_legs(result, points, legs, polyline)
            sim = _add_eta(result, points, total, *from_crew(payload))
            _add_bans(result, points, polyline, total, sim)

        # v3.32: From — машина: данные тахографа для ⏱ калькулятора («⏱ Послать в калькулятор»)
        if len(points) >= 2 and points[0].get("is_truck"):
            result["calc_seed"] = _truck_seed(points[0].get("unit") or {}, *from_crew(payload))

        # v1.29: похожие рейсы из базы фрахтов — первая погрузка -> последняя выгрузка
        if len(points) >= 2:
            try:
                result["freights"] = similar_freights(points[0], points[-1], result["dist_km"])
            except Exception as e:
                result["freights"] = {"error": str(e)}

        return result, 200
    except Exception as e:
        return {"error": str(e)}, 502


def from_crew(payload):
    """v3.115: соло / экипаж и память «экипаж», которые диспетчер поставил этой машине во Флоте (клиент шлёт из строки:
    from_crew, from_crew_seen) — From → To и ⏱ калькулятор считают так же, как строка. -> (crew | None, seen_ts | None)."""
    crew = payload.get("from_crew")
    crew = crew if crew in ("solo", "team") else None
    try:
        seen = float(payload.get("from_crew_seen") or 0)
    except (TypeError, ValueError):
        seen = 0.0
    return crew, (seen if seen > 0 else None)


def _truck_tacho(unit, crew=None, crew_seen=None):
    """v3.39: тахограф машины из From1 для ETA (соло / экипаж, пояс страны); нет тахографа — None."""
    try:
        tacho, _err = get_tacho(unit.get("unit_id"))
        if not tacho:
            return None
        days = unit_driving_days(unit.get("unit_id")) if len(tacho["drivers"]) < 2 and crew not in ("solo", "team") else None
        team, src, _ = crew_mode(tacho, crew, days, crew_seen)
        out = dict(tacho, team=team, crew_src=src)
        if unit.get("lat") is not None:
            code, _d = nearest_region_code(unit["lat"], unit["lng"])
            if code:
                out["tz"] = country_tz(code[:2])
        return out
    except Exception as _e:
        warn("route_calc:248", _e)
        return None


def _truck_seed(unit, crew=None, crew_seen=None):
    """v3.32: данные машины из From1 для калькулятора; v3.114 — тот же сбор, что у строки Флота (`truck_seed`)."""
    try:
        return truck_seed(unit, crew, crew_seen)
    except Exception as _e:
        warn("route_calc:261", _e)
        return None


def unit_seed(raw, crew=None, crew_seen=None):
    """v3.114: ⏱ калькулятор — в From выбрана машина, To пока пусто: данные машины без маршрута.
    Не машина (GPS, код, город) — {"truck": False}, без геокодера. -> (ответ, код)"""
    raw = str(raw or "").strip()
    if not raw or looks_like_gps_or_code(raw) or not MAPON_API_KEY:
        return {"truck": False}, 200
    try:
        unit = find_unit_exact(fetch_units(MAPON_API_KEY), raw)
        if unit is None:
            return {"truck": False}, 200
        return {"truck": True, "unit": unit.get("number") or raw, "calc_seed": _truck_seed(unit, crew, crew_seen)}, 200
    except Exception as e:
        return {"error": str(e)}, 502
