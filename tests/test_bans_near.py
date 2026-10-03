"""v3.12: запреты «впритык» и время по странам (фид и страны маршрута подменены)."""
import unittest
from unittest import mock

from tests import A  # noqa: F401
from fetat.domain import bans as bn

FEED = {"now": [], "days": [{"bans": [
    {"cc": "FR", "date": "2026-10-03", "from": "22:00", "until": "22:00", "type": "Sunday", "full": True},
]}]}


class BansNearTest(unittest.TestCase):
    def setUp(self):
        for name, val in (("bans_cached", FEED), ("route_countries", [("FR", 0, 700), ("BE", 700, 800)])):
            p = mock.patch.object(bn, name, return_value=val)
            p.start()
            self.addCleanup(p.stop)
        self.ban_ts = bn._ban_window_utc(FEED["days"][0]["bans"][0])[0]

    def run_from(self, exit_before_ban_sec):
        t0 = self.ban_ts - 700 / bn.TACHO_SPEED_KMH * 3600 - exit_before_ban_sec
        det = {}
        hits, st = bn.bans_on_route("x", 800, None, t0, detail=det)
        return hits, det

    def test_near(self):
        hits, det = self.run_from(20 * 60)        # выезд из FR за 20 мин до 22:00
        self.assertEqual(hits, [])
        self.assertEqual([n["cc"] for n in det["near"]], ["FR"])
        self.assertEqual([c["cc"] for c in det["countries"]], ["FR", "BE"])
        txt = bn.bans_near_text(det["near"], lambda ts: "03/10 21:40")
        self.assertIn("впритык", txt[0])

    def test_hit_not_near(self):
        hits, det = self.run_from(-20 * 60)       # в 22:00 ещё во Франции
        self.assertEqual([h["cc"] for h in hits], ["FR"])
        self.assertEqual(det["near"], [])

    def test_far_enough(self):
        hits, det = self.run_from(3 * 3600)       # выезд за 3 ч — не впритык
        self.assertEqual(hits, [])
        self.assertEqual(det["near"], [])


if __name__ == "__main__":
    unittest.main()
