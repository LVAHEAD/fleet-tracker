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
            line = self.line if getattr(self, "line", None) else None
            return 100.0, line
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


    def test_truck_follows_route(self):
        # v3.14: линия с редкими вершинами (через 0.5° ≈ 55 км) — машина между вершинами на трассе
        from fetat.utils.geo import _encode_polyline, haversine_km
        pts = [(56.0 - 0.5 * i, 24.0) for i in range(5)]   # на юг, ~222 км
        self.line = _encode_polyline(pts)
        total = sum(haversine_km(a[0], a[1], b[0], b[1]) for a, b in zip(pts, pts[1:]))
        gr.road_distance_km_google(56.0, 24.0, 54.0, 24.0, "k")
        km, _ = gr.road_distance_km_google(55.25, 24.01, 54.0, 24.0, "k")   # ~83 км проехал, 0.6 км в стороне
        self.assertEqual(len(self.calls), 1)
        self.assertAlmostEqual(km, 100.0 * (total - haversine_km(56.0, 24.0, 55.25, 24.0)) / total, delta=1.5)

    def test_truck_off_route(self):
        from fetat.utils.geo import _encode_polyline
        self.line = _encode_polyline([(56.0, 24.0), (54.0, 24.0)])
        gr.road_distance_km_google(56.0, 24.0, 54.0, 24.0, "k")
        gr.road_distance_km_google(55.0, 24.1, 54.0, 24.0, "k")   # ~6 км в стороне — новый маршрут
        self.assertEqual(len(self.calls), 2)


if __name__ == "__main__":
    unittest.main()
