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

    def test_zone_far_from_stop_still_matches_by_point(self):
        """v3.99: зона Mapon рядом, но стоянка в 250 м от её края и в 28 м от точки — засчитывается."""
        now = time.time()
        stop = {"start": now - 3 * 3600, "end": now - 600, "address": "Longitudinal 1",
                "lat": 41.33357, "lng": 2.11797, "now": False}
        unit = {"unit_id": 530465, "number": "NU-8704", "lat": 41.55, "lng": 2.25}
        def fake_poly(a, b, poly):
            return 27.0 if a == 41.55 else 0.25
        with mock.patch.object(P, "resolve_fleet_target",
                               return_value={"lat": 41.33355, "lng": 2.117641, "target_address": "x"}), \
                mock.patch.object(P, "target_object", return_value={"name": "Z", "poly": []}), \
                mock.patch.object(P, "poly_dist_km", side_effect=fake_poly), \
                mock.patch.object(P, "recent_stops", return_value=[stop]):
            rep = P.done_debug("Bonfred S.A", unit, [])
            res = P._auto_done("Bonfred S.A", {"lat": 41.33355, "lng": 2.117641}, 41.33355, 2.117641,
                               unit, [[stop]])
        self.assertTrue(rep["stops"][0]["in"])
        self.assertIsNotNone(res[0])


if __name__ == "__main__":
    unittest.main()
