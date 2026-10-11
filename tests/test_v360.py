"""v3.60: калькулятор — подпись источника наверху, статусы From / To выводятся в неё же."""
import os
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return f.read()


class CalcTopLineTest(unittest.TestCase):
    def test_source_caption_is_above_from_to(self):
        js = read("static/eta-calc.js")
        self.assertLess(js.index('class="ec-src"'), js.index('class="ec-sec ec-ft"'))
        self.assertNotIn("Откуда — куда", js)

    def test_status_goes_to_source_line(self):
        js = read("static/eta-calc.js")
        self.assertIn("st.ftMsg = t ?", js)
        self.assertNotIn('$(".ec-ftst")', js)


if __name__ == "__main__":
    unittest.main()
