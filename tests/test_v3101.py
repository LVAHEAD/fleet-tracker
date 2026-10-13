"""v3.101: плашка машины на карте Флота — вторая строка с таргетом текущей точки."""
import os
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return f.read()


class BadgeTargetTest(unittest.TestCase):
    def test_badge_second_line_wired(self):
        js = _read("static/map-core.js")
        self.assertIn("function badgeTargetText(row)", js)
        self.assertIn("(Math.trunc(parseFloat(v) * 1000) / 1000).toFixed(3)", js)
        self.assertIn("const tgtTxt = tgt ? `<span class=\"mk-tgt\">", js)
        self.assertIn("a.km, a.trailer, a.tgt);", js)
        self.assertIn("badgeTargetText(row)); }", _read("static/app.js"))

    def test_css_second_line_does_not_widen_badge(self):
        css = _read("static/style.css")
        self.assertIn(".mk-tgt { display: block; width: 0; min-width: 100%;", css)


if __name__ == "__main__":
    unittest.main()
