"""v3.119: Temp / NoTemp на плашке рефа (поле строки noTemp)."""
import os
import unittest

from tests import ROOT


def read(*p):
    with open(os.path.join(ROOT, *p), encoding="utf-8") as f:
        return f.read()


class V3119(unittest.TestCase):
    def test_alerts_off_for_notemp(self):
        s = read("static", "row-alerts.js")
        self.assertIn("if (row && row.noTemp) return [];", s)
        self.assertIn("comps.some((c) => c.on)) {", s)

    def test_pill_toggle(self):
        s = read("static", "app.js")
        self.assertIn("rf-nt rf-tog", s)
        self.assertIn("${un}${reeferPillHtml(lt, row)}${far}", s)
        self.assertIn("toggleNoTemp", read("static", "trailer-link.js"))

    def test_foreign_edit_tracked(self):
        from fetat.store.fleet_store import CHG_TOP
        self.assertIn("noTemp", CHG_TOP)
