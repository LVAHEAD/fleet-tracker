"""Откреплённая Карта Флота (/map-window): страница, зеркало состояния, окно карты."""
import unittest
from pathlib import Path

from tests import A

ROOT = Path(__file__).resolve().parent.parent


def src(name):
    return (ROOT / "static" / name).read_text(encoding="utf-8")


class MapWindowTest(unittest.TestCase):
    def test_page(self):
        r = A.app.test_client().get("/map-window")
        self.assertEqual(r.status_code, 200)
        html = r.get_data(as_text=True)
        for s in ("map-core.js", "map-window.js", "MAP_DISP_KEY", "IS_MAP_WINDOW"):
            self.assertIn(s, html)

    def test_main_page_loads_mirror(self):
        self.assertIn("map-mirror.js", (ROOT / "templates" / "index.html").read_text(encoding="utf-8"))

    def test_mirror_source(self):
        s = src("map-mirror.js")
        for w in ("updateMarker", "updateTargetMarker", "updateTrailerLink", "drawRoute", "renderRows", "fleet-map-win", "fleet-map-win-pos"):
            self.assertIn(w, s)

    def test_window_source(self):
        s = src("map-window.js")
        for w in ("fleet-map-win", "onGoogleMapsReady", "rowPassesFilterWith", "location.reload"):
            self.assertIn(w, s)


if __name__ == "__main__":
    unittest.main()
