"""v3.172: время ручной ✓ — отъезд с ближайшей стоянки Mapon в 100 м, иначе время нажатия."""
import json
import os
import shutil
import subprocess
import unittest
from unittest import mock

from fetat.domain import points
from fetat.utils.timefmt import ts_west

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LAT, LNG = 50.0, 10.0
# 0.001° широты ≈ 111 м
M50 = 0.00045    # ≈ 50 м
M80 = 0.00072    # ≈ 80 м
M150 = 0.00135   # ≈ 150 м


def stop(dlat, end, start=None, now=False):
    return {"lat": LAT + dlat, "lng": LNG, "end": end, "start": start, "now": now}


class ManualDoneTime(unittest.TestCase):
    def run_pd(self, stops, click=None, manual=(True,)):
        unit = {"unit_id": 7, "lat": LAT + 1, "lng": LNG, "number": "X-1"}
        with mock.patch.object(points, "resolve_fleet_target", return_value={"lat": LAT, "lng": LNG}), \
                mock.patch.object(points, "recent_stops", return_value=stops):
            return points.points_done(["Point A"], list(manual), unit, [], click=click)[0]

    def fmt(self, ts):
        return ts_west(ts).strftime("%d/%m %H:%M")

    def test_stop_within_100m(self):
        r = self.run_pd([stop(M50, 1_760_000_000, 1_759_990_000)])
        self.assertTrue(r["done"])
        self.assertFalse(r["auto"])               # ручная — не авто-✓
        self.assertEqual(r["msrc"], "mapon")
        self.assertEqual(r["at"], self.fmt(1_760_000_000))
        self.assertEqual(r["arr"], self.fmt(1_759_990_000))

    def test_nearest_of_several(self):
        r = self.run_pd([stop(M80, 1_760_100_000), stop(M50, 1_760_000_000), stop(M80, 1_760_200_000)])
        self.assertEqual(r["at"], self.fmt(1_760_000_000))   # ближайшая, а не самая свежая

    def test_equal_distance_takes_later(self):
        r = self.run_pd([stop(M50, 1_760_000_000), stop(M50, 1_760_300_000)])
        self.assertEqual(r["at"], self.fmt(1_760_300_000))

    def test_stop_beyond_100m_falls_back_to_click(self):
        r = self.run_pd([stop(M150, 1_760_000_000)], click=["20/10 06:55"])
        self.assertEqual((r["msrc"], r["at"]), ("click", "20/10 06:55"))

    def test_no_stops_uses_click(self):
        r = self.run_pd([], click=["20/10 06:55"])
        self.assertEqual((r["msrc"], r["at"]), ("click", "20/10 06:55"))

    def test_current_stop_is_ignored(self):
        r = self.run_pd([stop(M50, 1_760_000_000, now=True), stop(M50, None)], click=["20/10 06:55"])
        self.assertEqual(r["msrc"], "click")

    def test_no_stop_no_click_stays_without_time(self):
        r = self.run_pd([], click=None)
        self.assertTrue(r["done"])
        self.assertIsNone(r["at"])
        self.assertNotIn("msrc", r)

    def test_bad_click_format_ignored(self):
        for bad in ("20/10", "2026-10-20 06:55", "<b>", "", None, 5):
            r = self.run_pd([], click=[bad])
            self.assertIsNone(r["at"], bad)

    def test_manual_not_done_and_auto_untouched(self):
        r = self.run_pd([stop(M50, 1_760_000_000)], manual=(False,))
        self.assertFalse(r["done"])
        self.assertNotIn("msrc", r)

    def test_stops_error_falls_back_to_click(self):
        unit = {"unit_id": 7, "lat": LAT + 1, "lng": LNG}
        with mock.patch.object(points, "resolve_fleet_target", return_value={"lat": LAT, "lng": LNG}), \
                mock.patch.object(points, "recent_stops", side_effect=RuntimeError("mapon")):
            r = points.points_done(["Point A"], [True], unit, [], click=["20/10 06:55"])[0]
        self.assertEqual((r["done"], r["msrc"], r["at"]), (True, "click", "20/10 06:55"))


@unittest.skipUnless(shutil.which("node"), "нужен node")
class ClientSide(unittest.TestCase):
    SCRIPT = """
const fs = require('fs'), vm = require('vm');
const ctx = { escapeHtml: (s) => String(s), STOP_NUM: ['', '①', '②', '③'] };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(process.argv[1], 'utf8'), ctx);
const row = { done: { 0: true, 1: true, 2: false }, extra: [{}, {}], doneBy: { 0: { eu: '20/10 06:55' }, 1: { at: 'x' }, 2: { eu: '21/10 01:00' } } };
console.log(JSON.stringify({
  click: ctx.doneClickArray(row),
  now: ctx.nowEuStr(),
  mapon: ctx.doneEtaHtml({ done_at: '19/10 14:10', done_auto: false, done_msrc: 'mapon', done_tz: 'FI' }),
  click_html: ctx.doneEtaHtml({ done_at: '20/10 06:55', done_auto: false, done_msrc: 'click' }),
  plain: ctx.doneEtaHtml({ done_at: null, done_auto: false }),
}));
"""

    def test_client(self):
        out = subprocess.run(["node", "-e", self.SCRIPT, os.path.join(ROOT, "static", "done-marks.js")],
                             capture_output=True, text=True, timeout=60)
        self.assertEqual(out.returncode, 0, out.stderr)
        d = json.loads(out.stdout)
        self.assertEqual(d["click"], ["20/10 06:55", None, None])          # только «пройдена» и только с eu
        self.assertRegex(d["now"], r"^\d{2}/\d{2} \d{2}:\d{2}$")
        self.assertIn("✓ 19/10 14:10", d["mapon"])
        self.assertIn("отъезд со стоянки Mapon", d["mapon"])
        self.assertIn("лок.", d["mapon"])
        self.assertIn("✓ 20/10 06:55", d["click_html"])
        self.assertIn("момент нажатия", d["click_html"])
        self.assertIn("✓ пройдена", d["plain"])                            # без времени — как раньше
        self.assertNotIn("лок.", d["plain"])

    def test_payload_has_done_click(self):
        with open(os.path.join(ROOT, "static", "app.js"), encoding="utf-8") as f:
            self.assertIn("done_click: doneClickArray(row)", f.read())


if __name__ == "__main__":
    unittest.main()
