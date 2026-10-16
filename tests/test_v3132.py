"""v3.132: тихое обновление (версия в /api/presence, peek не продлевает онлайн) и пустая строка только у своего диспетчера."""
import os
import re
import unittest

os.environ.setdefault("FLEET_STORE", "memory")

import app as appmod
from fetat import APP_VERSION
from fetat.domain import presence

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return f.read()


class PresenceVersionTest(unittest.TestCase):
    def setUp(self):
        presence._seen.clear()
        self.c = appmod.app.test_client()

    def test_presence_returns_version(self):
        d = self.c.get("/api/presence").get_json()
        self.assertTrue(d["ok"])
        self.assertEqual(d["version"], APP_VERSION)

    def test_peek_returns_version_without_marking_online(self):
        d = self.c.get("/api/presence?peek=1", headers={"X-Goog-Authenticated-User-Email": "accounts.google.com:peek@example.com"}).get_json()
        self.assertEqual(d["version"], APP_VERSION)
        self.assertEqual(d["tags"], [])
        self.assertFalse(any("peek" in e for e in presence._seen))


class FrontendSourceTest(unittest.TestCase):
    def test_empty_row_obeys_dispatcher_filter(self):
        src = _read("static/fleet-sort-filter.js")
        self.assertIn("if (!row.unit) return rowPassesOwn(row);", src)

    def test_add_row_switches_filter_to_self(self):
        src = _read("static/app.js")
        self.assertRegex(src, r"if \(!rowPassesOwn\(nr\)\)")

    def test_update_pill_wired(self):
        js = _read("static/presence.js")
        self.assertIn("update-pill", js)
        self.assertIn("/api/presence?peek=1", js)
        self.assertTrue(re.search(r"verNum\(d\.version\) > verNum\(PAGE_VER\)", js))
        self.assertIn(".update-pill", _read("static/style.css"))


if __name__ == "__main__":
    unittest.main()
