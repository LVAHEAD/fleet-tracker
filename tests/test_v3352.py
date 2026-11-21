"""v3.352: режим наблюдения ✓ по прицепу (fetat/domain/trailer_done.py) и попап «нет прицепа / даты ①» (static/trailer-link.js)."""
import os
import unittest

from fetat.domain.trailer_done import build_cmp, compare_done, gps_state

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NOW = 1_800_000_000.0


def iso(ts):
    from datetime import datetime, timezone
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class TrailerDoneTest(unittest.TestCase):
    def test_gps_state(self):
        self.assertEqual(gps_state(None), "none")
        self.assertEqual(gps_state({"lat": None, "lng": 1}), "none")
        self.assertEqual(gps_state({"lat": 1, "lng": 1, "last_update": iso(NOW - 3600)}, NOW), "ok")
        self.assertEqual(gps_state({"lat": 1, "lng": 1, "last_update": iso(NOW - 7 * 3600)}, NOW), "stale")
        self.assertEqual(gps_state({"lat": 1, "lng": 1}, NOW), "ok")                      # last_update не пришло — свежим
        self.assertEqual(gps_state({"lat": 1, "lng": 1, "last_update": "мусор"}, NOW), "ok")

    def test_compare_done(self):
        truck = [{"done": True, "manual": None}, {"done": False, "manual": None}, {"done": True, "manual": True},
                 {"done": True, "manual": None, "kept": True}, {"done": True, "manual": None}]
        trailer = [{"done": True}, {"done": True}, {"done": False}, {"done": False}, {"done": False}]
        self.assertEqual(compare_done(truck, trailer), [{"i": 1, "truck": False, "trailer": True},
                                                         {"i": 4, "truck": True, "trailer": False}])

    def test_build_cmp(self):
        self.assertEqual(build_cmp("none", [])["mode"], "truck_only")
        self.assertIn("нет GPS", build_cmp("none", [])["text"])
        self.assertIn("старше 6 ч", build_cmp("stale", [])["text"])
        same = build_cmp("ok", [], km=0.2)
        self.assertEqual(same["mode"], "compare")
        self.assertIn("совпадают", same["text"])
        diff = build_cmp("ok", [{"i": 0, "truck": True, "trailer": False}, {"i": 2, "truck": False, "trailer": True}], km=12)
        self.assertIn("12 км", diff["text"])
        self.assertIn("① — тягач был, прицеп нет", diff["text"])
        self.assertIn("③ — прицеп был, тягач нет", diff["text"])
        self.assertIn("запомнена", build_cmp("ok", [], kept=True)["text"])
        self.assertNotIn("12 км", build_cmp("ok", [], km=5)["text"])        # порог 5 км: ровно 5 — не расхождение


class WiringTest(unittest.TestCase):
    def read(self, *p):
        with open(os.path.join(ROOT, *p), encoding="utf8") as f:
            return f.read()

    def test_server_hook(self):
        s = self.read("fetat", "services", "fleet_calc.py")
        self.assertIn("_add_trailer_done(result, payload, target_orig, unit, units)", s)
        self.assertIn("lt[\"done_cmp\"]", s)

    def test_front(self):
        self.assertIn("lt.done_cmp.text", self.read("static", "app.js"))
        self.assertIn("tripBasicsPopup(id)", self.read("static", "app.js"))
        t = self.read("static", "trailer-link.js")
        self.assertIn("function tripBasicsPopup", t)
        self.assertIn("openSwapPop", t)


if __name__ == "__main__":
    unittest.main()
