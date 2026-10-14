"""Калькулятор ⏱: сдвиг выезда за конец окна старой смены не должен ставить лишний отдых в момент выезда
(NU-8704, 14.10: машина встала на ночную 9-ку, диспетчер сдвигает выезд на её конец)."""
import datetime as dt
import unittest

from fetat.domain.tacho import calc_plan

NOW = dt.datetime(2026, 10, 14, 20, 13, tzinfo=dt.timezone.utc).timestamp()   # 22:13 Берлин
START = NOW - 10.1 * 3600                                                      # смена с ~12:05 Берлин


def run(**kw):
    p = dict(dist=1655, team=False, rest=9, shorts=2, wkLeft=39.25, nowMs=NOW * 1000, ext=[], extras={}, shifts={})
    p.update(kw)
    return calc_plan(p)


def first_rest_start(r):
    return next((e["t0"] for e in r["ev"] if e["k"] == "r"), None)


class CalcShiftWindow(unittest.TestCase):
    def test_no_shift_keeps_old_window(self):
        # без сдвига окно старой смены живо: остаток 1:15 → отдых через 1:15 (как было)
        r = run(shiftH=0, leftH=1.25, shiftStartMs=START * 1000)
        self.assertAlmostEqual(first_rest_start(r), 1.25, places=2)

    def test_shift_past_window_has_no_phantom_rest(self):
        r = run(shiftH=7.75, leftH=9, shiftStartMs=START * 1000)
        self.assertGreater(first_rest_start(r), 9)                 # первый отдых — после девяти часов езды, не в момент выезда
        self.assertEqual(r["eta"], run(shiftH=7.75, leftH=9, shiftStartMs=None)["eta"])   # как без начала смены

    def test_shift_inside_window_unchanged(self):
        a = run(shiftH=1, leftH=1.25, shiftStartMs=START * 1000)
        b = run(shiftH=1, leftH=1.25, shiftStartMs=None)
        self.assertNotEqual(a["eta"], b["eta"])                    # окно старой смены всё ещё действует


if __name__ == "__main__":
    unittest.main()
