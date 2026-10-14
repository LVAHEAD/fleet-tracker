"""v3.121: плашки на карте From → To (код зоны или страна, диспетчер, данные машины)."""
import os
import unittest

from tests import ROOT


def read(*p):
    with open(os.path.join(ROOT, *p), encoding="utf-8") as f:
        return f.read()


class V3121(unittest.TestCase):
    def test_point_view_gps_has_badge(self):
        from fetat.services.route_calc import _point_view
        p = {"kind": "O", "num": 1, "label": "x", "lat": 50.8504, "lng": 4.3488, "is_truck": False,
             "code": None, "raw": "50.8504, 4.3488"}
        v = _point_view(p)
        self.assertTrue(v["badge"])                  # код зоны рядом или хотя бы страна
        self.assertNotIn("unit_no", v)

    def test_point_view_far_gives_country_only(self):
        from fetat.services.route_calc import _point_view
        # посреди Северного моря: ближе 50 км кодов нет — только страна (две буквы)
        p = {"kind": "O", "num": 1, "label": "x", "lat": 56.0, "lng": 3.0, "is_truck": False,
             "code": None, "raw": "56.0, 3.0"}
        self.assertEqual(len(_point_view(p)["badge"]), 2)

    def test_point_view_truck_fields(self):
        from fetat.services.route_calc import _point_view
        unit = {"number": "OI-1781", "state": {"name": "driving"}, "direction": 90}
        p = {"kind": "L", "num": 1, "label": "x", "lat": 50.8504, "lng": 4.3488, "is_truck": True,
             "code": None, "raw": "OI-1781", "unit": unit}
        v = _point_view(p)
        self.assertEqual((v["unit_no"], v["st"], v["dir"]), ("OI-1781", "driving", 90))

    def test_badges_on_route_map(self):
        s = read("static", "route-tab.js")
        for name in ("routePointBadge", "routeTargetLine", "routeUnitDisp", "routeBadgeCode"):
            self.assertIn("function " + name, s)
        self.assertIn("null, map);", s)              # makeBadge рисует на карте From → To
        self.assertIn("function makeBadge(lat, lng, html, className, offsetY, onClick, onMap)", read("static", "map-core.js"))
        self.assertIn("o.setMap(onMap || map);", read("static", "map-core.js"))


if __name__ == "__main__":
    unittest.main()
