"""v3.236: подсказка у открытой точки (holdHtml), done_hint в ответе строки."""
import os
import unittest

from tests import ROOT


def rd(*p):
    with open(os.path.join(ROOT, *p), encoding="utf-8") as f:
        return f.read()


class V3236(unittest.TestCase):
    def test_front(self):
        js = rd("static", "app.js")
        self.assertIn("function holdHtml(c, j)", js)
        self.assertIn("holdHtml(c, i + 1)", js)
        self.assertIn("hold: data.done_hint", js)
        self.assertIn(".hold-mark", rd("static", "style.css"))

    def test_server(self):
        self.assertIn('result["done_hint"]', rd("fetat", "services", "fleet_calc.py"))
        self.assertIn("stood_later", rd("fetat", "domain", "points.py"))


if __name__ == "__main__":
    unittest.main()
