"""Направление зависимостей (CLAUDE.md → Структура): api → services → domain + clients → utils/config."""
import ast
import glob
import os
import unittest

from tests import ROOT


def fetat_imports(path):
    with open(path, encoding="utf-8") as f:
        tree = ast.parse(f.read())
    out = set()
    for n in ast.walk(tree):
        if isinstance(n, ast.ImportFrom) and n.module:
            out.add(n.module)
        elif isinstance(n, ast.Import):
            out |= {a.name for a in n.names}
    return out


def files(sub):
    return glob.glob(os.path.join(ROOT, "fetat", sub, "*.py"))


class StructureTest(unittest.TestCase):
    def assert_no_import(self, sub, prefixes):
        for f in files(sub):
            bad = [m for m in fetat_imports(f) if any(m == p or m.startswith(p + ".") for p in prefixes)]
            self.assertEqual(bad, [], f"{os.path.relpath(f, ROOT)} импортирует {bad}")

    def test_utils_are_leaves(self):
        self.assert_no_import("utils", ["fetat.clients", "fetat.domain", "fetat.services", "fetat.api", "flask", "requests"])

    def test_clients_do_not_know_domain(self):
        self.assert_no_import("clients", ["fetat.domain", "fetat.services", "fetat.api", "flask"])

    def test_domain_without_flask_and_http(self):
        # в сеть domain ходит только через fetat.clients
        self.assert_no_import("domain", ["fetat.services", "fetat.api", "flask", "requests"])

    def test_nobody_imports_app(self):
        for f in glob.glob(os.path.join(ROOT, "fetat", "**", "*.py"), recursive=True):
            self.assertNotIn("app", fetat_imports(f), os.path.relpath(f, ROOT))


if __name__ == "__main__":
    unittest.main()
