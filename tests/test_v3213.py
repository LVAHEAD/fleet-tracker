"""v3.213: обмен тягачами — если в чужой строке на месте встречи уже стоит точка-машина с нашим номером,
встречей становится она сама (без дубля «машина → сама к себе»); отмена оставляет точку на месте.
Гоняет настоящий static/trailer-swap.js под node."""
import json
import os
import shutil
import subprocess
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE = shutil.which("node")

DRIVER = r"""
const fs = require('fs'), vm = require('vm');
const stubs = `
  const unitsCache = [{kind:'truck', number:'OI-3197'}, {kind:'truck', number:'NP-7449'}];
  const normNo = (s) => String(s || "").toUpperCase().replace(/[\\s\\-]/g, "");
  const findUnitNo = (n, kind) => { const u = unitsCache.find((x) => x.kind === kind && normNo(x.number) === normNo(n)); return u ? u.number : null; };
  const loText = (lo) => lo === "L" ? "L" : lo === "O" ? "O" : "L/O";
  const loClass = (lo) => lo === "L" ? "lo-L" : lo === "O" ? "lo-O" : "";
  const loTitle = () => "обычный";
  const document = { addEventListener() {} };
`;
vm.runInThisContext(stubs + fs.readFileSync(process.argv[1], 'utf8') + "\n;globalThis.__api = { applyExchange, undoExchange, exchangeReuses };");
const a = globalThis.__api;
const clone = (x) => JSON.parse(JSON.stringify(x));
// строка OI-3197: ① пройдена, ② «NP-7449» (встреча введена заранее), ③ Baza
const row = () => ({ id: 2, unit: 'OI-3197', target: 'AGRICOLA', done: { 0: true },
  extra: [{ target: 'NP-7449' }, { target: 'Baza Parking' }] });
const out = {};
let b = row();
out.reuses = [a.exchangeReuses(b, 1, 'NP-7449'), a.exchangeReuses(b, 2, 'NP-7449'), a.exchangeReuses(b, 1, 'OI-3197')];
a.applyExchange(b, 1, 'NP-7449', 'OI-3197', 77, 1);
out.after = clone({ unit: b.unit, done: b.done, targets: [b.target].concat(b.extra.map((x) => x.target)), swap: b.extra[0].swap });
out.undo = a.undoExchange(b, 1, 77);
out.undone = clone({ unit: b.unit, done: b.done, targets: [b.target].concat(b.extra.map((x) => x.target)), swap: b.extra[0].swap || null });
// без заранее введённой точки — как раньше: встреча вставляется
b = row(); b.extra[0].target = 'Другая точка';
a.applyExchange(b, 1, 'NP-7449', 'OI-3197', 78, 1);
out.inserted = clone({ targets: [b.target].concat(b.extra.map((x) => x.target)), reuse: b.extra[0].swap.reuse || null });
console.log(JSON.stringify(out));
"""


@unittest.skipUnless(NODE, "нет node")
class ExchangeReuseTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        out = subprocess.run([NODE, "-e", DRIVER, os.path.join(ROOT, "static", "trailer-swap.js")],
                             capture_output=True, text=True, timeout=60)
        if out.returncode:
            raise RuntimeError(out.stderr)
        cls.r = json.loads(out.stdout)

    def test_reuses(self):
        self.assertEqual(self.r["reuses"], [True, False, False])

    def test_no_duplicate(self):
        a = self.r["after"]
        self.assertEqual(a["targets"], ["AGRICOLA", "NP-7449", "Baza Parking"])
        self.assertEqual(a["unit"], "NP-7449")
        self.assertTrue(a["done"]["1"])
        self.assertTrue(a["swap"]["reuse"])

    def test_undo_keeps_point(self):
        self.assertTrue(self.r["undo"])
        u = self.r["undone"]
        self.assertEqual(u["targets"], ["AGRICOLA", "NP-7449", "Baza Parking"])
        self.assertEqual(u["unit"], "OI-3197")
        self.assertNotIn("1", u["done"])
        self.assertIsNone(u["swap"])

    def test_still_inserts_without_machine_point(self):
        self.assertEqual(self.r["inserted"]["targets"], ["AGRICOLA", "NP-7449", "Другая точка", "Baza Parking"])
        self.assertIsNone(self.r["inserted"]["reuse"])


if __name__ == "__main__":
    unittest.main()
