import os
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class UnitTrackTest(unittest.TestCase):
    """/api/unit-track: трек трака из Mapon route/list."""

    def test_time_parse(self):
        from fetat.api.mapon import _track_ts
        self.assertEqual(_track_ts("2026-11-08", 0), 1794096000.0)
        self.assertEqual(_track_ts("2026-11-08 13:30", 0), 1794096000.0 + 13.5 * 3600)
        self.assertEqual(_track_ts("", 5), 5)
        with self.assertRaises(ValueError):
            _track_ts("вчера", 0)

    def test_endpoint_registered(self):
        from app import app
        rules = {r.rule for r in app.url_map.iter_rules()}
        self.assertIn("/api/unit-track", rules)
