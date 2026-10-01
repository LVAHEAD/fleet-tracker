"""Тахо-ETA (EU 561/2006 в упрощении проекта). Числа — снимок поведения v2.03:
если тест падает после переезда, значит логика изменилась, а не только место кода."""
import copy
import unittest
from datetime import datetime, timezone

from tests import A

H = 3600
NOW = datetime(2026, 10, 5, 6, 0, tzinfo=timezone.utc).timestamp()   # пн 06:00 UTC


def kinds(r):
    return [(s["kind"], round((s["end"] - s["start"]) / H, 2)) for s in r["stops"]]


def team_tacho():
    t = {"drivers": [copy.deepcopy(A.FRESH_SOLO_TACHO["drivers"][0]) for _ in range(2)]}
    for d in t["drivers"]:
        d["today"]["shift_remaining"] = 21 * H
    return t


class TachoEtaTest(unittest.TestCase):
    def test_speed_70(self):
        self.assertEqual(A.TACHO_SPEED_KMH, 70)

    def test_solo_one_day(self):
        # 630 км = 9 ч езды: 4:30 → перерыв 45 мин → 4:30
        r = A.tacho_eta(A.FRESH_SOLO_TACHO, 630, now_ts=NOW)
        self.assertFalse(r["team"])
        self.assertAlmostEqual((r["eta_ts"] - NOW) / H, 9.75, places=3)
        self.assertEqual(kinds(r), [("break", 0.75)])

    def test_solo_two_days(self):
        r = A.tacho_eta(A.FRESH_SOLO_TACHO, 1500, now_ts=NOW)
        self.assertAlmostEqual((r["eta_ts"] - NOW) / H, 46.4286, places=3)
        self.assertEqual(kinds(r), [("break", 0.75), ("break", 0.75), ("daily", 12.0),
                                    ("break", 0.75), ("break", 0.75), ("daily", 10.0)])

    def test_team(self):
        # экипаж: без перерывов, суточный 9 ч + 1 ч запаса
        r = A.tacho_eta(team_tacho(), 1500, now_ts=NOW)
        self.assertTrue(r["team"])
        self.assertAlmostEqual((r["eta_ts"] - NOW) / H, 31.4286, places=3)
        self.assertEqual(kinds(r), [("daily", 10.0)])


class BrandAndNightBanTest(unittest.TestCase):
    def test_brand(self):
        self.assertEqual(A.unit_brand({"make": "MAN"}), "MAN")
        self.assertEqual(A.unit_brand({"vin": "WMA06XZZ"}), "MAN")
        self.assertEqual(A.unit_brand({"vin": "XLRAE47"}), "DAF")
        self.assertEqual(A.unit_brand({"vehicle_title": "Volvo FH"}), "VOLVO")

    def test_at_night_only_man_trucks(self):
        self.assertTrue(A.needs_at_night_ban({"vehicle_title": "MAN TGX"}))
        self.assertFalse(A.needs_at_night_ban({"make": "DAF"}))
        self.assertFalse(A.needs_at_night_ban({"make": "MAN", "type": "trailer"}))

    def test_at_night_window_22_05_vienna(self):
        # 05.10.2026, Вена UTC+2: 22:00–05:00 = 20:00–03:00 UTC
        b, (start, end) = A._at_night_bans(NOW, 86400)[("2026-10-05", "night")]
        self.assertEqual((start - NOW) / H, 14.0)
        self.assertEqual((end - NOW) / H, 21.0)


class FreightValueTest(unittest.TestCase):
    def test_surcharge_and_outsourced(self):
        self.assertEqual(A.parse_freight_value("2650+400"), (2650.0, False))
        self.assertEqual(A.parse_freight_value("6729/5500"), (6729.0, True))
        self.assertEqual(A.parse_freight_value("1800"), (1800.0, False))


class PointsDoneTest(unittest.TestCase):
    def setUp(self):
        self._orig = A.recent_stops

    def tearDown(self):
        A.recent_stops = self._orig

    def test_auto_done_by_stop_history(self):
        # стоял у точки, уехал дальше 1 км → точка ✓ (без Mapon: история подменена)
        A.recent_stops = lambda unit_id: [{"lat": 56.9001, "lng": 24.1001, "start": NOW - 5 * H,
                                           "end": NOW - 4 * H, "now": False}]
        unit = {"unit_id": 1, "lat": 57.5, "lng": 24.5}
        res = A.points_done(["56.9, 24.1", "57.0, 24.2"], [None, None], unit, [])
        self.assertTrue(res[0]["done"])
        self.assertTrue(res[0]["auto"])
        self.assertFalse(res[1]["done"])

    def test_manual_wins(self):
        A.recent_stops = lambda unit_id: []
        unit = {"unit_id": 1, "lat": 57.5, "lng": 24.5}
        res = A.points_done(["56.9, 24.1"], [True], unit, [])
        self.assertTrue(res[0]["done"])


if __name__ == "__main__":
    unittest.main()
