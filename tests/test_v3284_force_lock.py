"""v3.284: админ снимает чужую 🔒 (force): замок переходит к админу, владелец при продлении получает 409; не админу — 403."""
import unittest
from unittest import mock

from tests import A  # noqa: F401  (поднимает приложение и пути)
from fetat.api import fleet as fleet_api

OWNER = {"X-Goog-Authenticated-User-Email": "accounts.google.com:janis@gmail.com"}
OTHER = {"X-Goog-Authenticated-User-Email": "accounts.google.com:ladins@gmail.com"}
BOSS = {"X-Goog-Authenticated-User-Email": "accounts.google.com:aa@gmail.com"}
RID = "990000000000401"


class ForceLockTest(unittest.TestCase):
    def setUp(self):
        p = mock.patch.object(fleet_api, "FLEET_ADMINS", {"aa@gmail.com"})
        p.start()
        self.addCleanup(p.stop)
        self.c = A.app.test_client()
        r = self.c.post("/api/fleet/sync", headers=OWNER, json={"ops": [{"id": RID, "new": True, "set": {
            "unit": "AB-1", "target": "ES08", "disp": "janis@gmail.com"}}]})
        self.assertTrue(r.get_json()["ok"])
        self.c.post("/api/fleet/lock", headers=OWNER, json={"id": RID, "release": True})

    def _lock(self, headers, **kw):
        return self.c.post("/api/fleet/lock", headers=headers, json={"id": RID, **kw})

    def test_admin_takes_foreign_lock(self):
        self.assertEqual(self._lock(OWNER).status_code, 200)                  # владелец держит замок
        self.assertEqual(self._lock(OTHER).status_code, 409)                  # чужой не может занять
        r = self._lock(BOSS, force=True)
        self.assertEqual(r.status_code, 200, r.get_json())
        self.assertTrue(r.get_json()["forced"])
        r = self._lock(OWNER)                                                 # зависшая вкладка продлевает — не перехватывает
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.get_json()["locked_by"], "aa@gmail.com")
        self.assertEqual(self._lock(OWNER, release=True).status_code, 200)    # чужой release замок админа не снимает
        self.assertEqual(self._lock(OWNER).status_code, 409)
        self.assertEqual(self._lock(BOSS).status_code, 200)                   # админ продлевает как обычный владелец
        self._lock(BOSS, release=True)
        self.assertEqual(self._lock(OWNER).status_code, 200)                  # админ отпустил — владелец снова может

    def test_not_admin_cannot_force(self):
        self._lock(OWNER)
        r = self._lock(OTHER, force=True)
        self.assertEqual(r.status_code, 403)
        self.assertEqual(self._lock(OTHER).status_code, 409)                  # замок владельца не тронут
        self._lock(OWNER, release=True)


if __name__ == "__main__":
    unittest.main()
