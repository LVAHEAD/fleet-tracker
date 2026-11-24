"""v3.384: фикс-время, на которое не хватает смены, — опоздун (красная строка), а «ждёт» и «успевает» — нет."""
import json
import os
import shutil
import subprocess
import unittest

from tests import ROOT

NODE = shutil.which("node")

DRIVER = r"""
const fs = require('fs'), vm = require('vm');
vm.runInThisContext(fs.readFileSync(process.argv[1], 'utf8'));
globalThis.fixViewAllowed = () => true;
const p2 = (n) => String(n).padStart(2, '0');
const t = new Date(Date.now() + 86400000);                 // завтра
const d = p2(t.getDate()) + '/' + p2(t.getMonth() + 1);
const eta = d + ' 01:15', slot = d + ' at 06.00';
const out = {};
out.short = deliveryCheck({ delivery: slot }, eta, { drive: 7 * 3600, shift: 3 * 3600 + 900 }).late;   // смена 3:15, слот через 4:45
out.fits = deliveryCheck({ delivery: slot }, eta, { drive: 7 * 3600, shift: 9 * 3600 }).late;          // смены хватает
out.noleft = deliveryCheck({ delivery: slot }, eta, null).late;                                        // нет данных тахографа
out.plain = deliveryCheck({ delivery: d + ' 06.00' }, eta, { drive: 7 * 3600, shift: 3 * 3600 + 900 }).late;   // без «at» — просто срок
out.late = deliveryCheck({ delivery: slot }, d + ' 07:00', { drive: 7 * 3600, shift: 9 * 3600 }).late;          // приехал позже слота
console.log(JSON.stringify(out));
"""


@unittest.skipUnless(NODE, "нужен node")
class FixShortLate(unittest.TestCase):
    def test_short_is_late(self):
        path = os.path.join(ROOT, "static", "delivery-check.js")
        r = subprocess.run([NODE, "-e", DRIVER, path], capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)
        o = json.loads(r.stdout.strip().splitlines()[-1])
        self.assertEqual(o, {"short": True, "fits": False, "noleft": False, "plain": False, "late": True})


if __name__ == "__main__":
    unittest.main()
