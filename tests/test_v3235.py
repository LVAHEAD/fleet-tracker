"""v3.235: закладка «Паромы» — ссылка на расписание оператора вместо контактов."""
import os
import re
import unittest

from tests import ROOT

JS = open(os.path.join(ROOT, "static", "ferries.js"), encoding="utf-8").read()
DATA = open(os.path.join(ROOT, "static", "ferries-data.js"), encoding="utf-8").read()


class V3235(unittest.TestCase):
    def test_links(self):
        for op in ("Finnlines", "Transfennica", "Stena Line", "Unity Line", "TT-Line", "DFDS Seaways",
                   "Color Line", "Fjord Line", "Scandlines"):
            self.assertRegex(JS, r'"%s": "https://' % re.escape(op))

    def test_ops_known(self):
        ops = set(re.findall(r'"op": "([^"]+)"', DATA))
        links = set(re.findall(r'"([^"]+)": "https://', JS[JS.index("const OP_LINK"):JS.index("function lineHtml")]))
        self.assertTrue(links <= ops)

    def test_no_contacts_block(self):
        self.assertNotIn("<h4>Контакты</h4>", JS)
        self.assertIn("<h4>Расписание</h4>", JS)
        self.assertIn('".op.lk"', JS)


if __name__ == "__main__":
    unittest.main()
