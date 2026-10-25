"""v3.211: цепочка перецепа у пройденной точки (static/swap-chain.js, функция swapChain) — по следам point.swap.
Гоняет настоящий файл через node (нет node — пропуск)."""
import json
import os
import shutil
import subprocess
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE = shutil.which("node")

DRIVER = r"""
const fs = require('fs'), vm = require('vm');
const stubs = `const normNo = (s) => String(s || "").toUpperCase().replace(/[\\s\\-]/g, "");`;
const code = fs.readFileSync(process.argv[1], 'utf8');
vm.runInThisContext(stubs + code + "\n;globalThis.__api = { swapChain };");
const f = globalThis.__api.swapChain;
const sw = (from, to) => ({ swap: { from, to, at: 1 } });
const out = {};
// один перецеп 1234 → 2222 у точки ②
const r1 = { unit: '2222', target: 'A', extra: [{ target: 'B' }, Object.assign({ target: '2222' }, sw('1234', '2222')), { target: 'C' }] };
out.one = f(r1, 2);
out.none_plain = f(r1, 1);
out.none_after = f(r1, 3);
// два перецепа: 1234 → 2222, потом 2222 → 3333
const r2 = { unit: '3333', target: 'A', extra: [Object.assign({ target: '2222' }, sw('1234', '2222')), { target: 'B' }, Object.assign({ target: '3333' }, sw('2222', '3333'))] };
out.two_first = f(r2, 1);
out.two_second = f(r2, 3);
// след у ① (row.swap)
out.first = f({ unit: '2222', target: '2222', swap: { from: '1234', to: '2222', at: 1 }, extra: [] }, 0);
// чужой более ранний перецеп в цепочку не входит
const r3 = { unit: '3333', target: 'A', extra: [Object.assign({ target: '9999' }, sw('1111', '9999')), Object.assign({ target: '3333' }, sw('2222', '3333'))] };
out.unrelated = f(r3, 2);
// регистр и дефисы в номерах не мешают
const r4 = { unit: '3333', target: 'A', extra: [Object.assign({ target: 'oi 2222' }, sw('OI-1234', 'OI-2222')), Object.assign({ target: '3333' }, sw('oi2222', 'OI-3333'))] };
out.norm = f(r4, 2);
// встреча без перецепа
out.no_swap = f({ unit: 'X', target: 'A', extra: [{ target: 'OI-1' }] }, 1);
out.bad = f(null, 0);
console.log(JSON.stringify(out));
"""


@unittest.skipUnless(NODE, "нет node")
class SwapChain(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        p = subprocess.run([NODE, "-e", DRIVER, os.path.join(ROOT, "static", "swap-chain.js")],
                           capture_output=True, text=True, timeout=60)
        assert p.returncode == 0, p.stderr
        cls.o = json.loads(p.stdout)

    def test_one_swap(self):
        self.assertEqual(self.o["one"], ["2222", "1234"])

    def test_no_chain_without_swap(self):
        self.assertIsNone(self.o["none_plain"])
        self.assertIsNone(self.o["none_after"])
        self.assertIsNone(self.o["no_swap"])
        self.assertIsNone(self.o["bad"])

    def test_two_swaps(self):
        self.assertEqual(self.o["two_first"], ["2222", "1234"])
        self.assertEqual(self.o["two_second"], ["3333", "2222", "1234"])

    def test_first_point(self):
        self.assertEqual(self.o["first"], ["2222", "1234"])

    def test_unrelated_swap_not_included(self):
        self.assertEqual(self.o["unrelated"], ["3333", "2222"])

    def test_number_format(self):
        self.assertEqual(self.o["norm"], ["OI-3333", "oi2222", "OI-1234"])


DRIVER2 = r"""
const fs = require('fs'), vm = require('vm');
const stubs = `const document = { addEventListener() {} };`;
vm.runInThisContext(stubs + fs.readFileSync(process.argv[1], 'utf8') + "\n;globalThis.__w = exchangeWhere;");
const w = globalThis.__w;
const r = { target: 'A', extra: [{ target: 'B' }, { target: 'C' }] };
console.log(JSON.stringify([w(r, 1), w(r, 2), w(r, 3), w({ target: 'A', extra: [{ target: '' }] }, 1)]));
"""


@unittest.skipUnless(NODE, "нет node")
class ExchangeHint(unittest.TestCase):
    def test_where(self):
        p = subprocess.run([NODE, "-e", DRIVER2, os.path.join(ROOT, "static", "trailer-swap.js")],
                           capture_output=True, text=True, timeout=60)
        self.assertEqual(p.returncode, 0, p.stderr)
        a = json.loads(p.stdout)
        self.assertEqual(a[0], "точкой 2, перед «B»")
        self.assertEqual(a[1], "точкой 3, перед «C»")
        self.assertEqual(a[2], "в конец трипа, точкой 4")
        self.assertIn("пусто", a[3])


if __name__ == "__main__":
    unittest.main()
