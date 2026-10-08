"""v3.28: ⏱ ETA-калькулятор — панель справа (язычок под 📓). v3.39: расклад — с сервера (/api/eta-plan,
тот же движок, что Флот), Google не нужен."""
import os
import shutil
import subprocess
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return f.read()


class EtaCalcWiringTest(unittest.TestCase):
    def test_page_has_tab_css_and_script(self):
        html = read("templates/index.html")
        self.assertIn('id="calc-tab"', html)
        self.assertIn("eta-calc.css", html)
        self.assertIn("eta-calc.js", html)
        # калькулятор грузится после map-panel.js (карта закрывает его через window.etaCalc)
        self.assertLess(html.index("filename='map-panel.js'"), html.index("filename='eta-calc.js'"))

    def test_one_panel_at_a_time(self):
        js = read("static/eta-calc.js")
        self.assertIn("Notebook.close()", js)
        self.assertIn("window.fleetMapPanel.close()", js)
        self.assertIn("window.etaCalc.close()", read("static/notebook.js"))
        self.assertIn("window.etaCalc.close()", read("static/map-panel.js"))

    def test_no_server_calls(self):
        # v3.39: расклад — /api/eta-plan (движок Флота), коды регионов — для мини-карты;
        # v3.51: Routes — только из полей From / To (/api/route, как вкладка From → To)
        js = read("static/eta-calc.js")
        self.assertEqual(js.count("fetch("), 3)
        self.assertIn('fetch("/api/region-codes")', js)
        self.assertIn('fetch("/api/eta-plan"', js)
        self.assertIn('fetch("/api/route"', js)
        self.assertNotIn("/api/calc", js)

    def test_tab_under_notebook(self):
        css = read("static/eta-calc.css")
        self.assertIn("top: calc(50% + 52px)", css)
        self.assertIn("body.calc-open .nb-tab, body.calc-open .map-tab { right: var(--sidepw", css)   # v3.34


class EtaCalcSimulateTest(unittest.TestCase):
    """Правила расчёта калькулятора (v3.39 — calc_plan на сервере) на примерах, согласованных в песочнице."""

    def run_cases(self, cases):
        from datetime import datetime, timezone
        from fetat.domain.tacho import calc_plan
        now = datetime(2026, 10, 6, 6, 52, tzinfo=timezone.utc).timestamp() * 1000   # 08:52 Берлин
        out = []
        for c in cases:
            p = dict(nowMs=now, dist=3000, shiftH=0, leftH=9, team=False, rest=9, shorts=3, wkLeft=56)
            p.update(c)
            S = calc_plan(p)
            out.append({"h": (S["eta"] - S["etd"]) / 36e5,
                        "rests": [[e["t1"] - e["t0"], e["short"]] for e in S["ev"] if e["k"] == "r"],
                        "breaks": sum(1 for e in S["ev"] if e["k"] == "b"),
                        "wk": S["wk"]["km"] if S["wk"] else None,
                        "etdMin": datetime.fromtimestamp(S["etd"] / 1000, timezone.utc).minute})
        return out

    def test_rules(self):
        crew, solo, solo11, stretched, week, week45 = self.run_cases(
            [{"team": True, "leftH": 18}, {}, {"rest": 11}, {"extras": {0: 2}}, {"wkLeft": 20},
             {"wkLeft": 20, "extras": {0: 36}}])
        # ETD — вверх до 15 мин (08:52 → 09:00)
        self.assertEqual(crew["etdMin"], 0)
        # экипаж: 3000 км = 42:51 вождения, по 18 ч, два отдыха по 9 ч, без перерывов → 60:51 → вверх до 61:00
        self.assertEqual([r[0] for r in crew["rests"]], [9, 9])
        self.assertEqual(crew["breaks"], 0)
        self.assertEqual(crew["h"], 61)
        # соло: три 9-ки, потом 11; перерыв 45 мин каждые 4:30
        self.assertEqual(solo["rests"], [[9, True], [9, True], [9, True], [11, False]])
        self.assertEqual(solo["breaks"], 5)
        self.assertEqual(solo11["rests"], [[11, False]] * 4)
        # 9-ка, растянутая до 11 ч, — обычный отдых, сокращение остаётся следующим
        self.assertEqual(stretched["rests"], [[11, False], [9, True], [9, True], [9, True]])
        # недельный остаток 20 ч кончается на 1400 км — только отметка, ETA тот же
        self.assertAlmostEqual(week["wk"], 1400, places=3)
        self.assertEqual(week["h"], solo["h"])
        # отдых растянули до 45 ч — неделя заново, отметки нет
        self.assertIsNone(week45["wk"])
        self.assertEqual(week45["rests"][0][0], 45)

    def test_tenth_hour(self):
        base, ext = self.run_cases([{"dist": 700}, {"dist": 700, "ext": [0], "leftH": 10}])
        # 700 км = 10 ч: соло 9 ч — нужен отдых; с 10-м часом в первый день — доезжает за день
        self.assertEqual(len(base["rests"]), 1)
        self.assertEqual(len(ext["rests"]), 0)


if __name__ == "__main__":
    unittest.main()
