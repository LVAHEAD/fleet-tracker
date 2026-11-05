"""v3.277: расстояние между трипами (fetat/services/trip_gap.py) — без сети: Google и разбор точек подменены."""
import unittest
from unittest import mock

from fetat.services import trip_gap as tg


def _pt(lat, lng):
    return {"lat": lat, "lng": lng}


class TripGapTest(unittest.TestCase):
    def test_no_point(self):
        self.assertEqual(tg.trip_gap("", "X")[0], {"error": "нет точки"})

    def test_same_point_zero_without_google(self):
        with mock.patch.object(tg, "resolve_fleet_target", return_value=_pt(41.0, 2.0)), \
             mock.patch.object(tg, "road_distance_km_google", side_effect=AssertionError("Google не нужен")):
            self.assertEqual(tg.trip_gap("A", "B")[0], {"km": 0.0})

    def test_leg_km_rounded(self):
        pts = iter([_pt(41.0, 2.0), _pt(43.0, 3.0)])
        with mock.patch.object(tg, "resolve_fleet_target", side_effect=lambda *a: next(pts)), \
             mock.patch.object(tg, "fleet_waypoints", return_value=None), \
             mock.patch.object(tg, "road_distance_km_google", return_value=(231.46, "poly")) as g:
            self.assertEqual(tg.trip_gap("A", "B")[0], {"km": 231.5})
            self.assertEqual(g.call_args.kwargs.get("kind"), "leg")

    def test_unresolved_and_truck(self):
        with mock.patch.object(tg, "resolve_fleet_target", side_effect=ValueError("x")):
            self.assertEqual(tg.trip_gap("A", "B")[0], {"error": "нет координат"})
        with mock.patch.object(tg, "resolve_fleet_target", return_value={"lat": 1, "lng": 1, "target_is_truck": True}):
            self.assertEqual(tg.trip_gap("A", "B")[0], {"error": "нет координат"})


if __name__ == "__main__":
    unittest.main()
