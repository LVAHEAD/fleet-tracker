"""Кеш готового расчёта строки (/api/calc): автопроход берёт свежий результат, правка и ↻ считают заново."""
import unittest
from unittest import mock

from fetat import create_app
from fetat.api import calc


class CalcCache(unittest.TestCase):
    def setUp(self):
        calc._calc_cache.clear()
        self.client = create_app().test_client()
        self.n = 0

        def fake(payload):
            self.n += 1
            return {"n": self.n}, 200
        self.p = mock.patch.object(calc, "calc_row", side_effect=fake)
        self.p.start()

    def tearDown(self):
        self.p.stop()

    def post(self, why, unit="OI-1"):
        return self.client.post("/api/calc", json={"unit": unit, "target": "X", "why": why}).get_json()

    def test_auto_uses_recent_result(self):
        self.assertEqual(self.post("all"), {"n": 1})
        self.assertEqual(self.post("auto"), {"n": 1})
        self.assertEqual(self.n, 1)

    def test_manual_always_recalculates(self):
        self.post("auto")
        self.assertEqual(self.post("all"), {"n": 2})
        self.assertEqual(self.post("edit"), {"n": 3})

    def test_other_payload_not_shared(self):
        self.post("auto", "OI-1")
        self.assertEqual(self.post("auto", "OI-2"), {"n": 2})

    def test_expired(self):
        self.post("auto")
        with mock.patch.object(calc.time, "time", return_value=calc.time.time() + calc.CALC_RESULT_TTL + 1):
            self.assertEqual(self.post("auto"), {"n": 2})


if __name__ == "__main__":
    unittest.main()
