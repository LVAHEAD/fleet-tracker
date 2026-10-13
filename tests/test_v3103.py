"""v3.103: подсказка автообновления — время последнего пересчёта."""
import os
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class AutoTipTest(unittest.TestCase):
    def test_tip_shows_last_update(self):
        with open(os.path.join(ROOT, "static/app.js"), encoding="utf-8") as f:
            js = f.read()
        self.assertIn("function updateAutoTip()", js)
        self.assertIn("Последнее обновление: ", js)
        self.assertIn("lastCalcAt = Date.now(); updateAutoTip();", js)


if __name__ == "__main__":
    unittest.main()
