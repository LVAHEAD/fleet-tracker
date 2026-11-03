"""v3.262: утечка Google Routes «машина → точка» (разбор [gmiss] 03.11)."""
import time
import unittest
from unittest import mock

from fetat.clients import google_routes as gr
from fetat.utils.geo import _encode_polyline


class TruckCacheV3262(unittest.TestCase):
    def setUp(self):
        gr._route_cache.clear()
        gr._along_cache.clear()
        self.calls = []
        self.line = None

        def fake(lat1, lng1, lat2, lng2, api_key, waypoints=None):
            self.calls.append((lat1, lng1))
            return 100.0, self.line or _encode_polyline([(lat1, lng1), (lat2, lng2)])
        self.p = mock.patch.object(gr, "_road_distance_km_google", side_effect=fake)
        self.p.start()

    def tearDown(self):
        self.p.stop()
        gr.set_route_ctx("auto", "t", "")

    def _calc(self, unit, lat, lng, tlat=54.0, tlng=24.0, **kw):
        gr.set_route_ctx("auto", "t", unit)
        return gr.road_distance_km_google(lat, lng, tlat, tlng, "k", **kw)

    def test_no_ping_pong(self):
        # две машины к одной точке, далеко друг от друга — каждая по разу, дальше из своего кеша
        for _ in range(3):
            self._calc("A", 56.0, 24.0)
            self._calc("B", 55.0, 28.0)
        self.assertEqual(len(self.calls), 2)

    def test_same_place_10h(self):
        # стоит вдали от линии (паром, ГПС застыл): через 10 ч — прошлый ответ, без Google
        self.line = _encode_polyline([(57.0, 21.0), (54.0, 24.0)])
        t0 = time.time()
        with mock.patch("time.time", return_value=t0):
            self._calc("A", 57.384, 19.428)
        with mock.patch("time.time", return_value=t0 + 10 * 3600):
            self._calc("A", 57.384, 19.428)
        self.assertEqual(len(self.calls), 1)

    def test_at_target(self):
        km, _ = self._calc("A", 54.003, 24.0)
        self.assertEqual(self.calls, [])
        self.assertLess(km, 1.0)

    def test_moving_target(self):
        t0 = time.time()
        with mock.patch("time.time", return_value=t0):
            km1, _ = self._calc("A", 56.946, 24.032, 60.53, 24.84, moving_target=True)
        with mock.patch("time.time", return_value=t0 + 20 * 60):
            km2, _ = self._calc("A", 56.946, 24.032, 60.20, 24.80, moving_target=True)
        self.assertEqual(len(self.calls), 1)
        from fetat.utils.geo import haversine_km
        self.assertAlmostEqual(km2, haversine_km(56.946, 24.032, 60.20, 24.80), delta=1)   # прямая × коэф. (≥ 1)
        with mock.patch("time.time", return_value=t0 + 31 * 60):
            self._calc("A", 56.946, 24.032, 59.90, 24.70, moving_target=True)
        self.assertEqual(len(self.calls), 2)


if __name__ == "__main__":
    unittest.main()
