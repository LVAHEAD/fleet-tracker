"""v3.319: машина на пароме (в море) — маршрут от порта прибытия, ETA со схода, а не ошибка."""
import time
import unittest
from unittest import mock

from fetat.services import fleet_calc as fc


class ShipMode(unittest.TestCase):
    def test_on_line_mid_sea(self):
        # Любек (Seelandkai) → Ханко, середина рейса; таргет в Финляндии (Kesko)
        st = fc._ship_state(57.0, 17.0, 60.97, 28.2)
        self.assertIsNotNone(st)
        self.assertEqual(st["to_name"] in ("Hanko Port", "Vuosaari Port", "Turku Port"), True)
        self.assertGreater(st["left_sec"], 3600)

    def test_land_or_port_is_not_ship(self):
        self.assertIsNone(fc._ship_state(53.9, 10.78, 60.97, 28.2))     # в порту — маршрут обычный
        self.assertIsNone(fc._ship_state(48.1, 11.5, 60.97, 28.2))      # Мюнхен — далеко от линий
        self.assertIsNone(fc._ship_state(None, None, 60.97, 28.2))

    def test_route_by_ship_sets_eta_after_landing(self):
        unit = {"lat": 57.0, "lng": 17.0}
        res = {}
        with mock.patch.object(fc, "GOOGLE_API_KEY", "k"), \
                mock.patch.object(fc, "road_distance_km_google", return_value=(250.0, "poly")), \
                mock.patch.object(fc, "fleet_waypoints", return_value=None):
            ok = fc._add_route_by_ship(res, unit, 60.97, 28.2, {})
        self.assertTrue(ok)
        self.assertEqual(res["dist_km"], 250.0)
        self.assertGreater(res["_ship_arr_ts"], time.time())
        self.assertIn("arr", res["ship"])

    def test_not_ship_keeps_error(self):
        res = {}
        with mock.patch.object(fc, "GOOGLE_API_KEY", "k"):
            self.assertFalse(fc._add_route_by_ship(res, {"lat": 48.1, "lng": 11.5}, 60.97, 28.2, {}))
        self.assertNotIn("ship", res)


if __name__ == "__main__":
    unittest.main()
