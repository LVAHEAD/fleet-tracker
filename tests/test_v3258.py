"""v3.258: лог рефа прицепа — включения по истории Mapon, склейка пауз, пороги подзарядки (1 ч / 2 ч)."""
import unittest

from fetat.domain.trailers import reefer_log, reefer_log_events, reefer_log_kind

H = 3600


def ev(*pairs):
    return [(t, on) for t, on in pairs]


class ReeferLog(unittest.TestCase):
    def test_kinds(self):
        self.assertEqual(reefer_log_kind(59), "low")
        self.assertEqual(reefer_log_kind(60), "ok")
        self.assertEqual(reefer_log_kind(119), "ok")
        self.assertEqual(reefer_log_kind(120), "good")

    def test_basic_and_summary(self):
        # off до 1 ч, on 2 ч (good), off, on 30 мин (low), off
        e = ev((1 * H, True), (3 * H, False), (10 * H, True), (10 * H + 1800, False))
        r = reefer_log(e, 0, 24 * H)
        self.assertEqual([o["kind"] for o in r["on"]], ["good", "low"])
        s = r["summary"]
        self.assertEqual((s["count"], s["ok"], s["good"]), (2, 1, 1))
        self.assertEqual(round(s["total_min"]), 150)
        self.assertEqual(s["last_on"], 10 * H + 1800)
        self.assertEqual(s["last_ok"], 3 * H)
        self.assertEqual(round(s["longest_idle_min"]), round((24 * H - (10 * H + 1800)) / 60))

    def test_merge_short_gap(self):
        # пауза 40 с и 4 мин 35 с — склеиваем; пауза 10 мин — нет
        e = ev((0, True), (60, False), (100, True), (400, False), (400 + 275, True), (4000, False), (4000 + 600, True), (5000, False))
        r = reefer_log(e, 0, 10 * H)
        self.assertEqual(len(r["on"]), 2)
        self.assertEqual(r["on"][0]["till"], 4000)

    def test_heartbeat_on_repeated_and_open_end(self):
        e = ev((H, True), (2 * H, True), (3 * H, True))     # «on» повторяется, на конец включён
        r = reefer_log(e, 0, 5 * H)
        self.assertEqual(len(r["on"]), 1)
        self.assertEqual(r["on"][0]["till"], 5 * H)

    def test_clamp_to_period(self):
        e = ev((-5 * H, True), (2 * H, False))
        r = reefer_log(e, 0, 10 * H)
        self.assertEqual((r["on"][0]["from"], r["on"][0]["till"]), (0, 2 * H))

    def test_events_any_compartment_on(self):
        st = {"compartment_0": [{"value": "on", "gmt": "2026-11-01T10:00:00Z"}, {"value": "off", "gmt": "2026-11-01T11:00:00Z"}],
              "compartment_1": [{"value": "on", "gmt": "2026-11-01T10:30:00Z"}, {"value": "off", "gmt": "2026-11-01T12:00:00Z"}]}
        e = reefer_log_events(st)
        self.assertEqual([on for _, on in e], [True, True, True, False])   # off отсека 0 при включённом отсеке 1 — реф всё ещё включён
        self.assertEqual(e[-1][0] - e[0][0], 2 * H)

    def test_empty(self):
        r = reefer_log([], 0, H)
        self.assertEqual(r["on"], [])
        self.assertIsNone(r["summary"]["last_on"])
        self.assertEqual(r["summary"]["longest_idle_min"], 60.0)


if __name__ == "__main__":
    unittest.main()
