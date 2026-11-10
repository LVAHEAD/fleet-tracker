"""Тахо-ETA (EU 561/2006 в упрощении проекта). Числа — снимок поведения v3.39 (одна логика с калькулятором:
чистые отдыхи, соло 9 ч, неделя — только отметка); было v2.03:
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
        # v3.39: соло 9 ч в день, отдых чистый 9 ч (сокращения есть), без +1 ч запаса
        r = A.tacho_eta(A.FRESH_SOLO_TACHO, 1500, now_ts=NOW)
        self.assertAlmostEqual((r["eta_ts"] - NOW) / H, 40.9286, places=3)
        self.assertEqual(kinds(r), [("break", 0.75), ("daily", 9.0), ("break", 0.75), ("daily", 9.0)])

    def test_team(self):
        # экипаж: без перерывов, суточный 9 ч — чистый (v3.39: без +1 ч запаса)
        r = A.tacho_eta(team_tacho(), 1500, now_ts=NOW)
        self.assertTrue(r["team"])
        self.assertAlmostEqual((r["eta_ts"] - NOW) / H, 30.4286, places=3)
        self.assertEqual(kinds(r), [("daily", 9.0)])

    def test_night_shift_window(self):
        # v3.39: смена с 20:00 (Берлин) заходит в ночь — окно 11 ч: 9 ч вождения + перерыв укладываются
        start = datetime(2026, 10, 5, 18, 0, tzinfo=timezone.utc).timestamp()      # 20:00 Берлин
        self.assertEqual((A.shift_window_end(start) - start) / H, 11)
        # с 08:00 — до полуночи 16 ч, но не больше 15
        start = datetime(2026, 10, 5, 6, 0, tzinfo=timezone.utc).timestamp()
        self.assertEqual((A.shift_window_end(start) - start) / H, 15)
        # с 14:00 — до полуночи 10 ч, ночь не обойти — 11 ч от начала
        start = datetime(2026, 10, 5, 12, 0, tzinfo=timezone.utc).timestamp()
        self.assertEqual((A.shift_window_end(start) - start) / H, 11)
        # с 02:00 — ночная, 11 ч; экипаж — всегда 21 ч
        start = datetime(2026, 10, 5, 0, 0, tzinfo=timezone.utc).timestamp()
        self.assertEqual((A.shift_window_end(start) - start) / H, 11)
        self.assertEqual((A.shift_window_end(start, team=True) - start) / H, 21)

    def test_week_only_mark(self):
        # v3.39: неделя кончилась — отметка, ETA не сдвигаем
        t = copy.deepcopy(A.FRESH_SOLO_TACHO)
        t["drivers"][0]["week"]["driving_remaining"] = 5 * H
        r = A.tacho_eta(t, 1500, now_ts=NOW)
        self.assertTrue(r["week"]["hit"])
        self.assertAlmostEqual((r["eta_ts"] - NOW) / H, 40.9286, places=3)


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


class WeeklyCompensationTests(unittest.TestCase):
    """v3.289: компенсация сокращённого недельного отдыха (ст. 8(6) 561/2006)."""
    T0 = datetime(2026, 10, 5, tzinfo=timezone.utc).timestamp()     # пн
    FROM = T0 - 3 * 86400

    def rest(self, start_h, hours):
        return {"start": self.T0 + start_h * H, "end": self.T0 + (start_h + hours) * H, "src": ["ddd"]}

    def comp(self, rests, now_h):
        return A.weekly_compensation({"rests": rests, "from": self.FROM}, self.T0 + now_h * H)

    def test_compensation_only_one_block(self):
        red = self.rest(10, 36)                                     # недобор 9 ч
        # два отдыха с излишком по 5 ч над 11 ч: суммой (10 ч) долг не гасится — нужен один кусок
        r = self.comp([red, self.rest(200, 16), self.rest(250, 16)], 300)
        self.assertEqual((r[0]["status"], round(r[0]["left"] / H)), ("open", 9))

    def test_reduced_open_then_closed_by_long_daily(self):
        red = self.rest(10, 36)                                     # недобор 9 ч
        r = self.comp([red], 100)
        self.assertEqual((r[0]["status"], round(r[0]["left"] / H)), ("open", 9))
        r = self.comp([red, self.rest(200, 20)], 300)               # суточный 20 ч: излишек над 11 ч = 9 ч
        self.assertEqual(r[0]["status"], "ok")

    def test_weekly_45_surplus_and_short_daily_do_not_close(self):
        red = self.rest(10, 36)
        self.assertEqual(self.comp([red, self.rest(200, 9)], 300)[0]["status"], "open")        # 9 ч — излишка нет
        self.assertEqual(self.comp([red, self.rest(200, 54)], 300)[0]["status"], "ok")         # 54 − 45 = 9 ч

    def test_overdue_after_third_week_and_late_rest_ignored(self):
        red = self.rest(10, 36)                                     # неделя пн 05.10 → срок пн 02.11 00:00
        late = self.rest(28 * 24 + 5, 24)                           # после срока — не считается
        r = self.comp([red, late], 28 * 24 + 40)
        self.assertEqual(r[-1]["status"], "overdue")
        self.assertEqual(r[-1]["deadline"], self.T0 + 28 * 86400)

    def test_big_daily_in_same_week_is_not_weekly(self):
        """OI-4311 08.11: 32,3 ч и через 5 ч ещё 26,4 ч в одной неделе — недельный только длинный, второй — «большая 9-ка»."""
        b, c = self.rest(10, 32.3), self.rest(10 + 32.3 + 5.65, 26.4)
        rests = [b, c]
        self.assertEqual(A.designate_weekly(rests, self.FROM), [b])
        r = self.comp(rests, 120)
        self.assertEqual(len(r), 1)                                  # долг один — у 32,3 ч
        self.assertEqual(r[0]["status"], "ok")                       # излишек «большой 9-ки» над 11 ч (15,4 ч) его закрывает


if __name__ == "__main__":
    unittest.main()
