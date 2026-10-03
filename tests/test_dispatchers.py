"""v3.11: лист «Диспетчеры» и право назначать диспетчера строки (сеть подменена)."""
import unittest
from unittest import mock

from tests import A  # noqa: F401  (поднимает приложение и пути)
from fetat.domain import dispatchers as dp
from fetat.store.fleet_store import FLEET_STORE

ADMIN = {"X-Goog-Authenticated-User-Email": "accounts.google.com:vladimirs.head@gmail.com"}
DISP = {"X-Goog-Authenticated-User-Email": "accounts.google.com:janis@gmail.com"}
AA = {"X-Goog-Authenticated-User-Email": "accounts.google.com:antons@gmail.com"}

SHEET = [
    ["Email", "Инициалы", "Цвет", "Назначает"],
    ["vladimirs.head@gmail.com", "VL", "#ebebeb", "да"],
    ["Janis@gmail.com ", "jz", "eceefc", ""],
    ["antons@gmail.com", "AA", "#fff", "Да"],
    ["", "XX", "#000", "да"],
]


class DispatchersTest(unittest.TestCase):
    def setUp(self):
        dp._disp_cache.update(list=None, loaded_at=0.0, error=None, source="default")
        p = mock.patch.object(dp, "read_sheet_values", return_value=SHEET)
        p.start()
        self.addCleanup(p.stop)
        self.addCleanup(lambda: dp._disp_cache.update(list=None, loaded_at=0.0, error=None, source="default"))

    def test_parse(self):
        lst = dp.get_dispatchers(force=True)
        self.assertEqual([d["email"] for d in lst], ["vladimirs.head@gmail.com", "janis@gmail.com", "antons@gmail.com"])
        self.assertEqual(lst[1]["tag"], "JZ")
        self.assertEqual(lst[1]["color"], "#eceefc")
        self.assertEqual(lst[2]["color"], "#ffffff")
        self.assertEqual([d["assign"] for d in lst], [True, False, True])

    def test_fallback_when_sheet_fails(self):
        with mock.patch.object(dp, "read_sheet_values", side_effect=RuntimeError("нет доступа")):
            lst = dp.get_dispatchers(force=True)
        self.assertEqual(len(lst), 6)
        self.assertEqual(dp._disp_cache["source"], "default")
        self.assertTrue(dp.can_assign("vladimirs.head@gmail.com"))
        self.assertFalse(dp.can_assign("antons@gmail.com"))

    def test_can_assign(self):
        dp.get_dispatchers(force=True)
        self.assertTrue(dp.can_assign("vladimirs.head@gmail.com"))
        self.assertTrue(dp.can_assign("antons@gmail.com"))
        self.assertFalse(dp.can_assign("janis@gmail.com"))

    def _sync(self, headers, ops):
        c = A.app.test_client()
        return c.post("/api/fleet/sync", json={"ops": ops}, headers=headers).get_json()

    def test_sync_disp_change_rights(self):
        dp.get_dispatchers(force=True)
        rid = "990000000000001"
        r = self._sync(DISP, [{"id": rid, "new": True, "set": {"unit": "AB-1", "disp": "janis@gmail.com"}}])
        self.assertTrue(r["ok"], r)
        # обычный дисп не может переназначить
        r = self._sync(DISP, [{"id": rid, "set": {"disp": "vadims@gmail.com"}}])
        self.assertFalse(r["ok"])
        self.assertIn("может только", r["errors"][0]["error"])
        self.assertEqual(FLEET_STORE.get(rid)["data"]["disp"], "janis@gmail.com")
        # то же значение — можно (браузер шлёт поле как есть)
        r = self._sync(DISP, [{"id": rid, "set": {"disp": "janis@gmail.com", "note": "x"}}])
        self.assertTrue(r["ok"], r)
        # назначающий из листа и админ — могут
        r = self._sync(AA, [{"id": rid, "set": {"disp": "vadims@gmail.com"}}])
        self.assertTrue(r["ok"], r)
        r = self._sync(ADMIN, [{"id": rid, "unset": ["disp"]}])
        self.assertTrue(r["ok"], r)

    def test_api_dispatchers(self):
        c = A.app.test_client()
        d = c.get("/api/dispatchers", headers=DISP).get_json()
        self.assertTrue(d["ok"])
        self.assertFalse(d["can_assign"])
        self.assertEqual(d["dispatchers"][0]["tag"], "VL")


if __name__ == "__main__":
    unittest.main()
