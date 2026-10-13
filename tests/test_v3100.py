"""v3.100: сортировка — пустой TimeSlot открытой точки берёт TimeSlot следующих точек."""
import os
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class SlotKeyFallbackTest(unittest.TestCase):
    def test_slot_key_uses_next_filled_point(self):
        with open(os.path.join(ROOT, "static/fleet-sort-filter.js"), encoding="utf-8") as f:
            js = f.read()
        self.assertIn("while (j < n - 1 && !String((pointOf(row, j) || {}).delivery || \"\").trim()) j++;", js)
        self.assertIn("const p = pointOf(row, j);", js)


if __name__ == "__main__":
    unittest.main()
