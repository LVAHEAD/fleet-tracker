"""v3.126: статистика рефрешей, список эндпоинтов, ↻ сначала видимые строки."""
import re
import unittest

from tests import A


class V3126(unittest.TestCase):
    def setUp(self):
        self.c = A.app.test_client()

    def test_refresh_stat_roundtrip(self):
        r = self.c.post("/api/refresh-stat", json={"kind": "manual", "rows": 20, "rows_visible": 6, "sec_visible": 2.4,
                                                    "sec_full": 7.9, "slowest_unit": "OI-1781", "slowest_sec": 3.1})
        self.assertTrue(r.get_json()["ok"])
        d = self.c.get("/api/refresh-stat?json=1").get_json()
        self.assertEqual(d["log"][-1]["vis"], 6)
        self.assertIn("manual", d["avg"])
        self.assertEqual(self.c.get("/api/refresh-stat").status_code, 200)

    def test_refresh_stat_garbage(self):
        r = self.c.post("/api/refresh-stat", json={"kind": "x", "rows": "abc", "sec_full": -5})
        self.assertTrue(r.get_json()["ok"])
        self.assertEqual(self.c.get("/api/refresh-stat?json=1").get_json()["log"][-1]["kind"], "manual")

    def test_every_route_described(self):
        eps = self.c.get("/api/endpoints").get_json()["endpoints"]
        self.assertTrue(eps)
        self.assertEqual([e["path"] for e in eps if not e["doc"]], [])
        self.assertIn("/api/warm", [e["path"] for e in eps])

    def test_calc_all_rows_visible_first(self):
        js = open("static/app.js", encoding="utf-8").read()
        self.assertIn("rowPassesFilter", js[js.index("function calcAllRows"):js.index("// ---------- v1.59: автообновление")])
        self.assertIn("/api/refresh-stat", js)


if __name__ == "__main__":
    unittest.main()
