"""v3.21: лог запросов к Google — раскладка по суткам Google и часам Риги, текст для Claude, страница."""
import unittest
from datetime import datetime, timezone
from unittest import mock

from fetat.services import gusage


def utc(s):
    return datetime.strptime(s, "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)


class BuildLogTest(unittest.TestCase):
    def test_hour_order_starts_at_google_midnight(self):
        # 04.10 Рига UTC+3, Лос-Анджелес UTC−7: сутки Google начинаются в 10:00 по Риге
        self.assertEqual(gusage.hour_order("2026-10-04")[:3], ["10", "11", "12"])
        self.assertEqual(gusage.hour_order("2026-10-04")[-1], "09")

    def test_days_and_hours(self):
        stats = {"2026-10-04": {"c": 3, "h": 20, "c_why_all": 2, "c_why_auto": 1, "c_kind_truck": 3,
                                "c_user_vladimirs_head": 3, "c_hr_10": 1, "h_hr_10": 5, "c_hr_11": 2, "h_hr_11": 15}}
        series = [(utc("2026-10-04 07:05"), 2),     # 10:05 Рига, сутки 04.10
                  (utc("2026-10-04 08:10"), 4),     # 11:10 Рига
                  (utc("2026-10-04 06:55"), 7)]     # 09:55 Рига — ещё сутки 03.10
        days = gusage.build_log(stats, series, today="2026-10-04", days=2, now=utc("2026-10-10 12:00"))
        self.assertEqual([d["day"] for d in days], ["2026-10-04", "2026-10-03"])
        d = days[0]
        self.assertEqual((d["g"], d["c"], d["h"]), (6, 3, 20))
        self.assertEqual(d["why"], {"all": 2, "auto": 1})
        self.assertEqual([(x["hh"], x["g"], x["c"], x["h"]) for x in d["hours"]],
                         [("10", 2, 1, 5), ("11", 4, 2, 15)])
        self.assertEqual(days[1]["g"], 7)
        self.assertEqual(days[1]["hours"], [{"hh": "09", "c": 0, "h": 0, "g": 7}])

    def test_without_google(self):
        days = gusage.build_log({"2026-10-04": {"c": 1, "c_hr_12": 1}}, None, today="2026-10-04", days=1, now=utc("2026-10-10 12:00"))
        self.assertIsNone(days[0]["g"])
        self.assertIsNone(days[0]["hours"][0]["g"])

    def test_text(self):
        stats = {"2026-10-04": {"c": 2, "h": 9, "c_why_auto": 2, "c_hr_10": 2, "h_hr_10": 9}}
        days = gusage.build_log(stats, [(utc("2026-10-04 07:00"), 5)], today="2026-10-04", days=3, now=utc("2026-10-10 12:00"))
        text = gusage.log_text(days, "2026-10-04")
        self.assertIn("04.10: 5 / 2 / 9 — автообновление 2", text)
        self.assertIn("10:00  5 / 2 / 9", text)
        self.assertNotIn("03.10", text)     # пустые сутки не печатаем


class PageTest(unittest.TestCase):
    def setUp(self):
        from fetat import create_app
        from fetat.api import meta
        meta._gseries_cache.update(at=0.0, data=None, error=None)
        self.client = create_app().test_client()

    def test_page(self):
        r = self.client.get("/gusage")
        self.assertEqual(r.status_code, 200)
        self.assertIn("Запросы к Google Routes", r.get_data(as_text=True))

    def test_log_without_monitoring(self):
        with mock.patch("fetat.api.meta.monitoring_token", side_effect=RuntimeError("нет доступа")):
            js = self.client.get("/api/google-usage/log").get_json()
            self.assertEqual(len(js["days"]), gusage.LOG_DAYS)
            self.assertIn("нет доступа", js["google_error"])
            r = self.client.get("/api/google-usage/log?format=text")
            self.assertIn("Счёт Google недоступен", r.get_data(as_text=True))

    def test_log_with_monitoring(self):
        now = datetime.now(timezone.utc)
        with mock.patch("fetat.api.meta.monitoring_token", return_value="t"), \
                mock.patch("fetat.api.meta.monitoring_series", return_value=[(now, 4)]):
            js = self.client.get("/api/google-usage/log").get_json()
        self.assertIsNone(js["google_error"])
        self.assertEqual(js["days"][0]["g"], 4)


if __name__ == "__main__":
    unittest.main()
