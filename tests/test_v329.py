"""v3.29: коридор Инсбрук → Куфштайн; ✓ по зоне Mapon и по следующей точке (OI-3041, Svinesund);
нет карт водителя в Mapon (OS-2438) — экипаж по истории, тахо-ETA после долгой стоянки."""
import time
import unittest

from tests import A

H = 3600
NOW = time.time()

# зона Mapon «SVINESUND Border» (примерно как на скрине 06.10): вытянута на ~2 км вдоль E6, точка — у северного края
SVINESUND_ZONE = {
    "name": "SVINESUND Border",
    "poly": [(59.1115, 11.2640), (59.1118, 11.2668), (59.1040, 11.2690), (59.0960, 11.2690),
             (59.0930, 11.2660), (59.0960, 11.2640), (59.1040, 11.2630)],
}
SVINESUND_PT = "59.11189, 11.26705"
WAIT_SPOT = (59.1065, 11.2655)          # стоянка у таможни — внутри зоны, ~600 м от точки


def _obj(o):
    la = [p[0] for p in o["poly"]]
    ln = [p[1] for p in o["poly"]]
    return dict(o, bbox=(min(la), max(la), min(ln), max(ln)), c=(sum(la) / len(la), sum(ln) / len(ln)))


class ZoneDoneTest(unittest.TestCase):
    def setUp(self):
        self._stops, self._objs = A.recent_stops, A.mapon_objects
        A.mapon_objects = lambda: [_obj(SVINESUND_ZONE)]

    def tearDown(self):
        A.recent_stops, A.mapon_objects = self._stops, self._objs

    def test_zone_linked_by_edge(self):
        # точка на краю длинной зоны, центр далеко — зона всё равно привязана
        self.assertEqual(A.target_object(59.11189, 11.26705)["name"], "SVINESUND Border")
        self.assertIsNone(A.target_object(59.20, 11.40))

    def test_done_by_stop_inside_zone(self):
        A.recent_stops = lambda uid: [{"lat": WAIT_SPOT[0], "lng": WAIT_SPOT[1],
                                       "start": NOW - 12 * H, "end": NOW - 9 * H, "now": False}]
        unit = {"unit_id": 1, "lat": 59.40, "lng": 10.90}          # уже уехал в Норвегию
        res = A.points_done([SVINESUND_PT], [None], unit, [])
        self.assertTrue(res[0]["done"])
        self.assertEqual(res[0]["zone"], "SVINESUND Border")

    def test_still_in_zone_not_done(self):
        A.recent_stops = lambda uid: [{"lat": WAIT_SPOT[0], "lng": WAIT_SPOT[1],
                                       "start": NOW - 3 * H, "end": NOW - 1 * H, "now": False}]
        unit = {"unit_id": 1, "lat": 59.0950, "lng": 11.2665}       # ещё в зоне
        self.assertFalse(A.points_done([SVINESUND_PT], [None], unit, [])[0]["done"])

    def test_without_zone_500m_as_before(self):
        A.mapon_objects = lambda: []
        A.recent_stops = lambda uid: [{"lat": WAIT_SPOT[0], "lng": WAIT_SPOT[1],
                                       "start": NOW - 12 * H, "end": NOW - 9 * H, "now": False}]
        unit = {"unit_id": 1, "lat": 59.40, "lng": 10.90}
        self.assertFalse(A.points_done([SVINESUND_PT], [None], unit, [])[0]["done"])

    def test_on_target_long_zone(self):
        self.assertEqual(A.on_target(WAIT_SPOT[0], WAIT_SPOT[1], 59.11189, 11.26705)["how"], "object")


