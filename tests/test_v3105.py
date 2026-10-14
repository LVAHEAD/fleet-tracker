"""v3.105: TimeSlot «at ЧЧ:ММ» = фикс-время приёмки (окно из одного момента), остальные формы окна — без изменений.
Тест гоняет настоящий static/delivery-check.js через node (нет node — пропуск)."""
import json
import os
import shutil
import subprocess
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE = shutil.which("node")

DRIVER = r"""
const fs = require('fs'), vm = require('vm');
const code = fs.readFileSync(process.argv[1], 'utf8');
vm.runInThisContext(code + "\n;globalThis.__api = { parseDeliveryWindow, deliveryCheck };");
const api = globalThis.__api;
const now = new Date(), p = (n) => String(n).padStart(2, '0');
const hm = (d) => d ? `${p(d.getHours())}:${p(d.getMinutes())}` : null;
const today = `${p(now.getDate())}/${p(now.getMonth() + 1)}`;
const eta = (h, m) => `${today} ${p(h)}:${p(m)}`;
const win = (t) => { const w = api.parseDeliveryWindow(t); return w ? { s: hm(w.start), e: hm(w.end), fixed: !!w.fixed } : null; };
const chk = (t, h, m) => { const r = api.deliveryCheck({ delivery: t }, eta(h, m)); return { late: r.late, lines: r.lines }; };
console.log(JSON.stringify({
  at: win("at 10:30"), AT: win("AT 10.30"), v: win("в 10:30"), pm: win("at 10:30pm"), at_date: win(today + " at 10:30"),
  before: win("до 15"), after: win("after 10"), range: win("09-15"), single: win("10:30"), word: win("tba"),
  c_late: chk("at 10:30", 11, 0), c_ok: chk("at 10:30", 10, 30), c_early: chk("at 10:30", 9, 0),
  r_early: chk("after 10", 8, 0), r_late: chk("до 15", 16, 0)
}));
"""


@unittest.skipUnless(NODE, "нет node")
class FixedTimeSlotTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        out = subprocess.run([NODE, "-e", DRIVER, os.path.join(ROOT, "static", "delivery-check.js")],
                             capture_output=True, text=True, timeout=60)
        if out.returncode:
            raise RuntimeError(out.stderr)
        cls.r = json.loads(out.stdout)

    def test_at_is_fixed_time(self):
        for k in ("at", "AT", "v", "at_date"):
            self.assertEqual(self.r[k], {"s": "10:30", "e": "10:30", "fixed": True}, k)
        self.assertEqual(self.r["AT"]["s"], "10:30")                       # «10.30» — время, не дата
        self.assertEqual(self.r["pm"], {"s": "22:30", "e": "22:30", "fixed": True})

    def test_late_ok_early(self):
        self.assertTrue(self.r["c_late"]["late"])
        self.assertIn("Позже фикс-времени", self.r["c_late"]["lines"][0])
        self.assertEqual(self.r["c_ok"], {"late": False, "lines": []})      # ровно в срок
        self.assertFalse(self.r["c_early"]["late"])
        self.assertIn("Раньше фикс-времени", self.r["c_early"]["lines"][0])
        self.assertIn("будет ждать", self.r["c_early"]["lines"][0])

    def test_other_forms_unchanged(self):
        self.assertEqual(self.r["before"], {"s": None, "e": "15:00", "fixed": False})
        self.assertEqual(self.r["after"], {"s": "10:00", "e": None, "fixed": False})
        self.assertEqual(self.r["range"], {"s": "09:00", "e": "15:00", "fixed": False})
        self.assertEqual(self.r["single"], {"s": None, "e": "10:30", "fixed": False})   # одно время без слов — срок
        self.assertEqual(self.r["word"], None)
        self.assertIn("Раньше окна TimeSlot", self.r["r_early"]["lines"][0])
        self.assertIn("срок", self.r["r_late"]["lines"][0])


if __name__ == "__main__":
    unittest.main()
