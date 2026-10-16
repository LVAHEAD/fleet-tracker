"""v3.136: список разрешённых АЗС из «Инструкции по заправкам» (опубликованные CSV Google-таблицы).

Чистый разбор текста и сверка по GPS — без сети и Flask (сеть — fetat/clients/fuel_sheet.py).
Blocks: станции и GPS свободным текстом («AS24 - SLUBICE  GPS: (52.33445, 14.61741)»), ищем пары координат.
Meta: дата обновления и таблицы «страна / станция - карта» (без GPS — станции только названием).
"""
import csv
import io
import re

from fetat.utils.geo import haversine_km

# пара координат «широта, долгота» (десятичная точка); запятая-разделитель обязательна
_COORD = re.compile(r"(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)")
# Европа с запасом — отсекает чужие числа (цены, литры)
LAT_RANGE = (34.0, 72.0)
LNG_RANGE = (-12.0, 45.0)

DUP_KM = 0.02              # одна и та же станция в разных блоках — совпадение до 20 м и той же сети
MATCH_M = 150              # радиус сопоставления станции списка с объектом группы Mapon

NETWORKS = (("as24", "AS24"), ("eurowag", "EWAG"), ("ewag", "EWAG"), ("viada", "VIADA"), ("neste", "NESTE"),
            ("cirkle", "CIRCLEK"), ("circle", "CIRCLEK"), ("crosschem", "CROSSCHEM"), ("preem", "PREEM"))
_NOT_WORKING = ("не работает", "ремонт", "временно")

_META_ROW = re.compile(r"^\s*(.+?)\s+/\s+(.+?)\s+-\s+(\S+)\s*$")


def network_of(text):
    low = (text or "").lower()
    for key, name in NETWORKS:
        if key in low:
            return name
    return ""


def _clean_name(raw):
    """Название станции из куска текста рядом с координатами."""
    s = raw or ""
    s = re.sub(r"GPS\s*:?", " ", s, flags=re.I)
    s = s.replace("(", " ").replace(")", " ")
    s = re.sub(r"оплата\s*картой.*$|картой\s+\w+.*$|[-–]\s*оплата.*$", " ", s, flags=re.I)
    if ":" in s:
        s = s.split(":")[-1]
    s = re.sub(r"\bили\b", " ", s, flags=re.I)
    s = re.sub(r"^[^\w]+", "", s)           # маркеры ✔ ✦ 📌 и тире в начале
    s = re.sub(r"[\s\-–,;/]+$", "", s)
    s = re.sub(r"\s{2,}", " ", s).strip()
    return s


def _name_for(before, after):
    """Название — перед координатами; если там пусто («56.93, 24.01 - Šampetera 180») — после."""
    b = _clean_name(before)
    if len(re.findall(r"[^\W\d_]", b)) >= 3:
        return b
    a = _clean_name(re.sub(r"^[\s\-–]+", "", after or ""))
    return a or b


def _in_europe(lat, lng):
    return LAT_RANGE[0] <= lat <= LAT_RANGE[1] and LNG_RANGE[0] <= lng <= LNG_RANGE[1]


def _cells(text):
    """Все ячейки CSV одним списком строк."""
    out = []
    for row in csv.reader(io.StringIO(text or "")):
        out.extend(c for c in row if c and c.strip())
    return out


def parse_blocks(text):
    """Станции с GPS из CSV «Blocks»: [{name, network, lat, lng, not_working, mentions}], без дублей."""
    found = []
    for cell in _cells(text):
        for line in cell.splitlines():
            ms = list(_COORD.finditer(line))
            for i, m in enumerate(ms):
                lat, lng = float(m.group(1)), float(m.group(2))
                if not _in_europe(lat, lng):
                    continue
                start = ms[i - 1].end() if i else 0
                end = ms[i + 1].start() if i + 1 < len(ms) else len(line)
                before, after = line[start:m.start()], line[m.end():end]
                seg = before + " " + after
                name = _name_for(before, after)
                found.append({"name": name, "network": network_of(seg) or network_of(line), "lat": lat, "lng": lng,
                              "not_working": any(w in seg.lower() for w in _NOT_WORKING), "mentions": 1})
    return _dedup(found)


def _dedup(items):
    out = []
    for it in items:
        for o in out:
            same_net = not o["network"] or not it["network"] or o["network"] == it["network"]
            if same_net and haversine_km(o["lat"], o["lng"], it["lat"], it["lng"]) <= DUP_KM:
                o["mentions"] += 1
                o["not_working"] = o["not_working"] or it["not_working"]
                if not o["network"]:
                    o["network"] = it["network"]
                if len(it["name"]) > len(o["name"]):
                    o["name"] = it["name"]
                break
        else:
            out.append(dict(it))
    return out


def parse_meta(text):
    """CSV «Meta»: {updated, stations: [{country, name, card}]} — станции без GPS, только названия."""
    updated = ""
    stations = []
    rows = list(csv.reader(io.StringIO(text or "")))
    for row in rows[:3]:
        if row and row[0].strip().lower().startswith("цены обновлены") and len(row) > 1:
            updated = row[1].strip()
            break
    for cell in _cells(text):
        for line in cell.splitlines():
            if line.strip().lower().startswith("страна"):
                continue
            m = _META_ROW.match(line)
            if m:
                stations.append({"country": m.group(1).strip(), "name": m.group(2).strip(), "card": m.group(3).strip()})
    return {"updated": updated, "stations": stations}


def match_to_mapon(stations, group_objects, radius_m=MATCH_M):
    """Сверка по GPS. group_objects: [{id, name, lat, lng}] — объекты группы Mapon (центры).
    Возвращает {matched, to_create, not_working, extra}: extra — объекты Mapon, которым в списке нет пары."""
    matched, to_create, not_working = [], [], []
    used = set()
    for st in stations:
        best, best_d = None, None
        for o in group_objects:
            d = haversine_km(st["lat"], st["lng"], o["lat"], o["lng"]) * 1000
            if best_d is None or d < best_d:
                best, best_d = o, d
        if best is not None and best_d <= radius_m:
            used.add(best["id"])
            matched.append({**st, "mapon_id": best["id"], "mapon_name": best["name"], "dist_m": round(best_d)})
        elif st.get("not_working"):
            not_working.append(st)
        else:
            to_create.append(st)
    extra = [o for o in group_objects if o["id"] not in used]
    return {"matched": matched, "to_create": to_create, "not_working": not_working, "extra": extra}
