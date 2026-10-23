"""v3.199: именная плашка ① не берёт адрес первой активной точки, когда ① пройдена (CANSO получал якорь порта Lübeck). Проверка по исходнику app.js."""
import os
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class FirstDoneKindTest(unittest.TestCase):
    def test_first_done_has_no_address(self):
        app = open(os.path.join(ROOT, "static", "app.js"), encoding="utf-8").read()
        self.assertIn("targetAddress: data.first_done ? null :", app)
        self.assertIn("data.first_done ? null : data.target_address, ptTruckNo(row)", app)


if __name__ == "__main__":
    unittest.main()
