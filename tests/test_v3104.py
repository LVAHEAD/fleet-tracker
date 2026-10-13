"""v3.104: смена по GPS — тахограф Mapon отстаёт (карты не считаны, ddd не скачан), остаток дня и начало смены
берём из GPS-истории (route/list). Случаи — OI-3044 (экипаж, «чистые» счётчики), паром, обычный тахограф."""
import time
import unittest

from tests import A

H = 3600


def seg(k, a, b, m=0.0):
    """Отрезок от a до b часов (от условного нуля), m — метры."""
    return {"k": k, "s": a * H, "e": b * H, "m": m}


# OI-3044, 13.10 (часы от 00:00): стоянка до 11:05, манёвр 139 м, стоянка до 11:47, дальше езда со стоянками
OI3044 = [
    seg("stop", 0, 11.083), seg("route", 11.083, 11.0889, 139), seg("stop", 11.0889, 11.783),
    seg("route", 11.783, 12.5, 53100), seg("stop", 12.5, 12.95),
    seg("route", 12.95, 15.3, 185200), seg("stop", 15.3, 15.47),
    seg("route", 15.47, 16.95, 114300), seg("stop", 16.95, 19.85),
]


class GpsShiftTest(unittest.TestCase):
    def test_shift_start_after_long_stop_with_shuffle(self):
        g = A.gps_shift(OI3044, 20.0 * H)
        self.assertAlmostEqual(g["start"], 11.783 * H, delta=2)          # манёвр 139 м стоянку не прерывает
        want = (12.5 - 11.783 + 15.3 - 12.95 + 16.95 - 15.47) * H
        self.assertAlmostEqual(g["driven"], want, delta=2)

    def test_driving_now_counts_to_now(self):
        segs = OI3044 + [seg("route", 19.85, 23.0, 150000)]
        g = A.gps_shift(segs, 22.0 * H)                                  # идущая поездка — до «сейчас»
        self.assertAlmostEqual(g["driven"], (0.717 + 2.35 + 1.48 + 2.15) * H, delta=10)

    def test_ferry_is_not_driving(self):
        # 3 ч на 100 км (33 км/ч) — паром: не вождение
        segs = [seg("stop", 0, 10), seg("route", 10, 12, 150000), seg("route", 12, 15, 100000), seg("stop", 15, 16)]
        g = A.gps_shift(segs, 16.0 * H)
        self.assertAlmostEqual(g["start"], 10 * H, delta=1)
        self.assertAlmostEqual(g["driven"], 2 * H, delta=1)

    def test_overnight_ferry_counts_as_rest(self):
        segs = [seg("route", 0, 3, 250000), seg("route", 3, 15, 380000), seg("route", 15, 17, 150000)]
        g = A.gps_shift(segs, 17.0 * H)                                  # 12 ч на 380 км — паром-отдых
        self.assertAlmostEqual(g["start"], 15 * H, delta=1)
        self.assertAlmostEqual(g["driven"], 2 * H, delta=1)

    def test_no_long_stop_unknown(self):
        self.assertIsNone(A.gps_shift([seg("stop", 0, 5), seg("route", 5, 8, 200000)], 8 * H))
        self.assertIsNone(A.gps_shift([], 8 * H))


def blank_team(n=1):
    """Счётчики «чистые»: вождения Mapon не записал."""
    return {"drivers": [{"current_state": "AVAILABLE", "now": {"rest": 0, "driving": 0},
                         "today": {"driving_remaining": 9 * H, "shift_remaining": 13 * H},
                         "week": {"driving_remaining": 56 * H, "9h_rest_shortening_remaining": 3}}
                        for _ in range(n)], "team": True}


class GpsAdjustTest(unittest.TestCase):
    def test_blind_tacho_uses_gps(self):
        t = dict(blank_team(), gps={"start": 100.0, "driven": 5.67 * H})
        left, fix = A.gps_adjust(t, 18 * H, 18 * H)
        self.assertAlmostEqual(left, (18 - 5.67) * H, delta=1)
        self.assertEqual(fix["tacho"], 0.0)

    def test_small_difference_keeps_tacho(self):
        t = dict(blank_team(), gps={"start": 100.0, "driven": 0.8 * H})
        left, fix = A.gps_adjust(t, 18 * H, 18 * H)
        self.assertEqual(left, 18 * H)
        self.assertIsNone(fix)

    def test_tacho_ahead_of_gps_keeps_tacho(self):
        t = dict(blank_team(), gps={"start": 100.0, "driven": 3 * H})
        left, fix = A.gps_adjust(t, 8 * H, 18 * H)                       # по тахографу уже 10 ч, по GPS 3 ч
        self.assertEqual(left, 8 * H)
        self.assertIsNone(fix)

    def test_no_gps_no_change(self):
        left, fix = A.gps_adjust(blank_team(), 18 * H, 18 * H)
        self.assertEqual((left, fix), (18 * H, None))


