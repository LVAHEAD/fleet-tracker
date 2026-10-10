"""v3.57: приезд на точку хранится рядом с отъездом (done_arr) и возвращается с авто-✓."""
import unittest

from fetat.domain.points import points_done


class PointsDoneArrivalTest(unittest.TestCase):
    def test_kept_point_returns_arrival(self):
        out = points_done([None], [None], {}, [], seen=["08/10 21:26"], seen_arr=["08/10 15:37"])
        self.assertTrue(out[0]["done"])
        self.assertEqual(out[0]["at"], "08/10 21:26")
        self.assertEqual(out[0]["arr"], "08/10 15:37")

    def test_no_arrival_known_is_none(self):
        out = points_done([None], [None], {}, [], seen=["08/10 21:26"])
        self.assertEqual(out[0]["at"], "08/10 21:26")
        self.assertIsNone(out[0]["arr"])

    def test_manual_point_has_no_arrival(self):
        out = points_done([None], [True], {}, [], seen=[None], seen_arr=["08/10 15:37"])
        self.assertTrue(out[0]["done"])
        self.assertIsNone(out[0].get("arr"))


if __name__ == "__main__":
    unittest.main()
