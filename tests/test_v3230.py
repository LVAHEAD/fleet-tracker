"""v3.230: extrasLate — трак стоит на объекте точки (nbAt / onArr): сравниваем слот со временем приезда, а не с ETA «от сейчас»
(иначе после слота строка «опаздывала» и мигала при приезде раньше). Чистая функция — через node (нет node — пропуск)."""
import json
import os
import shutil
import subprocess
import unittest

from tests import ROOT

NODE = shutil.which("node")

DRIVER = r"""
const fs = require('fs'), vm = require('vm');
vm.runInThisContext(fs.readFileSync(process.argv[1], 'utf8') + "\n;globalThis.__a = { extrasLate };");
const p2 = (n) => String(n).padStart(2, "0");
const f = (d) => `${p2(d.getDate())}/${p2(d.getMonth() + 1)} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
const base = new Date(); base.setMinutes(0, 0, 0);
const at = (h) => new Date(base.getTime() + h * 3600000);
const row = { extra: [{ delivery: `${f(at(-1)).split(" ")[0]} at ${p2(at(-1).getHours())}:00` }] };   // слот был час назад
const nowEta = f(at(0));          // трак стоит на точке: ETA «от сейчас» = текущее время — позже слота
const arr = f(at(-3));            // приехал за 3 ч до слота
const ce = [{ eta_tacho: nowEta }];
console.log(JSON.stringify({
  old: global.__a.extrasLate(row, ce),                  // без onArr — как раньше: «опаздывает»
  onSite: global.__a.extrasLate(row, ce, 0, arr),       // с временем приезда — нет
  lateArr: global.__a.extrasLate(row, ce, 0, nowEta),   // приехал позже слота — да
  otherIdx: global.__a.extrasLate(row, ce, 1, arr),     // onArr относится к другой точке — как раньше
}));
"""


@unittest.skipUnless(NODE, "нужен node")
class ExtrasLateOnSiteTest(unittest.TestCase):
    def test_on_site(self):
        r = subprocess.run([NODE, "-e", DRIVER, os.path.join(ROOT, "static", "delivery-check.js")],
                           capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)
        o = json.loads(r.stdout.strip().splitlines()[-1])
        self.assertTrue(o["old"])
        self.assertFalse(o["onSite"])
        self.assertTrue(o["lateArr"])
        self.assertTrue(o["otherIdx"])


if __name__ == "__main__":
    unittest.main()
