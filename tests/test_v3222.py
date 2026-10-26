"""v3.222: всплывашка рефа «как Freezer в Mapon» — моточасы и режим работы в reefer_summary, модуль static/reefer-pop.js."""
import os
import unittest

from tests import A, ROOT

G = "2026-10-26T10:27:40Z"


def rd(*p):
    with open(os.path.join(ROOT, *p), encoding="utf-8") as f:
        return f.read()


class V3222(unittest.TestCase):
    def _unit(self):                                         # форма ответа Mapon для C-704B (26.10)
        comp = lambda st, sp: {"state": {"value": st, "gmt": G},
                               "temperature": {"setpoint": {"value": sp}, "return": {"value": 3.5, "gmt": G}, "supply": {"value": 3.4}},
                               "mode": {"run": {"value": 1}}}
        c0 = comp("on", 3)
        c0["hours"] = {"diesel": {"value": 6187}, "standby": {"value": 42}}
        return {"reefer": {"0": c0, "1": comp("off", -1), "refrigerator_type": "CARRIER", "refrigerator_compartment_count": "2"},
                "fuel": [{"type": "sensor", "value": 179}]}

    def test_summary_has_hours_and_run(self):
        saved = A.time_now_ts
        A.time_now_ts = lambda: A._iso_ts(G)
        try:
            r = A.reefer_summary(self._unit())
        finally:
            A.time_now_ts = saved
        self.assertEqual(r["diesel_h"], 6187)
        self.assertEqual(r["run"], 1)
        self.assertEqual(len(r["compartments"]), 2)
        self.assertTrue(r["compartments"][0]["on"])
        self.assertFalse(r["compartments"][1]["on"])
        self.assertTrue(r["compartments"][0]["ts"] > 1e9)

    def test_two_compartments_on(self):                      # C-221H (26.10): оба отсека включены, уставки 8° и 4°
        t = lambda ret, sp: {"return": {"value": ret, "gmt": G}, "setpoint": {"value": sp}, "supply": {"value": 8.5, "gmt": G}}
        u = {"reefer": {"0": {"state": {"value": "on", "gmt": G}, "temperature": t(8.9, 8), "hours": {"diesel": {"value": 3309}}, "mode": {"run": {"value": 1}}},
                        "1": {"state": {"value": "on", "gmt": G}, "temperature": t(4.8, 4), "mode": {"run": {"value": 1}}},
                        "refrigerator_type": "CARRIER", "refrigerator_compartment_count": "2"}}
        saved = A.time_now_ts
        A.time_now_ts = lambda: A._iso_ts(G)
        try:
            r = A.reefer_summary(u)
        finally:
            A.time_now_ts = saved
        self.assertEqual([c["on"] for c in r["compartments"]], [True, True])
        self.assertEqual([c["dev"] for c in r["compartments"]], [0.9, 0.8])
        self.assertFalse(r["warn"])
        self.assertEqual(r["diesel_h"], 3309)

    def test_summary_without_hours(self):
        u = self._unit()
        del u["reefer"]["0"]["hours"], u["reefer"]["0"]["mode"], u["reefer"]["1"]["mode"]
        r = A.reefer_summary(u)
        self.assertIsNone(r["diesel_h"])
        self.assertIsNone(r["run"])

    def test_front(self):
        js = rd("static", "reefer-pop.js")
        for s in ("Incoming temperature", "Set temperature", "Outgoing temperature", "Temperature 2", "Run mode", "Diesel hours", "Europe/Riga"):
            self.assertIn(s, js)
        self.assertNotIn("Battery voltage", js)             # в ответе Mapon этого поля нет — плитку не рисуем
        self.assertIn("reefer-pop.js", rd("templates", "index.html"))
        app = rd("static", "app.js")
        self.assertEqual(app.count("${rp} title="), 2)       # обе плашки (Temp и NoTemp) несут data-rp


if __name__ == "__main__":
    unittest.main()
