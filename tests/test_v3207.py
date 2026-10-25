"""v3.207: закладка «Паромы» — фильтры по странам (из / в), разворот текста под выбранную страну, блок «Заказ паромов»."""
import json
import os
import shutil
import subprocess
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE = shutil.which("node")
JS = open(os.path.join(ROOT, "static", "ferries.js"), encoding="utf-8").read()
SNIP = JS[JS.index("const dirParts"):JS.index("function pair(")]


def _run(reg, rows):
    code = ("let reg=%s; const rows=%s;\n%s\n"
            "console.log(JSON.stringify({regions, t: rows.map(r=>[flipDir(r),flipRoute(r),flipPorts(r)])}));"
            % (json.dumps(reg), json.dumps(rows, ensure_ascii=False), SNIP))
    out = subprocess.run([NODE, "-e", code], capture_output=True, text=True, check=True).stdout
    return json.loads(out)


ROWS = [
    {"dir": "Финляндия ↔ Эстония", "route": "Хельсинки ↔ Таллин", "ports": "Helsinki (Vuosaari) · Tallinn (Muuga)"},
    {"dir": "Швеция ↔ Эстония", "route": "Стокгольм ↔ Таллин", "ports": "Stockholm — Tallinn"},
    {"dir": "Германия ↔ Финляндия", "route": "Росток ↔ Ханко", "ports": "DE: Rostock · FI: Hanko"},
]


@unittest.skipUnless(NODE, "нужен node")
class FerriesCountryTest(unittest.TestCase):
    def test_regions_by_count(self):
        r = _run("Все", ROWS)["regions"]
        self.assertEqual(r[0], "Все")
        self.assertEqual(set(r[1:]), {"Финляндия", "Эстония", "Швеция", "Германия"})
        self.assertIn(r[1], ("Финляндия", "Эстония"))        # по две линии — выше остальных

    def test_flip_estonia(self):
        t = _run("Эстония", ROWS)["t"]
        self.assertEqual(t[0], ["Эстония ↔ Финляндия", "Таллин ↔ Хельсинки", "Tallinn (Muuga) · Helsinki (Vuosaari)"])
        self.assertEqual(t[1], ["Эстония ↔ Швеция", "Таллин ↔ Стокгольм", "Tallinn — Stockholm"])

    def test_flip_finland(self):
        t = _run("Финляндия", ROWS)["t"]
        self.assertEqual(t[0][0], "Финляндия ↔ Эстония")             # уже первая — не трогаем
        self.assertEqual(t[2], ["Финляндия ↔ Германия", "Ханко ↔ Росток", "FI: Hanko · DE: Rostock"])

    def test_all_untouched(self):
        t = _run("Все", ROWS)["t"]
        self.assertEqual(t[2], ["Германия ↔ Финляндия", "Росток ↔ Ханко", "DE: Rostock · FI: Hanko"])

    def test_order_block(self):
        self.assertIn('id="ord"', JS)
        self.assertIn('"заказ паромов"', JS)
        self.assertIn("/api/links", JS)

    def test_mobile_layout(self):
        self.assertIn("@media (max-width:760px)", JS)
        for k in ('id="mapbtn"', ".mapwrap.mopen", "grid-template-areas", ".ord:not(.open) a"):
            self.assertIn(k, JS)


if __name__ == "__main__":
    unittest.main()
