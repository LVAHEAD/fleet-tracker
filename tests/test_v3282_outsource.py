"""v3.282: аутсорс — номера нет в Mapon: ответ 200 с outsource, км по плечам, без ETA; сбой Mapon (пустой список) — не аутсорс."""
import unittest
from unittest import mock

from fetat.services import fleet_calc as fc

UNITS = [{"number": "OB-3280", "unit_id": 1, "lat": 40.0, "lng": -3.0, "label": "OB-3280"}]
COORDS = {"A": (40.0, -3.0), "B": (41.0, -2.0), "C": (42.0, -1.0)}


def _resolve(t, units, unit=None):
    if t not in COORDS:
        raise ValueError("не найдено")
    return {"lat": COORDS[t][0], "lng": COORDS[t][1]}


def _road(lat1, lng1, lat2, lng2, key, wps=None, kind="truck", **kw):
    return 100.0 + lat2, f"poly{lat1}-{lat2}"


class OutsourceTest(unittest.TestCase):
    def _run(self, payload, units=UNITS):
        with mock.patch.object(fc, "MAPON_API_KEY", "k"), mock.patch.object(fc, "GOOGLE_API_KEY", "g"), \
                mock.patch.object(fc, "fetch_units", return_value=units), \
                mock.patch.object(fc, "resolve_fleet_target", side_effect=_resolve), \
                mock.patch.object(fc, "fleet_waypoints", return_value=None), \
                mock.patch.object(fc, "road_distance_km_google", side_effect=_road) as road:
            body, code = fc.calc_row(payload)
        return body, code, road

    def test_unknown_unit_is_outsource_with_legs(self):
        body, code, road = self._run({"unit": "lotos", "target": "A", "extra": ["B", "C"]})
        self.assertEqual(code, 200)
        self.assertTrue(body["outsource"])
        self.assertNotIn("error", body)
        self.assertNotIn("eta_local", body)                       # ETA не считаем
        self.assertEqual(body["legs_km"], [141.0, 142.0])         # A→B, B→C
        self.assertEqual(body["dist_km"], 283.0)
        self.assertEqual(len(body["polys"]), 2)
        self.assertEqual(body["pts"][0], [40.0, -3.0])
        self.assertTrue(all(c.kwargs.get("kind") == "leg" for c in road.call_args_list))   # плечи — из кеша плеч, не «от машины»

    def test_unresolved_point_skips_its_legs(self):
        body, code, _ = self._run({"unit": "lotos", "target": "A", "extra": ["???", "C"]})
        self.assertEqual(code, 200)
        self.assertEqual(body["legs_km"], [None, None])
        self.assertIsNone(body["dist_km"])
        self.assertIsNone(body["pts"][1])

    def test_single_point_has_no_legs(self):
        body, code, road = self._run({"unit": "lotos", "target": "A"})
        self.assertEqual(code, 200)
        self.assertTrue(body["outsource"])
        self.assertEqual(body["legs_km"], [])
        self.assertIsNone(body["dist_km"])
        road.assert_not_called()

    def test_mapon_failure_is_not_outsource(self):
        body, code, _ = self._run({"unit": "lotos", "target": "A"}, units=[])
        self.assertEqual(code, 404)                               # пустой список машин — сбой Mapon, а не аутсорс
        self.assertIn("error", body)

    def test_known_unit_is_not_outsource(self):
        with mock.patch.object(fc, "_unit_status", side_effect=RuntimeError("дошли до обычного расчёта")):
            body, code, _ = self._run({"unit": "OB-3280", "target": "A"})
        self.assertNotEqual(code, 200)
        self.assertNotIn("outsource", body)


if __name__ == "__main__":
    unittest.main()
