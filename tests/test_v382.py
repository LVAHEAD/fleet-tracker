import time
import unittest
from unittest import mock


class SiteArrivalTest(unittest.TestCase):
    """v3.82: время приезда трака, стоящего на объекте точки (для ETA-ячейки)."""

    def setUp(self):
        from fetat.domain import points
        self.points = points
        self.unit = {"unit_id": 1, "lat": 55.0, "lng": 11.0, "state": {"duration": 3600}}

    def test_from_current_stop(self):
        st = [{"now": False, "start": 100, "end": 200, "lat": 55.0, "lng": 11.0},
              {"now": True, "start": 1_700_000_000, "end": 1_700_000_900, "lat": 55.001, "lng": 11.001}]
        with mock.patch.object(self.points, "recent_stops", return_value=st):
            r = self.points.site_arrival(self.unit)
        self.assertEqual(r, self.points.ts_west(1_700_000_000).strftime("%d/%m %H:%M"))

    def test_stale_stop_elsewhere_falls_back_to_duration(self):
        st = [{"now": True, "start": 1_700_000_000, "end": 1_700_000_900, "lat": 50.0, "lng": 5.0}]
        with mock.patch.object(self.points, "recent_stops", return_value=st):
            r = self.points.site_arrival(self.unit)
        want = self.points.ts_west(time.time() - 3600).strftime("%d/%m %H:%M")
        self.assertEqual(r, want)

    def test_no_data(self):
        with mock.patch.object(self.points, "recent_stops", return_value=[]):
            self.assertIsNone(self.points.site_arrival({"unit_id": 1, "lat": 1, "lng": 1, "state": {}}))


class FrontSourceTest(unittest.TestCase):
    def test_markers(self):
        import os
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        app = open(os.path.join(root, "static", "app.js"), encoding="utf-8").read()
        self.assertIn("function onSiteArr(row, data, k)", app)
        css = open(os.path.join(root, "static", "style.css"), encoding="utf-8").read()
        self.assertIn(".eta-arr.eta-arr-late", css)


if __name__ == "__main__":
    unittest.main()
