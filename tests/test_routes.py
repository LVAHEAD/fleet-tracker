"""Эталон списка маршрутов: при переезде в Blueprints ни один /api/* не должен потеряться."""
import os
import unittest

from tests import A, FIXTURES


def current_routes():
    return sorted(f"{r.rule} {','.join(sorted(r.methods - {'HEAD', 'OPTIONS'}))}"
                  for r in A.app.url_map.iter_rules())


class RoutesTest(unittest.TestCase):
    def test_routes_match_fixture(self):
        with open(os.path.join(FIXTURES, "routes.txt"), encoding="utf-8") as f:
            expected = [line.strip() for line in f if line.strip()]
        self.assertEqual(current_routes(), expected)

    def test_static_pages(self):
        c = A.app.test_client()
        self.assertEqual(c.get("/").status_code, 200)
        r = c.get("/api/region-codes")
        self.assertEqual(r.status_code, 200)


if __name__ == "__main__":
    unittest.main()
