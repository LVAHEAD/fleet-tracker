"""v3.281: SAVA — основной источник запретов, nakordoni — только для стран вне SAVA; 400 не превращается в «запретов нет»."""
import unittest
from unittest import mock

from fetat.clients import nakordoni as nk
from fetat.domain import bans


class BansSavaFirstTest(unittest.TestCase):
    def setUp(self):
        nk._bans_cc.clear()

    def tearDown(self):
        nk._bans_cc.clear()

    def test_nk_only_for_countries_outside_sava(self):
        with mock.patch.object(bans, "BANS_NK_COUNTRIES", {"DE", "HR"}):
            n, sv, _none = bans._bans_sources()
        self.assertEqual(n, {"HR"})              # DE знает SAVA — идёт к ней
        self.assertIn("DE", sv)

    def test_400_country_is_not_cached_as_no_bans(self):
        bad = []
        with mock.patch.object(nk, "_bans_get", side_effect=nk.BansBadRequest("400")), mock.patch("time.sleep"):
            nk._bans_fetch_group(["HR", "PT"], bad)
        self.assertEqual(sorted(bad), ["HR", "PT"])
        self.assertEqual(nk._bans_cc, {})        # раньше обе страны молча попадали в кеш с пустыми списками

    def test_build_reports_nk_countries_only_when_data_came(self):
        with mock.patch.object(bans, "BANS_NK_COUNTRIES", {"HR"}):
            self.assertEqual(bans._bans_build()["nk"], [])
            nk._bans_cc["HR"] = {"at": 1.0, "upcoming": [], "current": []}
            d = bans._bans_build()
        self.assertEqual(d["nk"], ["HR"])
        self.assertNotIn("HR", d["missing"])


if __name__ == "__main__":
    unittest.main()
