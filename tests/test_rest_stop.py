"""v3.360: где трак стоял во время отдыха водителя (unit_stop_at и /api/truck-rest-stop)."""
import time
import unittest
from datetime import datetime, timezone
from unittest import mock

from fetat.clients import mapon as M

NOW = time.time()
D = 86400


def iso(ts):
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def stop(s, e, lat, lng, addr="адрес"):
    return {"type": "stop", "start": {"time": iso(s), "lat": lat, "lng": lng, "address": addr},
            "end": {"time": iso(e)} if e else {}}


class StopAtTest(unittest.TestCase):
    def test_longest_overlap_wins(self):
        routes = [stop(NOW - 3 * D, NOW - 3 * D + 3600, 1, 1), stop(NOW - 3 * D + 7200, NOW - 2 * D, 2, 2, "длинная"),
                  {"type": "route", "start": {"time": iso(NOW - 3 * D)}, "end": {"time": iso(NOW - 3 * D + 100)}}]
        with mock.patch.object(M, "unit_routes", return_value=(routes, {})):
            st, err = M.unit_stop_at(1, NOW - 3 * D, NOW - 2 * D)
        self.assertIsNone(err)
        self.assertEqual((st["lat"], st["address"]), (2, "длинная"))

    def test_old_interval_requests_mapon_without_polyline(self):
        routes = [stop(NOW - 20 * D, NOW - 18 * D, 5, 6)]
        with mock.patch.object(M, "_route_list", return_value=routes) as rl, \
                mock.patch.object(M, "unit_routes", side_effect=AssertionError("кеш для старого интервала")):
            st, err = M.unit_stop_at(1, NOW - 20 * D + 600, NOW - 19 * D)
        self.assertEqual(st["lat"], 5)
        self.assertFalse(rl.call_args.kwargs.get("polyline", True))

    def test_no_stops(self):
        with mock.patch.object(M, "_route_list", return_value=[]):
            st, err = M.unit_stop_at(1, NOW - 20 * D, NOW - 19 * D)
        self.assertIsNone(st)
        self.assertIn("нет", err)

    def test_mapon_error(self):
        with mock.patch.object(M, "_route_list", side_effect=RuntimeError("boom")):
            st, err = M.unit_stop_at(1, NOW - 20 * D, NOW - 19 * D)
        self.assertIsNone(st)
        self.assertIn("Mapon", err)

    def test_too_long_interval(self):
        st, err = M.unit_stop_at(1, NOW - 40 * D, NOW)
        self.assertIsNone(st)

    def test_ongoing_stop(self):
        routes = [stop(NOW - 3600, None, 7, 8)]
        with mock.patch.object(M, "unit_routes", return_value=(routes, {})):
            st, err = M.unit_stop_at(1, NOW - 1800, NOW - 600)
        self.assertTrue(st["now"])


if __name__ == "__main__":
    unittest.main()
