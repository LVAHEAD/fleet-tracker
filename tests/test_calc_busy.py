"""Обновление Флота: старый статус не затирается «…» (calc-busy), 16 потоков, подробный замер шага route."""
import os
import unittest

from tests import ROOT


def read(*p):
    with open(os.path.join(ROOT, *p), encoding="utf-8") as f:
        return f.read()


class CalcBusy(unittest.TestCase):
    def test_busy_class_instead_of_blanking(self):
        s = read("static", "app.js")
        self.assertIn('tr.classList.add("calc-busy")', s)
        self.assertIn('tr.classList.remove("calc-busy")', s)        # снимается при любом исходе (finally)
        self.assertIn("calc-busy", read("static", "style.css"))

    def test_threads(self):
        self.assertIn("--threads 16", read("Procfile"))

    def test_route_substeps_timed(self):
        s = read("fetat", "services", "fleet_calc.py")
        for name in ("r_wps", "r_cor", "r_gmaps"):
            self.assertIn(f'tm.mark("{name}")', s)


if __name__ == "__main__":
    unittest.main()
