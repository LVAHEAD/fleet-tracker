"""v3.124: докачка свежих дней истории водителя, прогрев."""
import unittest
from fetat.clients import mapon


def A(s, e, st="REST"):
    return {"start": s, "end": e, "status": st, "src": "x"}


class Merge(unittest.TestCase):
    def test_merge_replaces_fresh_window(self):
        old = [A(100, 200), A(1000, 1100), A(1200, 1300, "DRIVING")]
        fresh = [A(1000, 1500), A(1600, 1700)]
        m = mapon._merge_acts(old, fresh, 900)
        self.assertEqual(sorted((a["start"], a["end"]) for a in m), [(100, 200), (1000, 1500), (1200, 1300), (1600, 1700)][:1] + [(1000, 1500), (1600, 1700)])

    def test_derive_glues_rests(self):
        d = mapon._derive_rests([A(0, 100), A(150, 300), A(400, 500, "DRIVING"), A(600, 700)], 1000)
        self.assertEqual([(r["start"], r["end"]) for r in d["rests"]], [(0, 300), (600, 700)])

    def test_refresh_uses_short_window(self):
        calls = []

        def fake(url, params, timeout=0):
            calls.append(params["from"])
            return {"data": [{"activities": [{"start": 5, "end": 9, "status": "REST", "source": "c"}]}]}
        orig = mapon.mapon_get
        mapon.mapon_get = fake
        try:
            mapon._act_cache.pop("t1", None)
            mapon.get_driver_rests("t1")
            mapon._act_cache["t1"]["at"] -= mapon.ACT_TTL + 1
            mapon.get_driver_rests("t1")
        finally:
            mapon.mapon_get = orig
        self.assertEqual(len(calls), 2)
        self.assertGreater(calls[1], calls[0])


if __name__ == "__main__":
    unittest.main()
