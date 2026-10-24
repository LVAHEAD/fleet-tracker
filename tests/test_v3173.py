"""v3.173: Client «топ-3» по диспетчеру, окна фильтров закрываются кликом вне, сортировка одной кнопкой, вид Флота."""
import json
import os
import shutil
import subprocess
import unittest

from tests import ROOT

NODE = shutil.which("node")


def read(*p):
    with open(os.path.join(ROOT, *p), encoding="utf-8") as f:
        return f.read()


DRIVER = r"""
const fs = require('fs'), vm = require('vm');
vm.runInThisContext(fs.readFileSync(process.argv[1], 'utf8') + "\n;globalThis.__api = { clientList };");
const a = globalThis.__api;
const rows = ["Zeta", "Kesko", "Bama", "alfa", "Mowi Markets Norway AS", "DSV"].map((c, i) => ({ unit: "U" + i, client: c }));
const names = (l) => l.map((x) => x.name);
console.log(JSON.stringify({
  vl: names(a.clientList(rows, [], "VL")),
  jz: names(a.clientList(rows, [], "jz")),
  none: names(a.clientList(rows, [], "")),
  topFlag: a.clientList(rows, [], "VL").map((x) => !!x.top),
}));
"""


class V3173(unittest.TestCase):
    def test_version_and_changelog(self):
        from fetat import APP_VERSION
        top = [ln for ln in read("CHANGELOG.md").splitlines() if ln[:1].isdigit()][0]
        self.assertTrue(top.startswith(APP_VERSION + " ("))

    @unittest.skipUnless(NODE, "нет node")
    def test_client_top3(self):
        out = subprocess.run([NODE, "-e", DRIVER, os.path.join(ROOT, "static", "client-filter.js")],
                             capture_output=True, text=True, timeout=60)
        self.assertEqual(out.returncode, 0, out.stderr)
        r = json.loads(out.stdout)
        # VL: из закреплённых в данных есть Bama и Kesko (GreenFood нет — не показываем), дальше по алфавиту
        self.assertEqual(r["vl"], ["Bama", "Kesko", "alfa", "DSV", "Mowi Markets Norway AS", "Zeta"])
        self.assertEqual(r["topFlag"], [True, True, False, False, False, False])
        # JZ: порядок как назвал Владимир — Mowi, DSV (SeaBorn нет в данных), потом алфавит
        self.assertEqual(r["jz"], ["Mowi Markets Norway AS", "DSV", "alfa", "Bama", "Kesko", "Zeta"])
        self.assertEqual(r["none"], ["alfa", "Bama", "DSV", "Kesko", "Mowi Markets Norway AS", "Zeta"])

    def test_popups_close_outside(self):
        for f in ("slot-filter.js", "client-filter.js"):
            js = read("static", f)
            self.assertIn("}, true);", js)                    # слушатель в фазе перехвата
            self.assertIn("fleet-popup-open", js)             # открытие одного закрывает другое

    def test_sort_single_button(self):
        html = read("templates", "index.html")
        self.assertEqual(html.count("data-sort-toggle"), 1)
        self.assertNotIn('data-sort="OL"', html)
        self.assertIn('data-sort="manual"', html)
        self.assertIn("function sortDir()", read("static", "fleet-sort-filter.js"))

    def test_look(self):
        css = read("static", "style.css")
        self.assertIn(":root { --stop-h: 22px; }", css)
        self.assertIn("border-bottom-color: #cdd7e6;", css)
        self.assertIn("outline: 2px solid #2f6fd6", css)
        self.assertIn("--stop-h: 28px", read("static", "mobile.css"))


class V3174(unittest.TestCase):
    def test_col_order_wiring(self):
        html = read("templates", "index.html")
        self.assertLess(html.index("app.js"), html.index("col-order.js"))
        js = read("static", "col-order.js")
        for s in ("fleet-col-order", "data-ci", "MutationObserver", "col-reset-btn", "max-width: 767px"):
            self.assertIn(s, js)
        css = read("static", "style.css")
        self.assertIn('#fleet-table td[data-ci="3"] { overflow: hidden; }', css)
        self.assertIn('td[data-ci="0"] .drag-h', css)

    @unittest.skipUnless(NODE, "нет node")
    def test_col_order_validates_saved(self):
        # битый / неполный порядок — исходный (логика load)
        js = read("static", "col-order.js")
        self.assertIn("a.length === N", js)


class V3175(unittest.TestCase):
    def test_changelog_disp_field(self):
        from fetat.api.meta import parse_changelog
        items = parse_changelog("3.9 (2026-10-21) — заголовок\n    техника\n    Для диспетчеров: просто и ясно.\n3.8 (2026-10-20) — без строки\n    текст\n")
        self.assertEqual(items[0]["disp"], "просто и ясно.")
        self.assertEqual(items[1]["disp"], "")
        top = parse_changelog(read("CHANGELOG.md"))[0]
        self.assertTrue(top["disp"], "в верхней записи нет строки «Для диспетчеров:»")

    def test_wiring(self):
        html = read("templates", "index.html")
        self.assertLess(html.index("whats-new.js"), html.index("presence.js"))
        self.assertIn("fleetWhatsNew", read("static", "presence.js"))
        js = read("static", "whats-new.js")
        self.assertNotIn("innerHTML", js)                      # текст — только через textContent
        for s in ("fleet-seen-ver", "}, true);", "Escape"):
            self.assertIn(s, js)