class EtaWithGpsTest(unittest.TestCase):
    def test_team_window_from_real_shift_start(self):
        now = 2_000_000_000.0
        start = now - 11.42 * H                                          # смена открыта 11:25 назад
        t = dict(blank_team(), gps={"start": start, "driven": 5.67 * H})
        sim = A.tacho_eta(t, 3450, now_ts=now)
        first = sim["stops"][0]
        self.assertEqual(first["kind"], "daily")
        self.assertAlmostEqual(first["start"], start + 21 * H, delta=1)  # отдых — к концу окна смены, не через 18 ч
        self.assertAlmostEqual(sim["gps_fix"]["driven"], 5.67 * H, delta=1)
        sim0 = A.tacho_eta(blank_team(), 3450, now_ts=now)               # без GPS — «чистый лист»
        self.assertAlmostEqual(sim0["stops"][0]["start"], now + 18 * H, delta=1)
        self.assertIsNone(sim0["gps_fix"])
        self.assertGreater(sim["stops"][0]["start"], 0)
        self.assertLess(sim["stops"][0]["start"], sim0["stops"][0]["start"])

    def test_fresh_after_long_rest_ignores_gps(self):
        now = 2_000_000_000.0
        t = dict(blank_team(), gps={"start": now - 1 * H, "driven": 6 * H})
        t["drivers"][0].update(current_state="REST", now={"rest": 12 * H, "driving": 0})
        sim = A.tacho_eta(t, 500, now_ts=now)
        self.assertIsNone(sim["gps_fix"])

    def test_calc_seed_left_by_gps(self):
        t = dict(blank_team(), gps={"start": 100.0, "driven": 5.67 * H})
        s = A.calc_seed(t)
        self.assertTrue(s["team"])
        self.assertEqual(s["left_h"], 12.25)
        self.assertTrue(s["gps_fix"])
        self.assertNotIn("gps_fix", A.calc_seed(blank_team()))

    def test_summary_mentions_gps(self):
        now = 2_000_000_000.0
        t = dict(blank_team(), gps={"start": now - 11 * H, "driven": 5.67 * H})
        sim = A.tacho_eta(t, 3450, now_ts=now)
        txt = "\n".join(A.tacho_summary(t, sim))
        self.assertIn("отстаёт от GPS", txt)
        self.assertIn("(по GPS)", txt)


class RowGpsTest(unittest.TestCase):
    def setUp(self):
        self._saved = {k: getattr(A, k) for k in ("get_tacho", "unit_driving_days", "unit_driver_names",
                                                  "unit_route_segments")}
        A.unit_driving_days = lambda uid: {"d1": 6 * H}
        A.unit_driver_names = lambda uid: []

    def tearDown(self):
        for k, v in self._saved.items():
            setattr(A, k, v)

    def test_row_gets_gps_fix(self):
        now = time.time()
        segs = [{"k": "stop", "s": now - 30 * H, "e": now - 11 * H, "m": 0},
                {"k": "route", "s": now - 11 * H, "e": now - 5 * H, "m": 480000},
                {"k": "stop", "s": now - 5 * H, "e": now - 4 * H, "m": 0},
                {"k": "route", "s": now - 4 * H, "e": now, "m": 320000}]
        A.get_tacho = lambda uid: (blank_team(), None)
        A.unit_route_segments = lambda uid: segs
        res = {"dist_km": 3450.0}
        A._add_tacho(res, {"unit_id": 7}, False, "team")
        self.assertAlmostEqual(res["tacho_gps_fix"]["driven"], 10 * H, delta=5)
        self.assertEqual(res["calc_seed"]["left_h"], 8.0)

    def test_gps_error_does_not_break_row(self):
        def boom(uid):
            raise RuntimeError("Mapon down")
        A.get_tacho = lambda uid: (blank_team(), None)
        A.unit_route_segments = boom
        res = {"dist_km": 900.0}
        A._add_tacho(res, {"unit_id": 7}, False, "team")
        self.assertNotIn("tacho_gps_fix", res)
        self.assertEqual(res["calc_seed"]["left_h"], 18.0)
        self.assertIn("eta_tacho", res)


if __name__ == "__main__":
    unittest.main()
