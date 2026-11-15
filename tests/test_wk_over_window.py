"""v3.319: метка недельного отдыха, когда срок 24ка/45ка раньше начала окна выгрузки."""
import unittest

from tests import ROOT
import os


class WkOverWindow(unittest.TestCase):
    def test_weekly_over_html_uses_delivery(self):
        js = open(os.path.join(ROOT, "static", "app.js"), encoding="utf-8").read()
        f = js[js.index("function weeklyOverHtml"):js.index("// v3.236: у открытой точки")]
        self.assertIn("delivery", f)
        self.assertIn("раньше начала окна выгрузки", f)
        self.assertIn("weeklyOverHtml(c.weekly, firstEta, row.delivery)", js)
        self.assertIn("weeklyOverHtml(c.weekly, ce.eta_tacho || ce.eta_local, x.delivery)", js)
        # v3.320: первая открытая точка ②+ (① пройдена, строка composed) тоже получает метку
        self.assertIn("nbAt === i && !c.onArr && ce && !ce.done && !ce.error ? weeklyOverHtml(", js)


if __name__ == "__main__":
    unittest.main()
