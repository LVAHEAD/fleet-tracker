"""v3.191: паромы Германия ↔ Финляндия — выбор линии (fetat/domain/ferries.py)."""
import unittest

from fetat.domain.ferries import find_ferry, GATE_IN_H, LINES, PORTS

TRAVEMUNDE = PORTS["Lubeck (Travemünde) Port"][:2]
ROSTOCK = PORTS["Rostock Port"][:2]
VUOSAARI = PORTS["Vuosaari Port"][:2]
HANKO = PORTS["Hanko Port"][:2]
KESKO = (60.29, 25.04)        # Вантаа, окрестности Хельсинки
TURKU_AREA = (60.45, 22.27)
HAMBURG = (53.55, 9.99)
BERLIN = (52.52, 13.40)


class FerriesTest(unittest.TestCase):
    def test_travemunde_to_helsinki(self):
        f = find_ferry(*TRAVEMUNDE, *KESKO)
        self.assertEqual(f["id"], "fin-trv-hel")
        self.assertEqual(f["hours"], 31)
        self.assertEqual(f["sec"], (31 + GATE_IN_H) * 3600)
        self.assertTrue(f["to_fi"])
        self.assertEqual(f["from_name"], "Lubeck (Travemünde) Port")
        self.assertEqual(f["to_name"], "Vuosaari Port")

    def test_rostock_picks_by_target(self):
        self.assertEqual(find_ferry(*ROSTOCK, *TURKU_AREA)["id"], "fin-ros-tku")        # Турку ближе — 38 ч
        self.assertEqual(find_ferry(*ROSTOCK, 59.85, 23.0)["id"], "fin-ros-han")        # Ханко — Finnlines 33 ч
        self.assertEqual(find_ferry(*ROSTOCK, *KESKO)["id"], "fin-ros-han")             # Хельсинки: ближайший из линий — Ханко
        self.assertEqual(find_ferry(*ROSTOCK, 59.85, 23.0)["hours"], 33)                # Transfennica Росток–Ханко (43 ч) сама не берётся

    def test_seelandkai_to_hanko(self):
        f = find_ferry(*PORTS["Lubeck (Seelandkai) Port"][:2], 59.85, 23.0)
        self.assertEqual((f["id"], f["hours"]), ("tf-lub-han", 36))

    def test_reverse_direction(self):
        f = find_ferry(*VUOSAARI, *HAMBURG)
        self.assertEqual(f["id"], "fin-trv-hel")
        self.assertFalse(f["to_fi"])
        self.assertEqual((f["from_name"], f["to_name"]), ("Vuosaari Port", "Lubeck (Travemünde) Port"))
        g = find_ferry(*HANKO, *BERLIN)                                                   # из Ханко к Берлину — ближе Росток
        self.assertEqual(g["id"], "fin-ros-han")

    def test_no_ferry_without_port_or_for_other_targets(self):
        self.assertIsNone(find_ferry(52.0, 13.0, *KESKO))                                # предыдущая точка не порт
        self.assertIsNone(find_ferry(*TRAVEMUNDE, 59.4, 24.7))                           # Таллин (EE) — не наша линия
        self.assertIsNone(find_ferry(*TRAVEMUNDE, 57.7, 12.0))                           # Швеция — правила Скандинавии
        self.assertIsNone(find_ferry(None, None, *KESKO))

    def test_table_is_consistent(self):
        for ln in LINES:
            self.assertIn(ln["de"], PORTS)
            self.assertIn(ln["fi"], PORTS)
            self.assertEqual(PORTS[ln["de"]][2], "DE")
            self.assertEqual(PORTS[ln["fi"]][2], "FI")
        self.assertEqual(sorted(ln["hours"] for ln in LINES), [31, 33, 36, 38, 43])


