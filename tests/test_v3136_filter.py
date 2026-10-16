"""v3.136: «+» / «×» у точки не прячут трип фильтром L / O (NP-7454 при фильтре O).
Причина: lastCalcText сбрасывался, авто-✓ пропадали, пройденная ① считалась открытой, тип строки менялся на L.
Гоняет настоящий static/fleet-sort-filter.js через node (нет node — пропуск)."""
import json
import os
import shutil
import subprocess
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE = shutil.which("node")

DRIVER = r"""
const fs = require('fs'), vm = require('vm');
globalThis.lastCalcText = {};
globalThis.rows = [];
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.ptLo = (p) => (p && p.lo) || "";
globalThis.document = { addEventListener() {}, getElementById() { return null; } };
const code = fs.readFileSync(process.argv[1], 'utf8');
vm.runInThisContext(code + "\n;globalThis.__api = { rowLoKind, shiftDoneFlags, firstOpenIdx };");
const a = globalThis.__api;
const out = {};
// NP-7454: ① L пройдена (авто-✓), ② O
const mk = () => ({ id: 'np', lo: 'L', target: 'A', extra: [{ lo: 'O', target: 'B' }] });
const flags = () => [{ done: true, auto: true }, { done: false }];
const calc = (row) => { lastCalcText[row.id] = { doneFlags: flags() }; };

let row = mk(); calc(row);
out.before = a.rowLoKind(row);

// «+» после ①: новая пустая точка встаёт между ① и ②
row.extra.splice(0, 0, { lo: '', target: '' });
a.shiftDoneFlags(row.id, 1, 1);
delete lastCalcText[row.id];
out.after_add = a.rowLoKind(row);
out.first_open_after_add = a.firstOpenIdx(row);

// то же без сдвига флагов (прежнее поведение): тип менялся на L
row = mk(); row.id = 'old'; calc(row);      // другой id: у него нет запомненных флагов — как до v3.136
row.extra.splice(0, 0, { lo: '', target: '' });
delete lastCalcText[row.id];
out.old_behaviour = a.rowLoKind(row);

// «×» у новой точки — обратно
row = mk(); calc(row);
row.extra.splice(0, 0, { lo: '', target: '' });
a.shiftDoneFlags(row.id, 1, 1);
delete lastCalcText[row.id];
row.extra.splice(0, 1);
a.shiftDoneFlags(row.id, 1, -1);
delete lastCalcText[row.id];
out.after_remove = a.rowLoKind(row);

// строка без известных флагов (ещё не считалась): как раньше — по первой точке
const fresh = mk(); fresh.id = 'fresh';
out.fresh = a.rowLoKind(fresh);

// ручное «не пройдена» важнее авто-✓
row = mk(); calc(row); row.done = { 0: false };
out.manual_wins = a.rowLoKind(row);
console.log(JSON.stringify(out));
"""


@unittest.skipUnless(NODE, "нет node")
class AddStopKeepsRowType(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        out = subprocess.run([NODE, "-e", DRIVER, os.path.join(ROOT, "static", "fleet-sort-filter.js")],
                             capture_output=True, text=True, timeout=60)
        if out.returncode:
            raise RuntimeError(out.stderr)
        cls.r = json.loads(out.stdout)

    def test_type_before(self):
        self.assertEqual(self.r["before"], "O")

    def test_add_stop_keeps_O(self):
        self.assertEqual(self.r["after_add"], "O")             # трип не прячется фильтром O
        self.assertEqual(self.r["first_open_after_add"], 1)    # первая открытая — новая точка, ① по-прежнему пройдена

    def test_old_behaviour_was_L(self):
        self.assertEqual(self.r["old_behaviour"], "L")         # без сдвига флагов — прежний дефект

    def test_remove_stop_keeps_O(self):
        self.assertEqual(self.r["after_remove"], "O")

    def test_fresh_row_and_manual(self):
        self.assertEqual(self.r["fresh"], "L")                 # флагов нет — по первой точке, как раньше
        self.assertEqual(self.r["manual_wins"], "L")           # ручное «не пройдена» важнее авто-✓


class Wiring(unittest.TestCase):
    def test_app_uses_shift(self):
        with open(os.path.join(ROOT, "static", "app.js"), encoding="utf-8") as f:
            src = f.read()
        self.assertIn("shiftDoneFlags(id, k + 1, 1)", src)
        self.assertIn("shiftDoneFlags(id, k, -1)", src)
        self.assertIn("lastDoneFlags[id] = lastCalcText[id].doneFlags", src)


if __name__ == "__main__":
    unittest.main()
