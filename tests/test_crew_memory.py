"""v3.105: память режима «экипаж» — две карты видели раньше, Mapon потерял вторую (OI-3194: два дня 👥, потом «соло»)."""
import time
import unittest

from tests import A

H = 3600
D = 24 * H


def drivers(n):
    return {"drivers": [{"current_state": "AVAILABLE", "now": {"rest": 0, "driving": 0},
                         "today": {"driving_remaining": 5 * H, "shift_remaining": 8 * H},
                         "week": {"driving_remaining": 40 * H, "9h_rest_shortening_remaining": 2}}
                        for _ in range(n)]}


class CrewModeMemoryTest(unittest.TestCase):
    NOW = 2_000_000_000.0

    def test_one_card_with_fresh_memory_is_team(self):
        team, src, _ = A.crew_mode(drivers(1), None, {}, self.NOW - 2 * D, self.NOW)
        self.assertTrue(team)
        self.assertEqual(src, "memory")

    def test_old_memory_ignored(self):
        team, src, _ = A.crew_mode(drivers(1), None, {}, self.NOW - 15 * D, self.NOW)
        self.assertFalse(team)
        self.assertEqual(src, "tacho")

    def test_future_or_empty_memory_ignored(self):
        self.assertFalse(A.crew_mode(drivers(1), None, {}, self.NOW + 10 * H, self.NOW)[0])
        self.assertFalse(A.crew_mode(drivers(1), None, {}, None, self.NOW)[0])
        self.assertFalse(A.crew_mode(drivers(1), None, {}, 0, self.NOW)[0])

    def test_manual_beats_memory(self):
        team, src, _ = A.crew_mode(drivers(1), "solo", {}, self.NOW - D, self.NOW)
        self.assertFalse(team)
        self.assertEqual(src, "manual")

    def test_two_cards_and_history_come_first(self):
        self.assertEqual(A.crew_mode(drivers(2), None, {}, self.NOW - D, self.NOW)[1], "tacho")
        self.assertEqual(A.crew_mode(drivers(1), None, {"d": 11 * H}, self.NOW - D, self.NOW)[1], "hist")

    def test_without_memory_unchanged(self):
        self.assertEqual(A.crew_mode(drivers(1), None, {"d": 9.5 * H}), (False, "tacho", 9.5 * H))

    def test_no_card_at_all_uses_memory(self):
        team, src, _ = A.crew_mode(None, None, {}, self.NOW - D, self.NOW)
        self.assertEqual((team, src), (True, "memory"))


class RowMemoryTest(unittest.TestCase):
    def setUp(self):
        self._saved = {k: getattr(A, k) for k in ("get_tacho", "unit_driving_days", "unit_driver_names",
                                                  "unit_route_segments")}
        A.unit_driving_days = lambda uid: {"d1": 9.5 * H}
        A.unit_driver_names = lambda uid: ["Daira Freimane"]
        A.unit_route_segments = lambda uid: []

    def tearDown(self):
        for k, v in self._saved.items():
            setattr(A, k, v)

    def test_row_team_from_memory(self):
        A.get_tacho = lambda uid: (drivers(1), None)
        seen = time.time() - 2 * D
        res = {"dist_km": 900.0}
        A._add_tacho(res, {"unit_id": 7}, False, None, False, seen)
        self.assertEqual(res["crew"], "team")
        self.assertEqual(res["crew_src"], "memory")
        self.assertEqual(res["crew_seen_at"], int(seen))
        self.assertNotIn("week_left_sec", res)                      # экипаж — недельного остатка в значке нет
        self.assertIn("из памяти", " ".join(res["tacho_summary"]))

    def test_row_without_memory_is_solo(self):
        A.get_tacho = lambda uid: (drivers(1), None)
        res = {"dist_km": 900.0}
        A._add_tacho(res, {"unit_id": 7}, False, None, False, None)
        self.assertEqual(res["crew"], "solo")
        self.assertNotIn("crew_seen_at", res)

    def test_no_card_path_keeps_memory(self):
        A.get_tacho = lambda uid: (None, "нет данных")
        res = {"dist_km": 900.0}
        A._add_tacho(res, {"unit_id": 7, "state": {"name": "driving"}}, False, None, False, time.time() - D)
        self.assertEqual(res["crew"], "team")
        self.assertEqual(res["crew_src"], "memory")

    def test_payload_value_parsing(self):
        self.assertIsNone(A._crew_seen({}))
        self.assertIsNone(A._crew_seen({"crew_seen": "мусор"}))
        self.assertIsNone(A._crew_seen({"crew_seen": -5}))
        self.assertEqual(A._crew_seen({"crew_seen": 1791000000}), 1791000000.0)


class FrontMemoryTest(unittest.TestCase):
    def test_frontend_and_autofield_wired(self):
        import os
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        with open(os.path.join(root, "static", "app.js"), encoding="utf-8") as f:
            js = f.read()
        self.assertIn("keepCrewSeen(row, data)", js)
        self.assertIn("crew_seen: Math.floor(row.crewSeen.t / 1000)", js)
        with open(os.path.join(root, "fetat", "api", "fleet.py"), encoding="utf-8") as f:
            py = f.read()
        self.assertIn('"crewSeen"', py)                              # служебное поле — не «правка» человека


if __name__ == "__main__":
    unittest.main()
