"""Блокнот ФЕТАТ: формат запросов к Firestore и права в /api/notebook (сеть подменена)."""
import json
import unittest
from unittest import mock

from tests import A  # noqa: F401  (поднимает приложение и пути)
from fetat.api import notebook as nb
from fetat.clients import firestore as fs

ME = {"X-Goog-Authenticated-User-Email": "accounts.google.com:vladimirs.head@gmail.com"}
OTHER = {"X-Goog-Authenticated-User-Email": "accounts.google.com:dispatcher@gmail.com"}
IMG = "data:image/jpeg;base64," + "A" * 100


class _Resp:
    def __init__(self, status, body):
        self.status_code, self._body, self.text = status, body, json.dumps(body)

    def json(self):
        return self._body


class FirestoreFormatTest(unittest.TestCase):
    def setUp(self):
        p = mock.patch.object(fs, "_fs_headers", return_value={})
        p.start()
        self.addCleanup(p.stop)

    def test_values_roundtrip(self):
        for v in ["123", "true", "текст", 5, 1.5, True, None, {"a": [1, "x"]}]:
            self.assertEqual(fs._decode_value(fs._encode_value(v)), v)

    def test_insert_sends_document_itself(self):
        doc = {"name": "p/d/fetat_notebook/abc", "fields": {"title": {"stringValue": "123"}}}
        with mock.patch("requests.post", return_value=_Resp(200, doc)) as post:
            got = fs.fs_insert("fetat_notebook", "abc", {"title": "123"})
        body = post.call_args.kwargs["json"]
        self.assertIn("fields", body)
        self.assertNotIn("document", body)
        self.assertEqual(post.call_args.kwargs["params"], {"documentId": "abc"})
        self.assertEqual(got, {"title": "123", "id": "abc"})

    def test_update_uses_mask(self):
        doc = {"name": "p/d/fetat_notebook/abc", "fields": {}}
        with mock.patch("requests.patch", return_value=_Resp(200, doc)) as patch:
            fs.fs_update("fetat_notebook", "abc", {"title": "x", "updated_at": "t"})
        params = patch.call_args.kwargs["params"]
        self.assertIn(("updateMask.fieldPaths", "title"), params)
        self.assertIn(("updateMask.fieldPaths", "updated_at"), params)
        self.assertIn(("currentDocument.exists", "true"), params)

    def test_401_retries_with_fresh_token(self):
        doc = {"name": "p/d/fetat_notebook/abc", "fields": {}}
        calls = []
        with mock.patch.object(fs, "_fs_headers", side_effect=lambda force=False: calls.append(force) or {}), \
             mock.patch("requests.get", side_effect=[_Resp(401, {"error": {"message": "x"}}), _Resp(200, doc)]):
            self.assertEqual(fs.fs_get("fetat_notebook", "abc"), {"id": "abc"})
        self.assertEqual(calls, [False, True])

    def test_get_missing_is_none(self):
        with mock.patch("requests.get", return_value=_Resp(404, {"error": {"message": "nf"}})):
            self.assertIsNone(fs.fs_get("fetat_notebook", "nope"))

    def test_query_pages(self):
        pages = [_Resp(200, {"documents": [{"name": "x/1", "fields": {}}], "nextPageToken": "t"}),
                 _Resp(200, {"documents": [{"name": "x/2", "fields": {}}]})]
        with mock.patch("requests.get", side_effect=pages):
            self.assertEqual([d["id"] for d in fs.fs_query("fetat_notebook", fields=["title"])], ["1", "2"])


