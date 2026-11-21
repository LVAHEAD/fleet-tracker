"""v3.353: цвета паромных линий — новые линии v3.251 (Германия ↔ Латвия / Литва / Норвегия) не «Дания» (static/ferries.js, region(); нет node — пропуск)."""
import os
import re
import shutil
import subprocess
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE = shutil.which("node")

DRIVER = r"""
const fs = require('fs');
const m = fs.readFileSync(process.argv[1], 'utf8').match(/function region\(d\)[^\n]*/)[0].replace(/\/\/.*$/, '');
eval(m);
console.log(JSON.stringify(process.argv.slice(2).map((d) => region(d))));
"""


@unittest.skipUnless(NODE, "нет node")
class FerryRegionTest(unittest.TestCase):
    def test_region(self):
        dirs = ["Германия ↔ Латвия", "Германия ↔ Литва", "Германия ↔ Норвегия", "Германия ↔ Дания", "Дания ↔ Норвегия",
                "Швеция ↔ Германия", "Германия ↔ Финляндия", "Швеция ↔ Эстония", "Дания ↔ Швеция"]
        out = subprocess.run([NODE, "-e", DRIVER, os.path.join(ROOT, "static", "ferries.js")] + dirs,
                             capture_output=True, text=True, check=True).stdout
        self.assertEqual(eval(out.replace("true", "True")), [
            "Германия ↔ Балтия", "Германия ↔ Балтия", "Норвегия", "Дания", "Дания",
            "Швеция", "Германия ↔ Финляндия", "Эстония", "Дания"])

    def test_css_and_legend(self):
        with open(os.path.join(ROOT, "static", "ferries.js"), encoding="utf8") as f:
            s = f.read()
        for cls in ("bl", "no"):
            self.assertIn(f".ln.{cls}{{stroke:var(--c-{cls})}}", s)
            self.assertIn(f"--c-{cls}:#", s)
        self.assertIn("Германия ↔ Балтия</span>", s)
        self.assertIsNotNone(re.search(r'reg === "Норвегия" \? "no"', s))


class TabsLayoutTest(unittest.TestCase):
    """v3.353: вкладки — слева Флот · Truck Info · Паромы, справа GF · From → To · Локатор · Рейтинг · [.]; Truck Info без «в разработке»."""
    def test_order_and_wip(self):
        with open(os.path.join(ROOT, "templates", "index.html"), encoding="utf8") as f:
            nav = f.read().split('<nav class="main-tabs">')[1].split("</nav>")[0]
        tabs = re.findall(r'data-tab="(\w+)"|class="(main-tabs-spacer)"', nav)
        order = [a or b for a, b in tabs]
        self.assertEqual(order, ["fleet", "truckinfo", "ferries", "main-tabs-spacer", "gf", "route", "maps", "maps", "rating", "notes"])
        self.assertNotRegex(nav, r'data-tab="truckinfo"[^>]*data-wip')
        self.assertRegex(nav, r'data-tab="gf" data-wip')

    def test_blue_style(self):
        with open(os.path.join(ROOT, "static", "style.css"), encoding="utf8") as f:
            css = f.read()
        self.assertIn(".main-tab-btn:hover,\n.main-tab-btn.active {\n  background: #2f6fd6;", css)
        self.assertNotIn(".main-tab-btn.ref-tab {", css)


class MapTypeToggleTest(unittest.TestCase):
    """v3.353: свой переключатель «Сат» / «Карта» вместо родного «Map ▾» на всех картах (static/maps-common.js)."""
    def test_toggle(self):
        with open(os.path.join(ROOT, "static", "maps-common.js"), encoding="utf8") as f:
            js = f.read()
        self.assertIn("mapTypeControl: false", js)
        self.assertNotIn("MapTypeControlStyle", js)
        self.assertIn("mapTypeBtn(map);", js)
        self.assertIn('sat ? "Карта" : "Сат"', js)
        with open(os.path.join(ROOT, "static", "addr-tab.js"), encoding="utf8") as f:
            self.assertNotIn("mapTypeControl", f.read())          # карточка адреса не возвращает родной переключатель
        with open(os.path.join(ROOT, "static", "style.css"), encoding="utf8") as f:
            self.assertIn(".mc-mt:hover { background: #2f6fd6;", f.read())


if __name__ == "__main__":
    unittest.main()
