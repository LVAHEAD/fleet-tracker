"""Принудительные маршруты: Инсбрук, паромы на Скандинавию (CLAUDE.md → Маршруты)."""
import unittest

from tests import A

HAMBURG = (53.55, 9.99)
BERLIN = (52.52, 13.40)
BOLOGNA = (44.49, 11.34)
MUNICH = (48.14, 11.58)


def wp(fc, fll, tc, tll):
    return A.pick_waypoints_by_country(fc, fll[0], fll[1], tc, tll[0], tll[1])


class RoutingRulesTest(unittest.TestCase):
    def test_it_de_via_innsbruck(self):
        # v3.29: выезд из Тироля — только через Куфштайн
        self.assertEqual(wp("IT", BOLOGNA, "DE", MUNICH), [A.INNSBRUCK, A.KUFSTEIN])
        self.assertEqual(wp("DE", MUNICH, "IT", BOLOGNA), [A.KUFSTEIN, A.INNSBRUCK])

    def test_it_to_norway_rostock_gedser(self):
        self.assertEqual(wp("IT", BOLOGNA, "NO", (59.9, 10.7)),
                         [A.ROSTOCK_FERRY, A.GEDSER, A.HELSINGOR, A.HELSINGBORG])

    def test_spain_to_sweden_puttgarden(self):
        self.assertEqual(wp("ES", (40.4, -3.7), "SE", (59.3, 18.0)),
                         [A.PUTTGARDEN, A.RODBY, A.HELSINGOR, A.HELSINGBORG])

    def test_benelux_france_puttgarden(self):
        for cc in ("BE", "NL", "LU", "FR"):
            self.assertEqual(wp(cc, (50.8, 4.3), "SE", (59.3, 18.0))[:2], [A.PUTTGARDEN, A.RODBY], cc)

    def test_reverse_direction(self):
        self.assertEqual(wp("NO", (59.9, 10.7), "ES", (40.4, -3.7)),
                         [A.HELSINGBORG, A.HELSINGOR, A.RODBY, A.PUTTGARDEN])

    def test_germany_by_nearest_port(self):
        self.assertEqual(wp("DE", HAMBURG, "SE", (59.3, 18.0))[:2], [A.PUTTGARDEN, A.RODBY])
        self.assertEqual(wp("DE", BERLIN, "SE", (59.3, 18.0))[:2], [A.ROSTOCK_FERRY, A.GEDSER])

    def test_truck_already_in_denmark(self):
        self.assertEqual(wp("DK", (55.4, 10.4), "SE", (59.3, 18.0)), [A.HELSINGOR, A.HELSINGBORG])

    def test_no_rule(self):
        self.assertIsNone(wp("ES", (40.4, -3.7), "FR", (48.8, 2.3)))
        self.assertIsNone(wp(None, (40.4, -3.7), "SE", (59.3, 18.0)))

    def test_fleet_waypoints_by_coordinates(self):
        # Флот: страна точки — по ближайшему коду региона
        self.assertEqual(A.fleet_waypoints(*BOLOGNA, *MUNICH), [A.INNSBRUCK, A.KUFSTEIN])


if __name__ == "__main__":
    unittest.main()
