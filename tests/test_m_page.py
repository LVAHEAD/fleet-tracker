"""Лёгкая мобильная страница /m: тело расчёта строки и карточка."""
import unittest

from fetat.api.mobile import _card, _row_payload


class MobilePage(unittest.TestCase):
    def test_payload_like_desktop(self):
        row = {"unit": "NU-8704", "target": "Riga", "extra": [{"target": "Tallinn"}], "trailer": "T1",
               "done": {"0": True}, "doneBy": {"0": {"eu": "14/11 08:00"}}, "doneSeen": {"Riga": "14/11 09:00"}}
        p = _row_payload(row)
        self.assertEqual(p["extra"], ["Tallinn"])
        self.assertEqual(p["done"], [True, None])
        self.assertEqual(p["done_click"], ["14/11 08:00", None])
        self.assertEqual(p["done_seen"], ["14/11 09:00", None])
        self.assertEqual(p["why"], "auto")

    def test_card_error_and_points(self):
        row = {"unit": "A", "target": "X", "extra": [{"target": "Y"}]}
        c = _card("1", row, "VL", {"error": "нет данных"})
        self.assertEqual(c["error"], "нет данных")
        self.assertEqual(len(c["pts"]), 2)
        c = _card("1", row, "VL", {"dist_km": 10, "eta_local": "14/11 10:00", "points_done": [{"done": True}, {}],
                                    "extra": [{"leg_km": 5, "eta_tacho": "14/11 12:00"}]})
        self.assertTrue(c["pts"][0]["done"])
        self.assertEqual(c["pts"][1]["eta"], "14/11 12:00")


if __name__ == "__main__":
    unittest.main()
