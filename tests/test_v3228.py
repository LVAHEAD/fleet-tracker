"""v3.228: кнопка «B G K» в шапке Флота (только VL, фильтр по началу названия клиента, static/client-filter.js — через node)
и переключение разделов левой панели как у правых (призрак уезжает, новая выезжает, ярлыки на месте)."""
import json
import os
import shutil
import subprocess
import unittest

from tests import ROOT

NODE = shutil.which("node")


def _read(*p):
    with open(os.path.join(ROOT, *p), encoding="utf-8") as f:
        return f.read()


DRIVER = r"""
const fs = require('fs'), vm = require('vm');
globalThis.__tag = "VL";
globalThis.fleetMe = () => "vl@example.com";
globalThis.dispTag = () => globalThis.__tag;
const code = fs.readFileSync(process.argv[1], 'utf8');
vm.runInThisContext(code + "\n;globalThis.__api = { rowPassesClient, setP: (a) => { clientPrefix = a; }, setF: (a) => { clientFilter = a; } };");
const a = globalThis.__api;
const rows = [
  { unit: "A", client: "Bama" }, { unit: "B", client: "Bama Supliers" }, { unit: "C", client: "GreenFood" },
  { unit: "D", client: "GreenFood Italy" }, { unit: "E", client: "Kesko" }, { unit: "F", client: "STEF Italia" },
  { unit: "G", client: "" }, { unit: "", client: "Bama" },
];
const pass = () => rows.map((r) => a.rowPassesClient(r));
const out = {};
a.setF([]); a.setP([]);
out.none = pass();
a.setP(["B"]); out.b = pass();
a.setP(["B", "G"]); out.bg = pass();
a.setP(["K"]); a.setF(["stefitalia"]); out.kPlusWindow = pass();      // буква + галочка окна — объединение
a.setP(["B"]); a.setF([]); globalThis.__tag = "VJ"; out.notVl = pass();   // не VL: буквы не действуют
console.log(JSON.stringify(out));
"""


@unittest.skipUnless(NODE, "нет node")
class ClientLettersTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        out = subprocess.run([NODE, "-e", DRIVER, os.path.join(ROOT, "static", "client-filter.js")],
                             capture_output=True, text=True, timeout=60)
        if out.returncode:
            raise RuntimeError(out.stderr)
        cls.r = json.loads(out.stdout)

    def test_no_letters_no_filter(self):
        self.assertEqual(self.r["none"], [True] * 8)

    def test_b_prefix(self):
        # Bama и Bama Supliers; пустая строка без машины видна всегда
        self.assertEqual(self.r["b"], [True, True, False, False, False, False, False, True])

    def test_multi_select(self):
        self.assertEqual(self.r["bg"], [True, True, True, True, False, False, False, True])

    def test_letter_plus_window_is_union(self):
        self.assertEqual(self.r["kPlusWindow"], [False, False, False, False, True, True, False, True])

    def test_not_vl_ignores_letters(self):
        self.assertEqual(self.r["notVl"], [True] * 8)


class WiringTest(unittest.TestCase):
    def test_status_header_and_hook(self):
        html = _read("templates", "index.html")
        self.assertIn('id="status-th"', html)
        self.assertIn('class="st-lbl"', html)
        self.assertIn("clientLetters.render()", _read("static", "app.js"))

    def test_left_panel_ghost_swap(self):
        js, css = _read("static", "left-panel.js"), _read("static", "style.css")
        self.assertIn("lp-ghost", js)
        self.assertNotIn("left-swap", js)
        self.assertNotIn("left-swap", css)
        self.assertIn(".left-panel.lp-from", css)


if __name__ == "__main__":
    unittest.main()
