"""v3.139: форма объекта-АЗС для Mapon — повторяем образец из группы «Actual Petrol Station».

Чистая математика и текст, без сети: из WKT образца берём число вершин, радиус, поворот и сам вид записи
(префикс, разделители, замыкающая точка), затем строим такой же многоугольник вокруг другой точки.
"""
import math
import re

from fetat.utils.geo import haversine_km

_NUM = re.compile(r"-?\d+(?:\.\d+)?")
M_PER_DEG = 111320.0


def shape_from_sample(wkt):
    """Описание формы по WKT образца. Не многоугольник (меньше 3 вершин) — ValueError."""
    text = str(wkt or "")
    ms = list(_NUM.finditer(text))
    if len(ms) < 6 or len(ms) % 2:
        raise ValueError("образец не многоугольник (меньше 3 вершин)")
    pts = [(float(ms[i].group()), float(ms[i + 1].group())) for i in range(0, len(ms), 2)]
    closed = len(pts) > 3 and pts[0] == pts[-1]
    verts = pts[:-1] if closed else pts
    if abs(verts[0][0]) > 90:
        raise ValueError("в образце первой идёт долгота — порядок координат не подтверждён")
    lat = sum(p[0] for p in verts) / len(verts)
    lng = sum(p[1] for p in verts) / len(verts)
    k = math.cos(math.radians(lat))
    rad = sum(haversine_km(lat, lng, p[0], p[1]) for p in verts) * 1000 / len(verts)
    ang0 = math.atan2((verts[0][0] - lat) * M_PER_DEG, (verts[0][1] - lng) * M_PER_DEG * k)
    dec = len(ms[0].group().split(".")[1]) if "." in ms[0].group() else 0
    return {"prefix": text[:ms[0].start()], "suffix": text[ms[-1].end():], "sep_in": text[ms[0].end():ms[1].start()],
            "sep_between": text[ms[1].end():ms[2].start()], "closed": closed, "n": len(verts),
            "radius_m": round(rad, 1), "ang0": ang0, "dec": dec}


def make_wkt(shape, lat, lng):
    """WKT такой же формы и радиуса вокруг точки (lat, lng)."""
    n, rad, k = shape["n"], shape["radius_m"], math.cos(math.radians(lat))
    pts = []
    for i in range(n):
        a = shape["ang0"] + 2 * math.pi * i / n          # тот же порядок обхода (против часовой), что и угол образца
        pts.append((lat + rad * math.sin(a) / M_PER_DEG, lng + rad * math.cos(a) / (M_PER_DEG * k)))
    if shape["closed"]:
        pts.append(pts[0])
    f = f"{{:.{shape['dec']}f}}"
    body = shape["sep_between"].join(f.format(a) + shape["sep_in"] + f.format(b) for a, b in pts)
    return shape["prefix"] + body + shape["suffix"]
