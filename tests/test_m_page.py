"""Лёгкая мобильная страница /m: тело расчёта строки и карточка."""
import unittest

from fetat.api.mobile import _card, _row_payload


class MobilePage(unittest.TestCase):
    def test_payload_like_desktop(self):
        row = {"unit": "NU-8704", "target": "Riga", "extra": [{"target": "Tallinn"}], "trailer": "T1",
               "done": {"0": True}, "doneBy": {"0": {"eu": "14/11 08:00"}}, "doneSeen": {"Riga": "14/11 09:00"}}
        p = _row_payload(row)
        self.assertEqual(p["extra"], ["Tallinn"])
        self.assertEqual(p["done"], [True, None])
        self.assertEqual(p["done_click"], ["14/11 08:00", None])
        self.assertEqual(p["done_seen"], ["14/11 09:00", None])
        self.assertEqual(p["why"], "auto")

    def test_card_error_and_points(self):
        row = {"unit": "A", "target": "X", "extra": [{"target": "Y"}]}
        c = _card("1", row, "VL", {"error": "нет данных"})
        self.assertEqual(c["error"], "нет данных")
        self.assertEqual(len(c["pts"]), 2)
        c = _card("1", row, "VL", {"dist_km": 10, "eta_local": "14/11 10:00", "points_done": [{"done": True}, {}],
                                    "extra": [{"leg_km": 5, "eta_tacho": "14/11 12:00"}]})
        self.assertTrue(c["pts"][0]["done"])
        self.assertEqual(c["pts"][1]["eta"], "14/11 12:00")

    def test_pwa_routes(self):
        from app import app
        c = app.test_client()
        r = c.get("/m.webmanifest")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.get_json(force=True)["start_url"], "/m")
        r = c.get("/sw-m.js")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.headers.get("Service-Worker-Allowed"), "/m")

    def test_phone_redirect(self):
        from app import app
        c = app.test_client()
        ua = {"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"}
        r = c.get("/", headers=ua)
        self.assertEqual((r.status_code, r.headers["Location"]), (302, "/m"))
        r = c.get("/?full=1", headers=ua)                       # «Полная версия» — ставит cookie
        self.assertIn("fetat_full=1", r.headers.get("Set-Cookie", ""))
        self.assertEqual(c.get("/", headers=ua).status_code, 200)   # cookie есть — не редиректим
        self.assertEqual(app.test_client().get("/", headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0)"}).status_code, 200)
        ipad = {"User-Agent": "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)"}
        self.assertEqual(app.test_client().get("/", headers=ipad).status_code, 200)


if __name__ == "__main__":
    unittest.main()
