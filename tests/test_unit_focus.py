"""«Только эта машина»: кнопка в карточке трипов, клик по стыку, плашка выхода, перекрытие остальных фильтров."""
import os
import unittest

from tests import ROOT


def rd(*p):
    with open(os.path.join(ROOT, *p), encoding="utf-8") as f:
        return f.read()


class UnitFocus(unittest.TestCase):
    def test_wiring(self):
        flt = rd("static", "fleet-sort-filter.js")
        f = flt[flt.index("function rowPassesFilterWith"):]
        # проверка режима стоит раньше остальных фильтров (диспетчер, L / O, клиент, дата)
        self.assertLess(f.index("unitFocus"), f.index("ownPass(row)"))
        uf = rd("static", "unit-filter.js")
        self.assertIn("function setUnitFocus", uf)
        self.assertIn(".unit-focus-chip", uf)
        mt = rd("static", "multi-trip.js")
        self.assertIn('class="mtc-only"', mt)
        self.assertIn('ev.target.closest(".mtc-only, .mtc-gap")', mt)
        self.assertIn("setUnitFocus(unit)", mt)
        self.assertIn('class="unit-focus-chip"', rd("templates", "index.html"))


if __name__ == "__main__":
    unittest.main()
