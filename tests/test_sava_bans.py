"""v3.278: запреты из SAVA Logistic → формат nakordoni (fetat/clients/sava_bans.py) и разбивка стран по источникам."""
import unittest
from datetime import datetime, timezone

from fetat.clients import sava_bans as sb
from fetat.domain import bans

NOW = datetime(2026, 11, 8, 10, 0, tzinfo=timezone.utc).timestamp()   # воскресенье, 11:00 по Берлину


def _ban(cc, date, start, end, reason, **kw):
    b = {"country": cc, "countryName": cc, "date": date, "start": start, "end": end, "reason": reason,
         "scope": "nationwide", "minimumTonnes": 7.5,
         "startsAt": f"{date}T{start}:00+01:00", "endsAt": f"{date}T{end}:00+01:00" if end != "24:00" else None}
    if end == "24:00":
        d2 = datetime.fromisoformat(date).date().toordinal() + 1
        b["endsAt"] = datetime.fromordinal(d2).strftime("%Y-%m-%dT00:00:00+01:00")
    b.update(kw)
    return b


class SavaTest(unittest.TestCase):
    def test_convert(self):
        d = {"countries": [{"code": "CZ"}, {"code": "SK"}], "countriesWithoutDatedBans": [{"code": "PL"}],
             "bans": [_ban("CZ", "2026-11-08", "00:00", "22:00", "Sunday"),          # идёт сейчас
                      _ban("CZ", "2026-11-15", "13:00", "22:00", "Sunday"),
                      _ban("CZ", "2026-11-07", "00:00", "22:00", "Saturday"),         # уже закончился
                      _ban("SK", "2026-12-25", "06:00", "22:00", "Public holiday: Christmas Day", scope="specific-roads")]}
        part, local, cover = sb.sava_to_cc(d, NOW)
        self.assertEqual(cover, {"CZ", "SK", "PL"})
        self.assertEqual(local, {"PL"})
        self.assertEqual(part["PL"]["upcoming"] + part["PL"]["current"], [])
        self.assertEqual([b["date"] for b in part["CZ"]["current"]], ["2026-11-08"])
        self.assertEqual([b["date"] for b in part["CZ"]["upcoming"]], ["2026-11-15"])
        cur = part["CZ"]["current"][0]
        self.assertEqual((cur["country_code"], cur["time_from"], cur["time_until"], cur["restriction_type"], cur["min_weight_tons"]),
                         ("CZ", "00:00", "22:00", "Sunday", 7.5))
        self.assertEqual(part["SK"]["upcoming"][0]["restriction_type"], "Local")   # отдельные дороги — не «полный»
        self.assertNotIn("Local", bans.BANS_FULL_TYPES)

    def test_types(self):
        self.assertEqual(sb._ban_type({"reason": "Public holiday: X"}), "Holiday")
        self.assertEqual(sb._ban_type({"reason": "Saturday"}), "General")
        self.assertEqual(sb._ban_type({"reason": "Eve of public holiday: X"}), "General")

    def test_sources_split(self):
        nk, sv, none = bans._bans_sources()
        self.assertEqual(nk, {"AT", "DE", "FR", "IT"})
        self.assertFalse(nk & sv or nk & none or sv & none)
        self.assertEqual(nk | sv | none, set(bans.OUR_COUNTRIES))
        self.assertIn("NO", none)    # у Норвегии нет ни nakordoni (вне тарифа), ни SAVA
        self.assertIn("CZ", sv)


if __name__ == "__main__":
    unittest.main()
