"""v3.125: идущая стоянка по GPS от 6 ч — суточный отдых уже идёт, даже если тахограф отстаёт (OI-1781)."""
import unittest

from fetat.domain.tacho import calc_plan, calc_seed, gps_shift, tacho_eta

H = 3600.0
NOW = 1_800_000_000.0


def segs(stand_h):
    return [{"k": "route", "s": NOW - (stand_h + 10) * H, "e": NOW - stand_h * H, "m": 800_000},
            {"k": "stop", "s": NOW - stand_h * H, "e": NOW, "m": 0}]


def tacho(g):
    return {"drivers": [{"current_state": "AVAILABLE", "now": {}, "today": {"driving_remaining": 11.5 * H},
                         "week": {"driving_remaining": 56 * H, "9h_rest_shortening_remaining": 3}}],
            "team": True, "gps": g}


class GpsStandRest(unittest.TestCase):
    def test_stand_reported(self):
        self.assertAlmostEqual(gps_shift(segs(7.5), NOW)["stand"], 7.5 * H, delta=1)

    def test_seed_waits_rest_end(self):
        seed = calc_seed(tacho(gps_shift(segs(7.5), NOW)), NOW)
        self.assertTrue(seed["resting"])
        self.assertEqual(seed["shift_h"], 1.5)
        self.assertEqual(seed["left_h"], 18)

    def test_short_stand_is_not_rest(self):
        self.assertFalse(calc_seed(tacho(gps_shift(segs(2), NOW)), NOW)["resting"])

    def test_eta_after_rest(self):
        sim = tacho_eta(tacho(gps_shift(segs(7.5), NOW)), 800, now_ts=NOW)
        self.assertEqual(sim["stops"][0]["kind"], "daily")
        self.assertAlmostEqual(sim["stops"][0]["end"], NOW + 1.5 * H, delta=1)

    def test_seed_stand_h(self):
        self.assertEqual(calc_seed(tacho(gps_shift(segs(7.5), NOW)), NOW)["stand_h"], 7.5)

    def test_calc_shift_plus_stand_is_fresh(self):
        base = {"dist": 500, "team": True, "leftH": 3, "rest": 9, "nowMs": NOW * 1000, "shiftStartMs": (NOW - 19 * H) * 1000}
        old = calc_plan(dict(base, shiftH=1.5))                  # стоянка неизвестна — остаток 3 ч, старая смена
        new = calc_plan(dict(base, shiftH=1.5, standH=7.5))      # 7,5 + 1,5 = 9 ч отдыха — свежий день 18 ч
        self.assertLess(new["eta"], old["eta"])
        self.assertFalse(any(e["k"] == "r" for e in new["ev"]))


if __name__ == "__main__":
    unittest.main()
