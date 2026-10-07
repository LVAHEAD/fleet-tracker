"""v3.49: проездные точки (Svinesund Border) — ✓ по треку без стоянки ≥ 15 мин."""
import time
import unittest

from tests import A
from tests.test_v329 import SVINESUND_ZONE, _obj

NOW = time.time()
H = 3600


class TransitDoneTest(unittest.TestCase):
    def setUp(self):
        self._p, self._s, self._o, self._r = A.recent_passes, A.recent_stops, A.mapon_objects, A.resolve_fleet_target
        A.resolve_fleet_target = lambda t, units, unit=None: {"lat": 59.11189, "lng": 11.26705}
        A.mapon_objects = lambda: [_obj(SVINESUND_ZONE)]
        A.recent_stops = lambda uid: []

    def tearDown(self):
        A.recent_passes, A.recent_stops, A.mapon_objects, A.resolve_fleet_target = self._p, self._s, self._o, self._r

    def test_is_transit(self):
        self.assertTrue(A.is_transit("Svinesund Border"))
        self.assertTrue(A.is_transit("Svinesund Grense"))
        self.assertFalse(A.is_transit("Bama Nyland"))

    def test_done_by_track_in_zone(self):
        A.recent_passes = lambda uid: [{"end": NOW - 5 * H, "pts": [(59.2, 11.3), (59.1040, 11.2660), (59.0, 11.2)]}]
        unit = {"unit_id": 1, "lat": 59.40, "lng": 10.90}
        r = A.points_done(["Svinesund Border"], [None], unit, [])
        self.assertTrue(r[0]["done"])
        self.assertEqual(r[0]["zone"], "SVINESUND Border")

    def test_other_point_not_transit(self):
        # обычная точка (без Border) — по стоянкам как раньше: трек не считается
        A.recent_passes = lambda uid: [{"end": NOW - 5 * H, "pts": [(59.1040, 11.2660)]}]
        unit = {"unit_id": 1, "lat": 59.40, "lng": 10.90}
        self.assertFalse(A.points_done(["Bama Nyland"], [None], unit, [])[0]["done"])

    def test_no_pass_not_done(self):
        A.recent_passes = lambda uid: [{"end": NOW - 5 * H, "pts": [(58.0, 10.0)]}]
        unit = {"unit_id": 1, "lat": 59.40, "lng": 10.90}
        self.assertFalse(A.points_done(["Svinesund Border"], [None], unit, [])[0]["done"])
