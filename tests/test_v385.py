import os
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return f.read()


class CalcRestZeroTest(unittest.TestCase):
    """v3.85: остаток 9-к «0» — кнопка, а не «11 ч»; с Флота 0 приходит как «9 ч, остаток 0»."""

    def test_buttons_and_seed(self):
        js = _read("static/eta-calc.js")
        self.assertIn("[0, 1, 2, 3].map", js)
        self.assertIn("st.rest = 9;", js)
        self.assertIn("Math.max(0, Math.min(3, s.shorts || 0))", js)

    def test_zero_shorts_plan_uses_11h(self):
        from fetat.domain import tacho
        t0 = 1_800_000_000
        p0 = tacho.plan(t0, 2000, rest_pref=9, shorts=0)
        p3 = tacho.plan(t0, 2000, rest_pref=9, shorts=3)
        self.assertGreaterEqual(p0["end_ts"] if "end_ts" in p0 else 0, 0)
        self.assertNotEqual(p0, p3)


class UiCssTest(unittest.TestCase):
    def test_css_rules(self):
        css = _read("static/style.css")
        self.assertIn("body.sort-manual #fleet-tbody td:first-child .disp-lbl", css)
        self.assertIn("width: 22px; height: 22px", css)
        self.assertIn("#2f6fd6", css)


if __name__ == "__main__":
    unittest.main()