class CascadeDoneTest(unittest.TestCase):
    def setUp(self):
        self._stops, self._objs = A.recent_stops, A.mapon_objects
        A.mapon_objects = lambda: []

    def tearDown(self):
        A.recent_stops, A.mapon_objects = self._stops, self._objs

    def test_later_done_marks_earlier(self):
        # OI-3041: ③ без ✓, ④ ✓ → ③ пройдена «по ④»
        A.recent_stops = lambda uid: [{"lat": 59.30, "lng": 10.40, "start": NOW - 10 * H, "end": NOW - 9 * H, "now": False}]
        unit = {"unit_id": 1, "lat": 59.60, "lng": 10.20}
        res = A.points_done(["56.9, 24.1", "59.0, 11.0", "59.30, 10.40"], [True, None, None], unit, [])
        self.assertTrue(res[2]["done"])
        self.assertIsNone(res[2].get("by"))
        self.assertTrue(res[1]["done"])
        self.assertEqual(res[1]["by"], 2)
        self.assertIsNone(res[1]["at"])
        self.assertIsNone(res[0].get("by"))       # ручная ✓ осталась ручной

    def test_manual_not_done_wins(self):
        A.recent_stops = lambda uid: []
        unit = {"unit_id": 1, "lat": 59.60, "lng": 10.20}
        res = A.points_done(["56.9, 24.1", "59.0, 11.0", "59.3, 10.4"], [None, False, True], unit, [])
        self.assertFalse(res[1]["done"])
        self.assertTrue(res[0]["done"])

    def test_nothing_done(self):
        A.recent_stops = lambda uid: []
        unit = {"unit_id": 1, "lat": 59.60, "lng": 10.20}
        res = A.points_done(["56.9, 24.1", "59.0, 11.0"], [None, None], unit, [])
        self.assertFalse(any(x["done"] for x in res))


class PolyDistTest(unittest.TestCase):
    def test_inside_zero_outside_edge(self):
        sq = [(0.0, 0.0), (0.0, 0.01), (0.01, 0.01), (0.01, 0.0)]
        self.assertEqual(A.poly_dist_km(0.005, 0.005, sq), 0.0)
        self.assertAlmostEqual(A.poly_dist_km(0.005, 0.02, sq), 1.113, places=2)


class NoCardCrewTest(unittest.TestCase):
    """OS-2438: тахограф пустой, водители в машине (семейный экипаж)."""
    def setUp(self):
        self._saved = {k: getattr(A, k) for k in ("get_tacho", "unit_driving_days", "unit_driver_names")}
        A.get_tacho = lambda uid: (None, "нет данных водителя")
        A.unit_driver_names = lambda uid: ["Bakhodir Djumaev"]

    def tearDown(self):
        for k, v in self._saved.items():
            setattr(A, k, v)

    def _run(self, state, days, crew=None, dist=1500.0):
        A.unit_driving_days = lambda uid: days
        res = {"dist_km": dist}
        tacho, sim = A._add_tacho(res, {"unit_id": 7, "state": state}, False, crew)
        return res, tacho, sim

    def test_team_by_history_fresh_after_long_stop(self):
        res, tacho, sim = self._run({"name": "standing", "duration": 21 * H}, {"d1": 14 * H, "d2": 12 * H})
        self.assertEqual(res["crew"], "team")
        self.assertTrue(res["crew_nocard"])
        self.assertEqual(res["crew_names"], ["Bakhodir Djumaev"])
        self.assertIsNotNone(res.get("eta_tacho"))
        self.assertIsNotNone(tacho)
        # 1500 км экипажем: 18 ч езды, отдых, ещё ~3,4 ч — меньше полутора суток
        self.assertLess(sim["eta_ts"] - NOW, 36 * H)
        self.assertEqual(res["tacho_error"], "нет данных водителя")

    def test_solo_by_history_moving_simple_eta(self):
        res, tacho, sim = self._run({"name": "driving", "duration": 2 * H}, {"d1": 8 * H})
        self.assertEqual(res["crew"], "solo")
        self.assertTrue(res["crew_nocard"])
        self.assertIsNone(res.get("eta_tacho"))
        self.assertIsNone(tacho)

    def test_manual_crew_wins(self):
        res, _, _ = self._run({"name": "standing", "duration": 10 * H}, {"d1": 8 * H}, crew="team")
        self.assertEqual(res["crew"], "team")
        self.assertEqual(res["crew_src"], "manual")

    def test_trailer_untouched(self):
        A.unit_driving_days = lambda uid: {}
        res = {"dist_km": 100.0}
        A._add_tacho(res, {"unit_id": 7, "state": {"name": "standing", "duration": 20 * H}}, True, None)
        self.assertNotIn("crew", res)


if __name__ == "__main__":
    unittest.main()
