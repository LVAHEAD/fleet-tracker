"""v3.198: отмена перецепа не оставляет «пройденными» точки, ✓ которых набрал другой тягач (запомненные авто-✓ doneSeen / doneArr после точки перецепа).
Гоняет настоящий static/trailer-swap.js через node (нет node — пропуск)."""
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
  const unitsCache = [{kind:'truck', number:'OI-1781'}, {kind:'truck', number:'OI-3577'}];
  const normNo = (s) => String(s || "").toUpperCase().replace(/[\\s\\-]/g, "");
  const findUnitNo = (n, kind) => { const u = unitsCache.find((x) => x.kind === kind && normNo(x.number) === normNo(n)); return u ? u.number : null; };
  const loText = (lo) => lo === "L" ? "L" : lo === "O" ? "O" : "L/O";
  const loClass = (lo) => lo === "L" ? "lo-L" : lo === "O" ? "lo-O" : "";
  const loTitle = () => "обычный";
  const document = { addEventListener() {} };
`;
vm.runInThisContext(stubs + fs.readFileSync(process.argv[1], 'utf8') + "\n;globalThis.__api = { applyTransfer, undoTransfer, dropSeenAfter };");
const a = globalThis.__api;
const r = { id: 1, unit: 'AAA', target: 'ES29', extra: [{ target: 'ES30' }, { target: 'OI-3577' }, { target: 'Baza Parking' }, { target: 'TerminalID (Tallink) Port' }, { target: 'FI04' }],
  doneSeen: { ES29: '19/10 19', ES30: '19/10 09', 'Baza Parking': '23/10', 'TerminalID (Tallink) Port': '24/10 06' },
  doneArr: { ES30: '19/10 08', 'Baza Parking': '23/10 01' } };
a.applyTransfer(r, 2, 'OI-3577', 1);
const ok = a.undoTransfer(r, 2);
console.log(JSON.stringify({ ok, unit: r.unit, seen: r.doneSeen, arr: r.doneArr }));
const s = { target: 'X', extra: [{ target: 'Y' }], doneSeen: { Y: 't' } };
a.dropSeenAfter(s, 0);
console.log(JSON.stringify({ s: s.doneSeen || null }));
"""


@unittest.skipUnless(NODE, "нет node")
class UndoSwapSeenTest(unittest.TestCase):
    def test_undo_drops_seen_after_swap_point(self):
        out = subprocess.run([NODE, "-e", DRIVER, os.path.join(ROOT, "static", "trailer-swap.js")],
                             capture_output=True, text=True, timeout=60, check=True).stdout.strip().split("\n")
        r = json.loads(out[0])
        self.assertTrue(r["ok"])
        self.assertEqual(r["unit"], "AAA")                              # прежний тягач вернулся
        self.assertEqual(r["seen"], {"ES29": "19/10 19", "ES30": "19/10 09"})   # ✓ до точки перецепа остались, после — сняты
        self.assertEqual(r["arr"], {"ES30": "19/10 08"})
        self.assertIsNone(json.loads(out[1])["s"])                      # пустая карта убирается


if __name__ == "__main__":
    unittest.main()
