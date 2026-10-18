"""v3.157: причина запроса «машина → точка» в Google — считается и показывается в /gusage."""
import pathlib
import time
import unittest

from fetat.clients import google_routes as gr
from fetat.services import gusage

ROOT = pathlib.Path(__file__).resolve().parent.parent


class MissReasonTest(unittest.TestCase):
    def setUp(self):
        gr._along_cache.clear()

    def test_reasons(self):
        now = time.time()
        k = ("truck", 1.0, 2.0, "")
        self.assertEqual(gr._truck_miss_reason(k, False, now), "new")
        self.assertEqual(gr._truck_miss_reason(k, True, now), "noline")
        gr._along_cache[k] = {"at": now - gr.ALONG_ROUTE_TTL - 5, "pts": [], "cum": [], "scale": 1}
        self.assertEqual(gr._truck_miss_reason(k, True, now), "old")
        gr._along_cache[k]["at"] = now - 60
        self.assertEqual(gr._truck_miss_reason(k, True, now), "off")

    def test_stat_counts_miss_key(self):
        old_on, old_buf, old_flush = gr._shared_on, dict(gr._stats_buf), dict(gr._stats_flush)
        gr._shared_on = lambda: True
        gr._stats_buf.clear()
        gr._stats_flush.update(at=time.time(), day=gr._quota_day())   # сброс в Firestore не нужен
        try:
            gr._route_stat("calls", "truck", miss="off")
            self.assertEqual(gr._stats_buf.get("c_miss_off"), 1)
            gr._route_stat("cache_hits", "truck", miss="off")           # у попаданий в кеш причины нет
            self.assertEqual(gr._stats_buf.get("c_miss_off"), 1)
        finally:
            gr._shared_on = old_on
            gr._stats_buf.clear(); gr._stats_buf.update(old_buf)
            gr._stats_flush.clear(); gr._stats_flush.update(old_flush)

    def test_gusage_shows_miss(self):
        self.assertIn("off", gusage.MISS)
        text = gusage.log_text([{"day": "2026-10-17", "label": "17.10", "c": 5, "h": 9, "g": 5,
                                 "why": {}, "kind": {"truck": 5}, "user": {}, "miss": {"off": 3, "old": 2}, "hours": []}])
        self.assertIn("причина запроса", text)
        self.assertIn("сход с линии", text)
        page = (ROOT / "static" / "gusage-page.js").read_text(encoding="utf-8")
        self.assertIn("d.miss", page)


if __name__ == "__main__":
    unittest.main()
