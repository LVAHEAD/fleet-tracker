"""v3.191: паромы Германия ↔ Финляндия — отрезок порт → порт считается константой линии, а не Google.

Включается только когда диспетчер сам поставил точку-порт (предыдущая точка в радиусе PORT_RADIUS_KM от порта из таблицы)
и следующая точка в Финляндии (или, в обратную сторону, в Германии). По стране без порта — не включаем: рейсы по суше
через Прибалтику остаются как есть. Часы — верхняя граница из файла Владимира (22.10): 31 / 36 / 33 / 38 / 43 ч;
Gate-In для тягача с водителем 2 ч прибавляется. Отход по расписанию — билд 2, меню выбора линии — билд 3."""

from fetat.domain.regions import _country_at
from fetat.utils.geo import haversine_km

PORT_RADIUS_KM = 3.0      # предыдущая точка ближе этого к порту — «мы в порту»
GATE_IN_H = 2.0           # тягач с водителем: заезд на терминал за 1,5–2 ч до отхода (берём 2)

# Точные Name из листа «Адреса» (Type = port): (широта, долгота, страна, подпись по-русски)
PORTS = {
    "Lubeck (Travemünde) Port": (53.94068, 10.85824, "DE", "Травемюнде"),
    "Lubeck (Seelandkai) Port": (53.90174, 10.78126, "DE", "Любек (Seelandkai)"),
    "Rostock Port": (54.14616, 12.09899, "DE", "Росток"),
    "Vuosaari Port": (60.22304, 25.18172, "FI", "Хельсинки (Vuosaari)"),
    "Hanko Port": (59.82215, 22.95575, "FI", "Ханко"),
    "Turku Port": (60.4333, 22.2166, "FI", "Турку"),
}

# auto=False — линия только для несопровождаемых прицепов, сама не выбирается (билд 3 — выбор руками)
LINES = [
    {"id": "fin-trv-hel", "operator": "Finnlines", "de": "Lubeck (Travemünde) Port", "fi": "Vuosaari Port", "hours": 31, "auto": True},
    {"id": "tf-lub-han", "operator": "Transfennica", "de": "Lubeck (Seelandkai) Port", "fi": "Hanko Port", "hours": 36, "auto": True},
    {"id": "fin-ros-han", "operator": "Finnlines", "de": "Rostock Port", "fi": "Hanko Port", "hours": 33, "auto": True},
    {"id": "fin-ros-tku", "operator": "Finnlines", "de": "Rostock Port", "fi": "Turku Port", "hours": 38, "auto": True},
    {"id": "tf-ros-han", "operator": "Transfennica", "de": "Rostock Port", "fi": "Hanko Port", "hours": 43, "auto": False},
]


def _near(lat, lng, port):
    p = PORTS[port]
    return haversine_km(lat, lng, p[0], p[1]) <= PORT_RADIUS_KM


def _pick(cands, lat, lng, far_port_key):
    """Из нескольких линий — та, чей дальний порт ближе к таргету; при равенстве — короче по времени."""
    return min(cands, key=lambda ln: (haversine_km(lat, lng, PORTS[ln[far_port_key]][0], PORTS[ln[far_port_key]][1]), ln["hours"]))


def find_ferry(prev_lat, prev_lng, lat, lng):
    """Паром для отрезка prev → target или None. Вперёд: prev у немецкого порта, таргет в FI; назад: prev у финского
    порта, таргет в DE. Возвращает {id, operator, label, from_name, to_name, from, to, hours, gate_in_h, sec, to_fi}."""
    if None in (prev_lat, prev_lng, lat, lng):
        return None
    cc = _country_at(lat, lng)
    if cc == "FI":
        cands = [ln for ln in LINES if ln["auto"] and _near(prev_lat, prev_lng, ln["de"])]
        key, to_fi = "fi", True
    elif cc == "DE":
        cands = [ln for ln in LINES if ln["auto"] and _near(prev_lat, prev_lng, ln["fi"])]
        key, to_fi = "de", False
    else:
        return None
    if not cands:
        return None
    ln = _pick(cands, lat, lng, key)
    a, b = (ln["de"], ln["fi"]) if to_fi else (ln["fi"], ln["de"])
    ru_a, ru_b = PORTS[a][3], PORTS[b][3]
    hours = ln["hours"]
    return {
        "id": ln["id"], "operator": ln["operator"], "label": f"{ln['operator']} {ru_a} → {ru_b}",
        "from_name": a, "to_name": b, "from": (PORTS[a][0], PORTS[a][1]), "to": (PORTS[b][0], PORTS[b][1]),
        "hours": hours, "gate_in_h": GATE_IN_H, "sec": (hours + GATE_IN_H) * 3600.0, "to_fi": to_fi,
    }


def ferry_sec(fr, arr_ts, dep_ts=None):
    """v3.192: сколько секунд от прихода в порт (arr_ts) до схода с парома. Без отхода — Gate-In + рейс.
    Отход (из «Даты» точки-порта) задан и успеваем к Gate-In — ждём отхода: сход = отход + рейс.
    Не успеваем — (sec, True): считаем как раньше (следующий рейс неизвестен), диспетчеру — предупреждение."""
    base = fr["sec"]
    if not dep_ts:
        return base, False
    if arr_ts + fr["gate_in_h"] * 3600 <= dep_ts:
        return dep_ts + fr["hours"] * 3600.0 - arr_ts, False
    return base, True
