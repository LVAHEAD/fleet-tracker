"""Геометрия: расстояния, polyline Google, WKT-полигоны Mapon, разбор GPS."""
import math
import re


def haversine_km(lat1, lng1, lat2, lng2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _encode_polyline(pts):
    out, plat, plng = [], 0, 0
    for la, ln in pts:
        for v, prev in ((round(la * 1e5), plat), (round(ln * 1e5), plng)):
            d = v - prev
            d = ~(d << 1) if d < 0 else d << 1
            while d >= 0x20:
                out.append(chr((0x20 | (d & 0x1F)) + 63))
                d >>= 5
            out.append(chr(d + 63))
        plat, plng = round(la * 1e5), round(ln * 1e5)
    return "".join(out)


def _decode_polyline(enc):
    pts, i, lat, lng = [], 0, 0, 0
    while enc and i < len(enc):
        for which in (0, 1):
            shift = result = 0
            while True:
                b = ord(enc[i]) - 63
                i += 1
                result |= (b & 0x1F) << shift
                shift += 5
                if b < 0x20:
                    break
            d = ~(result >> 1) if result & 1 else result >> 1
            if which == 0:
                lat += d
            else:
                lng += d
        pts.append((lat / 1e5, lng / 1e5))
    return pts


def _wkt_vertices(wkt):
    """Вершины полигона Mapon (v3.55): список [lat, lng] без замыкающей точки; та же логика порядка, что у _wkt_center."""
    nums = re.findall(r"-?\d+(?:\.\d+)?", str(wkt or ""))
    pts = [[float(nums[i]), float(nums[i + 1])] for i in range(0, len(nums) - 1, 2)]
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    if pts and abs(pts[0][0]) > 90:        # на случай долготы первой
        pts = [[b, a] for a, b in pts]
    return [[round(a, 5), round(b, 5)] for a, b in pts]


def _wkt_center(wkt):
    """Центр объекта из WKT Mapon (по умолчанию широта первой): среднее вершин."""
    nums = re.findall(r"-?\d+(?:\.\d+)?", str(wkt or ""))
    pts = [(float(nums[i]), float(nums[i + 1])) for i in range(0, len(nums) - 1, 2)]
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    if not pts:
        return None, None, 0
    lat = sum(p[0] for p in pts) / len(pts)
    lng = sum(p[1] for p in pts) / len(pts)
    if abs(lat) > 90:                      # на случай долготы первой
        lat, lng = lng, lat
    return round(lat, 5), round(lng, 5), len(pts)


def _wkt_points(wkt):
    nums = re.findall(r"-?\d+(?:\.\d+)?", str(wkt or ""))
    pts = [(float(nums[i]), float(nums[i + 1])) for i in range(0, len(nums) - 1, 2)]
    if pts and any(abs(a) > 90 for a, _ in pts):
        pts = [(b, a) for a, b in pts]
    return pts


def _point_in_poly(lat, lng, poly):
    inside, n = False, len(poly)
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        if (a[1] > lng) != (b[1] > lng):
            x = a[0] + (lng - a[1]) * (b[0] - a[0]) / ((b[1] - a[1]) or 1e-12)
            if lat < x:
                inside = not inside
    return inside


def poly_dist_km(lat, lng, poly):
    """v3.29: расстояние от точки до полигона, км: 0 — внутри, иначе до ближайшего края
    (плоская проекция вокруг точки — для зон в пару км точности хватает)."""
    if _point_in_poly(lat, lng, poly):
        return 0.0
    kx = 111.32 * math.cos(math.radians(lat))
    ky = 110.57
    best = None
    n = len(poly)
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        ax, ay = (a[1] - lng) * kx, (a[0] - lat) * ky
        bx, by = (b[1] - lng) * kx, (b[0] - lat) * ky
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy
        t = 0.0 if L2 == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / L2))
        px, py = ax + t * dx, ay + t * dy
        d = math.hypot(px, py)
        if best is None or d < best:
            best = d
    return best if best is not None else float("inf")


_GPS_RE = re.compile(r"(-?\d{1,2}\.\d+)\s*[,;]\s*(-?\d{1,3}\.\d+)")


def parse_gps(text):
    """Первая пара "lat, lng" в тексте -> (lat, lng) или None."""
    m = _GPS_RE.search(str(text or ""))
    if not m:
        return None
    lat, lng = float(m.group(1)), float(m.group(2))
    if -90 <= lat <= 90 and -180 <= lng <= 180:
        return lat, lng
    return None
