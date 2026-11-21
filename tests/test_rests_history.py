"""v3.355: длинная история отдыхов водителя — склейка и хранилище."""
import unittest

from fetat.domain import rests_history as H
from fetat.store.rests_store import RESTS_STORE

D = 86400
NOW = 1_800_000_000


def R(s, e, src=("ddd",)):
    return {"start": NOW + s, "end": NOW + e, "src": list(src)}


class MergeTest(unittest.TestCase):
    def test_same_start_takes_later_end(self):
        m = H.merge_rests([R(-10 * D, -9 * D)], [R(-10 * D, -8 * D)], NOW)
        self.assertEqual(len(m), 1)
        self.assertEqual(m[0]["end"], NOW - 8 * D)

    def test_clipped_piece_replaced_by_full(self):
        stored = [R(-40 * D, -38 * D)]
        fresh = [R(-39 * D, -37 * D)]          # перекрытие — один отдых от начала первого до конца второго
        m = H.merge_rests(stored, fresh, NOW)
        self.assertEqual((m[0]["start"], m[0]["end"]), (NOW - 40 * D, NOW - 37 * D))

    def test_adjacent_within_15_min_joined(self):
        m = H.merge_rests([R(-5 * D, -4 * D)], [R(-4 * D + 600, -3 * D, ("can",))], NOW)
        self.assertEqual(len(m), 1)
        self.assertEqual(m[0]["src"], ["can", "ddd"])

    def test_gap_over_15_min_kept_apart(self):
        m = H.merge_rests([R(-5 * D, -4 * D)], [R(-4 * D + 1200, -3 * D)], NOW)
        self.assertEqual(len(m), 2)

    def test_older_than_keep_dropped(self):
        m = H.merge_rests([R(-70 * D, -69 * D), R(-5 * D, -4 * D)], [], NOW)
        self.assertEqual(len(m), 1)


class StoreTest(unittest.TestCase):
    def setUp(self):
        RESTS_STORE.docs.clear()
        H._saved_at.clear()

    def hist(self, rests):
        return {"rests": rests, "cards": [], "from": NOW - 28 * D}

    def test_remember_skips_ongoing_and_clipped(self):
        h = self.hist([R(-28 * D, -27 * D),          # начало окна — обрезан
                       R(-10 * D, -9 * D),            # завершён
                       R(-3600, 0)])                  # идёт сейчас
        H.remember("d1", h, NOW)
        rec = RESTS_STORE.get("d1")
        self.assertEqual([(r["start"], r["end"]) for r in rec["rests"]], [(NOW - 10 * D, NOW - 9 * D)])
        self.assertEqual(rec["since"], NOW - 28 * D)

    def test_long_history_reaches_beyond_window(self):
        RESTS_STORE.put("d2", {"rests": [R(-40 * D, -38 * D)], "since": NOW - 45 * D})
        lh = H.long_history("d2", self.hist([R(-10 * D, -9 * D)]), NOW)
        self.assertEqual(len(lh["rests"]), 2)
        self.assertEqual(lh["from"], NOW - 45 * D)
        self.assertEqual(lh["window_from"], NOW - 28 * D)

    def test_long_history_depth_capped_at_56(self):
        RESTS_STORE.put("d3", {"rests": [R(-59 * D, -58 * D)], "since": NOW - 60 * D})
        lh = H.long_history("d3", self.hist([]), NOW)
        self.assertEqual(lh["from"], NOW - 56 * D)
        self.assertEqual(lh["rests"], [])

    def test_no_store_equals_window(self):
        lh = H.long_history("none", self.hist([R(-10 * D, -9 * D)]), NOW)
        self.assertEqual(lh["from"], NOW - 28 * D)
        self.assertEqual(len(lh["rests"]), 1)

    def test_remember_throttled(self):
        H.remember("d4", self.hist([R(-10 * D, -9 * D)]), NOW)
        H.remember("d4", self.hist([R(-10 * D, -9 * D), R(-5 * D, -4 * D)]), NOW + 60)
        self.assertEqual(len(RESTS_STORE.get("d4")["rests"]), 1)


if __name__ == "__main__":
    unittest.main()
