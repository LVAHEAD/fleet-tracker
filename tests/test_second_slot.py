"""Второй слот тахографа Mapon «NO CARD / NO DATA» (NU-8704) — не второй водитель: экипажем машину не считаем.
Слот без чисел отбрасывается, только если у другого водителя данные есть; все слоты без данных — как раньше."""
import unittest

from tests import A

GOOD = {"driver_id": 1, "current_state": "DRIVING", "now": {"driving": 8100, "rest": 0},
        "today": {"driving_remaining": 27000, "shift_remaining": 40000}, "week": {"driving_remaining": 40000}}
EMPTY = {"driver_id": 2, "current_state": "REST", "now": {"driving": None, "rest": None},
         "today": {"driving_remaining": None}, "week": None}
BARE = {"driver_id": 3, "current_state": "REST"}


class SecondSlotTest(unittest.TestCase):
    def setUp(self):
        self._saved = A.mapon_get
        A._tacho_cache.clear()

    def tearDown(self):
        A.mapon_get = self._saved
        A._tacho_cache.clear()

    def tacho(self, payload, uid=1):
        A.mapon_get = lambda url, params, **kw: {"data": payload}
        data, err = A.get_tacho(uid)
        return data, err

    def test_has_data(self):
        self.assertTrue(A.driver_has_data(GOOD))
        self.assertFalse(A.driver_has_data(EMPTY))
        self.assertFalse(A.driver_has_data(BARE))

    def test_no_card_slot_is_not_second_driver(self):
        data, _ = self.tacho({"driver1": GOOD, "driver2": EMPTY})
        self.assertEqual([d["driver_id"] for d in data["drivers"]], [1])
        self.assertFalse(A.crew_mode(data, None, {})[0])          # соло, а не «две карты в тахографе»

    def test_bare_slot_dropped_too(self):
        data, _ = self.tacho({"driver1": GOOD, "driver2": BARE}, uid=2)
        self.assertEqual(len(data["drivers"]), 1)

    def test_two_real_drivers_stay_team(self):
        two = dict(GOOD, driver_id=9)
        data, _ = self.tacho({"driver1": GOOD, "driver2": two}, uid=3)
        self.assertEqual(len(data["drivers"]), 2)
        self.assertTrue(A.crew_mode(data, None, {})[0])

    def test_all_slots_without_data_unchanged(self):
        data, _ = self.tacho({"driver1": EMPTY, "driver2": BARE}, uid=4)
        self.assertEqual(len(data["drivers"]), 2)


if __name__ == "__main__":
    unittest.main()
