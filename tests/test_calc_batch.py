"""v3.243: /api/calc-batch — пачка строк одним запросом: порядок ответов, ошибка строки, кеш автопрохода, лимит."""
import unittest
from unittest import mock

from fetat import create_app
from fetat.api import calc


class CalcBatch(unittest.TestCase):
    def setUp(self):
        calc._calc_cache.clear()
        self.client = create_app().test_client()

        def fake(payload):
            if payload["unit"] == "BAD":
                raise RuntimeError("mapon")
            if payload["unit"] == "ERR":
                return {"error": "Машина не найдена"}, 404
            return {"unit": payload["unit"], "why": payload.get("why")}, 200
        self.p = mock.patch.object(calc, "calc_row", side_effect=fake)
        self.calc_row = self.p.start()

    def tearDown(self):
        self.p.stop()

    def batch(self, units, why="all"):
        return self.client.post("/api/calc-batch",
                                json={"items": [{"unit": u, "target": "X", "why": why} for u in units]})

    def test_order_and_errors(self):
        r = self.batch(["A", "BAD", "ERR", "B"]).get_json()["results"]
        self.assertEqual(r[0]["unit"], "A")
        self.assertEqual(r[1], {"error": "Ошибка расчёта"})
        self.assertEqual(r[2], {"error": "Машина не найдена"})
        self.assertEqual(r[3]["unit"], "B")

    def test_auto_uses_cache_shared_with_single(self):
        self.client.post("/api/calc", json={"unit": "A", "target": "X", "why": "all"})
        self.batch(["A"], why="auto")
        self.assertEqual(self.calc_row.call_count, 1)

    def test_limits(self):
        self.assertEqual(self.client.post("/api/calc-batch", json={"items": []}).status_code, 400)
        self.assertEqual(self.batch(["A"] * (calc.CALC_BATCH_MAX + 1)).status_code, 400)
        self.assertEqual(self.client.post("/api/calc-batch", json={}).status_code, 400)


if __name__ == "__main__":
    unittest.main()
