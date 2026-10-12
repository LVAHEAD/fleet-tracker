"""Лист «Ссылки» (Links): разбор групп и запасной список (сеть подменена)."""
import unittest
from unittest import mock

from tests import A  # noqa: F401  (поднимает приложение и пути)
from fetat.domain import links as lk

SHEET = [
    [], [],
    ["заказ паромов"],
    ["https://cargo.eckeroline.com/", "Eckero Portal"],
    ["mailto:booking@kreiss.lv", "Kreiss mail"],
    [], [],
    ["Fuel", ""],
    ["https://login.eurowag.com/", "EWAG"],
    ["https://www.as24.com/path"],
    ["javascript:alert(1)", "плохая"],
    ["Пустая группа"],
]


class LinksTest(unittest.TestCase):
    def setUp(self):
        lk._links_cache.update(groups=None, loaded_at=0.0, error=None, source="default")

    def test_parse(self):
        g = lk.parse_links(SHEET)
        self.assertEqual([x["title"] for x in g], ["заказ паромов", "Fuel"])
        self.assertEqual(g[0]["items"][1], {"url": "mailto:booking@kreiss.lv", "name": "Kreiss mail"})
        self.assertEqual(g[1]["items"][1], {"url": "https://www.as24.com/path", "name": "www.as24.com"})
        self.assertEqual(len(g[1]["items"]), 2)   # javascript: не ссылка и не заголовок (есть B)

    def test_links_before_any_group(self):
        g = lk.parse_links([["https://a.example/", "A"]])
        self.assertEqual(g, [{"title": "", "items": [{"url": "https://a.example/", "name": "A"}]}])

    def test_sheet_ok(self):
        with mock.patch.object(lk, "read_sheet_values", return_value=SHEET):
            self.assertEqual(len(lk.get_links(force=True)), 2)
        self.assertEqual(lk._links_cache["source"], "sheet")

    def test_default_on_error(self):
        with mock.patch.object(lk, "read_sheet_values", side_effect=RuntimeError("нет сети")):
            g = lk.get_links(force=True)
        self.assertEqual(g[0]["title"], "заказ паромов")
        self.assertEqual(lk._links_cache["source"], "default")
        self.assertIn("нет сети", lk._links_cache["error"])

    def test_api(self):
        with mock.patch.object(lk, "read_sheet_values", return_value=SHEET):
            r = A.app.test_client().get("/api/links?refresh=1") if hasattr(A, "app") else None
        if r is not None:
            self.assertTrue(r.get_json()["ok"])


if __name__ == "__main__":
    unittest.main()
