"""v3.337: машина без карт водителя, едет — ETA по GPS-смене (остаток дня = максимум − проехано), а не «км ÷ 70 без отдыхов»."""
import time
import unittest
from unittest import mock

import fetat.services.fleet_calc as fc

H = 3600


class NoCardGpsEtaTest(unittest.TestCase):
    def run_case(self, g, crew="team", dist=2063.0):
        res = {"dist_km": dist}
        unit = {"unit_id": 1, "state": {"name": "driving"}}
        with mock.patch.object(fc, "_gps_shift_of", return_value=g), \
                mock.patch.object(fc, "unit_driver_names", return_value=[]), \
                mock.patch.object(fc, "unit_driving_days", return_value={}):
            tacho, sim = fc._no_card_crew(res, unit, crew=crew)
        return res, tacho, sim

    def test_gps_shift_gives_tacho_eta_with_rest(self):
        now = time.time()
        res, tacho, sim = self.run_case({"start": now - 10 * H, "driven": 9 * H})
        self.assertIsNotNone(sim)
        self.assertTrue(res["eta_gps"])
        self.assertTrue(res["tacho_rest_ahead"])        # 2063 км = 29,5 ч — без отдыха не доехать
        self.assertIn("по GPS, примерно", " ".join(res["tacho_summary"]))
        self.assertGreater(sim["eta_ts"] - now, 29.5 * H + 8 * H)   # дольше простого ETA минимум на отдых

    def test_no_gps_shift_keeps_simple_eta(self):
        res, tacho, sim = self.run_case(None)
        self.assertIsNone(sim)
        self.assertNotIn("eta_gps", res)


if __name__ == "__main__":
    unittest.main()
