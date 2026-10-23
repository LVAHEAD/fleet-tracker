"""v3.195: именные плашки — pointKind (static/point-kind.js): граница → B, База → home, порт → port, брокер (customs) → cust. Гоняет настоящий файл через node."""
import json
import os
import shutil
import subprocess
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE = shutil.which("node")

DRIVER = r"""
const fs = require('fs'), vm = require('vm');
vm.runInThisContext(fs.readFileSync(process.argv[1], 'utf8') + "\n;globalThis.__api = { pointKind, ptkAttr };");
const a = globalThis.__api;
console.log(JSON.stringify({
  border: a.pointKind('Svinesund Border', null),
  border_customs: a.pointKind('Svinesund Border', { name: 'Svinesund Border', type: 'customs' }),
  base: a.pointKind('Baza Parking', null),
  base_lower: a.pointKind('baza', null),
  port: a.pointKind('Rostock Port', { name: 'Rostock Port', type: 'port' }),
  broker: a.pointKind('DESFRU Valencia', { name: 'DESFRU Valencia', type: 'customs' }),
  broker_noaddr: a.pointKind('DESFRU Valencia', null),
  plain: a.pointKind('KESKO KV2', { name: 'KESKO KV2', type: 'unload' }),
  empty: a.pointKind('', null),
  attr: a.ptkAttr('home'), attr_empty: a.ptkAttr(''),
}));
"""


@unittest.skipUnless(NODE, "нет node")
class PointKindTest(unittest.TestCase):
    def test_kinds(self):
        out = subprocess.run([NODE, "-e", DRIVER, os.path.join(ROOT, "static", "point-kind.js")],
                             capture_output=True, text=True, check=True).stdout
        r = json.loads(out)
        self.assertEqual(r["border"], "B")
        self.assertEqual(r["border_customs"], "B")      # слово «Border» важнее Type = customs
        self.assertEqual(r["base"], "home")
        self.assertEqual(r["base_lower"], "home")
        self.assertEqual(r["port"], "port")
        self.assertEqual(r["broker"], "cust")
        self.assertEqual(r["broker_noaddr"], "")        # без записи адресной базы типа нет
        self.assertEqual(r["plain"], "")
        self.assertEqual(r["empty"], "")
        self.assertEqual(r["attr"], ' data-ptk="home"')
        self.assertEqual(r["attr_empty"], "")

    def test_wired(self):
        idx = open(os.path.join(ROOT, "templates", "index.html"), encoding="utf-8").read()
        self.assertIn("point-kind.js", idx)
        self.assertIn('id="addrBaseRefresh"', idx)
        app = open(os.path.join(ROOT, "static", "app.js"), encoding="utf-8").read()
        self.assertEqual(app.count("pointKind("), 4)


if __name__ == "__main__":
    unittest.main()
