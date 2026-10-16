"""v3.139: АЗС ⛽ — создание объектов в группе Mapon «Actual Petrol Station» по образцу."""
import unittest
from unittest import mock

from tests.test_v3136 import BLOCKS, META

SAMPLE = "POLYGON((51.48302 4.72959,51.48320 4.72980,51.48302 4.73010,51.48280 4.72980,51.48302 4.72959))"


class Names(unittest.TestCase):
    def test_country_role_name(self):
        from fetat.domain.fuel_stations import mapon_name, parse_blocks
        st = {s["name"]: s for s in parse_blocks(BLOCKS)}
        s = st["AS24 - SLUBICE"]
        self.assertEqual((s["country"], s["role"]), ("POLAND", "MAIN"))
        self.assertEqual(mapon_name(s), "POLAND - MAIN - AS24 - SLUBICE GPS: (52.33445, 14.61741)")
        e = [x for x in parse_blocks(BLOCKS) if x["network"] == "EWAG" and x["lat"] < 52.4 and x["lng"] < 14.7][0]
        self.assertEqual(e["role"], "RESERVE")
        self.assertTrue(mapon_name(e).startswith("POLAND - RESERVE - EWAG - Slubice GPS"))
        cz = [x for x in parse_blocks(BLOCKS) if x["not_working"]][0]
        self.assertEqual(mapon_name(cz), "CZECHIA - RESERVE - EWAG - Rozvadov II GPS: (49.64933, 12.53283)")

    def test_main_wins_in_dup(self):
        from fetat.domain.fuel_stations import parse_blocks
        s = [x for x in parse_blocks(BLOCKS) if x["name"] == "AS24 - SLUBICE"][0]
        self.assertEqual(s["role"], "MAIN")


class Shape(unittest.TestCase):
    def test_repeat_sample(self):
        from fetat.domain.fuel_shape import make_wkt, shape_from_sample
        from fetat.utils.geo import _wkt_center, _wkt_vertices
        sh = shape_from_sample(SAMPLE)
        self.assertEqual((sh["n"], sh["closed"]), (4, True))
        w = make_wkt(sh, 52.0, 10.0)
        self.assertTrue(w.startswith("POLYGON((52.") and w.endswith("))"))
        lat, lng, n = _wkt_center(w)
        self.assertAlmostEqual(lat, 52.0, places=3)
        self.assertAlmostEqual(lng, 10.0, places=3)
        self.assertEqual(len(_wkt_vertices(w)), 4)
        sh2 = shape_from_sample(w)
        self.assertAlmostEqual(sh2["radius_m"], sh["radius_m"], delta=1.0)

    def test_bad_sample(self):
        from fetat.domain.fuel_shape import shape_from_sample
        with self.assertRaises(ValueError):
            shape_from_sample("POINT(51.4 4.7)")


class Create(unittest.TestCase):
    def _rep(self, sample=SAMPLE):
        from fetat.services import fuel_report as fr
        grp = ({"id": 7, "name": "Actual Petrol Station"},
               [{"id": 1, "name": "BELGIUM - MAIN - AS24 - MEER", "lat": 51.48302, "lng": 4.72959, "wkt": sample, "private": 0, "pts": 4}])
        with mock.patch.object(fr, "fetch_fuel_csv", return_value={"blocks": BLOCKS, "meta": META, "at": 1.0}), \
                mock.patch.object(fr, "MAPON_API_KEY", "k"), mock.patch.object(fr, "_group_objects", return_value=grp):
            return fr.fuel_report()

    def test_no_key_no_write(self):
        from fetat.services import fuel_create as fc
        with mock.patch.object(fc, "MAPON_WRITE_KEY", ""), mock.patch.object(fc, "mapon_post") as p:
            self.assertIn("MAPON_WRITE_KEY", fc.fuel_create("trial")["error"])
        p.assert_not_called()

    def test_trial_creates_one_and_verifies(self):
        from fetat.services import fuel_create as fc
        rep = self._rep()
        self.assertEqual(rep["sample"]["id"], 1)
        st = rep["to_create"][0]
        made = []

        def post(path, data):
            made.append((path, data))

        def regroup(key):
            d = made[0][1]
            from fetat.utils.geo import _wkt_center
            la, ln, n = _wkt_center(d["wkt"])
            return {"id": 7}, [{"id": 9, "name": d["name"], "lat": la, "lng": ln}]
        with mock.patch.object(fc, "MAPON_WRITE_KEY", "w"), mock.patch.object(fc, "MAPON_API_KEY", "k"), \
                mock.patch.object(fc.fr, "fuel_report", return_value=rep), mock.patch.object(fc, "mapon_post", side_effect=post), \
                mock.patch.object(fc.fr, "_group_objects", side_effect=regroup):
            r = fc.fuel_create("trial")
        self.assertEqual(len(made), 1)
        self.assertEqual(made[0][0], "object/save.json")
        self.assertEqual(made[0][1]["name"], st["obj_name"])
        self.assertEqual(made[0][1]["group_id"], 7)
        self.assertEqual(made[0][1]["key"], "w")
        self.assertTrue(r["verified"])
        self.assertEqual(r["left"], len(rep["to_create"]) - 1)

    def test_all_stops_on_first_error(self):
        from fetat.services import fuel_create as fc
        rep = self._rep()
        with mock.patch.object(fc, "MAPON_WRITE_KEY", "w"), mock.patch.object(fc.fr, "fuel_report", return_value=rep), \
                mock.patch.object(fc, "mapon_post", side_effect=[None, RuntimeError("Mapon 5: нет прав")]) as p:
            r = fc.fuel_create("all")
        self.assertEqual(p.call_count, 2)
        self.assertEqual(len(r["created"]), 1)
        self.assertIn("нет прав", r["failed"][0]["error"])

    def test_no_sample_no_write(self):
        from fetat.services import fuel_create as fc
        rep = self._rep(sample="POINT(51.4 4.7)")
        rep["sample"] = None
        with mock.patch.object(fc, "MAPON_WRITE_KEY", "w"), mock.patch.object(fc.fr, "fuel_report", return_value=rep), \
                mock.patch.object(fc, "mapon_post") as p:
            self.assertIn("образц", fc.fuel_create("trial")["error"])
        p.assert_not_called()

    def test_endpoint_needs_confirm(self):
        from tests import A
        c = A.app.test_client()
        self.assertEqual(c.post("/api/fuel-stations/create", json={"mode": "trial"}).status_code, 400)
        with mock.patch("fetat.api.fuel.fuel_create", return_value={"created": []}) as m:
            r = c.post("/api/fuel-stations/create", json={"mode": "trial", "confirm": True})
        self.assertEqual(r.status_code, 200)
        m.assert_called_once_with("trial")

    def test_write_isolated(self):
        import os
        from tests import ROOT
        hits = []
        for d, _, fs in os.walk(os.path.join(ROOT, "fetat")):
            for f in fs:
                if f.endswith(".py") and "object/save" in open(os.path.join(d, f), encoding="utf-8").read():
                    hits.append(f)
        self.assertEqual(hits, ["fuel_create.py"])

    def test_post_error_hides_key(self):
        from fetat.clients import mapon_write as mw

        class R:
            status_code, text = 200, ""
            def json(self): return {"error": {"code": 12, "msg": "no access"}}
        with mock.patch.object(mw.requests, "post", return_value=R()):
            with self.assertRaises(RuntimeError) as cm:
                mw.mapon_post("object/save.json", {"key": "SECRET"})
        self.assertNotIn("SECRET", str(cm.exception))
        self.assertIn("no access", str(cm.exception))


if __name__ == "__main__":
    unittest.main()
