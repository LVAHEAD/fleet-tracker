import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _src(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as f:
        return f.read()


class FleetV381Test(unittest.TestCase):
    """v3.81: ждущие «✓ Завершён» наверх, TimeSlot зачёркнут, ETA — время отъезда, единая высота подстрок."""

    def test_pending_complete_goes_up_and_passes_filter(self):
        js = _src("static", "fleet-sort-filter.js")
        self.assertIn("function awaitsComplete(row)", js)
        self.assertIn("computeBaseOrder()", js)
        self.assertRegex(js, r"if \(awaitsComplete\(row\)\) return true;")

    def test_done_marks(self):
        js = _src("static", "done-marks.js")
        self.assertIn('"row-blink-done"', js)
        self.assertIn('.xd-input[data-k=', js)
        self.assertNotIn("${arr} – ${at}", js)      # в ячейке ETA только время отъезда
        self.assertIn("Трак стоял", js)             # подсказка «приехал – уехал» осталась

    def test_css(self):
        css = _src("static", "style.css")
        self.assertIn("--stop-h: 22px", css)
        self.assertRegex(css, r"\.delivery-input\.pt-done, \.xd-input\.pt-done \{[^}]*line-through")
        self.assertIn("rowBlinkDone", css)
        # жёлтое мигание не перебивает тревоги
        self.assertRegex(css, r"tr\.row-blink-done:not\(\.row-blink\):not\(\.row-blink-fuel\):not\(\.row-blink-rf\)")


if __name__ == "__main__":
    unittest.main()
