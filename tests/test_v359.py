"""v3.59: ручки отдыха в таблице по дням — тот же обработчик, что на шкале."""
import os
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return f.read()


class RestDaysDragTest(unittest.TestCase):
    def test_day_rows_have_handles_and_length(self):
        js = read("static/eta-calc.js")
        self.assertIn('data-len="${len}"', js)
        self.assertIn('[$(".ec-strip"), $(".ec-days")].forEach(bindDrag)', js)

    def test_day_row_is_not_clipped(self):
        css = read("static/eta-calc.css")
        self.assertIn(".ec-day .ec-hdl", css)
        self.assertNotIn("border-radius: 3px; overflow: hidden", css)


if __name__ == "__main__":
    unittest.main()
