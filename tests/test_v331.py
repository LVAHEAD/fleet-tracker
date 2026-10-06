"""v3.31: данные машины для ⏱ ETA-калькулятора по клику на строку Флота (calc_seed)."""
import unittest

from tests import A

H = 3600


def solo(state="DRIVING", rest=0, day_left=5 * H, shorts=2, week_left=30 * H):
    return {"drivers": [{
        "current_state": state, "now": {"rest": rest, "driving": 0},
        "today": {"driving_remaining": day_left, "shift_remaining": 8 * H},
        "week": {"driving_remaining": week_left, "9h_rest_shortening_remaining": shorts,
                 "10h_driving_extensions_remaining": 0}}]}


class CalcSeedTest(unittest.TestCase):
    def test_solo_driving(self):
        s = A.calc_seed(solo())
        self.assertFalse(s["team"])
        self.assertEqual(s["left_h"], 5.0)
        self.assertEqual(s["shift_h"], 0.0)
        self.assertEqual(s["shorts"], 2)
        self.assertEqual(s["week_left_h"], 30.0)
        self.assertFalse(s["resting"])

    def test_solo_rested_fresh_day(self):
        s = A.calc_seed(solo(state="REST", rest=12 * H, day_left=0))
        self.assertEqual(s["left_h"], 9.0)
        self.assertEqual(s["shift_h"], 0.0)

    def test_solo_on_daily_rest_waits_clean(self):
        # 9-ка (сокращения есть), отдыхает 5 ч — выезд через 4 ч чистых, 9-к стало на одну меньше
        s = A.calc_seed(solo(state="REST", rest=5 * H, day_left=0, shorts=2))
        self.assertTrue(s["resting"])
        self.assertEqual(s["shift_h"], 4.0)
        self.assertEqual(s["left_h"], 9.0)
        self.assertEqual(s["shorts"], 1)

    def test_solo_no_shorts_rest_11(self):
        s = A.calc_seed(solo(state="REST", rest=5 * H, day_left=0, shorts=0))
        self.assertEqual(s["shift_h"], 6.0)
        self.assertEqual(s["shorts"], 0)

    def test_team_sum_capped(self):
        t = {"drivers": [
            {"current_state": "DRIVING", "now": {}, "today": {"driving_remaining": 7 * H}, "week": {}},
            {"current_state": "REST", "now": {}, "today": {"driving_remaining": 9 * H}, "week": {}}]}
        s = A.calc_seed(t)
        self.assertTrue(s["team"])
        self.assertEqual(s["left_h"], 16.0)
        self.assertNotIn("week_left_h", s)

    def test_quarter_hours(self):
        s = A.calc_seed(solo(day_left=4 * H + 50 * 60))
        self.assertEqual(s["left_h"], 4.75)


class RowSeedTest(unittest.TestCase):
    def setUp(self):
        self._saved = {k: getattr(A, k) for k in ("get_tacho", "unit_driving_days", "unit_driver_names")}
        A.unit_driving_days = lambda uid: {"d1": 6 * H}
        A.unit_driver_names = lambda uid: []

    def tearDown(self):
        for k, v in self._saved.items():
            setattr(A, k, v)

    def test_row_has_seed(self):
        A.get_tacho = lambda uid: (solo(), None)
        res = {"dist_km": 900.0}
        A._add_tacho(res, {"unit_id": 7}, False, None)
        self.assertEqual(res["calc_seed"]["left_h"], 5.0)

    def test_no_card_driving_unknown(self):
        A.get_tacho = lambda uid: (None, "нет данных водителя")
        res = {"dist_km": 900.0}
        A._add_tacho(res, {"unit_id": 7, "state": {"name": "driving", "duration": H}}, False, None)
        self.assertTrue(res["calc_seed"]["unknown"])
        self.assertFalse(res["calc_seed"]["team"])

    def test_no_card_rested_fresh(self):
        A.get_tacho = lambda uid: (None, "нет данных водителя")
        res = {"dist_km": 900.0}
        A._add_tacho(res, {"unit_id": 7, "state": {"name": "standing", "duration": 12 * H}}, False, None)
        s = res["calc_seed"]
        self.assertTrue(s["nocard"])
        self.assertEqual(s["left_h"], 9.0)
        self.assertNotIn("week_left_h", s)


if __name__ == "__main__":
    unittest.main()
