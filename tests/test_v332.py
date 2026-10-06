"""v3.32: выбор коридора ИТ ↔ Бенелюкс диспетчером; меню с км; калькулятор — EU time, From → To."""
import os
import unittest
from unittest import mock

from fetat.clients import google_routes as gr
from fetat.domain import routing_rules as rr
from fetat.services import corridors

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VENICE = (45.44, 12.33)
NL29 = (51.9482, 4.9309)
IBK_N = [rr.INNSBRUCK, rr.KUFSTEIN]


def read(p):
    with open(os.path.join(ROOT, p), encoding="utf-8") as f:
        return f.read()


class CorridorPickTest(unittest.TestCase):
    def setUp(self):
        gr._route_cache.clear()

    def tearDown(self):
        gr._route_cache.clear()

    def test_manual_wins(self):
        # по прямой Венеция → NL — Инсбрук; диспетчер выбрал Монблан
        self.assertEqual(corridors.resolve_waypoints("IT", *VENICE, "NL", *NL29), IBK_N)
        self.assertEqual(corridors.resolve_waypoints("IT", *VENICE, "NL", *NL29, "Монблан"), [rr.MONT_BLANC])
        self.assertEqual(corridors.fleet_waypoints_resolved(*VENICE, *NL29, "Фрежюс"), [rr.FREJUS])

    def test_manual_ignored_outside_rule(self):
        # Германия → Италия: правило Инсбрука, выбор коридора к нему не относится
        de = (48.14, 11.58)
        self.assertEqual(corridors.resolve_waypoints("DE", *de, "IT", *VENICE, "Монблан"),
                         rr.innsbruck_corridor(to_italy=True))

    def test_clean(self):
        self.assertEqual(corridors.clean_corridor("Монблан"), "Монблан")
        self.assertIsNone(corridors.clean_corridor("Сен-Бернар"))
        self.assertIsNone(corridors.clean_corridor(None))

    def test_info_names_used(self):
        cc = rr.swiss_bypass_candidates("IT", *VENICE, "NL", *NL29)
        info = corridors.corridor_info(cc, [rr.MONT_BLANC], "Монблан", (*VENICE, *NL29))
        self.assertEqual(info["used"], "Монблан")
        self.assertTrue(info["manual"])
        self.assertEqual(sorted(info["names"]), sorted(corridors.CORRIDOR_NAMES))

    def test_options_km_and_diff(self):
        kms = {rr.INNSBRUCK: 1300.0, rr.MONT_BLANC: 1250.0, rr.FREJUS: 1400.0}

        def fake(lat1, lng1, lat2, lng2, key, wps=None):
            return kms[tuple(wps[0])], None
        with mock.patch.object(corridors, "GOOGLE_API_KEY", "k"), \
                mock.patch.object(gr, "_road_distance_km_google", side_effect=fake):
            d = corridors.corridor_options(*VENICE, *NL29, "IT", "NL")
        self.assertEqual(d["best"], "Монблан")
        by = {o["name"]: o for o in d["options"]}
        self.assertEqual(by["Инсбрук"]["diff"], 50.0)
        self.assertEqual(by["Монблан"]["tunnel_eur"], 250)
        self.assertEqual(by["Фрежюс"]["tunnel_eur"], 250)
        self.assertIsNone(by["Инсбрук"]["tunnel_eur"])

    def test_options_not_rule(self):
        d = corridors.corridor_options(48.14, 11.58, 52.5, 13.4, "DE", "DE")
        self.assertIn("error", d)


class FrontWiringTest(unittest.TestCase):
    def test_calc_eu_time(self):
        js = read("static/eta-calc.js")
        self.assertIn('"Europe/Berlin"', js)
        self.assertNotIn(".getHours()", js)
        self.assertIn("openWith", js)

    def test_route_button_and_corridor(self):
        html = read("templates/index.html")
        self.assertIn('id="route-to-calc"', html)
        self.assertIn('id="route-corridor"', html)
        self.assertIn('"corridor"', read("static/sync.js"))

    def test_left_edge_fix(self):
        self.assertIn("var(--side-ml", read("static/style.css"))
        for f in ("static/map-panel.js", "static/eta-calc.js", "static/notebook.js"):
            self.assertIn("sideMarginFix()", read(f), f)


if __name__ == "__main__":
    unittest.main()
