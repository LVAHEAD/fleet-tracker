"""История стоянок (v3.368): сбор, слияние, статистика по зоне / городу."""
import unittest
from datetime import datetime, timezone

from fetat.domain import stops_history as S
from fetat.store.stops_store import STOPS_STORE

NOW = datetime(2026, 11, 22, 12, 0, tzinfo=timezone.utc).timestamp()


def iso(ts):
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def stop(h_ago, hours, lat=41.39, lng=2.15, addr="Carrer X 1, 08040 Barcelona, Spain"):
    s = NOW - h_ago * 3600
    return {"type": "stop", "start": {"time": iso(s), "lat": lat, "lng": lng, "address": addr},
            "end": {"time": iso(s + hours * 3600)}}


class StopsHistoryTest(unittest.TestCase):
    def setUp(self):
        STOPS_STORE.docs.clear()

    def test_parse_keeps_finished_long_stops_and_glues_midnight(self):
        r = [stop(30, 1.0), stop(29, 5.0), stop(10, 0.5), {"type": "stop", "start": {"time": iso(NOW - 3600), "lat": 1, "lng": 1}, "end": {}}]
        got = S.parse_stops(r, NOW)
        self.assertEqual(len(got), 1)                       # 1 ч + 5 ч склеены; 30 мин — короткая; идущая — не берём
        self.assertEqual(got[0]["e"] - got[0]["s"], 6 * 3600)

    def test_collect_is_incremental_and_dedups(self):
        calls = []

        def rl(uid, frm, till, polyline=True):
            calls.append(frm)
            return [stop(50, 10), stop(20, 3)]
        S.collect_unit(7, NOW, rl)
        S.collect_unit(7, NOW + 3600, rl)
        self.assertEqual(len(STOPS_STORE.get(7)["stops"]), 2)       # повтор не плодит дубли
        self.assertGreater(calls[1], calls[0])                      # второй раз — только хвост

    def test_where_by_zone_and_city(self):
        S.collect_unit(1, NOW, lambda *a, **k: [stop(40, 9), stop(100, 11)])
        S.collect_unit(2, NOW, lambda *a, **k: [stop(40, 8, lat=48.85, lng=2.35, addr="Rue A, 75001 Paris, France")])
        code = STOPS_STORE.get(1)["stops"][0]["c"]
        r = S.where(code=code, now=NOW)
        self.assertEqual((r["stops"], r["units"]), (2, 1))
        self.assertEqual(r["top"][0]["n"], 2)                       # обе стоянки в одной ячейке ~300 м
        self.assertEqual(S.where(city="paris", now=NOW)["stops"], 1)
        self.assertEqual(S.where(city="paris", min_h=9, now=NOW)["stops"], 0)
        self.assertEqual(S.where(city="barcelona", days=2, now=NOW)["stops"], 1)   # окно 2 суток

    def test_one_unit_error_does_not_stop_collection(self):
        def rl(uid, *a, **k):
            if uid == 1:
                raise RuntimeError("Mapon")
            return [stop(40, 9)]
        r = S.collect_all([1, 2], NOW, rl, pause=0)
        self.assertEqual((r["errors"], r["units"]), (1, 2))
        self.assertEqual(len(STOPS_STORE.get(2)["stops"]), 1)


if __name__ == "__main__":
    unittest.main()
