"""v3.277: расстояние между двумя трипами одной машины — от последней точки трипа 1 до ① трипа 2
(карточка «трипов во Флоте», static/multi-trip.js). Плечо — тот же общий кеш LEG_TTL (30 дней), что у трипов."""
from fetat.clients.google_routes import road_distance_km_google
from fetat.config import GOOGLE_API_KEY
from fetat.domain.points import resolve_fleet_target
from fetat.services.corridors import fleet_waypoints_resolved as fleet_waypoints
from fetat.utils.geo import haversine_km
from fetat.utils.log import warn

SAME_POINT_KM = 1.0   # точки в одном месте — 0 км, Google не спрашиваем


def trip_gap_line(frm, to):
    """v3.305: то же плечо, но с координатами концов и линией для карты Флота (машина в 2 трипах):
    ({"km", "from_ll", "to_ll", "polyline"} | {"error"}, http-код). У плеча «в одной точке» линии нет."""
    frm, to = str(frm or "").strip(), str(to or "").strip()
    if not frm or not to:
        return {"error": "нет точки"}, 200
    try:
        a = resolve_fleet_target(frm, [], None)
        b = resolve_fleet_target(to, [], None)
        if a.get("lat") is None or b.get("lat") is None or a.get("target_is_truck") or b.get("target_is_truck"):
            return {"error": "нет координат"}, 200
        ll = {"from_ll": [a["lat"], a["lng"]], "to_ll": [b["lat"], b["lng"]]}
        if haversine_km(a["lat"], a["lng"], b["lat"], b["lng"]) <= SAME_POINT_KM:
            return {"km": 0.0, **ll}, 200
        wps = fleet_waypoints(a["lat"], a["lng"], b["lat"], b["lng"])
        km, poly = road_distance_km_google(a["lat"], a["lng"], b["lat"], b["lng"], GOOGLE_API_KEY, wps, kind="leg")
        if km is None:
            return {"error": "маршрут не найден"}, 200
        return {"km": round(float(km), 1), "polyline": poly if isinstance(poly, str) else None, **ll}, 200
    except ValueError:
        return {"error": "нет координат"}, 200
    except Exception as e:
        warn("trip_gap", e)
        return {"error": "не посчитать"}, 200


def trip_gap(frm, to):
    """({"km": число} | {"error": текст}, http-код). Тексты точек — как в таргете строки Флота."""
    body, code = trip_gap_line(frm, to)
    return ({"km": body["km"]} if "km" in body else body), code
