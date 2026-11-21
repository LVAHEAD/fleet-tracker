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


if __name__ == "__main__":
    unittest.main()
