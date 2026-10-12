import os
import unittest
from unittest import mock

from fetat.domain import routing_rules as rr
from fetat.services import fleet_calc

MILAN = (45.46, 9.19)
NL72 = (52.28, 6.40)


class MontBlancAnchorsTest(unittest.TestCase):
    """v3.84: Монблан держит маршрут во Франции после туннеля (иначе Google едет через Женеву и Базель)."""

    def test_order_both_directions(self):
        c = {n: p for n, p, _ in rr.swiss_bypass_candidates("IT", *MILAN, "NL", *NL72)}
        self.assertEqual(c["Монблан"], [rr.MONT_BLANC, rr.ANNECY, rr.BOURG_EN_BRESSE])
        back = {n: p for n, p, _ in rr.swiss_bypass_candidates("NL", *NL72, "IT", *MILAN)}
        self.assertEqual(back["Монблан"], [rr.BOURG_EN_BRESSE, rr.ANNECY, rr.MONT_BLANC])

    def test_other_corridors_unchanged(self):
        c = {n: p for n, p, _ in rr.swiss_bypass_candidates("IT", *MILAN, "NL", *NL72)}
        self.assertEqual(c["Фрежюс"], [rr.FREJUS])
        self.assertEqual(c["Инсбрук"], [rr.INNSBRUCK, rr.KUFSTEIN])

    def test_choice_by_tunnel_not_anchors(self):
        # выбор коридора по прямой — по самому туннелю, точки привязки на него не влияют
        c1 = rr.swiss_bypass_candidates("IT", *MILAN, "NL", *NL72)
        by = {n: km for n, _, km in c1}
        self.assertLess(by["Монблан"], by["Фрежюс"] + 400)

    def test_label(self):
        self.assertEqual(rr.waypoints_label([rr.MONT_BLANC, rr.ANNECY, rr.BOURG_EN_BRESSE]), "через Монблан")
        self.assertEqual(rr.waypoints_label([rr.FREJUS]), "через Фрежюс")


class SwissFlagTest(unittest.TestCase):
    def test_flag(self):
        with mock.patch.object(fleet_calc, "country_chain", return_value=["IT", "FR", "CH", "DE", "NL"]):
            self.assertTrue(fleet_calc._enters_switzerland("poly", 1200))
        with mock.patch.object(fleet_calc, "country_chain", return_value=["IT", "FR", "BE", "NL"]):
            self.assertFalse(fleet_calc._enters_switzerland("poly", 1200))
        self.assertFalse(fleet_calc._enters_switzerland(None, None))


class FrontSourceTest(unittest.TestCase):
    def test_markers(self):
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        rd = lambda *p: open(os.path.join(root, *p), encoding="utf-8").read()
        self.assertIn("function refreshRoute(rowId)", rd("static", "map-core.js"))
        self.assertIn("drawRoute(id, isSelected(id))", rd("static", "map-core.js"))
        self.assertIn("refreshRoute(id)", rd("static", "app.js"))
        self.assertIn("cor-warn", rd("static", "corridor-menu.js"))


if __name__ == "__main__":
    unittest.main()
