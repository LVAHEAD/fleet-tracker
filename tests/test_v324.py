"""v3.24: From → To больше не виснет — счётчик запросов не вызывается под замком кеша маршрутов."""
import threading
import unittest
from unittest import mock

from fetat.clients import google_routes as gr
from fetat.services import route_calc as rc

POINTS = [{"lat": 56.95, "lng": 24.1, "country": "LV"}, {"lat": 52.5, "lng": 13.4, "country": "DE"}]


class MultiRouteLockTest(unittest.TestCase):
    def setUp(self):
        gr._route_cache.clear()
        self.patches = [
            # как на боевом сервере: счётчик пишет в буфер под замком (Firestore)
            mock.patch.object(gr, "_shared_on", return_value=True),
            mock.patch.object(gr, "flush_route_stats", return_value=None),
            mock.patch.object(rc, "_compute_multi_route",
                              return_value=([{"dist_km": 1500.0, "waypoints_applied": False}], "")),
        ]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        gr._route_cache.clear()

    def _run(self):
        t = threading.Thread(target=rc.compute_multi_route, args=(POINTS, "k"), daemon=True)
        t.start()
        t.join(5)
        return not t.is_alive()

    def test_no_hang_call_and_cache_hit(self):
        self.assertTrue(self._run(), "первый расчёт (запрос в Google) завис")
        self.assertTrue(self._run(), "повторный расчёт (из кеша) завис")
        # замок свободен — другие потоки (расчёты Флота) могут его взять
        self.assertTrue(gr._route_cache_lock.acquire(timeout=1))
        gr._route_cache_lock.release()

    def test_stat_called_outside_lock(self):
        held = []
        orig = rc._route_stat

        def spy(*a, **k):
            held.append(gr._route_cache_lock._is_owned())
            return orig(*a, **k)
        with mock.patch.object(rc, "_route_stat", side_effect=spy):
            rc.compute_multi_route(POINTS, "k")
            rc.compute_multi_route(POINTS, "k")
        self.assertEqual(held, [False, False])


if __name__ == "__main__":
    unittest.main()
