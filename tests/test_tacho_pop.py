"""v3.217: всплывашка статуса — числа tacho_panel и подключение клиентской части."""
import os
import unittest

from tests import A
from tests.test_v3104 import H, blank_team

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def rd(*p):
    with open(os.path.join(ROOT, *p), encoding="utf-8") as f:
        return f.read()


def crew(today_a, today_b, gps):
    t = blank_team(2)
    for d, v in zip(t["drivers"], (today_a, today_b)):
        d["today"].update(driving=v, driving_remaining=10 * H - v)
    t["drivers"][0]["current_state"] = "DRIVING"
    t["gps"] = {"start": 100.0, "driven": gps}
    return t


class PanelTest(unittest.TestCase):
    def test_two_cards_match_gps_no_fix(self):          # NP-7554: 5411 + 15295 ≈ 5:43 по GPS не расходится
        t = crew(5411, 15295, 5.7 * H)
        self.assertIsNone(A.gps_adjust(t, 18 * H - 20706, 18 * H)[1])
        p = A.tacho_panel(t)
        self.assertIsNone(p["fix"])
        self.assertEqual(p["left_src"], "tacho")
        self.assertEqual(len(p["drivers"]), 2)

    def test_lag_and_nocard_kinds(self):
        self.assertEqual(A.tacho_panel(crew(0, 0, 5.7 * H))["fix"]["kind"], "lag")
        t = blank_team(1)
        t["gps"] = {"start": 100.0, "driven": 5.7 * H}
        p = A.tacho_panel(t)
        self.assertEqual(p["fix"]["kind"], "nocard")
        self.assertEqual(p["left_src"], "gps")

    def test_client_wired(self):
        self.assertIn("tacho-pop.js", rd("templates", "index.html"))
        self.assertIn("data-tp", rd("static", "app.js"))
        self.assertIn("Europe/Riga", rd("static", "tacho-pop.js"))
