"""v3.327: отдых «без карты» у одиночки обрезается по поездкам трака (OI-7556: «75:55 на недельном», а трак ехал)."""
import unittest
from unittest import mock

from fetat.domain import tacho as T

H = 3600


class RestMovingTest(unittest.TestCase):
    def test_clip_cuts_nocard_rest(self):
        r = [{"start": 0, "end": 100 * H, "src": ["can", "unkn"]}]
        out = T.clip_rests_by_moving(r, [(30 * H, 55 * H), (60 * H, 61 * H)])
        self.assertEqual([(x["start"], x["end"]) for x in out], [(0, 30 * H), (55 * H, 60 * H), (61 * H, 100 * H)])
        self.assertTrue(all(x["clipped"] for x in out))

    def test_card_rest_untouched(self):
        r = [{"start": 0, "end": 100 * H, "src": ["ddd", "can"]}]
        self.assertEqual(T.clip_rests_by_moving(r, [(30 * H, 55 * H)]), r)

    def test_no_overlap_untouched(self):
        r = [{"start": 0, "end": 10 * H, "src": ["can"]}]
        self.assertEqual(T.clip_rests_by_moving(r, [(20 * H, 30 * H)]), r)

    def test_weekly_status_drops_fake_45(self):
        # отдых «12.11 09:38 → сейчас» без карты, трак ехал посередине: недельного (от 24 ч) не остаётся
        now = 1000 * H
        hist = {"from": 0, "cards": [], "rests": [{"start": 100 * H, "end": now, "src": ["can"]}]}
        with mock.patch.object(T, "get_driver_rests", return_value=(hist, None)):
            w, _ = T.weekly_status("d", now, moving=[(120 * H, 990 * H)])
            self.assertTrue(w.get("error"))                 # от 24 ч отдыха нет
            self.assertEqual(w["resting_sec"], 10 * H)      # стоит с конца поездки
            w2, _ = T.weekly_status("d", now)               # без moving — как раньше: идёт недельный
            self.assertTrue(w2["ongoing"])


if __name__ == "__main__":
    unittest.main()
