"""Сеть: сжатие ответов, ?v= по хешу файла, короткий кеш сбоя тахографа, общий пул соединений."""
import gzip
import json
import unittest
from unittest import mock

import requests

from fetat import create_app
from fetat.clients import mapon
from fetat.clients import http


class Gzip(unittest.TestCase):
    def setUp(self):
        self.c = create_app().test_client()

    def test_static_js_gzipped_and_cached(self):
        r = self.c.get("/static/app.js?v=x", headers={"Accept-Encoding": "gzip, br"})
        self.assertEqual(r.headers.get("Content-Encoding"), "gzip")
        self.assertIn("immutable", r.headers.get("Cache-Control", ""))
        self.assertIn(b"calcAllRows", gzip.decompress(r.data))

    def test_no_gzip_without_accept(self):
        r = self.c.get("/static/app.js?v=x")
        self.assertIsNone(r.headers.get("Content-Encoding"))

    def test_json_gzipped(self):
        r = self.c.get("/api/changelog", headers={"Accept-Encoding": "gzip"})
        self.assertEqual(r.headers.get("Content-Encoding"), "gzip")
        self.assertIn("items", json.loads(gzip.decompress(r.data)))


class StaticVer(unittest.TestCase):
    def test_v_is_file_hash(self):
        app = create_app()
        with app.test_request_context():
            from flask import url_for
            a = url_for("static", filename="app.js", v="3.239")
            b = url_for("static", filename="style.css", v="3.239")
        self.assertNotIn("3.239", a)
        self.assertNotEqual(a.split("v=")[1], b.split("v=")[1])


class TachoFail(unittest.TestCase):
    def setUp(self):
        mapon._tacho_cache.clear()

    def test_failure_retried_after_a_minute(self):
        t = [1000.0]
        with mock.patch("time.time", side_effect=lambda: t[0]), \
             mock.patch.object(mapon, "mapon_get", side_effect=RuntimeError("timeout")) as g:
            mapon.get_tacho(1)
            t[0] += 30
            mapon.get_tacho(1)
            self.assertEqual(g.call_count, 1)
            t[0] += mapon.TACHO_ERR_TTL
            mapon.get_tacho(1)
            self.assertEqual(g.call_count, 2)

    def test_no_driver_answer_kept_full_ttl(self):
        t = [1000.0]
        with mock.patch("time.time", side_effect=lambda: t[0]), \
             mock.patch.object(mapon, "mapon_get", return_value={"data": {}}) as g:
            mapon.get_tacho(2)
            t[0] += 120
            mapon.get_tacho(2)
            self.assertEqual(g.call_count, 1)


class Pool(unittest.TestCase):
    def test_patched_requests_respected(self):
        with mock.patch("requests.get", return_value="ok") as g:
            self.assertEqual(http.get("https://x.test"), "ok")
            g.assert_called_once()

    def test_session_used_normally(self):
        with mock.patch.object(requests.Session, "get", return_value="s") as g:
            self.assertEqual(http.get("https://x.test"), "s")
            g.assert_called_once()


if __name__ == "__main__":
    unittest.main()