class NotebookApiTest(unittest.TestCase):
    def setUp(self):
        self.db = {}

        def ins(col, rid, data):
            self.db[rid] = dict(data)
            return dict(data, id=rid)

        def get(col, rid, fields=None):
            d = self.db.get(rid)
            if d is None:
                return None
            d = {k: v for k, v in d.items() if not fields or k in fields}
            return dict(d, id=rid)

        def query(col, fields=None):
            return [get(col, rid, fields) for rid in self.db]

        def upd(col, rid, data):
            self.db[rid].update(data)

        def dele(col, rid):
            self.db.pop(rid)

        for name, fn in (("fs_insert", ins), ("fs_get", get), ("fs_query", query),
                         ("fs_update", upd), ("fs_delete", dele)):
            p = mock.patch.object(nb, name, side_effect=fn)
            p.start()
            self.addCleanup(p.stop)
        self.c = A.app.test_client()

    def add(self, headers=ME, **kw):
        body = {"title": "Не считает ⑧", "category": "Bug", "description": "d"}
        body.update(kw)
        return self.c.post("/api/notebook", json=body, headers=headers)

    def test_add_list_get(self):
        r = self.add(image=IMG, thumb=IMG)
        self.assertEqual(r.status_code, 201)
        rid = r.get_json()["id"]
        lst = self.c.get("/api/notebook", headers=ME).get_json()
        self.assertEqual(lst["total"], 1)
        self.assertNotIn("image", lst["items"][0])
        self.assertEqual(lst["items"][0]["thumb"], IMG)
        full = self.c.get(f"/api/notebook/{rid}", headers=OTHER).get_json()
        self.assertEqual(full["image"], IMG)
        self.assertFalse(full["can_edit"])

    def test_validation(self):
        self.assertEqual(self.add(title="  ").status_code, 400)
        self.assertEqual(self.add(image="http://x/y.png").status_code, 400)
        self.assertEqual(self.add(image="data:image/jpeg;base64," + "A" * 800_000).status_code, 400)
        self.assertEqual(self.c.post("/api/notebook", json={"title": "x"}).status_code, 401)
        self.assertEqual(self.c.get("/api/notebook/nope").status_code, 404)

    def test_rights(self):
        rid = self.add(headers=OTHER).get_json()["id"]
        rid_me = self.add().get_json()["id"]
        # чужую запись диспетчер не удалит, админ — может
        self.assertEqual(self.c.delete(f"/api/notebook/{rid_me}", headers=OTHER).status_code, 403)
        self.assertEqual(self.c.patch(f"/api/notebook/{rid}", json={"title": "y"}, headers=ME).status_code, 200)
        self.assertEqual(self.db[rid]["title"], "y")
        self.assertEqual(self.db[rid]["author"], "dispatcher@gmail.com")
        self.assertEqual(self.c.delete(f"/api/notebook/{rid}", headers=ME).status_code, 200)
        self.assertNotIn(rid, self.db)

    def test_fields_legacy_and_validation(self):
        rid = self.add(category="Thought", where="Флот", priority=9).get_json()["id"]
        full = self.c.get(f"/api/notebook/{rid}", headers=ME).get_json()
        self.assertEqual((full["category"], full["where"], full["priority"], full["status"]), ("Discuss", "Флот", 9, "new"))
        self.assertEqual(self.add(priority=11).status_code, 400)
        r = self.c.patch(f"/api/notebook/{rid}", json={"status": "work", "priority": None}, headers=ME).get_json()
        self.assertEqual((r["status"], r["priority"], r["title"]), ("work", None, "Не считает ⑧"))

    def test_patch_image(self):
        rid = self.add(image=IMG, thumb=IMG).get_json()["id"]
        self.c.patch(f"/api/notebook/{rid}", json={"title": "x"}, headers=ME)
        self.assertEqual(self.db[rid]["image"], IMG)          # без ключа image скрин не трогаем
        self.c.patch(f"/api/notebook/{rid}", json={"image": None}, headers=ME)
        self.assertEqual((self.db[rid]["image"], self.db[rid]["has_image"]), (None, False))

    def test_comments(self):
        rid = self.add().get_json()["id"]
        self.assertEqual(self.c.post(f"/api/notebook/{rid}/comments", json={"text": " "}, headers=OTHER).status_code, 400)
        r = self.c.post(f"/api/notebook/{rid}/comments", json={"text": "проверил"}, headers=OTHER)
        self.assertEqual(r.status_code, 201)
        cid = r.get_json()["comments"][0]["id"]
        lst = self.c.get("/api/notebook", headers=ME).get_json()["items"][0]
        self.assertEqual(lst["comments"][0]["text"], "проверил")
        self.assertTrue(lst["comments"][0]["can_delete"])      # админ
        self.c.post(f"/api/notebook/{rid}/comments", json={"text": "моё"}, headers=ME)
        mine = self.db[rid]["comments"][1]["id"]
        self.assertEqual(self.c.delete(f"/api/notebook/{rid}/comments/{mine}", headers=OTHER).status_code, 403)
        self.assertEqual(self.c.delete(f"/api/notebook/{rid}/comments/{cid}", headers=OTHER).status_code, 200)
        self.assertEqual([c["text"] for c in self.db[rid]["comments"]], ["моё"])

    def test_page(self):
        r = self.c.get("/notebook", headers=ME)
        self.assertEqual(r.status_code, 200)
        self.assertIn("notebook-page.js", r.get_data(as_text=True))


if __name__ == "__main__":
    unittest.main()
