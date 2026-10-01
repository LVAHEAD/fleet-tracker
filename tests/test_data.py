"""Справочники и история версий: после переезда в data/ и CHANGELOG.md всё на месте."""
import unittest

from tests import A


class RegionCodesTest(unittest.TestCase):
    def test_own_codes_loaded(self):
        # 1096+ кодов из GPS_Codes.xlsx, пример — Брюссель
        own = [c for c, v in A.REGION_CODES.items() if v.get("src") != "geonames"]
        self.assertGreaterEqual(len(own), 1096)
        self.assertEqual(A.REGION_CODES["BE10"], {"lat": 50.8504, "lng": 4.3488, "place": "Bruxelles"})

    def test_geonames_added(self):
        self.assertGreater(A.GEONAMES_CODES_ADDED, 0)

    def test_region_country(self):
        self.assertEqual(A.get_region_country("se25"), "SE")
        self.assertIsNone(A.get_region_country("Riga"))

    def test_nearest_code(self):
        code, dist = A.nearest_region_code(50.8504, 4.3488)
        self.assertEqual(code, "BE10")
        self.assertLess(dist, 1)


class ChangelogTest(unittest.TestCase):
    def test_top_entry_is_current_version(self):
        # правило билда: APP_VERSION поднят и запись в CHANGELOG.md добавлена
        items = A.parse_changelog(A.read_changelog())
        self.assertGreater(len(items), 80)
        self.assertEqual(items[0]["ver"], A.APP_VERSION)

    def test_api_changelog(self):
        r = A.app.test_client().get("/api/changelog")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.get_json()["version"], A.APP_VERSION)


if __name__ == "__main__":
    unittest.main()
