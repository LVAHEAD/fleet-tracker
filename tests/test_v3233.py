"""v3.233: срок и тип недельного отдыха (24ка / 45ка) у ETA, история водителя 28 суток."""
import os
import unittest
from unittest import mock

from fetat.clients import mapon as cm
from fetat.domain import tacho as T
from tests import ROOT
from tests.test_v3104 import blank_team


def rd(*p):
    with open(os.path.join(ROOT, *p), encoding="utf-8") as f:
        return f.read()


def crew(mins, starts, ids=("a", "b")):
    t = blank_team(len(mins))
    for d, m, s, i in zip(t["drivers"], mins, starts, ids):
        w = d.setdefault("week", {})
        w["weekly_rest_min"], w["weekly_rest_start"], d["driver_id"] = m, s, i
    return t


class V3233(unittest.TestCase):
    def test_depth_28(self):
        self.assertEqual(cm.ACT_DAYS, 28)

    def test_info_mapon_only(self):
        with mock.patch.object(T, "weekly_status", return_value=(None, "нет данных")):
            r = T.weekly_rest_info(crew([86400], [1_800_000_000]))
        self.assertEqual((r["need"], r["mapon"], r["ddd"], r["unconfirmed"]), (86400, 1_800_000_000, None, True))

    def test_info_ddd_confirms(self):
        with mock.patch.object(T, "weekly_status", return_value=({"deadline": 1_800_000_600}, None)):
            r = T.weekly_rest_info(crew([162000], [1_800_000_000]))
        self.assertEqual((r["need"], r["ddd"], r["unconfirmed"]), (162000, 1_800_000_600, False))

    def test_info_can_only_differs(self):                      # OI-1780: Mapon 03.11, ddd 31.10
        with mock.patch.object(T, "weekly_status", return_value=({"deadline": 1_800_000_000 - 2 * 86400}, None)):
            r = T.weekly_rest_info(crew([86400], [1_800_000_000]))
        self.assertTrue(r["unconfirmed"])

    def test_info_none_without_fields(self):
        self.assertIsNone(T.weekly_rest_info(crew([None], [None])))

    def test_ddd_only_filter(self):
        rests = [{"start": 1_000_000, "end": 1_000_000 + 30 * 3600, "src": ["can"]},
                 {"start": 2_000_000, "end": 2_000_000 + 30 * 3600, "src": ["ddd"]}]
        hist = {"rests": rests, "from": 0}
        with mock.patch.object(T, "get_driver_rests", return_value=(hist, None)):
            allr, _ = T.weekly_status("x", now_ts=3_000_000)
            ddd, _ = T.weekly_status("x", now_ts=3_000_000, ddd_only=True)
        self.assertEqual(len(allr["weekly"]), 2)
        self.assertEqual(len(ddd["weekly"]), 1)

    def test_front(self):
        js = rd("static", "app.js")
        self.assertIn("weeklyChipHtml(c.weekly)", js)
        self.assertIn("weekly: data.weekly_rest", js)
        self.assertIn(".wk-rest", rd("static", "style.css"))


if __name__ == "__main__":
    unittest.main()


class V3233Rule45(unittest.TestCase):
    NOW = 1_793_000_000                       # чт 2026-10-29 ~ UTC

    def _wk(self):
        return T._next_monday_utc(self.NOW) - 7 * 86400

    def _info(self, rests, mapon_off, need=86400):
        ws = self._wk()
        t = crew([need], [T._next_monday_utc(self.NOW) + mapon_off])
        hist = {"rests": [{"start": ws + a, "end": ws + a + h * 3600, "src": ["ddd"]} for a, h in rests], "from": 0}
        with mock.patch.object(T, "weekly_status", return_value=(None, None)), \
                mock.patch.object(T, "get_driver_rests", return_value=(hist, None)):
            return T.weekly_rest_info(t, self.NOW)

    def test_reduced_this_week_deadline_next_week(self):
        r = self._info([(3600, 30)], 3600)
        self.assertTrue(r["rule45"])
        self.assertEqual((r["need"], r["need_mapon"]), (162000, 86400))

    def test_deadline_this_week_no_rule(self):
        r = self._info([(3600, 30)], -3600)
        self.assertNotIn("rule45", r)

    def test_full_rest_no_rule(self):
        r = self._info([(3600, 46)], 3600)
        self.assertNotIn("rule45", r)

    def test_already_45_no_rule(self):
        r = self._info([(3600, 30)], 3600, need=162000)
        self.assertNotIn("rule45", r)


class V3234Panel(unittest.TestCase):
    def test_panel_applies_rule45(self):
        t = crew([86400], [1_800_000_000])
        with mock.patch.object(T, "weekly_rest_info", return_value={"rule45": True, "need": 162000, "need_mapon": 86400}):
            p = T.tacho_panel(t)
        self.assertEqual((p["weekly_need"], p["weekly_rule45"], p["weekly_need_mapon"]), (162000, True, 86400))

    def test_panel_without_rule(self):
        t = crew([86400], [1_800_000_000])
        with mock.patch.object(T, "weekly_rest_info", return_value={"need": 86400}):
            p = T.tacho_panel(t)
        self.assertEqual((p["weekly_need"], p["weekly_rule45"]), (86400, False))

    def test_front_star(self):
        self.assertIn("weekly_rule45", rd("static", "tacho-pop.js"))
