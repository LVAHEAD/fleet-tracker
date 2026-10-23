"""v3.197: закладка «Паромы» — данные линий (static/ferries-data.js), подключение скриптов, схема ссылается на существующие строки."""
import json
import os
import re
import shutil
import subprocess
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE = shutil.which("node")


def _data():
    src = open(os.path.join(ROOT, "static", "ferries-data.js"), encoding="utf-8").read()
    return json.loads(src[src.index("[") : src.rindex("]") + 1])


class FerriesTest(unittest.TestCase):
    def test_data(self):
        rows = _data()
        self.assertEqual(len(rows), 32)
        for r in rows:
            for k in ("dir", "op", "route", "ports", "freq", "cond", "contact"):
                self.assertIn(k, r)
            self.assertTrue(r["op"] and r["route"] and r["freq"])
        self.assertEqual(sum(1 for r in rows if "Эстония" in r["dir"]), 5)

    def test_seg_indices(self):
        js = open(os.path.join(ROOT, "static", "ferries.js"), encoding="utf-8").read()
        seg = js[js.index("const SEG = ["):js.index("function buildMap")]
        ids = {int(x) for x in re.findall(r"\[(\d+),\"", seg)}
        self.assertEqual(ids, set(range(32)))           # у каждой строки таблицы есть линия на схеме
        ports = set(re.findall(r'(\w+):\["', js[js.index("const PORTS = {"):js.index("// [номер строки")]))
        for a, b in re.findall(r'\[\d+,"(\w+)","(\w+)"', seg):
            self.assertIn(a, ports)
            self.assertIn(b, ports)

    def test_wired(self):
        idx = open(os.path.join(ROOT, "templates", "index.html"), encoding="utf-8").read()
        self.assertIn('id="ferries-root"', idx)
        self.assertIn("ferries-data.js", idx)
        self.assertIn("ferries.js", idx)
        self.assertNotIn('<table class="ferries-tbl">', idx)

    @unittest.skipUnless(NODE, "нет node")
    def test_syntax(self):
        for f in ("ferries.js", "ferries-data.js"):
            subprocess.run([NODE, "--check", os.path.join(ROOT, "static", f)], check=True)


if __name__ == "__main__":
    unittest.main()
