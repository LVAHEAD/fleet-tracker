"""v3.229: фикс-время точки — парсер FIX / F, раньше слота можно до 1 ч, вердикт (опоздает / нет 2 ч после слота / ждёт),
ожидание у фикс-точки сдвигает ETA следующих точек (calc_extra_stops), остаток смены и вождения на приезде (plan).
Клиентские чистые функции — через node (нет node — пропуск)."""
import json
import os
import shutil
import subprocess
import unittest
from unittest import mock

from tests import ROOT

NODE = shutil.which("node")


def _read(*p):
    with open(os.path.join(ROOT, *p), encoding="utf-8") as f:
        return f.read()


DRIVER = r"""
const fs = require('fs'), vm = require('vm');
const code = fs.readFileSync(process.argv[1], 'utf8');
vm.runInThisContext(code + "\n;globalThis.__api = { parseDeliveryWindow, deliveryCheck, fixNotBefore, fixVerdict };");
const a = globalThis.__api;
const p2 = (n) => String(n).padStart(2, "0");
const dm = (d) => `${p2(d.getDate())}/${p2(d.getMonth() + 1)}`;
const hm = (d) => `${p2(d.getHours())}:${p2(d.getMinutes())}`;
const base = new Date(); base.setMinutes(0, 0, 0);
const at = (h) => new Date(base.getTime() + h * 3600000);
const eta = (h) => `${dm(at(h))} ${hm(at(h))}`;
const slotTxt = (pref) => `${dm(at(6))} ${pref} ${hm(at(6))}`;
const out = {};
for (const pref of ["FIX", "fix", "F", "at", "в"]) { const w = a.parseDeliveryWindow(slotTxt(pref)); out["p_" + pref] = !!(w && w.fixed && w.start.getTime() === at(6).getTime()); }
out.f_nospace = !!a.parseDeliveryWindow(`${dm(at(6))} f${hm(at(6))}`).fixed;
out.sofia = !!a.parseDeliveryWindow(`${dm(at(6))} Sofia 10`).fixed;          // «f» внутри слова — не фикс
out.after = !!a.parseDeliveryWindow(`${dm(at(6))} after 8`).fixed;
out.notBefore = a.fixNotBefore(slotTxt("FIX")) === Math.floor(at(5).getTime() / 1000);
out.notBeforeDeadline = a.fixNotBefore(`${dm(at(6))} до 10`);
out.notBeforeEmpty = a.fixNotBefore("");
const S = slotTxt("FIX");
const L = (shift, drive) => ({ shift: shift * 3600, drive: (drive == null ? 5 : drive) * 3600 });
const k = (v) => (v ? v.kind : null);
out.late = a.fixVerdict(S, eta(6.5), L(9)) && [k(a.fixVerdict(S, eta(6.5), L(9))), a.fixVerdict(S, eta(6.5), L(9)).short];
out.okWithin1h = k(a.fixVerdict(S, eta(5.5), L(5)));                           // раньше на 30 мин, запас есть — молчим
out.shortAfter = k(a.fixVerdict(S, eta(5.5), L(2.2)));                         // ждать 30 мин → после слота 1 ч 42 мин < 2 ч
out.shortDrive = k(a.fixVerdict(S, eta(6), L(9, 0.2)));                        // вождения < 30 мин на парковку
out.wait = k(a.fixVerdict(S, eta(3), L(10)));
out.waitShort = k(a.fixVerdict(S, eta(3), L(3)));                              // ждать 3 ч, смены 3 ч → после слота 0
out.waitLong = [k(a.fixVerdict(S, eta(-30), L(2))), k(a.fixVerdict(S, eta(-30), L(9, 0)))];   // v3.231: ждёт 36 ч — свежая смена, не «short»
out.waitEdge = [k(a.fixVerdict(S, eta(-2.5), L(3))), k(a.fixVerdict(S, eta(-3.5), L(3)))];   // ждёт 8,5 ч → short; 9,5 ч → wait
out.noLeft = [k(a.fixVerdict(S, eta(3), null)), k(a.fixVerdict(S, eta(5.5), null))];   // без данных тахографа — только по времени
out.notFixed = a.fixVerdict(`${dm(at(6))} ${hm(at(6))}-${hm(at(8))}`, eta(3), L(9));   // обычное окно — вердикта нет
// ранний приезд до 1 ч — без «будет ждать», раньше — с ним
out.chkEarly30 = a.deliveryCheck({ delivery: S }, eta(5.5)).lines.length;
out.chkEarly3h = a.deliveryCheck({ delivery: S }, eta(3)).lines.length;
out.chkLate = a.deliveryCheck({ delivery: S }, eta(6.5)).late;
console.log(JSON.stringify(out));
"""


