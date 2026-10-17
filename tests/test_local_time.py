"""v3.143: ETA и ✓ точек — в местном времени страны точки (FI, PT, Балтия…), оригиналы ✓ (Берлин) не трогаем."""
import unittest

from fetat.domain.local_time import local_tz, to_local_str
from fetat.services.fleet_calc import _add_local_times


class LocalTime(unittest.TestCase):
    def test_zones(self):
        self.assertEqual(to_local_str("17/10 08:34", "FI"), "17/10 09:34")   # Финляндия: +1 ч к Берлину
        self.assertEqual(to_local_str("17/10 08:34", "LV"), "17/10 09:34")   # Балтия — как Финляндия
        self.assertEqual(to_local_str("17/10 08:34", "PT"), "17/10 07:34")   # Португалия: −1 ч
        self.assertIsNone(to_local_str("17/10 08:34", "AT"))                  # как Берлин — без пересчёта
        self.assertIsNone(to_local_str("17/10 08:34", "HU"))
        self.assertIsNone(to_local_str("мусор", "FI"))
        self.assertIsNotNone(local_tz("RO"))

    def test_day_rollover(self):
        self.assertEqual(to_local_str("17/10 23:30", "FI"), "18/10 00:30")

    def test_result_fi(self):
        r = {"target_lat": 60.17, "target_lng": 24.94, "eta_tacho": "17/10 08:30", "eta_local": "17/10 08:15",
             "on_target": {"arr": "17/10 08:00"},
             "extra": [{"lat": 38.72, "lng": -9.14, "eta_tacho": "18/10 10:00", "eta_local": "18/10 09:45"}],   # Лиссабон
             "points_done": [{"done": True, "auto": True, "at": "17/10 08:34", "arr": "17/10 07:50", "cc": "FI"},
                             {"done": True, "auto": True, "at": "17/10 08:34", "arr": None, "cc": "AT"},
                             {"done": False, "cc": "FI"}]}
        _add_local_times(r)
        self.assertEqual((r["eta_tacho"], r["eta_local"], r["eta_tz"]), ("17/10 09:30", "17/10 09:15", "FI"))
        self.assertEqual(r["on_target"]["arr"], "17/10 09:00")
        self.assertEqual((r["extra"][0]["eta_tacho"], r["extra"][0]["eta_tz"]), ("18/10 09:00", "PT"))
        d0, d1, d2 = r["points_done"]
        self.assertEqual((d0["at"], d0["at_loc"], d0["arr_loc"], d0["tz"]), ("17/10 08:34", "17/10 09:34", "17/10 08:50", "FI"))
        self.assertNotIn("at_loc", d1)      # Австрия — как Берлин
        self.assertNotIn("at_loc", d2)      # не пройдена


if __name__ == "__main__":
    unittest.main()
