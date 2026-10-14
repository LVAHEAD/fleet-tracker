"""v3.122: км плеча у пройденных точек ②③… (у ① остаётся ✓)."""
import os
import unittest
from unittest import mock

from tests import ROOT


def read(*p):
    with open(os.path.join(ROOT, *p), encoding="utf-8") as f:
        return f.read()


class V3122(unittest.TestCase):
    def _run(self, dn, pts, resolver=None, dist=(123.4, "poly")):
        from fetat.services import fleet_calc as fc
        res = resolver or (lambda s, units, unit: {"lat": float(s), "lng": 1.0})
        with mock.patch.object(fc, "resolve_fleet_target", side_effect=res), \
                mock.patch.object(fc, "fleet_waypoints", return_value=None), \
                mock.patch.object(fc, "road_distance_km_google", return_value=dist) as g:
            fc._add_done_legs(dn, pts, [], {})
        return g

    def test_legs_only_for_done_from_second(self):
        dn = [{"done": True}, {"done": True}, {"done": False}]
        g = self._run(dn, ["10", "20", "30"])
        self.assertNotIn("leg_km", dn[0])            # у ① плеча нет
        self.assertEqual(dn[1]["leg_km"], 123.4)     # у ② — от ① до ②
        self.assertNotIn("leg_km", dn[2])            # непройденная — не наше дело
        self.assertEqual(g.call_count, 1)
        self.assertEqual(g.call_args.kwargs.get("kind"), "leg")   # общий долгий кеш плеч

    def test_skips_empty_and_truck_points(self):
        dn = [{"done": True}, {"done": True}, {"done": True}]
        trk = lambda s, units, unit: {"lat": 1.0, "lng": 1.0, "target_is_truck": s == "20"}
        self._run(dn, ["10", "20", ""], resolver=trk)
        self.assertNotIn("leg_km", dn[1])            # встреча с траком
        self.assertNotIn("leg_km", dn[2])            # пустая точка

    def test_error_means_no_km(self):
        def boom(s, units, unit):
            raise ValueError("нет")
        dn = [{"done": True}, {"done": True}]
        self._run(dn, ["10", "20"], resolver=boom)
        self.assertNotIn("leg_km", dn[1])

    def test_client_shows_km(self):
        self.assertIn("done_leg_km", read("static", "done-marks.js"))
        s = read("static", "app.js")
        self.assertIn("done-km done-km-n", s)
        self.assertIn("done-km-n", read("static", "style.css"))


if __name__ == "__main__":
    unittest.main()
