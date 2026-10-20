"""v3.118: PDF-инструкция в панели «Как работает», фильтр диспетчера при первом открытии, список клиентов по диспетчеру."""
import os
import unittest

from tests import ROOT


def read(*p):
    with open(os.path.join(ROOT, *p), encoding="utf-8") as f:
        return f.read()


class V3118(unittest.TestCase):
    def test_pdf_linked(self):
        self.assertIn("/static/instrukciya-dispetchera.pdf", read("templates", "index.html"))
        self.assertTrue(os.path.getsize(os.path.join(ROOT, "static", "instrukciya-dispetchera.pdf")) > 1000)

    def test_client_list_by_dispatcher(self):
        self.assertIn("clientList(rows.filter((r) => rowPassesOwn(r)), clientFilter, tag)", read("static", "client-filter.js"))

    def test_first_open_default(self):
        self.assertIn('let ownFilter = "mine";', read("static", "dispatchers.js"))
