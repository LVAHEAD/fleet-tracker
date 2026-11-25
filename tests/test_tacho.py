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

    def test_weekly_after_47h54m_counts(self):
        """Hurchenko 23.11: после недельного 36 ч начался через 47 ч 54 мин — недельный (раньше отбрасывался порогом 48 ч)."""
        a, b = self.rest(10, 100), self.rest(10 + 100 + 47.9, 36)
        self.assertEqual(A.designate_weekly([a, b], self.FROM), [a, b])

    def test_weekly_after_20h_counts(self):
        """Duplevskii 23.11: 58 ч недельный, через 19 ч 56 мин 25 ч отдыха — недельный (Мапон: срок от его конца)."""
        a, b = self.rest(10, 58), self.rest(10 + 58 + 19.9, 25)
        self.assertEqual(A.designate_weekly([a, b], self.FROM), [a, b])

    def test_weekly_late_marks_start_after_six_days(self):
        """Putseika 24.11: недельный 11.11 начался через 6 сут 3 ч 54 мин после конца прошлого — опоздание 3 ч 54 мин."""
        a, b = self.rest(10, 32), self.rest(10 + 32 + 6 * 24 + 3.9, 57)
        late = A.weekly_late(A.designate_weekly([a, b], self.FROM))
        self.assertEqual(late[0], 0)
        self.assertAlmostEqual(late[1] / 3600, 3.9, places=1)

    def test_weekly_chain_six_days(self):
        """OS-8560 22.11: недельный — цепочкой «не позже 6 суток от конца прошлого»; 26 ч 08.11 — недельный, 24 ч 04.11 и 14.11 — «9-ка»."""
        h = 3600
        rs = [self.rest(10, 24), self.rest(10 + 24 + 5 * 24 + 19, 47), self.rest(10 + 24 + 5 * 24 + 19 + 47 + 6.5, 24),
              self.rest(10 + 24 + 5 * 24 + 19 + 47 + 4 * 24 - 0.5, 26), self.rest(10 + 24 + 5 * 24 + 19 + 47 + 4 * 24 + 26 + 5 * 24 - 6, 99)]
        got = A.designate_weekly(rs, self.FROM)
        self.assertEqual([r["end"] - r["start"] for r in got], [24 * h, 47 * h, 26 * h, 99 * h])


if __name__ == "__main__":
    unittest.main()


def test_shift_mapon_not_cut_by_night_rule():
    """v3.388: остаток смены по Mapon не режется ночным правилом аппы"""
    from fetat.domain.tacho import _shift_mapon
    d0 = {"today": {"shift_remaining": 13 * 3600}}
    p = {"ev": [], "win_left": 4 * 3600, "eta_ts": 1000.0}
    assert _shift_mapon({}, d0, False, False, [], p, 1000.0) == 13 * 3600
    p2 = {"ev": [{"k": "r"}], "win_left": 4 * 3600, "eta_ts": 1000.0}
    assert _shift_mapon({}, d0, False, False, [], p2, 1000.0) == 4 * 3600


def test_weekly_short_pause_not_glued():
    """v3.391: пауза 58 мин — не склейка, отдых непрерывный (Nizomov 08.11): второй отдых не недельный, опоздание видно"""
    from fetat.domain.tacho import designate_weekly, weekly_late
    H = 3600
    d = 86400
    r1 = {"start": 1 * d, "end": 1 * d + 166 * H}
    r2 = {"start": r1["end"] + 1 * H, "end": r1["end"] + 59 * H}
    r3 = {"start": r2["end"] + 5 * d + 23 * H, "end": r2["end"] + 5 * d + 47 * H}
    des = designate_weekly([r1, r2, r3], t0=0)
    assert r2 not in des and r1 in des
    assert any(weekly_late(des))


def test_weekly_gap_5h_is_not_pause():
    """v3.390: пауза 5:39 — не склейка; отдых после неё «большая 9ка», нарушение остаётся (OI-4311, Putseika)"""
    from fetat.domain.tacho import designate_weekly, weekly_late
    H = 3600
    d = 86400
    r1 = {"start": 1 * d, "end": 1 * d + 57 * H}
    r2 = {"start": r1["end"] + 5 * d + 17 * H, "end": r1["end"] + 5 * d + 17 * H + 32 * H}       # 24 ч+, вовремя
    r3 = {"start": r2["end"] + 5 * H + 40 * 60, "end": r2["end"] + 5 * H + 40 * 60 + 26 * H}   # 5:40 после — «большая 9ка»
    r4 = {"start": r2["end"] + 6 * d + 4 * H, "end": r2["end"] + 6 * d + 4 * H + 57 * H}        # позже 6 суток от конца r2
    des = designate_weekly([r1, r2, r3, r4], t0=0)
    late = weekly_late(des)
    assert r3 not in des and late[-1] > 0


def test_weekly_cadence_starts_after_base_idle():
    """v3.392: простой на Базе (166 ч) вне цепочки — 6 суток от конца следующего отдыха, нарушения нет (Nizomov, 11.11)"""
    from fetat.domain.tacho import designate_weekly, weekly_late
    H = 3600
    d = 86400
    r2 = {"start": 8 * d + 14 * H, "end": 11 * d + 1 * H}          # 58 ч, конец — выезд с базы
    r3 = {"start": 17 * d + 0 * H, "end": 18 * d + 1 * H}          # 24 ч+, в пределах 6 суток от выезда
    des = designate_weekly([r2, r3], t0=0)
    assert des[0] is r2 and not any(weekly_late(des))


def test_base_idle_needs_66h_and_base(monkeypatch):
    from fetat.api import mapon as M
    H = 3600
    base = (56.94643, 24.03196)
    monkeypatch.setattr("fetat.domain.addresses.base_point", lambda: (base[0], base[1], "Baza"))
    monkeypatch.setattr(M, "unit_stop_at", lambda uid, a, b: ({"lat": 56.9465, "lng": 24.032}, None))
    assert M._base_idle(1, {"start": 1000, "end": 1000 + 70 * H}) is True
    assert M._base_idle(1, {"start": 2000, "end": 2000 + 60 * H}) is False      # короче 66 ч
    monkeypatch.setattr(M, "unit_stop_at", lambda uid, a, b: ({"lat": 52.0, "lng": 5.0}, None))
    assert M._base_idle(1, {"start": 3000, "end": 3000 + 70 * H}) is False      # не на Базе
    pts = iter([(56.9465, 24.032), (56.912, 24.2518), (56.9465, 24.032)])       # Румбула 11 км — всё ещё район Базы
    monkeypatch.setattr(M, "unit_stop_at", lambda uid, a, b: (dict(zip(("lat", "lng"), next(pts))), None))
    assert M._base_idle(1, {"start": 5000, "end": 5000 + 70 * H}) is True
    pts = iter([(56.9465, 24.032), (54.67, 25.17), (56.9465, 24.032)])         # уезжал в Вильнюс — не простой
    assert M._base_idle(1, {"start": 6000, "end": 6000 + 70 * H}) is False
    monkeypatch.setattr(M, "unit_stop_at", lambda uid, a, b: (None, "нет"))
    assert M._base_idle(1, {"start": 4000, "end": 4000 + 70 * H}) is False      # нет данных — не простой
