"""v3.285: код региона адреса у границы — из страны адреса (La Jonquera, ES: ES17, а не FR66 соседнего Перпиньяна)."""
import unittest

from fetat.domain import points
from fetat.domain.regions import REGION_CODES, nearest_region_code

JONQUERA = (42.4193, 2.8745)    # Parking - La Jonquera (ES), у границы с Францией


class BorderCodeTest(unittest.TestCase):
    def test_without_country_neighbour_wins(self):
        self.assertEqual(nearest_region_code(*JONQUERA)[0], "FR66")      # воспроизведение ошибки: центр Перпиньяна ближе

    def test_with_country_code_is_from_that_country(self):
        code, d = nearest_region_code(*JONQUERA, "ES")
        self.assertEqual(code, "ES17")
        self.assertEqual(nearest_region_code(*JONQUERA, "es")[0], "ES17")   # регистр не важен

    def test_unknown_country_falls_back(self):
        self.assertEqual(nearest_region_code(*JONQUERA, "ZZ")[0], "FR66")   # нет кодов страны — как без неё
        self.assertEqual(nearest_region_code(*JONQUERA, "")[0], "FR66")

    def test_badge_uses_address_country(self):
        self.assertIn("ES17", REGION_CODES)
        badge, hint = points.target_badge_info("Parking - La Jonquera (ES)", *JONQUERA, {"country": "ES"})
        self.assertEqual(badge, "ES17")
        self.assertIn("ES", hint)
        badge, _ = points.target_badge_info("Parking - La Jonquera (ES)", *JONQUERA, None)   # без адреса — как раньше
        self.assertEqual(badge, "FR66")

    def test_address_point_code(self):
        addr = {k: "" for k in ("name", "alias", "type", "open", "notes", "client", "supplier", "city", "full")}
        addr.update(name="Parking - La Jonquera (ES)", country="ES", lat=JONQUERA[0], lng=JONQUERA[1])
        p = points._address_point(addr)
        self.assertEqual(p["near_code"], "ES17")
        self.assertEqual(p["country"], "ES")


if __name__ == "__main__":
    unittest.main()
