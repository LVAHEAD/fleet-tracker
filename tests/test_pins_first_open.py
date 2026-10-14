"""Карта ⏱ при KM = 0 (машина уже на точке): маркеры рисуем у первой НЕпройденной точки, а не только у ① (OI-1781: ① пройдена, машина на ②)."""
import os
import unittest

from tests import ROOT


class PinsFirstOpenTest(unittest.TestCase):
    def test_pins_condition(self):
        with open(os.path.join(ROOT, "static", "app.js"), encoding="utf-8") as f:
            js = f.read()
        self.assertIn("const pins = km === 0 && at === first && pinPos", js)
        self.assertNotIn("km === 0 && at === 0", js)
        self.assertLess(js.index("const first = c.ecAt || 0;"), js.index("const pins = km === 0"))


if __name__ == "__main__":
    unittest.main()
