import unittest

from fetat.domain.routing_rules import (
    GEDSER, PUTTGARDEN, RODBY, ROSTOCK_FERRY, in_zealand_zone, pick_waypoints_by_country,
)

VALENCIA = (39.47, -0.38)
KORSOR = (55.3415, 11.1549)
RODBY_TOWN = (54.6559, 11.36)
NYKOBING_F = (54.77, 11.87)
KOBENHAVN = (55.676, 12.568)
AARHUS = (56.1629, 10.2039)
ODENSE = (55.40, 10.39)
BORNHOLM = (55.10, 14.70)
HAMBURG = (53.55, 10.0)
ROSTOCK = (54.09, 12.14)
MILAN = (45.46, 9.19)


class ZealandFerryTest(unittest.TestCase):
    """v3.83: на Зеландию / Лолланн / Фальстер с материка — паромами, Ютландия и Фюн — по суше."""

    def test_zone(self):
        for pt in (KORSOR, RODBY_TOWN, NYKOBING_F, KOBENHAVN, (55.75, 10.9)):
            self.assertTrue(in_zealand_zone(*pt), pt)
        for pt in (AARHUS, ODENSE, BORNHOLM, (55.6, 10.5)):
            self.assertFalse(in_zealand_zone(*pt), pt)

    def test_spain_to_korsor_ferry(self):
        w = pick_waypoints_by_country("ES", *VALENCIA, "DK", *KORSOR)
        self.assertEqual(w, [PUTTGARDEN, RODBY])

    def test_back_to_mainland(self):
        w = pick_waypoints_by_country("DK", *KORSOR, "ES", *VALENCIA)
        self.assertEqual(w, [RODBY, PUTTGARDEN])

    def test_italy_rostock_gedser(self):
        w = pick_waypoints_by_country("IT", *MILAN, "DK", *KOBENHAVN)
        self.assertEqual(w, [ROSTOCK_FERRY, GEDSER])

    def test_germany_nearest_pair(self):
        self.assertEqual(pick_waypoints_by_country("DE", *HAMBURG, "DK", *KORSOR), [PUTTGARDEN, RODBY])
        self.assertEqual(pick_waypoints_by_country("DE", *ROSTOCK, "DK", *KORSOR), [ROSTOCK_FERRY, GEDSER])

    def test_jutland_and_funen_by_land(self):
        self.assertIsNone(pick_waypoints_by_country("ES", *VALENCIA, "DK", *AARHUS))
        self.assertIsNone(pick_waypoints_by_country("ES", *VALENCIA, "DK", *ODENSE))

    def test_scandinavia_rules_unchanged(self):
        # Корсёр -> Хельсингборг: только Хельсингёр — Хельсингборг
        w = pick_waypoints_by_country("DK", *KORSOR, "SE", 56.0467, 12.6944)
        self.assertEqual(len(w), 2)
        # Испания -> Швеция напрямую: оба парома
        self.assertEqual(len(pick_waypoints_by_country("ES", *VALENCIA, "SE", 56.0467, 12.6944)), 4)


if __name__ == "__main__":
    unittest.main()
