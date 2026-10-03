"""Принудительные маршруты: Италия ↔ Германия через Инсбрук, паромы на Норвегию/Швецию."""

from fetat.domain.regions import _country_at, get_region_country
from fetat.utils.geo import haversine_km


INNSBRUCK = (47.2692, 11.4041)


PUTTGARDEN = (54.5008, 11.2158)


RODBY = (54.6559, 11.3600)


ROSTOCK_FERRY = (54.1766, 12.0894)   # Warnemünde, паромный терминал у Ростока


GEDSER = (54.5730, 11.9250)


HELSINGOR = (56.0360, 12.6136)


HELSINGBORG = (56.0465, 12.6945)


BENELUX_FR = {"BE", "NL", "LU", "FR"}


ES_PT = {"ES", "PT"}


SCANDI = {"NO", "SE"}


def _ferry_pair_for_country(other_country, other_lat, other_lng):
    """Южная пара паромных портов (материк -> Дания) для страны other_country."""
    if other_country == "IT":
        return (ROSTOCK_FERRY, GEDSER)
    if other_country in ES_PT or other_country in BENELUX_FR:
        return (PUTTGARDEN, RODBY)
    if other_country == "DE":
        d_rostock = haversine_km(other_lat, other_lng, ROSTOCK_FERRY[0], ROSTOCK_FERRY[1])
        d_puttgarden = haversine_km(other_lat, other_lng, PUTTGARDEN[0], PUTTGARDEN[1])
        return (ROSTOCK_FERRY, GEDSER) if d_rostock < d_puttgarden else (PUTTGARDEN, RODBY)
    return None


def pick_waypoints(from_str, from_lat, from_lng, to_str, to_lat, to_lng):
    """Старый интерфейс (страна только из кода региона) — оставлен для совместимости."""
    return pick_waypoints_by_country(
        get_region_country(from_str), from_lat, from_lng,
        get_region_country(to_str), to_lat, to_lng,
    )


def pick_waypoints_by_country(from_country, from_lat, from_lng, to_country, to_lat, to_lng):
    """Возвращает список [(lat,lng), ...] промежуточных точек по известным правилам
    для пары стран, или None, если ни одно правило не подходит."""
    if not from_country or not to_country:
        return None

    # Италия <-> Германия: всегда через Австрию (Инсбрук)
    if {from_country, to_country} == {"IT", "DE"}:
        return [INNSBRUCK]

    # v2.03: трак уже в Дании (после Рёдбю/Гедсера) — на Норвегию/Швецию только через Хельсингёр–Хельсингборг
    if from_country == "DK" and to_country in SCANDI:
        return [HELSINGOR, HELSINGBORG]
    if from_country in SCANDI and to_country == "DK":
        return [HELSINGBORG, HELSINGOR]

    # Паромы на/из Норвегии-Швеции
    if from_country in SCANDI and to_country not in SCANDI:
        pair = _ferry_pair_for_country(to_country, to_lat, to_lng)
        if pair:
            south_port, dk_port = pair
            # едем с севера на юг — сначала датская сторона паромов, потом материковая
            return [HELSINGBORG, HELSINGOR, dk_port, south_port]
    elif to_country in SCANDI and from_country not in SCANDI:
        pair = _ferry_pair_for_country(from_country, from_lat, from_lng)
        if pair:
            south_port, dk_port = pair
            # едем с юга на север
            return [south_port, dk_port, HELSINGOR, HELSINGBORG]

    return None


def fleet_waypoints(lat1, lng1, lat2, lng2):
    """v2.03: правила маршрутов (паромы на Скандинавию, Инсбрук) и для строк Флота —
    страны точек по ближайшему коду региона."""
    try:
        return pick_waypoints_by_country(_country_at(lat1, lng1), lat1, lng1, _country_at(lat2, lng2), lat2, lng2)
    except Exception:
        return None