@unittest.skipUnless(NODE, "нужен node")
class FixClientTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = os.path.join(ROOT, "static", "delivery-check.js")
        r = subprocess.run([NODE, "-e", DRIVER, path], capture_output=True, text=True, timeout=60)
        # node -e: аргумент после кода — argv[1] = путь
        assert r.returncode == 0, r.stderr
        cls.o = json.loads(r.stdout.strip().splitlines()[-1])

    def test_parser(self):
        o = self.o
        for p in ("FIX", "fix", "F", "at", "в"):
            self.assertTrue(o["p_" + p], p)
        self.assertTrue(o["f_nospace"])
        self.assertFalse(o["sofia"])
        self.assertFalse(o["after"])

    def test_not_before(self):
        self.assertTrue(self.o["notBefore"])             # начало слота минус 1 ч
        self.assertIsNone(self.o["notBeforeDeadline"])   # «до 10» — начала нет
        self.assertIsNone(self.o["notBeforeEmpty"])

    def test_verdict(self):
        o = self.o
        self.assertEqual(o["late"][0], "late")
        self.assertEqual(o["late"][1], "опоздает на 30 мин")
        self.assertIsNone(o["okWithin1h"])
        self.assertEqual(o["shortAfter"], "short")
        self.assertEqual(o["shortDrive"], "short")
        self.assertEqual(o["wait"], "wait")
        self.assertEqual(o["waitShort"], "short")
        self.assertEqual(o["waitLong"], ["wait", "wait"])
        self.assertEqual(o["waitEdge"], ["short", "wait"])
        self.assertEqual(o["noLeft"], ["wait", None])
        self.assertIsNone(o["notFixed"])

    def test_early_tolerance_one_hour(self):
        self.assertEqual(self.o["chkEarly30"], 0)        # раньше на 30 мин — можно
        self.assertEqual(self.o["chkEarly3h"], 1)        # раньше на 3 ч — «будет ждать»
        self.assertTrue(self.o["chkLate"])


class PlanLeftTest(unittest.TestCase):
    def test_plan_returns_left_at_arrival(self):
        from fetat.domain.tacho import plan, SOLO_DAY_SEC
        p = plan(1_800_000_000.0, 140.0, team=False)     # 2 ч езды из свежего дня
        self.assertAlmostEqual(p["day_left"], SOLO_DAY_SEC - 7200, delta=1)
        self.assertGreater(p["win_left"], 0)
        self.assertLessEqual(p["win_left"], 15 * 3600 - 7200 + 1)


class FixWaitTest(unittest.TestCase):
    """calc_extra_stops: приехал на фикс-точку раньше — ждёт, ETA следующих точек сдвигается на ожидание."""
    NOW = 1_800_000_000.0

    def _run(self, fixes):
        from fetat.services import fleet_calc as fc
        first = {"target_lat": 52.0, "target_lng": 13.0, "dist_km": 70.0}   # ① через 1 ч (простой ETA)
        res = {"lat": 51.0, "lng": 12.0, "target_address": None}
        with mock.patch("time.time", return_value=self.NOW), \
             mock.patch.object(fc, "resolve_fleet_target", side_effect=lambda *a, **k: dict(res)), \
             mock.patch.object(fc, "road_distance_km_google", return_value=(70.0, None)), \
             mock.patch.object(fc, "target_badge_info", return_value=("", "")), \
             mock.patch.object(fc, "fleet_corridor_cands", return_value=None):
            return fc.calc_extra_stops(["B", "C"], [], {}, first, None, None, fixes=fixes)

    def _eta(self, it):
        from datetime import datetime
        return datetime.strptime(it["eta_local"], "%d/%m %H:%M")

    def test_no_fix_is_unchanged(self):
        a = self._run(None)
        b = self._run([None, None, None])
        self.assertEqual([x["eta_local"] for x in a], [x["eta_local"] for x in b])
        self.assertNotIn("wait_sec", a[0])

    def test_wait_on_first_shifts_next(self):
        base = self._run(None)
        got = self._run([self.NOW + 5 * 3600, None, None])       # ① «не раньше» через 5 ч, машина будет через 1 ч → ждёт 4 ч
        self.assertEqual((self._eta(got[0]) - self._eta(base[0])).total_seconds(), 4 * 3600)
        self.assertEqual((self._eta(got[1]) - self._eta(base[1])).total_seconds(), 4 * 3600)

    def test_wait_on_extra_reports_and_shifts_next(self):
        base = self._run(None)
        got = self._run([None, self.NOW + 10 * 3600, None])      # ② приедет через 2,5 ч, «не раньше» через 10 ч → ждёт 7,5 ч
        self.assertEqual(got[0]["eta_local"], base[0]["eta_local"])
        self.assertEqual(got[0]["wait_sec"], 27000)
        self.assertEqual((self._eta(got[1]) - self._eta(base[1])).total_seconds(), 27000)

    def test_arrival_after_not_before_no_wait(self):
        got = self._run([None, self.NOW + 3600, None])
        self.assertNotIn("wait_sec", got[0])


class FixPayloadTest(unittest.TestCase):
    def test_fixes_parsing(self):
        from fetat.services.fleet_calc import _fixes
        self.assertEqual(_fixes({}), [])
        self.assertEqual(_fixes({"fix_at": "x"}), [])
        self.assertEqual(_fixes({"fix_at": [None, 1.5e9, -5, "a", True, 0]}), [None, 1.5e9, None, None, None, None])
        self.assertEqual(len(_fixes({"fix_at": [1.0] * 40})), 13)


class FixSourceTest(unittest.TestCase):
    def test_version_and_vl_only(self):
        app = _read("static", "app.js")
        self.assertIn("function fixViewAllowed", app)
        self.assertIn('dispTag(fleetMe()) === "VL"', app)
        self.assertIn("fix_at", app)


if __name__ == "__main__":
    unittest.main()
