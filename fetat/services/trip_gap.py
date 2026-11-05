"""v3.277: расстояние между двумя трипами одной машины — от последней точки трипа 1 до ① трипа 2
(карточка «трипов во Флоте», static/multi-trip.js). Плечо — тот же общий кеш LEG_TTL (30 дней), что у трипов."""
from fetat.clients.google_routes import road_distance_km_google
from fetat.config import GOOGLE_API_KEY
from fetat.domain.points import resolve_fleet_target
from fetat.services.corridors import fleet_waypoints_resolved as fleet_waypoints
from fetat.utils.geo import haversine_km
from fetat.utils.log import warn

SAME_POINT_KM = 1.0   # точки в одном месте — 0 км, Google не спрашиваем


def trip_gap(frm, to):
    """({"km": число} | {"error": текст}, http-код). Тексты точек — как в таргете строки Флота."""
    frm, to = str(frm or "").strip(), str(to or "").strip()
    if not frm or not to:
        return {"error": "нет точки"}, 200
    try:
        a = resolve_fleet_target(frm, [], None)
        b = resolve_fleet_target(to, [], None)
        if a.get("lat") is None or b.get("lat") is None or a.get("target_is_truck") or b.get("target_is_truck"):
            return {"error": "нет координат"}, 200
        if haversine_km(a["lat"], a["lng"], b["lat"], b["lng"]) <= SAME_POINT_KM:
            return {"km": 0.0}, 200
        wps = fleet_waypoints(a["lat"], a["lng"], b["lat"], b["lng"])
        km, _poly = road_distance_km_google(a["lat"], a["lng"], b["lat"], b["lng"], GOOGLE_API_KEY, wps, kind="leg")
        if km is None:
            return {"error": "маршрут не найден"}, 200
        return {"km": round(float(km), 1)}, 200
    except ValueError:
        return {"error": "нет координат"}, 200
    except Exception as e:
        warn("trip_gap", e)
        return {"error": "не посчитать"}, 200
