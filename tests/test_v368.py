import io
import unittest
from contextlib import redirect_stdout


class WarnAndGeoLimitTest(unittest.TestCase):
    """v3.68: warn не спамит; кеш геокодера ограничен."""

    def test_warn_once(self):
        from fetat.utils import log

        log._seen.clear()
        buf = io.StringIO()
        with redirect_stdout(buf):
            log.warn("x:1", ValueError("a"))
            log.warn("x:1", ValueError("b"))
            log.warn("x:2", KeyError("c"))
        lines = [l for l in buf.getvalue().splitlines() if l]
        self.assertEqual(len(lines), 2)
        self.assertIn("ValueError", lines[0])

    def test_geo_cache_limit(self):
        from unittest import mock

        from fetat.clients import geocode

        geocode._geo_cache.clear()
        with mock.patch.object(geocode, "GEO_CACHE_MAX", 8), \
                mock.patch.object(geocode, "_geo_nominatim", side_effect=lambda q: {"lat": 1, "lng": 2}):
            for i in range(20):
                geocode.geocode(f"town {i}")
        self.assertLessEqual(len(geocode._geo_cache), 8)
        geocode._geo_cache.clear()


if __name__ == "__main__":
    unittest.main()
