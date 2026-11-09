"""v3.294: окно по дням без времени — «09-10/11» и «09/11-10/11» = с 00:00 первого дня до 23:59 последнего.
Клиентский парсер — через node (нет node — пропуск)."""
import json
import os
import shutil
import subprocess
import unittest

from tests import ROOT

NODE = shutil.which("node")

DRIVER = r"""
const fs = require('fs'), vm = require('vm');
vm.runInThisContext(fs.readFileSync(process.argv[1], 'utf8') + "\n;globalThis.__p = parseDeliveryWindow;");
const f = (d) => d ? [d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()] : null;
const out = {};
for (const t of ["09-10/11", "09/11-10/11", "09/11 - 10/11", "10/11"]) { const w = __p(t); out[t] = w ? [f(w.start), f(w.end)] : null; }
console.log(JSON.stringify(out));
"""


@unittest.skipUnless(NODE, "нужен node")
class DayRange(unittest.TestCase):
    def test_day_ranges(self):
        path = os.path.join(ROOT, "static", "delivery-check.js")
        r = subprocess.run([NODE, "-e", DRIVER, path], capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)
        o = json.loads(r.stdout.strip().splitlines()[-1])
        for t in ("09-10/11", "09/11-10/11", "09/11 - 10/11"):
            self.assertEqual(o[t], [[11, 9, 0, 0], [11, 10, 23, 59]], t)
        self.assertEqual(o["10/11"], [None, [11, 10, 23, 59]])   # одна дата — как раньше


if __name__ == "__main__":
    unittest.main()
