"""v3.108: перецеп — смена тягача у прицепа. Точка с траком в цели — встреча; по ✓ «Да» меняет тягач в строке,
ставит след point.swap и ✓, «отмена» возвращает всё назад. Гоняет настоящий static/trailer-swap.js через node (нет node — пропуск)."""
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
  const unitsCache = [{kind:'truck', number:'OI-1781'}, {kind:'truck', number:'OI-3577'}, {kind:'trailer', number:'C-859G'}];
  const normNo = (s) => String(s || "").toUpperCase().replace(/[\\s\\-]/g, "");
  const findUnitNo = (n, kind) => { const u = unitsCache.find((x) => x.kind === kind && normNo(x.number) === normNo(n)); return u ? u.number : null; };
  const loText = (lo) => lo === "L" ? "L" : lo === "O" ? "O" : "L/O";
  const loClass = (lo) => lo === "L" ? "lo-L" : lo === "O" ? "lo-O" : "";
  const loTitle = () => "обычный";
  const document = { addEventListener() {} };
`;
const code = fs.readFileSync(process.argv[1], 'utf8');
vm.runInThisContext(stubs + code + "\n;globalThis.__api = { swapPoint, ptTruckNo, ptLo, swapCandidate, applyTransfer, undoTransfer, rowIsEmpty, ptBtnText, ptBtnClass, ptBtnTitle };");
const a = globalThis.__api;
const mk = () => ({
  id: 1, unit: 'OI-1781', trailer: 'C-859G', lo: 'L', target: 'IT04', crew: 'team', x10: true,
  done: { 0: true, 1: true }, doneSeen: { IT04: '13/10 14:00' },
  extra: [{ lo: 'O', target: 'IT00' }, { lo: 'O', target: 'OI-3577' }, { lo: 'O', target: 'Baza Parking' }, { lo: 'O', target: 'FI04' }],
});
const out = {};
let r = mk();
out.lo = [a.ptLo(r.extra[1]), a.ptLo(r.extra[2]), a.ptLo(r), a.ptLo(null)];
out.cand = [a.swapCandidate(r, 2), a.swapCandidate(r, 3), a.swapCandidate(r, 0), a.swapCandidate(r, 9)];
out.cand_loose = a.swapCandidate({ unit: 'OI-1781', extra: [{ target: 'oi 3577' }] }, 1);
out.cand_own = a.swapCandidate({ unit: 'OI-3577', extra: [{ target: 'OI-3577' }] }, 1);
out.btn_before = [a.ptBtnText(r.extra[1]), a.ptBtnClass(r.extra[1]), a.ptBtnTitle(r.extra[1]), a.ptBtnText(r.extra[2])];
out.ok = a.applyTransfer(r, 2, 'OI-3577', 1700000000000);
out.after = JSON.parse(JSON.stringify({ unit: r.unit, trailer: r.trailer, done: r.done, seen: r.doneSeen, crew: r.crew || null, x10: r.x10 || null,
  swap: r.extra[1].swap, n: r.extra.length, targets: r.extra.map((x) => x.target) }));
out.btn_after = [a.ptBtnText(r.extra[1]), a.ptBtnClass(r.extra[1]), a.ptBtnTitle(r.extra[1]).split('\n')[0].split(',')[0], a.ptLo(r.extra[1])];
out.cand_after = a.swapCandidate(r, 2);
out.again = a.applyTransfer(r, 2, 'OI-1781', 1);
out.undo = a.undoTransfer(r, 2);
out.undone = { unit: r.unit, swap: r.extra[1].swap || null, done: r.done };
out.undo_again = a.undoTransfer(r, 2);
const z = { unit: 'OI-1781', target: 'OI-3577', done: { 1: true } };
out.k0 = [a.applyTransfer(z, 0, 'OI-3577', 5), z.unit, z.swap && z.swap.from, z.done[0], a.ptBtnText(z)];
out.empty = [a.rowIsEmpty({ target: '' }), a.rowIsEmpty({ target: ' ', extra: [{ target: '' }] }), a.rowIsEmpty({ target: 'x' }), a.rowIsEmpty({ target: '', extra: [{ target: 'FI04' }] })];
console.log(JSON.stringify(out));
"""


@unittest.skipUnless(NODE, "нет node")
class TrailerSwapTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        out = subprocess.run([NODE, "-e", DRIVER, os.path.join(ROOT, "static", "trailer-swap.js")],
                             capture_output=True, text=True, timeout=60)
        if out.returncode:
            raise RuntimeError(out.stderr)
        cls.r = json.loads(out.stdout)

    def test_neutral_type_for_truck_target(self):
        # цель-трак — тип нейтральный (даже если был «O»), обычная точка и ① свой тип сохраняют
        self.assertEqual(self.r["lo"], ["", "O", "L", ""])
        self.assertEqual(self.r["btn_before"][:2], ["L/O", ""])
        self.assertIn("Встреча с OI-3577", self.r["btn_before"][2])
        self.assertEqual(self.r["btn_before"][3], "O")

    def test_candidate(self):
        # спрашиваем только у точки с чужим траком в цели; номер ищем без учёта регистра / пробелов / дефиса
        self.assertEqual(self.r["cand"], ["OI-3577", None, None, None])
        self.assertEqual(self.r["cand_loose"], "OI-3577")
        self.assertIsNone(self.r["cand_own"])

    def test_transfer(self):
        a = self.r["after"]
        self.assertTrue(self.r["ok"])
        self.assertEqual(a["unit"], "OI-3577")
        self.assertEqual(a["trailer"], "C-859G")                      # прицеп остаётся в строке
        self.assertEqual(a["done"], {"0": True, "1": True, "2": True})  # старые ✓ целы, перецеп ✓
        self.assertEqual(a["seen"], {"IT04": "13/10 14:00"})          # авто-✓ по тексту точки целы
        self.assertIsNone(a["crew"])                                  # режим экипажа и «+1 ч» были про старый тягач
        self.assertIsNone(a["x10"])
        self.assertEqual(a["swap"], {"from": "OI-1781", "to": "OI-3577", "at": 1700000000000})
        self.assertEqual(a["n"], 4)                                   # точки не копируются и не пропадают
        self.assertEqual(a["targets"], ["IT00", "OI-3577", "Baza Parking", "FI04"])

    def test_swap_mark(self):
        self.assertEqual(self.r["btn_after"], ["⇄", "lo-swap", "Перецеп: OI-1781 → OI-3577", ""])
        self.assertIsNone(self.r["cand_after"])                       # второй раз не спрашиваем
        self.assertFalse(self.r["again"])

    def test_undo(self):
        self.assertTrue(self.r["undo"])
        self.assertEqual(self.r["undone"], {"unit": "OI-1781", "swap": None, "done": {"0": True, "1": True}})
        self.assertFalse(self.r["undo_again"])

    def test_first_point(self):
        self.assertEqual(self.r["k0"], [True, "OI-3577", "OI-1781", True, "⇄"])

    def test_empty_row(self):
        self.assertEqual(self.r["empty"], [True, True, False, False])


if __name__ == "__main__":
    unittest.main()
