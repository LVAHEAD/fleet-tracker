"""v3.34: тревоги рефа — порог по уставке (заморозка 5°, охлаждёнка 3°), вес состава с CAN тягача."""
import unittest

from tests import A

NOW = "2026-10-06T15:00:00Z"
G = "2026-10-06T14:59:42Z"


def W(comb=None, trl=None, gmt=G):
    w = {}
    if comb is not None:
        w["combination_weight"] = {"gmt": gmt, "value": str(comb)}
    if trl is not None:
        w["trailer_axle_load_total"] = {"gmt": gmt, "value": str(trl)}
    return {"weights": w}


class TruckWeightTest(unittest.TestCase):
    def setUp(self):
        self._saved = A.time_now_ts
        A.time_now_ts = lambda: A._iso_ts(NOW)

    def tearDown(self):
        A.time_now_ts = self._saved

    def test_real_samples(self):
        # данные 06.10: Volvo OS-2438 гружён, MAN NP-7453 без прицепа, MAN NP-7454 пустой
        self.assertEqual(A.truck_weight(W(33980, 20298))["state"], "loaded")
        self.assertEqual(A.truck_weight(W(7940))["state"], "notrailer")
        self.assertEqual(A.truck_weight(W(20200))["state"], "light")

    def test_thresholds(self):
        self.assertEqual(A.truck_weight(W(24000))["state"], "loaded")
        self.assertEqual(A.truck_weight(W(23999))["state"], "light")
        self.assertEqual(A.truck_weight(W(11999))["state"], "notrailer")
        # оси прицепа важнее веса состава
        self.assertEqual(A.truck_weight(W(26000, 9000))["state"], "light")
        self.assertEqual(A.truck_weight(W(None, 12000))["state"], "loaded")
        # без прицепа — даже если оси прицепа что-то показывают
        self.assertEqual(A.truck_weight(W(8000, 15000))["state"], "notrailer")

    def test_no_or_old_data(self):
        self.assertIsNone(A.truck_weight({}))
        self.assertIsNone(A.truck_weight({"weights": {}}))
        self.assertIsNone(A.truck_weight({"weights": {"axis": {"2": {"gmt": G, "value": "2561"}}}}))
        self.assertIsNone(A.truck_weight(W(30000, gmt="2026-10-01T00:00:00Z")))   # старше 3 суток

    def test_output(self):
        w = A.truck_weight(W(33980, 20298))
        self.assertEqual((w["comb"], w["trl"]), (33980, 20298))
        self.assertTrue(w["at"])


class ReeferLimitTest(unittest.TestCase):
    def test_limit_by_setpoint(self):
        self.assertEqual(A.reefer_dev_limit(-20), 5.0)
        self.assertEqual(A.reefer_dev_limit(-10), 3.0)
        self.assertEqual(A.reefer_dev_limit(2), 3.0)
        self.assertEqual(A.reefer_dev_limit(None), 3.0)

    def _rf(self, sp, ret):
        return {"reefer": {"refrigerator_compartment_count": 1, "0": {
            "state": {"value": "on", "gmt": G},
            "temperature": {"setpoint": {"value": sp}, "return": {"value": ret, "gmt": G}}}}}

    def test_warn_uses_limit(self):
        saved = A.time_now_ts
        A.time_now_ts = lambda: A._iso_ts(NOW)
        try:
            self.assertFalse(A.reefer_summary(self._rf(-20, -16))["warn"])   # заморозка +4 — в допуске 5°
            self.assertTrue(A.reefer_summary(self._rf(-20, -14))["warn"])    # +6
            self.assertTrue(A.reefer_summary(self._rf(2, 6))["warn"])        # охлаждёнка +4 — больше 3°
            c = A.reefer_summary(self._rf(-20, -16))["compartments"][0]
            self.assertEqual(c["lim"], 5.0)
        finally:
            A.time_now_ts = saved



def read(p):
    import os
    with open(os.path.join(os.path.dirname(__file__), "..", p), encoding="utf-8") as f:
        return f.read()


class SidePanelWidthTest(unittest.TestCase):
    """v3.34: одна ширина всех боковых панелей; резерв таблицы прежний."""

    def test_one_width(self):
        js = read("static/app.js")
        self.assertIn("window.sidePanelW", js)
        self.assertIn('"side-w"', js)
        for f in ("static/map-panel.js", "static/eta-calc.js", "static/notebook.js"):
            self.assertIn("sidePanelW", read(f), f)
        for f in ("static/style.css", "static/eta-calc.css", "static/notebook.css"):
            css = read(f)
            self.assertNotIn("--mapw", css, f)
            self.assertNotIn("--calcw", css, f)
        self.assertIn(".nb-resize", read("static/notebook.css"))

    def test_table_reserve_unchanged(self):
        self.assertIn("--side-res: var(--sidew)", read("static/style.css"))


if __name__ == "__main__":
    unittest.main()
