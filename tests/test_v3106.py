"""v3.106: окно смены экипажа — по shift_remaining Mapon / GPS, а не «от сейчас»; калькулятор получает начало смены."""
import unittest

from fetat.domain.tacho import calc_plan, calc_seed, tacho_eta

NOW = 1_800_000_000.0
H = 3600.0


def drv(sr, left=9 * H, state="WORK"):
    return {"current_state": state, "now": {"driving": 0, "rest": 0},
            "today": {"driving_remaining": left, "shift_remaining": sr},
            "week": {"driving_remaining": 40 * H, "9h_rest_shortening_remaining": 2}}


def team_tacho(sr, gps=None):
    t = {"drivers": [drv(sr), drv(sr)], "team": True}
    if gps:
        t["gps"] = gps
    return t


class TeamWindowTest(unittest.TestCase):
    def test_window_from_mapon_shift_remaining(self):
        # до конца окна 31 мин — отдых должен встать почти сразу, а не через 18 ч езды
        r = tacho_eta(team_tacho(31 * 60), 3000, now_ts=NOW)
        first = r["stops"][0]
        self.assertEqual(first["kind"], "daily")
        self.assertLess(first["start"] - NOW, 40 * 60)

    def test_window_from_gps_without_sr(self):
        t = team_tacho(None, gps={"start": NOW - 20.5 * H, "driven": 5 * H})
        for d in t["drivers"]:
            d["today"].pop("shift_remaining")
        r = tacho_eta(t, 3000, now_ts=NOW)
        self.assertLess(r["stops"][0]["start"] - NOW, 40 * 60)

    def test_no_data_window_from_now(self):
        t = team_tacho(None)
        for d in t["drivers"]:
            d["today"].pop("shift_remaining")
        r = tacho_eta(t, 3000, now_ts=NOW)
        self.assertGreater(r["stops"][0]["start"] - NOW, 10 * H)

    def test_seed_used_and_calc(self):
        seed = calc_seed(team_tacho(31 * 60), now_ts=NOW)
        self.assertAlmostEqual(seed["used_h"], 20.48, places=1)
        self.assertEqual(seed["end_ts"] - seed["start_ts"], 21 * 3600)          # v3.107
        self.assertEqual(seed["shift_src"], "tacho")
        s2 = calc_seed(dict(team_tacho(None, gps={"start": NOW - 6.6 * H, "driven": 6.4 * H}), drivers=[drv(None)]), now_ts=NOW)
        self.assertEqual(s2["shift_src"], "gps")
        self.assertAlmostEqual(s2["driven_h"], 6.4)
        base = dict(nowMs=NOW * 1000, dist=3000, leftH=4, team=True, rest=9, shorts=0)
        a = calc_plan(base)
        b = calc_plan(dict(base, shiftStartMs=(NOW - 20.5 * H) * 1000))
        first = lambda r: next(e["t0"] for e in r["ev"] if e["k"] != "d")   # noqa: E731
        self.assertLess(first(b), first(a))


if __name__ == "__main__":
    unittest.main()


class GpsNoDistanceTest(unittest.TestCase):
    def test_ongoing_route_without_distance_is_driving(self):
        from fetat.domain.tacho import gps_shift
        segs = [{"k": "stop", "s": NOW - 20 * H, "e": NOW - 6 * H, "m": 0},
                {"k": "route", "s": NOW - 6 * H, "e": NOW - 2.75 * H, "m": 245_600},
                {"k": "route", "s": NOW - 2.75 * H, "e": NOW, "m": 0}]   # идущая поездка: distance нет
        g = gps_shift(segs, NOW)
        self.assertAlmostEqual(g["driven"] / H, 6.0, places=1)
