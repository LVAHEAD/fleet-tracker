"""v3.26: Италия ↔ Бенелюкс / восток Франции в обход Швейцарии (Инсбрук / Монблан / Фрежюс);
«впритык» — решает Google; подпись правила во From → To; «Карта 2.0»; «Для Claude» — текст заранее."""
import os
import unittest
from unittest import mock

from fetat.clients import google_routes as gr
from fetat.domain import routing_rules as rr
from fetat.services import corridors

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

BARI = (41.1013, 16.8693)
BOLOGNA = (44.49, 11.34)
TURIN = (45.07, 7.69)
MILAN = (45.46, 9.19)
NL29 = (51.9482, 4.9309)
BRUSSELS = (50.85, 4.35)
STRASBOURG = (48.58, 7.75)
NICE = (43.70, 7.26)
LYON = (45.76, 4.84)
VENICE = (45.44, 12.33)
AMSTERDAM = (52.37, 4.90)
IBK_N = [rr.INNSBRUCK, rr.KUFSTEIN]      # v3.29: коридор Инсбрук на север — выезд на Куфштайн
IBK_S = [rr.KUFSTEIN, rr.INNSBRUCK]


def cands(fc, a, tc, b):
    return rr.swiss_bypass_candidates(fc, a[0], a[1], tc, b[0], b[1])


class SwissBypassTest(unittest.TestCase):
    def test_bari_to_nl_via_innsbruck(self):
        # пример Владимира 05.10: IT70 → NL29 строился напрямую через Швейцарию
        self.assertEqual(rr.pick_waypoints_by_country("IT", *BARI, "NL", *NL29), IBK_N)

    def test_west_italy_via_mont_blanc(self):
        self.assertEqual(rr.pick_waypoints_by_country("IT", *TURIN, "NL", *NL29), [rr.MONT_BLANC])
        self.assertEqual(rr.pick_waypoints_by_country("IT", *MILAN, "FR", *STRASBOURG), [rr.MONT_BLANC])

    def test_reverse_direction(self):
        self.assertEqual(rr.pick_waypoints_by_country("NL", *NL29, "IT", *BARI), IBK_S)
        self.assertEqual(rr.pick_waypoints_by_country("BE", *BRUSSELS, "IT", *TURIN), [rr.MONT_BLANC])

    def test_countries(self):
        for cc, pt in (("BE", BRUSSELS), ("NL", NL29), ("LU", (49.61, 6.13)), ("FR", STRASBOURG)):
            self.assertIsNotNone(cands("IT", BARI, cc, pt), cc)
        # юг и запад Франции — без правила (туда из Италии через Вентимилью / туннели и так)
        self.assertIsNone(cands("IT", TURIN, "FR", NICE))
        self.assertIsNone(cands("IT", TURIN, "FR", LYON))
        self.assertIsNone(cands("IT", TURIN, "FR", (48.85, 2.35)))     # Париж — западнее 4,5°
        # не Италия — правило не трогает
        self.assertIsNone(cands("DE", (48.14, 11.58), "NL", NL29))
        self.assertIsNone(rr.pick_waypoints_by_country("ES", 40.4, -3.7, "NL", *NL29))

    def test_innsbruck_for_germany_unchanged(self):
        self.assertEqual(rr.pick_waypoints_by_country("IT", *BOLOGNA, "DE", 48.14, 11.58), IBK_N)
        self.assertEqual(rr.pick_waypoints_by_country("DE", 48.78, 9.18, "IT", *BOLOGNA), IBK_S)   # Штутгарт

    def test_tie(self):
        c = cands("IT", BOLOGNA, "BE", AMSTERDAM)       # v3.29: 1118 / 1120 по прямой (через Куфштайн) — впритык
        self.assertEqual([x[0] for x in c[:2]], ["Монблан", "Инсбрук"])
        self.assertTrue(rr.corridor_is_tie(c))
        self.assertFalse(rr.corridor_is_tie(cands("IT", VENICE, "NL", NL29)))
        # v3.29: Болонья → Брюссель через Куфштайн длиннее — Монблан без вопросов
        self.assertEqual(cands("IT", BOLOGNA, "BE", BRUSSELS)[0][0], "Монблан")
        self.assertFalse(rr.corridor_is_tie(cands("IT", BOLOGNA, "BE", BRUSSELS)))

    def test_label(self):
        self.assertEqual(rr.waypoints_label([rr.MONT_BLANC]), "через Монблан")
        self.assertEqual(rr.waypoints_label([rr.INNSBRUCK]), "через Инсбрук")
        self.assertEqual(rr.waypoints_label(IBK_N), "через Инсбрук")
        self.assertEqual(rr.waypoints_label(IBK_S), "через Инсбрук")
        self.assertEqual(rr.waypoints_label([rr.PUTTGARDEN, rr.RODBY]), "паромы")
        self.assertEqual(rr.waypoints_label(None), "")


