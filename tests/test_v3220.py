"""v3.220: обмен с «второй строкой того же тягача»: у неё первая непройденная точка — встреча с тем, кому передаём
(NP-7550: ① пройдена, ② OI-1779). Встреча отмечается ✓ со следом, тягач строки не меняется; отмена его не трогает."""
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
  const unitsCache = [{kind:'truck', number:'NP-7550'}, {kind:'truck', number:'OI-1779'}];
  const normNo = (s) => String(s || "").toUpperCase().replace(/[\\s\\-]/g, "");
  const findUnitNo = (n, kind) => { const u = unitsCache.find((x) => x.kind === kind && normNo(x.number) === normNo(n)); return u ? u.number : null; };
  const loText = () => "L/O"; const loClass = () => ""; const loTitle = () => "";
  const document = { addEventListener() {} };
`;
vm.runInThisContext(stubs + fs.readFileSync(process.argv[1], 'utf8') + "\n;globalThis.__api = { applyExchange, undoExchange, exchangeReuses };");
const a = globalThis.__api;
const clone = (x) => JSON.parse(JSON.stringify(x));
const row = () => ({ id: 2, unit: 'NP-7550', target: 'MYRTEA', done: { 0: true }, extra: [{ target: 'OI-1779' }, { target: 'Bama Fresh Cuts' }] });
const out = {};
let b = row();
out.reuses = [a.exchangeReuses(b, 1, 'NP-7550', 'OI-1779'), a.exchangeReuses(b, 1, 'NP-7550'), a.exchangeReuses(b, 2, 'NP-7550', 'OI-1779')];
a.applyExchange(b, 1, 'NP-7550', 'OI-1779', 55, 1);
out.after = clone({ unit: b.unit, done: b.done, n: b.extra.length, swap: b.extra[0].swap });
out.undo = a.undoExchange(b, 1, 55);
out.undone = clone({ unit: b.unit, done: b.done, n: b.extra.length, swap: b.extra[0].swap || null });
console.log(JSON.stringify(out));
"""


@unittest.skipUnless(NODE, "нет node")
class SameUnitExchangeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        out = subprocess.run([NODE, "-e", DRIVER, os.path.join(ROOT, "static", "trailer-swap.js")],
                             capture_output=True, text=True, timeout=60)
        if out.returncode:
            raise RuntimeError(out.stderr)
        cls.r = json.loads(out.stdout)

    def test_reuses_only_with_partner(self):
        self.assertEqual(self.r["reuses"], [True, False, False])

    def test_marks_meeting_keeps_unit(self):
        a = self.r["after"]
        self.assertEqual((a["unit"], a["n"]), ("NP-7550", 2))
        self.assertTrue(a["done"]["1"])
        self.assertTrue(a["swap"]["reuse"] and a["swap"]["keep"])

    def test_undo_keeps_unit_and_point(self):
        self.assertTrue(self.r["undo"])
        u = self.r["undone"]
        self.assertEqual((u["unit"], u["n"]), ("NP-7550", 2))
        self.assertNotIn("1", u["done"])
        self.assertIsNone(u["swap"])
