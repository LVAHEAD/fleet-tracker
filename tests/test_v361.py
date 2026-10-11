"""v3.61: плашка кластера с номерами, попап Локатора на точке, зум 16 для машины, выравнивание панели Флота."""
import os
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return f.read()


class V361Test(unittest.TestCase):
    def test_cluster_plate_lines(self):
        js = read("static/overlap-spider.js")
        self.assertIn("function plateLines", js)
        self.assertIn('if (n >= 5) return ["+" + n];', js)

    def test_locator_point_popup_and_truck_zoom(self):
        js = read("static/locator.js")
        self.assertIn("function openPointInfo", js)
        self.assertIn("map.setZoom(d.is_truck ? 16 : 8);", js)
        self.assertIn("openPointInfo(d, resultMarker)", js)

    def test_toolbar_controls_one_height(self):
        css = read("static/style.css")
        self.assertIn("v3.61: верхняя панель Флота", css)


if __name__ == "__main__":
    unittest.main()
