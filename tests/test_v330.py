"""v3.30: нет подписки Mapon на тахограф (1015); топливо тягача (сумма баков, порог 100 л)."""
import unittest

from tests import A

H = 3600
ERR_1015 = "Mapon 1015: Endpoint needs Tachograph remote download subscription"


class NoSubscriptionTest(unittest.TestCase):
    def setUp(self):
        self._saved = {k: getattr(A, k) for k in ("get_tacho", "unit_driving_days", "unit_driver_names")}
        A.get_tacho = lambda uid: (None, ERR_1015)
        A.unit_driving_days = lambda uid: {"d1": 14 * H}
        A.unit_driver_names = lambda uid: []

    def tearDown(self):
        for k, v in self._saved.items():
            setattr(A, k, v)

    def test_detect(self):
        self.assertTrue(A.tacho_no_subscription(ERR_1015))
        self.assertFalse(A.tacho_no_subscription("нет данных водителя"))
        self.assertFalse(A.tacho_no_subscription(None))

    def test_hint_says_subscription(self):
        res = {"dist_km": 800.0}
        A._add_tacho(res, {"unit_id": 7, "state": {"name": "standing", "duration": 21 * H}}, False, None)
        self.assertTrue(res["crew_nosub"])
        self.assertEqual(res["crew"], "team")
        self.assertIn("подписки", res["tacho_summary"][0])
        self.assertIsNotNone(res.get("eta_tacho"))

    def test_no_cards_hint_unchanged(self):
        A.get_tacho = lambda uid: (None, "нет данных водителя")
        res = {"dist_km": 800.0}
        A._add_tacho(res, {"unit_id": 7, "state": {"name": "driving", "duration": H}}, False, None)
        self.assertNotIn("crew_nosub", res)
        self.assertIn("карт", res["tacho_summary"][0])


class TruckFuelTest(unittest.TestCase):
    def test_sum_of_tanks(self):
        u = {"fuel": [{"type": "sensor", "value": 505.0}, {"type": "sensor", "value": 425.0},
                      {"type": "can", "value": 976.0}]}
        f = A.truck_fuel(u)
        self.assertEqual(f["l"], 930)
        self.assertEqual(f["parts"], [505, 425])
        self.assertFalse(f["low"])

    def test_can_only_and_low(self):
        f = A.truck_fuel({"fuel": [{"type": "can", "value": 80.4}]})
        self.assertEqual(f["l"], 80)
        self.assertTrue(f["low"])

    def test_percent_skipped_and_empty(self):
        self.assertIsNone(A.truck_fuel({"fuel": [{"value": 80, "units": "%"}]}))
        self.assertIsNone(A.truck_fuel({}))
        self.assertIsNone(A.truck_fuel(None))


if __name__ == "__main__":
    unittest.main()
