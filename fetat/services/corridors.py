"""v3.26: промежуточные точки маршрута по правилам (паромы, Инсбрук, обход Швейцарии) — с выбором коридора.

Правила — в domain/routing_rules. Здесь — один случай, где нужен Google: Италия ↔ Бенелюкс / восток Франции,
когда два лучших коридора по прямой впритык (ближе CORRIDOR_TIE) — какой короче по дорогам, решает Google
(clients.google_routes.choose_shortest, решение в кеше 30 дней)."""
from fetat.clients.google_routes import choose_shortest
from fetat.config import GOOGLE_API_KEY
from fetat.domain.regions import _country_at
from fetat.domain.routing_rules import corridor_is_tie, pick_waypoints_by_country, swiss_bypass_candidates


def resolve_waypoints(from_country, from_lat, from_lng, to_country, to_lat, to_lng):
    """Точки маршрута для пары: как pick_waypoints_by_country, но при «впритык» коридор выбирает Google."""
    cands = swiss_bypass_candidates(from_country, from_lat, from_lng, to_country, to_lat, to_lng)
    if cands and corridor_is_tie(cands) and GOOGLE_API_KEY:
        top = cands[:2]
        try:
            return top[choose_shortest(from_lat, from_lng, to_lat, to_lng, GOOGLE_API_KEY, [c[1] for c in top])][1]
        except Exception:
            return top[0][1]      # Google не ответил — коридор по прямой
    return pick_waypoints_by_country(from_country, from_lat, from_lng, to_country, to_lat, to_lng)


def fleet_waypoints_resolved(lat1, lng1, lat2, lng2):
    """Флот: страны точек — по ближайшему коду региона (как domain.routing_rules.fleet_waypoints)."""
    try:
        return resolve_waypoints(_country_at(lat1, lng1), lat1, lng1, _country_at(lat2, lng2), lat2, lng2)
    except Exception:
        return None
