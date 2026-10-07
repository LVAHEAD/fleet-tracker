"""v3.15: соло / экипаж, остаток недели, прогноз по нашему темпу."""
import unittest

from fetat.clients.google_routes import hourly_from_stats, own_forecast
from fetat.domain.tacho import crew_mode, tacho_eta, week_left_info


def _drv(**week):
    return {"current_state": "DRIVING", "now": {"driving": 0}, "today": {"driving_remaining": 4 * 3600,
            "shift_remaining": 10 * 3600}, "week": week}


class CrewTest(unittest.TestCase):
    def test_two_cards_team(self):
        self.assertEqual(crew_mode({"drivers": [_drv(), _drv()]})[:2], (True, "tacho"))

    def test_one_card_solo(self):
        self.assertEqual(crew_mode({"drivers": [_drv()]}, None, {"d": 9 * 3600})[:2], (False, "tacho"))

    def test_history_team(self):
        self.assertEqual(crew_mode({"drivers": [_drv()]}, None, {"d": 14 * 3600})[:2], (True, "hist"))

    def test_manual_wins(self):
        self.assertEqual(crew_mode({"drivers": [_drv(), _drv()]}, "solo")[:2], (False, "manual"))
        self.assertEqual(crew_mode({"drivers": [_drv()]}, "team")[:2], (True, "manual"))

    def test_forced_team_one_card_gets_second_driver(self):
        t = {"drivers": [_drv()], "team": True}
        solo = tacho_eta({"drivers": [_drv()]}, 700, now_ts=1_790_000_000)
        team = tacho_eta(t, 700, now_ts=1_790_000_000)
        self.assertTrue(team["team"])
        self.assertLess(team["eta_ts"], solo["eta_ts"])

    def test_week_left(self):
        w = week_left_info({"drivers": [_drv(driving_remaining=23 * 3600 + 40 * 60, driving=20 * 3600)]})
        self.assertEqual(int(w["left"]), 23 * 3600 + 40 * 60)
        self.assertEqual(w["limit"], "90 ч за 2 недели")
        w = week_left_info({"drivers": [_drv(driving_remaining=36 * 3600, driving=20 * 3600)]})
        self.assertEqual(w["limit"], "56 ч")
        self.assertIsNone(week_left_info({"drivers": [_drv()]}))


class ForecastTest(unittest.TestCase):
    def test_hourly_and_forecast(self):
        st = {"c": 13, "h": 200, "c_hr_18": 6, "h_hr_18": 90, "c_hr_19": 7, "h_hr_19": 110}
        self.assertEqual(hourly_from_stats(st), {"18": {"c": 6, "h": 90}, "19": {"c": 7, "h": 110}})
        f = own_forecast(st, 31, now_hour="19")
        self.assertEqual((f["hours"], f["calls"]), (2, 13))
        self.assertEqual(f["forecast"], round(6.5 * 24 * 31))
        self.assertIsNone(own_forecast({"c": 5}, 31))


if __name__ == "__main__":
    unittest.main()


class NoWeekTest(unittest.TestCase):
    def test_no_week_skips_weekly_stop(self):
        t = {"drivers": [_drv(driving_remaining=2 * 3600)], "team": False}
        with_w = tacho_eta(t, 1500, now_ts=1_790_000_000)
        no_w = tacho_eta(t, 1500, now_ts=1_790_000_000, no_week=True)
        self.assertTrue(with_w["week"]["hit"])
        self.assertFalse(no_w["week"]["hit"])
        self.assertEqual(no_w["eta_ts"], with_w["eta_ts"])   # v3.39: неделя — только отметка, ETA тот же

    def test_short_last_warning(self):
        from fetat.services.fleet_calc import _week_short_last
        r = {"crew": "solo", "week_left_sec": 5 * 3600, "dist_km": 100, "extra": [{"dist_km": 700}]}
        _week_short_last(r)
        self.assertEqual(r["week_short_last"]["short"], 5 * 3600)
        r = {"crew": "solo", "week_left_sec": 20 * 3600, "dist_km": 100, "extra": [{"dist_km": 700}]}
        _week_short_last(r)
        self.assertNotIn("week_short_last", r)
