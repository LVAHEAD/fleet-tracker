"""v3.130: чужие алерты без мигания (тихий значок), значки по центру плашки, клик по плашке «на точке» — зум 17."""
import json
import os
import re
import shutil
import subprocess
import unittest

from tests import ROOT


def read(*p):
    with open(os.path.join(ROOT, *p), encoding="utf-8") as f:
        return f.read()


class V3130(unittest.TestCase):
    @unittest.skipUnless(shutil.which("node"), "нужен node")
    def test_row_is_mine(self):
        src = read("static", "dispatchers.js")
        fn = re.search(r"function rowIsMine\(row\) \{.*?\n\}", src, re.S).group(0)
        js = fn + """
        let D = "", ME = "", IN = true;
        function rowDisp(r) { return r.disp || D; }
        function fleetMe() { return ME; }
        function meInSheet() { return IN; }
        const out = [];
        const t = (disp, me, inSheet) => { D = ""; ME = me; IN = inSheet; out.push(rowIsMine({ disp })); };
        t("a@x", "a@x", true);    // моя
        t("b@x", "a@x", true);    // чужая
        t("", "a@x", true);       // без хозяина — своя
        t("b@x", "", true);       // не вошёл — своя
        t("b@x", "a@x", false);   // меня нет в листе — своя
        console.log(JSON.stringify(out));
        """
        res = subprocess.run(["node", "-e", js], capture_output=True, text=True, check=True)
        self.assertEqual(json.loads(res.stdout), [True, False, True, True, True])

    def test_quiet_class_wired(self):
        s = read("static", "row-alerts.js")
        self.assertIn('toggle("row-quiet"', s)
        self.assertEqual(s.count("quietSync(tr, id);"), 2)
        css = read("static", "style.css")
        self.assertIn("tr.row-quiet td { animation: none !important; }", css)

    def test_icons_centered(self):
        css = read("static", "style.css")
        self.assertIn('data-k="fuel"] { display: inline-flex; }', css)
        self.assertNotIn('data-k="fuel"] { display: inline-block; }', css)

    def test_pill_click_zoom(self):
        app = read("static", "app.js")
        self.assertIn('e.target.closest(".ot-pill")) { otPillClick(id); return; }', app)
        self.assertIn("function otPillClick(id)", app)
        self.assertIn("map.setZoom(17)", app)
        self.assertIn("function ecFromRow(id, force, k)", app)
        self.assertIn("function focusMap(lat, lng, z)", read("static", "eta-calc.js"))
        self.assertIn("etaCalc.focusMap(pos0.unitLat, pos0.unitLng, 17)", app)

    def test_addr_tab_placeholder(self):
        html = read("templates", "index.html")
        self.assertIn('id="left-tab-addr" data-lp="addr"', html)
        self.assertIn('id="lp-addr" hidden>', html)
        self.assertIn('id="addrQuery"', html.split('id="lp-addr"')[1].split("</section>")[0])  # v3.152: заглушка заменена формой
        self.assertIn('addr: "Адреса"', read("static", "left-panel.js"))
