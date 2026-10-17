"""v3.144: фильтр-календарь по TimeSlot (static/slot-filter.js): чистые функции — на node, подключение — проверкой текста."""
import json
import os
import subprocess
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*p):
    with open(os.path.join(ROOT, *p), encoding="utf-8") as f:
        return f.read()


DRIVER = r"""
const fs = require('fs'), vm = require('vm');
const dc = fs.readFileSync(process.argv[1], 'utf8'), sf = fs.readFileSync(process.argv[2], 'utf8');
// заглушки из fleet-sort-filter.js: первая непройденная точка и точка по номеру
globalThis.firstOpenIdx = (row) => { const n = 1 + (row.extra ? row.extra.length : 0); for (let k = 0; k < n; k++) if (!(row.done || {})[k]) return k; return -1; };
globalThis.pointOf = (row, k) => (k === 0 ? { delivery: row.delivery } : (row.extra && row.extra[k - 1]) || null);
vm.runInThisContext(dc + "\n;globalThis.__dc = { parseDeliveryWindow };");
vm.runInThisContext(sf + "\n;globalThis.__api = { slotDayKey, slotWindowDays, rowSlotDays, rowPassesSlot, set: (a) => { slotFilter = a; } };");
const a = globalThis.__api;
const now = new Date(), y = now.getFullYear();
const key = (d, m) => a.slotWindowDays(d + '/' + m)[0];   // год подбирает сам разбор (mkDate), тест от даты запуска не зависит
const out = {};
out.single = a.slotWindowDays('17/10');
out.range = a.slotWindowDays('17/10 22:00 - 18/10 06:00');
out.nodate = [a.slotWindowDays('tba'), a.slotWindowDays(''), a.slotWindowDays('окно выгрузки')];
const rows = [
  { unit: 'A', delivery: '17/10', extra: [{ delivery: '19/10 02-04' }] },          // 17 и 19
  { unit: 'B', delivery: '', extra: [{ delivery: 'tba' }, { delivery: '20/10' }] },  // смотрим дальше: 20
  { unit: 'C', delivery: 'tba', extra: [] },                                          // даты нет — виден всегда
  { unit: 'D', delivery: '17/10', extra: [{ delivery: '21/10' }], done: { 0: true } }, // ① пройдена: только 21
  { unit: '', delivery: '25/10' },                                                    // пустая строка — всегда
];
a.set([]);
out.none = rows.map((r) => a.rowPassesSlot(r));
a.set([key(17, 10)]);
out.d17 = rows.map((r) => a.rowPassesSlot(r));
a.set([key(20, 10)]);
out.d20 = rows.map((r) => a.rowPassesSlot(r));
a.set([key(19, 10), key(21, 10)]);
out.d19_21 = rows.map((r) => a.rowPassesSlot(r));
console.log(JSON.stringify(out));
"""


class SlotFilterTest(unittest.TestCase):
    def test_wiring(self):
        html = _read("templates", "index.html")
        self.assertIn('id="slot-flt-th"', html)
        self.assertLess(html.index("slot-filter.js"), html.index("app.js"))
        sf = _read("static", "fleet-sort-filter.js")
        self.assertIn("rowPassesSlot(row)", sf)
        self.assertLess(sf.index("rowPassesClient(row)"), sf.index("rowPassesSlot(row)"))

    def test_logic_on_node(self):
        try:
            r = subprocess.run(["node", "-e", DRIVER.replace("process.argv[1]", "'%s'" % os.path.join(ROOT, "static", "delivery-check.js"))
                                .replace("process.argv[2]", "'%s'" % os.path.join(ROOT, "static", "slot-filter.js"))],
                               capture_output=True, text=True, timeout=30)
        except FileNotFoundError:
            self.skipTest("нет node")
        self.assertEqual(r.returncode, 0, r.stderr)
        o = json.loads(r.stdout)
        self.assertEqual(len(o["single"]), 1)
        self.assertEqual(len(o["range"]), 2)                      # окно через полночь — оба дня
        self.assertEqual(o["nodate"], [[], [], []])
        self.assertEqual(o["none"], [True] * 5)
        self.assertEqual(o["d17"], [True, False, True, False, True])     # A (17), C без даты, пустая строка
        self.assertEqual(o["d20"], [False, True, True, False, True])     # B смотрит дальше пустой ① и «tba»
        self.assertEqual(o["d19_21"], [True, False, True, True, True])   # A (19), D (21 — ① пройдена)


if __name__ == "__main__":
    unittest.main()
