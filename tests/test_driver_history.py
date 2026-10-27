"""История водителя в Truck Info: куски одного статуса склеиваются, события карты идут отдельно."""
import time
import unittest

from fetat.clients import mapon as m


class DriverHistoryTest(unittest.TestCase):
    def setUp(self):
        now = time.time()
        self.now = now
        m._act_cache[777] = {"at": now, "data": {}, "error": None, "full_at": now, "acts": [
            {"start": now - 7200, "end": now - 3600, "status": "DRIVING", "src": "ddd"},
            {"start": now - 3600, "end": now - 3000, "status": "DRIVING", "src": "can"},
            {"start": now - 3000, "end": now - 100, "status": "REST", "src": "can"},
            {"start": now - 7300, "end": now - 7300, "status": "CARD_INSERTED", "src": "ddd"},
            {"start": now - 5 * 86400, "end": now - 5 * 86400 + 600, "status": "WORK", "src": "ddd"},
        ]}

    def tearDown(self):
        m._act_cache.pop(777, None)

    def test_merge_and_cards(self):
        h, err = m.get_driver_history(777, 3)
        self.assertIsNone(err)
        self.assertEqual([g["status"] for g in h["acts"]], ["DRIVING", "REST"])
        self.assertEqual(h["acts"][0]["src"], ["can", "ddd"])
        self.assertEqual([c["what"] for c in h["cards"]], ["CARD_INSERTED"])

    def test_period_limits_old_work(self):
        h3, _ = m.get_driver_history(777, 3)
        h7, _ = m.get_driver_history(777, 7)
        self.assertEqual(len(h3["acts"]), 2)
        self.assertEqual(len(h7["acts"]), 3)

    def test_no_data(self):
        m._act_cache[778] = {"at": time.time(), "data": None, "error": "boom", "acts": None, "full_at": 0}
        try:
            h, err = m.get_driver_history(778, 3)
            self.assertIsNone(h)
            self.assertEqual(err, "boom")
        finally:
            m._act_cache.pop(778, None)


if __name__ == "__main__":
    unittest.main()
