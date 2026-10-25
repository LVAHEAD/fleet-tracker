"""v3.210: авто-✓ и запомненная ✓ у точки i > 0 — только когда в трипе уже есть пройденная точка (иначе проезд прошлого груза)."""
import unittest
from unittest import mock

from fetat.domain import points
from fetat.domain.points import points_done

UNIT = {"lat": 55.0, "lng": 20.0, "unit_id": 1}
AUTO = {}        # текст точки -> ts авто-✓ (или None)


def fake_auto(tstr, t, lat, lng, unit, stops_box, floor):
    return AUTO.get(tstr), None, None


def run(pts, manual=None, seen=None):
    with mock.patch.object(points, "resolve_fleet_target", return_value={"lat": 1.0, "lng": 2.0}), \
         mock.patch.object(points, "target_badge_info", return_value=(None, None)), \
         mock.patch.object(points, "_country_at", return_value="NO"), \
         mock.patch.object(points, "_manual_done_stop", return_value=None), \
         mock.patch.object(points, "_auto_done", side_effect=fake_auto):
        return points_done(pts, manual or [None] * len(pts), UNIT, {}, seen)


class OrderRule(unittest.TestCase):
    def setUp(self):
        AUTO.clear()

    def test_next_point_not_done_while_trip_not_started(self):     # OS-2602: ② Svinesund не берёт проезд прошлого груза
        AUTO.update({"B": 1000.0})
        r = run(["A", "B", "C"])
        self.assertFalse(r[1]["done"])
        self.assertTrue(r[1].get("gated"))

    def test_skipped_point_closed_by_next(self):               # OI-3041 / v3.29: ① ✓, ② без стоянки, ③ поймана — ② «по ③»
        AUTO.update({"A": 1000.0, "C": 3000.0})
        r = run(["A", "B", "C"])
        self.assertTrue(r[0]["done"] and r[2]["done"])
        self.assertTrue(r[1]["done"] and r[1].get("by") == 2)

    def test_next_point_done_after_previous(self):
        AUTO.update({"A": 1000.0, "B": 2000.0})
        r = run(["A", "B", "C"])
        self.assertTrue(r[0]["done"] and r[1]["done"])
        self.assertFalse(r[2]["done"])

    def test_seen_ignored_while_trip_not_started(self):
        r = run(["A", "B"], seen=[None, "22/10 18:41"])
        self.assertFalse(r[1]["done"])
        self.assertTrue(r[1].get("gated"))

    def test_seen_kept_when_trip_started(self):
        AUTO.update({"A": 1000.0})
        r = run(["A", "B"], seen=[None, "22/10 18:41"])
        self.assertTrue(r[1]["done"] and r[1].get("kept"))

    def test_manual_third_frees_earlier_points(self):          # ручная ✓ на ③: ① ② по порядку соблюдены
        AUTO.update({"B": 2000.0})
        r = run(["A", "B", "C"], manual=[None, None, True])
        self.assertTrue(r[2]["done"])
        self.assertTrue(r[1]["done"] and r[1]["at"])           # у ② своё авто-время
        self.assertTrue(r[0]["done"])                          # ① — по правилу v3.29

    def test_manual_second_then_third_auto(self):
        AUTO.update({"C": 3000.0})
        r = run(["A", "B", "C"], manual=[None, True, None])
        self.assertTrue(r[0]["done"] and r[1]["done"] and r[2]["done"])

    def test_manual_false_blocks_next_auto(self):
        AUTO.update({"B": 2000.0})
        r = run(["A", "B"], manual=[False, None])
        self.assertFalse(r[0]["done"])
        self.assertFalse(r[1]["done"])


if __name__ == "__main__":
    unittest.main()
