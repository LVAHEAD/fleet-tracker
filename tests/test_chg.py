"""v3.20: метки чужой правки (chg) — ставит не-хозяин, снимает только хозяин трипа."""
import unittest
from unittest import mock

from tests import A  # noqa: F401  (поднимает приложение и пути)
from fetat.domain import dispatchers as dp
from fetat.store.fleet_store import FLEET_STORE, chg_keys

OWNER = {"X-Goog-Authenticated-User-Email": "accounts.google.com:janis@gmail.com"}
OTHER = {"X-Goog-Authenticated-User-Email": "accounts.google.com:ladins@gmail.com"}


class ChgTest(unittest.TestCase):
    def setUp(self):
        p = mock.patch.object(dp, "read_sheet_values", return_value=[["Email", "Инициалы", "Цвет", "Назначает"]])
        p.start()
        self.addCleanup(p.stop)

    def _sync(self, headers, ops):
        return A.app.test_client().post("/api/fleet/sync", json={"ops": ops}, headers=headers).get_json()

    def test_keys(self):
        old = {"note": "a", "extra": [{"target": "X", "delivery": "1"}]}
        new = {"note": "b", "extra": [{"target": "X", "delivery": "2"}, {"target": "Y"}]}
        self.assertEqual(chg_keys(old, new), ["note", "x1.delivery", "x2.target"])

    def test_flow(self):
        rid = "990000000000077"
        self.assertTrue(self._sync(OWNER, [{"id": rid, "new": True, "set": {"unit": "AB-1", "note": "a",
                                                                          "disp": "janis@gmail.com"}}])["ok"])
        # хозяин правит сам — меток нет
        self._sync(OWNER, [{"id": rid, "set": {"note": "b"}}])
        self.assertNotIn("chg", FLEET_STORE.get(rid)["data"])
        # чужой правит — метка с автором
        self._sync(OTHER, [{"id": rid, "set": {"note": "c", "delivery": "05/10 10"}}])
        chg = FLEET_STORE.get(rid)["data"]["chg"]
        self.assertEqual(sorted(chg), ["delivery", "note"])
        self.assertEqual(chg["note"]["by"], "ladins@gmail.com")
        # чужой не может снять метки
        self._sync(OTHER, [{"id": rid, "unset": ["chg"]}])
        self.assertIn("chg", FLEET_STORE.get(rid)["data"])
        # хозяин снимает одну метку кликом, правка поля снимает вторую
        self._sync(OWNER, [{"id": rid, "set": {"chg": {"delivery": chg["delivery"]}}}])
        self.assertEqual(list(FLEET_STORE.get(rid)["data"]["chg"]), ["delivery"])
        self._sync(OWNER, [{"id": rid, "set": {"delivery": "06/10 10"}}])
        self.assertNotIn("chg", FLEET_STORE.get(rid)["data"])


if __name__ == "__main__":
    unittest.main()
