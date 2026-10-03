"""v3.13: кеш маршрутов — плечо точка → точка долгое, машина рядом с прошлым местом — без запроса."""
import unittest
from unittest import mock

from fetat.clients import google_routes as gr


class RouteCacheTest(unittest.TestCase):
    def setUp(self):
        gr._route_cache.clear()
        gr._along_cache.clear()
        self.calls = []

        def fake(lat1, lng1, lat2, lng2, api_key, waypoints=None):
            self.calls.append((lat1, lng1, lat2, lng2))
            return 100.0, None
        self.p = mock.patch.object(gr, "_road_distance_km_google", side_effect=fake)
        self.p.start()

    def tearDown(self):
        self.p.stop()

    def test_leg_cached(self):
        gr.road_distance_km_google(56.9, 24.1, 54.6, 25.3, "k", kind="leg")
        gr.road_distance_km_google(56.9, 24.1, 54.6, 25.3, "k", kind="leg")
        self.assertEqual(len(self.calls), 1)

    def test_truck_moved_little(self):
        gr.road_distance_km_google(56.90, 24.10, 54.6, 25.3, "k")
        gr.road_distance_km_google(56.91, 24.11, 54.6, 25.3, "k")   # ~1.3 км
        self.assertEqual(len(self.calls), 1)

    def test_truck_moved_far(self):
        gr.road_distance_km_google(56.90, 24.10, 54.6, 25.3, "k")
        gr.road_distance_km_google(56.70, 24.10, 54.6, 25.3, "k")   # ~22 км, линии маршрута нет
        self.assertEqual(len(self.calls), 2)


if __name__ == "__main__":
    unittest.main()
