#!/usr/bin/env python3
"""
Fleet ETA Tracker — дополнение кодов регионов из GeoNames (v1.27)

Скачивает открытый справочник почтовых индексов GeoNames
(https://download.geonames.org/export/zip/, лицензия CC BY 4.0) по списку
стран и считает центры 2-значных зон: код = страна + первые 2 цифры индекса
(AT10, CH80, BG10 ...), координаты = среднее по всем индексам зоны,
место = населённый пункт, ближайший к этому центру.

Результат — data/region_codes_geonames.json. Приложение при старте
добавляет эти коды к REGION_CODES из GPS_Codes.xlsx, НЕ перезаписывая
существующие (ваши коды главнее).

Запуск (один раз, из папки fleet-tracker, нужен интернет — Cloud Shell подходит):
    python3 tools/build_region_codes.py
Другой набор стран:
    python3 tools/build_region_codes.py AT CH HU
Только стандартная библиотека Python, ничего ставить не нужно.
"""
import io
import json
import math
import re
import sys
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path

# Страны, которых нет (или почти нет) в GPS_Codes.xlsx. Если GeoNames какую-то
# не публикует — она просто пропускается.
DEFAULT_COUNTRIES = [
    "AT", "CH", "LI", "LU", "HU", "SI", "HR", "BG", "RO", "LT", "LV", "EE",
    "GR", "RS", "BA", "MK", "MD", "IE", "TR",
]
URL = "https://download.geonames.org/export/zip/{cc}.zip"
OUT = Path(__file__).resolve().parent.parent / "data" / "region_codes_geonames.json"


def download(cc):
    req = urllib.request.Request(URL.format(cc=cc), headers={"User-Agent": "fleet-eta-tracker/1.27"})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        return z.read(f"{cc}.txt").decode("utf-8")


def zones_from_text(cc, text):
    """text — файл GeoNames: country, postal_code, place_name, admin1..3, lat, lng, accuracy (TAB)."""
    groups = defaultdict(list)
    for line in text.splitlines():
        f = line.split("\t")
        if len(f) < 11:
            continue
        digits = re.sub(r"\D", "", f[1])  # "LV-1001" -> "1001", "1000-001" -> "1000001"
        if len(digits) < 2:
            continue
        try:
            lat, lng = float(f[9]), float(f[10])
        except ValueError:
            continue
        groups[digits[:2]].append((lat, lng, f[2].strip()))

    zones = {}
    for pref, pts in groups.items():
        # центр-медиана устойчив к выбросам (ошибочные координаты отдельных индексов)
        mlat = sorted(p[0] for p in pts)[len(pts) // 2]
        mlng = sorted(p[1] for p in pts)[len(pts) // 2]
        # отбрасываем явные выбросы (> 3 медианных расстояний от медианы, минимум ~5 км)
        d = sorted(math.hypot(p[0] - mlat, p[1] - mlng) for p in pts)
        lim = max(3 * d[len(d) // 2], 0.05)
        core = [p for p in pts if math.hypot(p[0] - mlat, p[1] - mlng) <= lim] or pts
        clat = sum(p[0] for p in core) / len(core)
        clng = sum(p[1] for p in core) / len(core)
        place = min(core, key=lambda p: (p[0] - clat) ** 2 + (p[1] - clng) ** 2)[2]
        zones[f"{cc}{pref}"] = {"lat": round(clat, 4), "lng": round(clng, 4),
                                "place": place, "n": len(pts)}
    return zones


def main():
    countries = [c.upper() for c in sys.argv[1:]] or DEFAULT_COUNTRIES
    result, report = {}, []
    for cc in countries:
        try:
            zones = zones_from_text(cc, download(cc))
        except Exception as e:  # 404 — страны нет в GeoNames, и т.п.
            report.append(f"  {cc}: пропущена ({e.__class__.__name__}: {e})")
            continue
        for code, v in zones.items():
            v.pop("n", None)
            result[code] = v
        report.append(f"  {cc}: {len(zones)} зон")

    OUT.write_text(json.dumps({
        "source": "GeoNames postal codes, https://www.geonames.org (CC BY 4.0)",
        "codes": dict(sorted(result.items())),
    }, ensure_ascii=False, indent=0), encoding="utf-8")
    print("Готово:", OUT.name, f"— {len(result)} кодов")
    print("\n".join(report))


if __name__ == "__main__":
    main()
