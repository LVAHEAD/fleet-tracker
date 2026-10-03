"""fetat.utils: чистые помощники без сети."""
import unittest
from datetime import datetime, timezone

from fetat.utils import geo, timefmt, text


class GeoTest(unittest.TestCase):
    def test_haversine_riga_tallinn(self):
        self.assertAlmostEqual(geo.haversine_km(56.9496, 24.1052, 59.4370, 24.7536), 279.5, delta=1.5)

    def test_polyline_roundtrip(self):
        pts = [(56.94643, 24.03196), (54.5008, 11.2158), (47.2692, 11.4041)]
        back = geo._decode_polyline(geo._encode_polyline(pts))
        for (a, b), (c, d) in zip(pts, back):
            self.assertAlmostEqual(a, c, places=5)
            self.assertAlmostEqual(b, d, places=5)

    def test_parse_gps(self):
        self.assertEqual(geo.parse_gps("склад 42.84974, 13.72342 рампа 3"), (42.84974, 13.72342))
        self.assertIsNone(geo.parse_gps("Riga"))

    def test_point_in_poly(self):
        sq = [(0, 0), (0, 1), (1, 1), (1, 0)]
        self.assertTrue(geo._point_in_poly(0.5, 0.5, sq))
        self.assertFalse(geo._point_in_poly(1.5, 0.5, sq))


class TimeTest(unittest.TestCase):
    def test_round_to_15(self):
        dt = datetime(2026, 10, 3, 10, 7, 29, tzinfo=timezone.utc)
        self.assertEqual(timefmt.round_to_15min(dt).minute, 0)
        self.assertEqual(timefmt.round_to_15min(dt.replace(minute=8)).minute, 15)

    def test_hm_and_duration(self):
        self.assertEqual(timefmt._hm(9 * 3600 + 5 * 60), "9:05")
        self.assertEqual(timefmt.format_duration(90000), "1д 1ч 0м")


class TextTest(unittest.TestCase):
    def test_normalize(self):
        self.assertEqual(text.normalize("OI-1778 "), "oi1778")
        self.assertEqual(text._hkey("Full address"), "fulladdress")


if __name__ == "__main__":
    unittest.main()
