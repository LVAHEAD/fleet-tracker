"""v3.292: GPS «lat lng» через пробел читается (строка листа Адреса не пропускается), числа из адреса — нет."""
import unittest
from fetat.utils.geo import parse_gps
from fetat.domain.addresses import parse_address_rows


class GpsSpace(unittest.TestCase):
    def test_space_pair(self):
        self.assertEqual(parse_gps("38.13739 -1.06771"), (38.13739, -1.06771))
        self.assertEqual(parse_gps("39.97882, -3.56931"), (39.97882, -3.56931))

    def test_address_numbers_not_gps(self):
        self.assertIsNone(parse_gps("12.5 34.7"))
        self.assertIsNone(parse_gps("Calle 12.50 34.70 km"))

    def test_row_with_space_gps_loaded(self):
        vals = [["Name", "Full address", "GPS", "Type", "Country"],
                ["KYMEY BEST FRUIT, S.L", "Paraje el Reloj, 105 30628 LA MATANZA\n38.13739 -1.06771", "38.13739 -1.06771", "load", "ES"]]
        items, problems = parse_address_rows(vals)
        self.assertEqual(len(items), 1)
        self.assertEqual(problems, [])


if __name__ == "__main__":
    unittest.main()
