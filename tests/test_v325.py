"""v3.25: разбивка счёта Google (ключи, методы, ошибки), «час ещё идёт», прогноз по последним суткам,
отправка счётчика при остановке, фильтр «Все + диспетчеры», «✓ Завершить?» второй строкой."""
import os
import unittest
from datetime import datetime, timezone
from unittest import mock

import requests

from fetat.clients import google_routes as gr
from fetat.clients import monitoring
from fetat.services import gusage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def utc(s):
    return datetime.strptime(s, "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)


OK = {"credential_id": "apikey:AIzaOURKEY123456", "method": "google.maps.routing.v2.Routes.ComputeRoutes",
      "response_code_class": "2xx"}
ERR = dict(OK, response_code_class="4xx")
OTHER = {"credential_id": "apikey:AIzaOTHERabcdef", "method": "google.maps.routing.v2.Routes.ComputeRoutes",
         "response_code_class": "2xx"}


class BreakdownTest(unittest.TestCase):
    def test_keys_errors_methods(self):
        series = [(utc("2026-10-04 07:05"), 5, OK),       # 10:05 Рига, сутки 04.10
                  (utc("2026-10-04 07:10"), 2, ERR),
                  (utc("2026-10-04 08:00"), 3, OTHER)]
        days = gusage.build_log({}, series, today="2026-10-04", days=1,
                                now=utc("2026-10-05 12:00"), our_key="AIzaOURKEY123456")
        d = days[0]
        self.assertEqual(d["g"], 10)
        self.assertEqual(d["g_keys"], {"ключ …123456 (наш)": 7, "ключ …abcdef": 3})
        self.assertEqual(d["g_err"], {"4xx": 2})
        self.assertEqual(d["g_methods"], {"ComputeRoutes": 10})
        self.assertEqual([(x["hh"], x["g"], x.get("ge")) for x in d["hours"]], [("10", 7, 2), ("11", 3, None)])

    def test_old_series_without_labels(self):
        days = gusage.build_log({}, [(utc("2026-10-04 07:05"), 4)], today="2026-10-04", days=1,
                                now=utc("2026-10-05 12:00"))
        self.assertEqual(days[0]["g"], 4)
        self.assertNotIn("g_keys", days[0])

    def test_current_hour_marked(self):
        now = utc("2026-10-04 09:20")       # 12:20 Рига, сутки 04.10
        days = gusage.build_log({}, [(utc("2026-10-04 07:05"), 1, OK)], today="2026-10-04", days=1, now=now)
        cur = [x for x in days[0]["hours"] if x.get("now")]
        self.assertEqual(len(cur), 1)
        self.assertEqual(cur[0]["hh"], "12")
        text = gusage.log_text(days, "2026-10-04")
        self.assertIn("12:00  0 / 0 / 0  (час ещё идёт)", text)

    def test_text(self):
        series = [(utc("2026-10-04 07:05"), 5, OK), (utc("2026-10-04 07:10"), 2, ERR)]
        days = gusage.build_log({"2026-10-04": {"c": 4}}, series, today="2026-10-04", days=1,
                                now=utc("2026-10-05 12:00"), our_key="AIzaOURKEY123456")
        text = gusage.log_text(days, "2026-10-04")
        self.assertIn("04.10: 7 / 4 / 0", text)
        self.assertIn("Google — по ключам: ключ …123456 (наш) 7; ошибки: 4xx 2", text)
        self.assertIn("10:00  7 / 0 / 0  (ошибок 2)", text)

    def test_key_label(self):
        self.assertEqual(gusage.key_label("apikey:xyz987654", "nomatch"), "ключ …987654")
        self.assertEqual(gusage.key_label("serviceaccount:12345678"), "serviceaccount …345678")
        self.assertEqual(gusage.key_label(""), "без ключа")


class ForecastTest(unittest.TestCase):
    def test_median_of_last_full_days(self):
        # 05.10 утро: насчитано 2 083; последние полные сутки 291, 491, 626 → медиана 491
        f = gusage.month_forecast(2083, [291, 491, 626, 675], 31, 4.5, 10000)
        self.assertEqual(f["per_day"], 491)
        self.assertEqual(f["sample_days"], [291, 491, 626])
        self.assertEqual(f["forecast"], round(2083 + 491 * 26.5))
        self.assertEqual(f["left"], 7917)
        self.assertEqual(f["per_day_allowed"], int(7917 / 26.5))

    def test_dip_day_does_not_drag(self):
        f = gusage.month_forecast(3000, [40, 320, 330], 31, 10, 10000)    # сутки с провалом (зависание)
        self.assertEqual(f["per_day"], 320)

    def test_no_full_days_falls_back_to_average(self):
        f = gusage.month_forecast(300, [None, None], 31, 1.5, 10000)
        self.assertEqual(f["per_day"], 200)

    def test_over_limit(self):
        f = gusage.month_forecast(10500, [400], 31, 28, 10000)
        self.assertEqual(f["per_day_allowed"], 0)
        self.assertLess(f["left"], 0)

    def test_api_uses_forecast(self):
        from fetat import create_app
        from fetat.api import meta
        meta._gseries_cache.update(at=0.0, data=None, error=None)
        monitoring._gusage_cache.update(at=0.0, data=None)
        now = datetime.now(timezone.utc)
        series = [(datetime.fromtimestamp(now.timestamp() - 86400 * k, timezone.utc), 300, OK) for k in (1, 2, 3)]
        with mock.patch("fetat.api.meta.monitoring_token", return_value="t"), \
                mock.patch("fetat.api.meta._monitoring_sum", return_value=1000), \
                mock.patch("fetat.api.meta.monitoring_series", return_value=series):
            js = create_app().test_client().get("/api/google-usage?refresh=1").get_json()
        self.assertEqual(js["forecast_info"]["per_day"], 300)
        self.assertGreater(js["forecast"], 1000)


class MonitoringFallbackTest(unittest.TestCase):
    def test_group_by_rejected_falls_back(self):
        calls = []

        def fake_get(token, params):
            calls.append(params)
            if "aggregation.groupByFields" in params:
                resp = requests.Response()
                resp.status_code = 400
                raise requests.HTTPError("400", response=resp)
            return {"timeSeries": [{"points": [{"value": {"int64Value": "3"},
                                                 "interval": {"startTime": "2026-10-04T07:00:00Z",
                                                              "endTime": "2026-10-04T07:05:00Z"}}]}]}
        with mock.patch.object(monitoring, "_get", side_effect=fake_get):
            out = monitoring.monitoring_series("t", utc("2026-10-04 00:00"), utc("2026-10-05 00:00"))
        self.assertEqual(len(calls), 2)
        self.assertEqual(out, [(utc("2026-10-04 07:00"), 3, {})])

    def test_labels_read(self):
        js = {"timeSeries": [{"resource": {"labels": {"credential_id": "apikey:K", "method": "M"}},
                              "metric": {"labels": {"response_code_class": "2xx"}},
                              "points": [{"value": {"int64Value": "2"},
                                          "interval": {"startTime": "2026-10-04T07:00:00Z",
                                                       "endTime": "2026-10-04T07:05:00Z"}}]}]}
        with mock.patch.object(monitoring, "_get", return_value=js):
            out = monitoring.monitoring_series("t", utc("2026-10-04 00:00"), utc("2026-10-05 00:00"))
        self.assertEqual(out[0][2], {"credential_id": "apikey:K", "method": "M", "response_code_class": "2xx"})


class FlushAtExitTest(unittest.TestCase):
    def test_flush_when_buffer(self):
        with mock.patch.object(gr, "_shared_on", return_value=True), \
                mock.patch.dict(gr._stats_buf, {"c": 2}, clear=True), \
                mock.patch.object(gr, "flush_route_stats") as fl:
            gr._flush_at_exit()
        fl.assert_called_once()

    def test_no_flush_in_memory_mode(self):
        with mock.patch.object(gr, "_shared_on", return_value=False), \
                mock.patch.dict(gr._stats_buf, {"c": 2}, clear=True), \
                mock.patch.object(gr, "flush_route_stats") as fl:
            gr._flush_at_exit()
        fl.assert_not_called()


class FrontendTest(unittest.TestCase):
    def read(self, rel):
        with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
            return f.read()

    def test_filter_buttons(self):
        html = self.read("templates/index.html")
        self.assertIn('<span class="own-btns"></span>', html)
        self.assertNotIn('data-own="mine"', html)
        self.assertNotIn("own-sel", html)

    def test_complete_button_after_controls(self):
        js = self.read("static/app.js")
        i_menu = js.index('<button class="del-btn">✕ удалить строку</button>')
        i_cmpl = js.index('<button class="cmpl-btn" hidden')
        self.assertGreater(i_cmpl, i_menu)


if __name__ == "__main__":
    unittest.main()
