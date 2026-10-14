"""v3.109: обмен тягачами с чужой строкой (галочка «Обмен»): встреча вставляется перед первой непройденной точкой чужого трипа,
тягач в ней меняется, ручные ✓ сдвигаются; отмена возвращает обе строки. Гоняет настоящий static/trailer-swap.js через node (нет node — пропуск)."""
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
const code = fs.readFileSync(process.argv[1], 'utf8');
vm.runInThisContext(stubs + code + "\n;globalThis.__api = { exchangeSlot, applyExchange, undoExchange, applyTransfer, undoTransfer, ptLo, ptBtnText, swapCandidate };");
const a = globalThis.__api;
const clone = (x) => JSON.parse(JSON.stringify(x));
// строка диспетчера JZ: тягач OI-3577, ①② пройдены, ③ следующая, ручной ✓ у ⑤ (не по порядку) и «не пройдена» у ④
const jz = () => ({ id: 2, unit: 'OI-3577', trailer: 'T2', target: 'A', crew: 'solo', x10: true, done: { 0: true, 1: true, 3: false, 4: true },
  extra: [{ target: 'B', lo: 'O' }, { target: 'C', lo: 'O' }, { target: 'D' }, { target: 'E' }] });
const out = {};
let b = jz();
out.slot = [a.exchangeSlot(b, 2), a.exchangeSlot(b, 1), a.exchangeSlot(b, 0), a.exchangeSlot(b, -1), a.exchangeSlot({}, -1)];
a.applyExchange(b, 2, 'OI-1781', 'OI-3577', 1700000000000, 1);
out.after = clone({ unit: b.unit, trailer: b.trailer, crew: b.crew || null, x10: b.x10 || null, open: b.open, done: b.done,
  targets: [b.target].concat(b.extra.map((x) => x.target)), swap: b.extra[1].swap, lo: a.ptLo(b.extra[1]), btn: a.ptBtnText(b.extra[1]) });
out.cand_in_other = a.swapCandidate(b, 2);                   // вставленная встреча уже со следом — не спрашиваем
out.undo = a.undoExchange(b, 2, 1700000000000);
out.undone = clone({ unit: b.unit, done: b.done, targets: [b.target].concat(b.extra.map((x) => x.target)) });
b = jz();
a.applyExchange(b, 2, 'OI-1781', 'OI-3577', 5, 1);
out.undo_wrong_time = a.undoExchange(b, 2, 6);
out.undo_wrong_slot = a.undoExchange(b, 3, 5);
// все точки пройдены — встреча в конец
let c = { id: 3, unit: 'OI-3577', target: 'A', extra: [{ target: 'B' }], done: { 0: true, 1: true } };
const p = a.exchangeSlot(c, -1);
a.applyExchange(c, p, 'OI-1781', 'OI-3577', 7, 1);
out.end = clone({ p, targets: [c.target].concat(c.extra.map((x) => x.target)), done: c.done, unit: c.unit });
// пара в моей строке
const mine = { id: 1, unit: 'OI-1781', trailer: 'T1', target: 'A', extra: [{ target: 'OI-3577' }], done: { 0: true } };
out.pair = [a.applyTransfer(mine, 1, 'OI-3577', 1700000000000, { rid: 2, p: 2 }), mine.unit, clone(mine.extra[0].swap)];
out.undo_mine = [a.undoTransfer(mine, 1), mine.unit, mine.extra[0].swap || null];
console.log(JSON.stringify(out));
"""


@unittest.skipUnless(NODE, "нет node")
class ExchangeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        out = subprocess.run([NODE, "-e", DRIVER, os.path.join(ROOT, "static", "trailer-swap.js")],
                             capture_output=True, text=True, timeout=60)
        if out.returncode:
            raise RuntimeError(out.stderr)
        cls.r = json.loads(out.stdout)

    def test_slot(self):
        # перед первой непройденной; -1 (всё пройдено) — в конец; нет пройденных (0) — вставить нельзя
        self.assertEqual(self.r["slot"], [2, 1, None, 5, 1])   # в строке из 5 точек «в конец» — место 5; в строке без точек — 1

    def test_exchange_inserts_meeting(self):
        a = self.r["after"]
        self.assertEqual(a["unit"], "OI-1781")                         # тягач в чужой строке сменился
        self.assertEqual(a["trailer"], "T2")                           # его прицеп остаётся
        self.assertIsNone(a["crew"])
        self.assertIsNone(a["x10"])
        self.assertTrue(a["open"])
        self.assertEqual(a["targets"], ["A", "B", "OI-1781", "C", "D", "E"])   # встреча — перед первой непройденной ③
        # ручные ✓: ①② на месте, встреча ✓, «④ не пройдена» и «⑤ ✓» сдвинулись на одну точку
        self.assertEqual(a["done"], {"0": True, "1": True, "2": True, "4": False, "5": True})
        self.assertEqual(a["swap"], {"from": "OI-3577", "to": "OI-1781", "at": 1700000000000, "pair": {"rid": 1}})
        self.assertEqual((a["lo"], a["btn"]), ("", "⇄"))
        self.assertIsNone(self.r["cand_in_other"])

    def test_undo_exchange(self):
        self.assertTrue(self.r["undo"])
        u = self.r["undone"]
        self.assertEqual(u["unit"], "OI-3577")
        self.assertEqual(u["targets"], ["A", "B", "C", "D", "E"])
        self.assertEqual(u["done"], {"0": True, "1": True, "3": False, "4": True})   # как было до обмена

    def test_undo_only_the_same_meeting(self):
        self.assertFalse(self.r["undo_wrong_time"])
        self.assertFalse(self.r["undo_wrong_slot"])

    def test_meeting_at_end(self):
        e = self.r["end"]
        self.assertEqual(e["p"], 2)
        self.assertEqual(e["targets"], ["A", "B", "OI-1781"])
        self.assertEqual(e["done"], {"0": True, "1": True, "2": True})
        self.assertEqual(e["unit"], "OI-1781")

    def test_pair_in_my_row(self):
        ok, unit, sw = self.r["pair"]
        self.assertTrue(ok)
        self.assertEqual(unit, "OI-3577")
        self.assertEqual(sw, {"from": "OI-1781", "to": "OI-3577", "at": 1700000000000, "pair": {"rid": 2, "p": 2}})
        self.assertEqual(self.r["undo_mine"], [True, "OI-1781", None])


if __name__ == "__main__":
    unittest.main()
