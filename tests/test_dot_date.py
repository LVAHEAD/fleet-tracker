"""Дата дд.мм с текстом после неё читается как дата (хотелка OI-7556), голое «22.30» — как время сегодня."""
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
for (const t of ["05.11. 15:00", "05.11 15:00", "05.11. 10:00-14:00", "22.30", "09.15-12.00"]) { const w = __p(t); out[t] = w ? [f(w.start), f(w.end)] : null; }
console.log(JSON.stringify(out));
"""


@unittest.skipUnless(NODE, "нужен node")
class DotDate(unittest.TestCase):
    def test_dot_date(self):
        path = os.path.join(ROOT, "static", "delivery-check.js")
        r = subprocess.run([NODE, "-e", DRIVER, path], capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)
        o = json.loads(r.stdout.strip().splitlines()[-1])
        self.assertEqual(o["05.11. 15:00"][1][:2], [11, 5])
        self.assertEqual(o["05.11 15:00"][1][:2], [11, 5])
        self.assertEqual(o["05.11. 10:00-14:00"], [[11, 5, 10, 0], [11, 5, 14, 0]])
        self.assertNotEqual(o["22.30"][1][:2], [22, 30])      # не дата: месяца 30 нет
        self.assertEqual(o["09.15-12.00"][1][2:], [12, 0])    # время сегодня, как раньше


if __name__ == "__main__":
    unittest.main()
