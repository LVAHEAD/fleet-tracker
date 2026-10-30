"""v3.242: общий кеш отрезков route/list — догрузка хвоста вместо 4 суток."""
import time
import unittest
from datetime import datetime, timezone
from unittest import mock

from fetat.clients import mapon as M

H = 3600


def iso(ts):
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def seg(kind, s, e, lat=56.9, lng=24.1, addr="A"):
    r = {"type": kind, "start": {"time": iso(s), "lat": lat, "lng": lng, "address": addr},
         "end": {"time": iso(e), "lat": lat, "lng": lng} if e else {}}
    return r


class RoutesCache(unittest.TestCase):
    def setUp(self):
        M._routes_cache.clear()
        self.now = time.time()

    def test_tail_merge(self):
        n = self.now
        full = [seg("stop", n - 30 * H, n - 20 * H), seg("route", n - 20 * H, n - 10 * H),
                seg("stop", n - 10 * H, None, addr="B")]
        calls = []

        def fake(uid, frm, till):
            calls.append(frm)
            if len(calls) == 1:
                return full
            # хвост: стоянка B закончилась, началась поездка
            return [seg("route", n - 20 * H, n - 10 * H), seg("stop", n - 10 * H, n - 1 * H, addr="B"),
                    seg("route", n - 1 * H, None)]

        with mock.patch.object(M, "_route_list", side_effect=fake):
            st = M.unit_stops(1, days=4, min_sec=15 * 60)
            self.assertTrue(st[-1]["now"])
            self.assertIs(M.unit_stops(1, days=4, min_sec=15 * 60), st)   # memo, без запроса
            self.assertEqual(len(calls), 1)
            M._routes_cache[1]["at"] -= M.ROUTES_TTL + 1
            st2 = M.unit_stops(1, days=4, min_sec=15 * 60)
        self.assertEqual(len(calls), 2)
        self.assertAlmostEqual(calls[1], n - 20 * H, delta=2)          # хвост с начала предпоследнего
        self.assertEqual([x["address"] for x in st2], ["A", "B"])        # без дублей
        self.assertFalse(st2[-1]["now"])
        self.assertEqual(len(M._routes_cache[1]["routes"]), 4)

    def test_tail_error_keeps_old(self):
        n = self.now
        full = [seg("stop", n - 10 * H, n - 5 * H), seg("route", n - 5 * H, None)]
        with mock.patch.object(M, "_route_list", return_value=full):
            M.unit_routes(2)
        M._routes_cache[2]["at"] -= M.ROUTES_TTL + 1
        with mock.patch.object(M, "_route_list", side_effect=RuntimeError("mapon")):
            routes, _ = M.unit_routes(2)
        self.assertEqual(routes, full)

    def test_full_reload_after_6h(self):
        n = self.now
        with mock.patch.object(M, "_route_list", return_value=[seg("stop", n - 2 * H, None)]) as f:
            M.unit_routes(3)
            M._routes_cache[3]["at"] -= M.ROUTES_FULL_SEC
            M._routes_cache[3]["full_at"] -= M.ROUTES_FULL_SEC
            M.unit_routes(3)
        frm = f.call_args_list[1][0][1]
        self.assertAlmostEqual(frm, n - M.ROUTES_KEEP_DAYS * 86400, delta=5)

    def test_passes_error_empty(self):
        with mock.patch.object(M, "_route_list", side_effect=RuntimeError("mapon")):
            self.assertEqual(M.unit_passes(4), [])


if __name__ == "__main__":
    unittest.main()
