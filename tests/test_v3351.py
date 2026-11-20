"""v3.351: Ctrl+клик по «+» вставляет пустую точку ВЫШЕ (static/stop-insert.js через node; нет node — пропуск).
Выше ②+: точки ниже сдвигаются со своими полями и ручными ✓. Выше ①: старая ① (цель, дата, примечание, комментарий, перецеп) уходит в ②."""
import json
import os
import shutil
import subprocess
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE = shutil.which("node")

DRIVER = r"""
const fs = require('fs'), vm = require('vm');
vm.runInThisContext(fs.readFileSync(process.argv[1], 'utf8') + "\n;globalThis.__f = insertStopAbove;");
const f = globalThis.__f;
const mk = () => ({ id: 1, client: 'C', target: 'A', lo: 'L', delivery: '21/11 20-23', note: 'нA', com: 'комA', swap: { from: 'X', to: 'Y', at: 1 },
  done: { 0: true, 2: true }, doneBy: { 2: { who: 'VL' } },
  extra: [{ target: 'B', lo: 'L', delivery: '21/11', note: 'нB' }, { target: 'C', lo: 'O', note: 'нC', com: 'комC' }] });
const a = mk(); const ka = f(a, 0);
const b = mk(); const kb = f(b, 2);
const c = mk(); const kc = f(c, 1);
console.log(JSON.stringify({ a, ka, b, kb, c, kc }));
"""


@unittest.skipUnless(NODE, "нет node")
class StopInsertTest(unittest.TestCase):
    def test_insert_above(self):
        out = subprocess.run([NODE, "-e", DRIVER, os.path.join(ROOT, "static", "stop-insert.js")],
                             capture_output=True, text=True, check=True).stdout
        r = json.loads(out)
        # выше ①: пустая ①, старая ① — ②, поля и ✓ сдвинулись
        a = r["a"]
        self.assertEqual((r["ka"], a["target"], a["note"], a["delivery"], a["lo"]), (0, "", "", "", ""))
        self.assertNotIn("com", a)
        self.assertNotIn("swap", a)
        self.assertEqual(a["client"], "C")
        e = a["extra"]
        self.assertEqual([x["target"] for x in e], ["A", "B", "C"])
        self.assertEqual((e[0]["note"], e[0]["com"], e[0]["delivery"], e[0]["swap"]["to"]), ("нA", "комA", "21/11 20-23", "Y"))
        self.assertEqual(a["done"], {"1": True, "3": True})
        self.assertEqual(a["doneBy"], {"3": {"who": "VL"}})
        # выше ③ (k=2): новая ③, прежняя ③ — ④; ① и ② на месте
        b = r["b"]
        self.assertEqual(r["kb"], 2)
        self.assertEqual([x["target"] for x in b["extra"]], ["B", "", "C"])
        self.assertEqual((b["extra"][2]["note"], b["extra"][2]["com"]), ("нC", "комC"))
        self.assertEqual((b["target"], b["note"], b["com"]), ("A", "нA", "комA"))
        self.assertEqual(b["done"], {"0": True, "3": True})
        # выше ② (k=1): между ① и старой ②
        c = r["c"]
        self.assertEqual([x["target"] for x in c["extra"]], ["", "B", "C"])
        self.assertEqual(c["done"], {"0": True, "3": True})
        self.assertEqual(c["target"], "A")


if __name__ == "__main__":
    unittest.main()