class CorridorChoiceTest(unittest.TestCase):
    def setUp(self):
        gr._route_cache.clear()

    def tearDown(self):
        gr._route_cache.clear()

    def test_tie_asks_google_once_then_cache(self):
        calls = []

        def fake(lat1, lng1, lat2, lng2, key, wps=None):
            calls.append(tuple(wps[0]))
            return (1050.0 if tuple(wps[0]) == rr.INNSBRUCK else 1100.0), None
        with mock.patch.object(corridors, "GOOGLE_API_KEY", "k"), \
                mock.patch.object(gr, "_road_distance_km_google", side_effect=fake):
            wps = corridors.resolve_waypoints("IT", *BOLOGNA, "NL", *AMSTERDAM)
            self.assertEqual(wps, IBK_N)                    # по дорогам короче Инсбрук (через Куфштайн)
            self.assertEqual(len(calls), 2)
            # машина сдвинулась на пару км — та же клетка сетки, Google не спрашиваем
            wps2 = corridors.resolve_waypoints("IT", BOLOGNA[0] + 0.01, BOLOGNA[1] + 0.01, "NL", *AMSTERDAM)
            self.assertEqual(wps2, IBK_N)
            self.assertEqual(len(calls), 2)

    def test_not_tie_no_google(self):
        with mock.patch.object(corridors, "GOOGLE_API_KEY", "k"), \
                mock.patch.object(gr, "_road_distance_km_google", side_effect=AssertionError("не нужен")):
            self.assertEqual(corridors.resolve_waypoints("IT", *VENICE, "NL", *NL29), IBK_N)

    def test_google_error_falls_back(self):
        with mock.patch.object(corridors, "GOOGLE_API_KEY", "k"), \
                mock.patch.object(gr, "_road_distance_km_google", side_effect=RuntimeError("нет сети")):
            self.assertEqual(corridors.resolve_waypoints("IT", *BOLOGNA, "NL", *AMSTERDAM), [rr.MONT_BLANC])

    def test_fleet_uses_resolver(self):
        self.assertEqual(corridors.fleet_waypoints_resolved(*VENICE, *NL29), IBK_N)


class RouteCalcLegRuleTest(unittest.TestCase):
    def test_leg_rule_in_body(self):
        from fetat.services import route_calc
        sent = {}

        class R:
            def raise_for_status(self):
                pass

            def json(self):
                return {"routes": [{"distanceMeters": 1700000, "legs": [{"distanceMeters": 1700000}],
                                    "polyline": {"encodedPolyline": ""}}]}

        def fake_post(url, json=None, headers=None, timeout=None):
            sent["body"] = json
            return R()
        pts = [{"lat": BARI[0], "lng": BARI[1], "country": "IT"}, {"lat": NL29[0], "lng": NL29[1], "country": "NL"}]
        with mock.patch.object(route_calc.requests, "post", side_effect=fake_post):
            legs, _ = route_calc._compute_multi_route(pts, "k")
        self.assertEqual(legs[0]["rule"], "через Инсбрук")
        via = sent["body"]["intermediates"]
        self.assertEqual(via[0]["location"]["latLng"], {"latitude": rr.INNSBRUCK[0], "longitude": rr.INNSBRUCK[1]})
        self.assertTrue(via[0]["via"])


class GusageTextsTest(unittest.TestCase):
    def test_texts_in_json(self):
        from fetat import create_app
        from fetat.api import meta
        meta._gseries_cache.update(at=0.0, data=None, error=None)
        with mock.patch("fetat.api.meta.monitoring_token", side_effect=RuntimeError("нет доступа")):
            js = create_app().test_client().get("/api/google-usage/log").get_json()
        self.assertIn(js["today"], js["texts"])
        t = js["texts"][js["today"]]
        self.assertTrue(t.startswith("Запросы к Google Routes"))
        self.assertIn("Счёт Google недоступен: нет доступа", t)

    def test_page_copies_preloaded_text(self):
        with open(os.path.join(ROOT, "static/gusage-page.js"), encoding="utf-8") as f:
            js = f.read()
        self.assertIn("texts = d.texts || {}", js)
        self.assertIn("let text = texts[sel];", js)


class MapPanelTest(unittest.TestCase):
    def read(self, rel):
        with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
            return f.read()

    def test_markup(self):
        html = self.read("templates/index.html")
        self.assertIn('<aside id="map-panel" class="map-panel"', html)
        self.assertIn('<div id="map"></div>', html)            # id карты прежний — мобильная версия и initMap
        self.assertIn('id="map-tab"', html)
        self.assertLess(html.index("app.js"), html.index("map-panel.js"))

    def test_mechanics_present(self):
        js = self.read("static/app.js")
        for name in ("function recluster", "function syncMapVisibility", "function selectFromMap",
                     "function truckIcon", 'localStorage.getItem("fleet-target-v326")', "rowFilteredOut(rid)"):
            self.assertIn(name, js, name)
        self.assertNotIn("setOpacity(pale", js)                # чужие не бледные, а спрятаны

    def test_one_panel_at_a_time(self):
        self.assertIn("window.fleetMapPanel.close()", self.read("static/notebook.js"))
        self.assertIn("Notebook.close()", self.read("static/map-panel.js"))
        self.assertIn(".nb-tab.open { right: 460px;", self.read("static/notebook.css"))


if __name__ == "__main__":
    unittest.main()
