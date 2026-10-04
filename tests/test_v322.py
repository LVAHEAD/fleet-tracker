"""v3.22: Блокнот — открытые сверху, закрытые до лимита; «✓ Завершён» трипа — архив, права, возврат."""
import unittest
from unittest import mock

from tests import A  # noqa: F401  (поднимает приложение и пути)
from fetat.api import fleet as fleet_api
from fetat.api.notebook import open_first
from fetat.store.fleet_store import FLEET_DONE, FLEET_STORE

OWNER = {"X-Goog-Authenticated-User-Email": "accounts.google.com:janis@gmail.com"}
OTHER = {"X-Goog-Authenticated-User-Email": "accounts.google.com:ladins@gmail.com"}
BOSS = {"X-Goog-Authenticated-User-Email": "accounts.google.com:aa@gmail.com"}


class NotebookOpenFirstTest(unittest.TestCase):
    def test_open_always_closed_to_limit(self):
        docs = [{"id": "1", "status": "done"}, {"id": "2", "status": "new"}, {"id": "3", "status": "rejected"},
                {"id": "4", "status": "later"}, {"id": "5", "status": "work"}, {"id": "6", "status": "done"}]
        items, closed = open_first(docs, 4)
        self.assertEqual([d["id"] for d in items], ["2", "4", "5", "1"])
        self.assertEqual(closed, 3)
        items, _ = open_first(docs, 2)        # открытых больше лимита — все открытые всё равно в списке
        self.assertEqual([d["id"] for d in items], ["2", "4", "5"])


class CompleteTripTest(unittest.TestCase):
    def setUp(self):
        p = mock.patch.object(fleet_api, "can_assign", side_effect=lambda u: u == "aa@gmail.com")
        p.start()
        self.addCleanup(p.stop)
        self.c = A.app.test_client()

    def _new(self, rid):
        r = self.c.post("/api/fleet/sync", headers=OWNER, json={"ops": [{"id": rid, "new": True, "set": {
            "unit": "AB-1", "target": "ES08", "extra": [{"target": "SE10"}], "disp": "janis@gmail.com"}}]})
        self.assertTrue(r.get_json()["ok"])

    def _live_ids(self):
        return [str(x["row"]["id"]) for x in self.c.get("/api/fleet", headers=OWNER).get_json()["rows"]]

    def test_owner_completes_and_reopens(self):
        rid = "990000000000101"
        self._new(rid)
        since = self.c.get("/api/fleet", headers=OWNER).get_json()["now"]
        r = self.c.post("/api/fleet/complete", headers=OWNER, json={"id": rid})
        self.assertEqual(r.status_code, 200, r.get_json())
        self.assertNotIn(rid, self._live_ids())
        ch = self.c.get(f"/api/fleet?since={since}", headers=OWNER).get_json()["changes"]
        self.assertTrue(any(str(x["row"]["id"]) == rid and x["deleted"] for x in ch))   # у других — исчезает
        done = [x for x in self.c.get("/api/fleet/done?q=es08", headers=OWNER).get_json()["rows"]
                if str(x["row"]["id"]) == rid]
        self.assertEqual(len(done), 1)
        self.assertEqual(self.c.get("/api/fleet/done?q=nothere", headers=OWNER).get_json()["rows"], [])
        self.assertEqual(done[0]["completed_by"], "janis@gmail.com")
        self.assertEqual(done[0]["row"]["extra"], [{"target": "SE10"}])
        self.assertTrue(done[0]["can_reopen"])
        r = self.c.post("/api/fleet/reopen", headers=OWNER, json={"id": rid})
        self.assertEqual(r.status_code, 200, r.get_json())
        self.assertIn(rid, self._live_ids())
        self.assertIsNone(FLEET_DONE.get(rid))
        self.assertEqual(FLEET_STORE.get(rid)["data"]["target"], "ES08")

    def test_rights(self):
        rid = "990000000000102"
        self._new(rid)
        self.assertEqual(self.c.post("/api/fleet/complete", headers=OTHER, json={"id": rid}).status_code, 403)
        self.assertIn(rid, self._live_ids())
        self.assertEqual(self.c.post("/api/fleet/complete", headers=BOSS, json={"id": rid}).status_code, 200)
        done = self.c.get("/api/fleet/done", headers=OTHER).get_json()["rows"]
        mine = [x for x in done if str(x["row"]["id"]) == rid][0]
        self.assertFalse(mine["can_reopen"])
        self.assertEqual(self.c.post("/api/fleet/reopen", headers=OTHER, json={"id": rid}).status_code, 403)
        self.assertEqual(self.c.post("/api/fleet/reopen", headers=BOSS, json={"id": rid}).status_code, 200)

    def test_complete_twice(self):
        rid = "990000000000103"
        self._new(rid)
        self.assertEqual(self.c.post("/api/fleet/complete", headers=OWNER, json={"id": rid}).status_code, 200)
        self.assertEqual(self.c.post("/api/fleet/complete", headers=OWNER, json={"id": rid}).status_code, 404)


if __name__ == "__main__":
    unittest.main()
