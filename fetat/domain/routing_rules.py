"""Принудительные маршруты: Италия ↔ Германия через Инсбрук, паромы на Норвегию/Швецию,
v3.26 — Италия ↔ Бенелюкс и восток Франции в обход Швейцарии (Инсбрук / Монблан / Фрежюс),
v3.29 — коридор Инсбрук выходит из Тироля только через Куфштайн (не Фернпасс / Арльберг)."""


from fetat.domain.regions import _country_at, get_region_country
from fetat.utils.geo import haversine_km


INNSBRUCK = (47.2692, 11.4041)


# v3.29: выезд из Тироля в Германию — через Куфштайн: заправка на A12 у Куфштайна (наша, есть в Mapon)
KUFSTEIN = (47.56638, 12.15587)


# v3.29: коридор Инсбрук по ходу из Италии на север; в Италию — в обратном порядке
VIA_INNSBRUCK = (INNSBRUCK, KUFSTEIN)


# v3.26: туннели во Францию — точка в середине туннеля (Google притягивает её к дороге в туннеле)
MONT_BLANC = (45.854, 6.914)


FREJUS = (45.1365, 6.6855)


# v3.26: обход Швейцарии — коридоры и правило «впритык» (два лучших ближе этой доли — решает Google)
SWISS_BYPASS = (("Инсбрук", VIA_INNSBRUCK), ("Монблан", (MONT_BLANC,)), ("Фрежюс", (FREJUS,)))


CORRIDOR_TIE = 0.05


BENELUX = {"BE", "NL", "LU"}


PUTTGARDEN = (54.5008, 11.2158)


RODBY = (54.6559, 11.3600)


ROSTOCK_FERRY = (54.1766, 12.0894)   # Warnemünde, паромный терминал у Ростока


GEDSER = (54.5730, 11.9250)


HELSINGOR = (56.0360, 12.6136)


HELSINGBORG = (56.0465, 12.6945)


BENELUX_FR = {"BE", "NL", "LU", "FR"}


ES_PT = {"ES", "PT"}


SCANDI = {"NO", "SE"}


def innsbruck_corridor(to_italy):
    """v3.29: точки коридора Инсбрук по ходу: из Италии — Инсбрук → Куфштайн, в Италию — Куфштайн → Инсбрук."""
    return [KUFSTEIN, INNSBRUCK] if to_italy else [INNSBRUCK, KUFSTEIN]


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


def _swiss_risk(country, lat, lng):
    """v3.26: точка, куда из Италии Google может повести через Швейцарию: Бенелюкс и восток / северо-восток
    Франции (Эльзас, Лотарингия, Франш-Конте). Юг Франции (через Вентимилью) и запад — нет."""
    if country in BENELUX:
        return True
    return country == "FR" and lat is not None and lng is not None and lat > 46.5 and lng > 4.5


def swiss_bypass_candidates(from_country, from_lat, from_lng, to_country, to_lat, to_lng):
    """v3.26: Италия ↔ Бенелюкс / восток Франции — коридоры в обход Швейцарии по длине по прямой
    (откуда → точка коридора → куда), короткий первым: [(имя, [точка]), ...], или None, если правило не про эту пару."""
    if from_country == "IT" and _swiss_risk(to_country, to_lat, to_lng):
        to_italy = False
    elif to_country == "IT" and _swiss_risk(from_country, from_lat, from_lng):
        to_italy = True
    else:
        return None
    est = []
    for name, pts in SWISS_BYPASS:
        pts = list(reversed(pts)) if to_italy else list(pts)
        chain = [(from_lat, from_lng)] + pts + [(to_lat, to_lng)]
        km = sum(haversine_km(a[0], a[1], b[0], b[1]) for a, b in zip(chain, chain[1:]))
        est.append((km, name, pts))
    est.sort(key=lambda x: x[0])
    return [(name, pts, round(km)) for km, name, pts in est]


def corridor_is_tie(cands):
    """v3.26: два лучших коридора по прямой ближе CORRIDOR_TIE — по прямой не различить, решает Google."""
    return bool(cands) and len(cands) > 1 and cands[1][2] - cands[0][2] <= cands[0][2] * CORRIDOR_TIE


def waypoints_label(waypoints):
    """v3.26: подпись правила для отрезка: «через Монблан», «паромы», «через Инсбрук» — для разбивки From → To."""
    wps = [tuple(p) for p in (waypoints or [])]
    if not wps:
        return ""
    if set(wps) == set(VIA_INNSBRUCK) or wps == [INNSBRUCK]:
        return "через Инсбрук"
    names = {MONT_BLANC: "через Монблан", FREJUS: "через Фрежюс"}
    if len(wps) == 1 and wps[0] in names:
        return names[wps[0]]
    return "паромы"


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

    # Италия <-> Германия: всегда через Австрию (Инсбрук), v3.29 — выезд на Куфштайн
    if {from_country, to_country} == {"IT", "DE"}:
        return innsbruck_corridor(to_italy=(to_country == "IT"))

    # v3.26: Италия <-> Бенелюкс / восток Франции — в обход Швейцарии, самый короткий коридор по прямой
    # (если два лучших впритык — services.corridors спрашивает Google, см. resolve_waypoints)
    cands = swiss_bypass_candidates(from_country, from_lat, from_lng, to_country, to_lat, to_lng)
    if cands:
        return cands[0][1]

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
