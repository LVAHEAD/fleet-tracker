"""Заметки о паркингах (v3.381): привязка к месту, обновление ближайшей, проверка значений."""
import unittest

from fetat.domain import parking_notes as P
from fetat.store.parking_store import PARKING


class ParkingNotesTest(unittest.TestCase):
    def setUp(self):
        PARKING.docs.clear()

    def test_save_and_attach_nearest(self):
        n = P.save(39.331, -0.43761, {"ok": "yes", "pay": "free", "tags": ["fuel", "x"], "text": " тихо "}, "a@b", now=1)
        self.assertEqual((n["ok"], n["pay"], n["tags"], n["text"]), ("yes", "free", ["fuel"], "тихо"))
        top = [{"lat": 39.3315, "lng": -0.4377}, {"lat": 40.0, "lng": 0.0}]     # ~50 м и далеко
        P.attach(top)
        self.assertEqual(top[0]["note"]["ok"], "yes")
        self.assertIsNone(top[1]["note"])

    def test_update_keeps_one_note_and_sanitizes(self):
        a = P.save(39.331, -0.43761, {"ok": "yes"}, "u1", now=1)
        b = P.save(39.3312, -0.4377, {"ok": "bad", "pay": "paid"}, "u2", now=2)    # рядом — обновляем ту же
        self.assertEqual(a["id"], b["id"])
        self.assertEqual((b["ok"], b["pay"], b["by"]), ("", "paid", "u2"))
        self.assertEqual(len(PARKING.all()), 1)

    def test_api_save_and_validation(self):
        from fetat import create_app
        c = create_app().test_client()
        r = c.post("/api/parking-note", json={"lat": 39.33, "lng": -0.43, "ok": "no", "tags": ["fuel", "wc"], "text": "сливы"})
        self.assertEqual(r.status_code, 200)
        n = r.get_json()["note"]
        self.assertEqual((n["ok"], n["tags"]), ("no", ["fuel", "wc"]))
        self.assertEqual(c.post("/api/parking-note", json={"lat": "x"}).status_code, 400)
        r = c.get("/api/parking-map?s=30&w=-10&n=60&e=30&z=4")
        self.assertEqual(r.status_code, 200)
        self.assertIn("places", r.get_json())
        self.assertEqual(c.get("/api/parking-map?s=1").status_code, 400)


if __name__ == "__main__":
    unittest.main()
