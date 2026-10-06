"""v3.28: ⏱ ETA-калькулятор — панель справа (язычок под 📓), расчёт в браузере, без сервера и Google."""
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
        js = read("static/eta-calc.js")
        self.assertNotIn("fetch(", js)
        self.assertNotIn("/api/", js)

    def test_tab_under_notebook(self):
        css = read("static/eta-calc.css")
        self.assertIn("top: calc(50% + 52px)", css)
        self.assertIn("body.calc-open .nb-tab, body.calc-open .map-tab { right: var(--calcw", css)


@unittest.skipUnless(shutil.which("node"), "нет node — расчёт калькулятора не проверить")
class EtaCalcSimulateTest(unittest.TestCase):
    """Правила расчёта: прогон simulate() в node на примерах, согласованных в песочнице."""

    def run_js(self, cases):
        script = (
            "global.window={};global.document={addEventListener(){}};"
            "eval(require('fs').readFileSync(process.argv[1],'utf8')+';global.EC=EtaCalc;');"
            "const now=new Date(2026,9,6,8,52).getTime();"
            "const out=" + cases + ".map(p=>{const S=EC.simulate(Object.assign({nowMs:now,dist:3000,shiftH:0,leftH:9,"
            "team:false,rest:9,shorts:3,wkLeft:56},p));return {h:(S.eta-S.etd)/36e5,"
            "rests:S.ev.filter(e=>e.k==='r').map(e=>[e.t1-e.t0,e.short]),breaks:S.ev.filter(e=>e.k==='b').length,"
            "wk:S.wk?S.wk.km:null,etdMin:new Date(S.etd).getMinutes()}});"
            "console.log(JSON.stringify(out));"
        )
        res = subprocess.run(["node", "-e", script, os.path.join(ROOT, "static/eta-calc.js")],
                             capture_output=True, text=True, timeout=30)
        self.assertEqual(res.returncode, 0, res.stderr)
        import json
        return json.loads(res.stdout)

    def test_rules(self):
        crew, solo, solo11, stretched, week, week45 = self.run_js(
            "[{team:true,leftH:18},{},{rest:11},{extras:{0:2}},{wkLeft:20},{wkLeft:20,extras:{0:36}}]")
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


if __name__ == "__main__":
    unittest.main()
