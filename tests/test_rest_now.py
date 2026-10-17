"""v3.140: ⏱ «🌙 Встал на отдых» — выезд после конца отмеченного отдыха = свежий день (restEndMs)."""
import datetime as dt
import unittest

from fetat.domain.tacho import calc_plan

NOW = dt.datetime(2026, 10, 14, 20, 13, tzinfo=dt.timezone.utc).timestamp()
START = NOW - 10.1 * 3600


def run(**kw):
    p = dict(dist=1655, team=False, rest=9, shorts=2, wkLeft=39.25, nowMs=NOW * 1000, ext=[], extras={}, shifts={},
             shiftH=1, leftH=0.5, shiftStartMs=START * 1000)
    p.update(kw)
    return calc_plan(p)


def first_rest(r):
    return next((e["t0"] for e in r["ev"] if e["k"] == "r"), None)


class RestNow(unittest.TestCase):
    def test_without_flag_old_day_left(self):
        self.assertLess(first_rest(run()), 1.0)   # остаток 0:30 — отдых почти сразу после выезда

    def test_flag_gives_fresh_day(self):
        etd = run()["etd"]
        r = run(restEndMs=etd)                    # отдых кончается в момент выезда
        self.assertGreater(first_rest(r), 8.0)    # свежие 9 ч вождения (с перерывом) до следующего отдыха
        self.assertLess(r["eta"], run()["eta"])   # больше вождения до первого отдыха — приезд раньше

    def test_flag_in_future_keeps_old_day(self):
        etd = run()["etd"]
        self.assertLess(first_rest(run(restEndMs=etd + 3600 * 1000)), 1.0)   # выезд раньше конца отдыха — флаг не действует


if __name__ == "__main__":
    unittest.main()
