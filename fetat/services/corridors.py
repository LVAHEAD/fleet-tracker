"""v3.26: промежуточные точки маршрута по правилам (паромы, Инсбрук, обход Швейцарии) — с выбором коридора.

Правила — в domain/routing_rules. Здесь — один случай, где нужен Google: Италия ↔ Бенелюкс / восток Франции,
когда два лучших коридора по прямой впритык (ближе CORRIDOR_TIE) — какой короче по дорогам, решает Google
(clients.google_routes.choose_shortest, решение в кеше 30 дней)."""
from fetat.clients.google_routes import choose_shortest, road_distance_km_google
from fetat.config import GOOGLE_API_KEY
from fetat.domain.regions import _country_at
from fetat.domain.routing_rules import (SWISS_BYPASS, corridor_is_tie, pick_waypoints_by_country,
                                        swiss_bypass_candidates)

# v3.32: выбор коридора диспетчером (трип / From → To): имя из SWISS_BYPASS или None — авто
CORRIDOR_NAMES = tuple(name for name, _ in SWISS_BYPASS)
TUNNEL_EUR = {"Монблан": 261, "Фрежюс": 255}     # подсказка в меню выбора, в расчёт не идёт


def clean_corridor(v):
    """Ручной выбор коридора из запроса: известное имя или None (авто)."""
    v = str(v or "").strip()
    return v if v in CORRIDOR_NAMES else None


def corridor_name(cands, wps):
    """Какой коридор из кандидатов в точках маршрута wps (имя) или None."""
    key = [tuple(p) for p in (wps or [])]
    for name, pts, _km in cands or []:
        if [tuple(p) for p in pts] == key:
            return name
    return None


def resolve_waypoints(from_country, from_lat, from_lng, to_country, to_lat, to_lng, corridor=None):
    """Точки маршрута для пары: как pick_waypoints_by_country, но при «впритык» коридор выбирает Google.
    v3.32: corridor — выбор диспетчера (Инсбрук / Монблан / Фрежюс): если правило про эту пару — берём его."""
    cands = swiss_bypass_candidates(from_country, from_lat, from_lng, to_country, to_lat, to_lng)
    if cands and corridor:
        for name, pts, _km in cands:
            if name == corridor:
                return pts
    if cands and corridor_is_tie(cands) and GOOGLE_API_KEY:
        top = cands[:2]
        try:
            return top[choose_shortest(from_lat, from_lng, to_lat, to_lng, GOOGLE_API_KEY, [c[1] for c in top])][1]
        except Exception:
            return top[0][1]      # Google не ответил — коридор по прямой
    return pick_waypoints_by_country(from_country, from_lat, from_lng, to_country, to_lat, to_lng)


def fleet_waypoints_resolved(lat1, lng1, lat2, lng2, corridor=None):
    """Флот: страны точек — по ближайшему коду региона (как domain.routing_rules.fleet_waypoints)."""
    try:
        return resolve_waypoints(_country_at(lat1, lng1), lat1, lng1, _country_at(lat2, lng2), lat2, lng2, corridor)
    except Exception:
        return None


def fleet_corridor_cands(lat1, lng1, lat2, lng2):
    """v3.32: коридоры обхода Швейцарии для пары точек Флота (страны по кодам регионов) или None."""
    try:
        return swiss_bypass_candidates(_country_at(lat1, lng1), lat1, lng1, _country_at(lat2, lng2), lat2, lng2)
    except Exception:
        return None


def corridor_info(cands, wps, corridor, leg, to=0):
    """v3.32: что показать на плашке коридора: какой взят, вручную ли, отрезок (для меню с км).
    v3.45: to — номер точки, к которой ведёт плечо (0 — ①, 1 — ②…): плашка стоит перед этой строкой."""
    return {"used": corridor_name(cands, wps), "manual": bool(corridor), "names": [c[0] for c in cands],
            "leg": [round(float(x), 5) for x in leg], "to": to}


def corridor_options(lat1, lng1, lat2, lng2, from_country=None, to_country=None):
    """v3.32: меню выбора коридора — км по дорогам через каждый коридор (Google, общий кеш плеч 30 дней;
    начало — на сетке ~1 км, чтобы едущая машина не спрашивала заново на каждом шаге).
    Возвращает {"options": [{name, km, diff, tunnel_eur}], "best"} или {"error"}."""
    if from_country is None:
        from_country, to_country = _country_at(lat1, lng1), _country_at(lat2, lng2)
    cands = swiss_bypass_candidates(from_country, lat1, lng1, to_country, lat2, lng2)
    if not cands:
        return {"error": "Для этой пары правило обхода Швейцарии не действует"}
    if not GOOGLE_API_KEY:
        return {"error": "GOOGLE_API_KEY не настроен на сервере"}
    a_lat, a_lng = round(lat1, 2), round(lng1, 2)
    opts = []
    for name, pts, line_km in cands:
        try:
            km, _poly = road_distance_km_google(a_lat, a_lng, lat2, lng2, GOOGLE_API_KEY, pts, kind="leg")
        except Exception:
            km = None
        opts.append({"name": name, "km": round(km, 1) if km is not None else None, "line_km": line_km,
                     "tunnel_eur": TUNNEL_EUR.get(name)})
    known = [o["km"] for o in opts if o["km"] is not None]
    best = min(known) if known else None
    for o in opts:
        o["diff"] = round(o["km"] - best, 1) if (o["km"] is not None and best is not None) else None
    opts.sort(key=lambda o: (o["km"] is None, o["km"] if o["km"] is not None else o["line_km"]))
    return {"options": opts, "best": opts[0]["name"] if known else None}