class FerryCalcTest(unittest.TestCase):
    """calc_extra_stops: порт-точка ② → таргет в FI — паром, а не Google по суше."""

    def test_leg_after_ferry(self):
        from unittest import mock
        from fetat.services import fleet_calc as fc
        first = {"target_lat": TRAVEMUNDE[0], "target_lng": TRAVEMUNDE[1], "dist_km": 1000.0}
        calls = []

        def fake_road(a, b, c, d, key, wps, kind="leg"):
            calls.append((a, b, c, d))
            return 25.0, None

        res = {"lat": KESKO[0], "lng": KESKO[1], "target_address": None}
        with mock.patch.object(fc, "resolve_fleet_target", return_value=dict(res)), \
             mock.patch.object(fc, "road_distance_km_google", side_effect=fake_road), \
             mock.patch.object(fc, "target_badge_info", return_value=("", "")):
            out = fc.calc_extra_stops(["Kesko"], [], {}, first, None, None)
        it = out[0]
        self.assertEqual(it["leg_km"], 25.0)                       # только суша от Вуосаари
        self.assertEqual(it["dist_km"], 1025.0)
        self.assertEqual(it["ferry"]["hours"], 31)
        self.assertAlmostEqual(calls[0][0], VUOSAARI[0], places=3)   # Google — от финского порта
        self.assertEqual(len(calls), 1)


if __name__ == "__main__":
    unittest.main()


class FerryDepartureTest(unittest.TestCase):
    def setUp(self):
        self.fr = find_ferry(*TRAVEMUNDE, *KESKO)

    def test_no_departure(self):
        from fetat.domain.ferries import ferry_sec
        self.assertEqual(ferry_sec(self.fr, 1000.0, None), (self.fr["sec"], False))

    def test_waits_for_departure(self):
        from fetat.domain.ferries import ferry_sec
        arr = 10000.0
        dep = arr + 5 * 3600                       # успеваем: ждём отхода
        sec, late = ferry_sec(self.fr, arr, dep)
        self.assertFalse(late)
        self.assertEqual(arr + sec, dep + 31 * 3600)

    def test_late_for_gate_in(self):
        from fetat.domain.ferries import ferry_sec
        arr = 10000.0
        sec, late = ferry_sec(self.fr, arr, arr + 3600)   # отход через час < Gate-In 2 ч
        self.assertTrue(late)
        self.assertEqual(sec, self.fr["sec"])

    def test_wiring(self):
        import os
        r = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        rd = lambda *p: open(os.path.join(r, *p), encoding="utf-8").read()
        self.assertIn("ferry: x.ferry || null", rd("static", "app.js"))      # иначе ⛴ не дойдёт до подсказки
        self.assertIn("ferryDeps(row)", rd("static", "app.js"))
        self.assertIn("pos.ferries", rd("static", "map-core.js"))


class FerryMenuTest(unittest.TestCase):
    def test_manual_line_and_options(self):
        from fetat.domain.ferries import ferry_options, clean_line_id
        f = find_ferry(*ROSTOCK, 59.85, 23.0, "tf-ros-han")
        self.assertEqual((f["id"], f["hours"], f["manual"]), ("tf-ros-han", 43, True))
        self.assertFalse(find_ferry(*ROSTOCK, 59.85, 23.0)["manual"])
        self.assertEqual([o["id"] for o in ferry_options(*ROSTOCK, *KESKO)], ["fin-ros-han", "fin-ros-tku", "tf-ros-han"])
        self.assertEqual(find_ferry(*TRAVEMUNDE, *KESKO, "fin-ros-tku")["id"], "fin-trv-hel")   # линия не из этого порта — игнор
        self.assertIsNone(clean_line_id("evil"))
        self.assertEqual(clean_line_id("fin-trv-hel"), "fin-trv-hel")

    def test_wiring(self):
        import os
        r = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        rd = lambda *p: open(os.path.join(r, *p), encoding="utf-8").read()
        html = rd("templates", "index.html")
        self.assertLess(html.index("ferry-menu.js"), html.index("filename='app.js'"))
        self.assertIn("ferryMenu(b,", rd("static", "app.js"))
        self.assertIn("row.ferry ? { ferry: row.ferry }", rd("static", "app.js"))


class TerminalCoordsSyncTest(unittest.TestCase):
    """📍 терминалов на странице «Паромы» (static/ferries.js) = PORTS расчёта ETA."""

    def test_js_terminals_match_ports(self):
        import re
        from pathlib import Path
        js = (Path(__file__).resolve().parents[1] / "static" / "ferries.js").read_text(encoding="utf-8")
        got = {(float(a), float(b)) for a, b in re.findall(r'\[\s*"[^"]+",\s*([\d.]+),\s*([\d.]+)\s*\]', js.split("const TERMINAL_LL")[1].split("};")[0])}
        want = {(lat, lng) for lat, lng, *_ in PORTS.values()}
        self.assertLessEqual(want, got)   # все расчётные порты есть на странице; терминалы других линий — можно добавлять
