"""v3.98: отладка авто-✓ — done_debug видит стоянку у точки; ошибки резолва не теряются."""
import time
import unittest
from unittest import mock

from fetat.domain import points as P


class DoneDebugTest(unittest.TestCase):
    def test_stop_near_point_matches(self):
        now = time.time()
        stop = {"start": now - 3 * 3600, "end": now - 600, "address": "Longitudinal 1",
                "lat": 41.33357, "lng": 2.11797, "now": False}
        unit = {"unit_id": 530465, "number": "NU-8704", "lat": 41.35, "lng": 2.12}
        with mock.patch.object(P, "resolve_fleet_target",
                               return_value={"lat": 41.33355, "lng": 2.117641, "target_address": "x"}), \
                mock.patch.object(P, "target_object", return_value=None), \
                mock.patch.object(P, "recent_stops", return_value=[stop]):
            rep = P.done_debug("Bonfred S.A", unit, [])
        self.assertEqual(rep["errors"], [])
        self.assertTrue(rep["left_ok"])
        self.assertTrue(rep["stops"][0]["in"])
        self.assertLess(rep["stops"][0]["dist_km"], 0.5)
        self.assertIsNotNone(rep["auto"]["end"])

    def test_resolve_error_is_reported(self):
        with mock.patch.object(P, "resolve_fleet_target", side_effect=ValueError("нет точки")):
            rep = P.done_debug("X", {"unit_id": 1, "lat": 1.0, "lng": 1.0}, [])
        self.assertTrue(rep["errors"][0].startswith("resolve: ValueError"))
        self.assertIsNone(rep.get("auto"))


if __name__ == "__main__":
    unittest.main()
