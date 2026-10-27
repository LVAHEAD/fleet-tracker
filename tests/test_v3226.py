"""v3.226: яркая «C» (NO / 200 км от Стокгольма), км пройденных точек только из кеша, строка «сегодня» в калькуляторе."""
import os
import unittest
from unittest import mock

from tests import ROOT


def rd(*p):
    with open(os.path.join(ROOT, *p), encoding="utf-8") as f:
        return f.read()


class V3226(unittest.TestCase):
    def test_chain_geo(self):
        from fetat.domain.points import chain_geo
        self.assertTrue(chain_geo(None, None, "NO17"))            # Норвегия — по коду
        self.assertTrue(chain_geo(59.86, 17.64, "SE25"))          # Уппсала, ~65 км от Стокгольма
        self.assertTrue(chain_geo(58.59, 16.19, "SE15"))          # Норрчёпинг, ~160 км
        self.assertFalse(chain_geo(57.70, 11.97, "SE40"))         # Гётеборг, ~400 км
        self.assertFalse(chain_geo(50.0, 8.0, "DE60"))
        self.assertFalse(chain_geo(None, None, None))

    def test_leg_cache_only_no_google(self):
        from fetat.clients import google_routes as gr
        with mock.patch.object(gr, "_shared_get", return_value=None), \
             mock.patch.object(gr, "_road_distance_km_google") as g:
            self.assertEqual(gr.road_distance_km_google(51.0, 7.0, 52.0, 8.0, "k", None, kind="leg", cache_only=True), (None, None))
            g.assert_not_called()

    def test_front(self):
        app = rd("static", "app.js")
        self.assertIn("done_leg_km: x.done_leg_km", app)          # extraCalc больше не теряет км пройденной точки
        self.assertIn("chain-hi", app)
        self.assertIn(".chain-cell.chain-hi .chain-cb:not(:checked)", rd("static", "style.css"))
        self.assertIn("chain_geo", rd("static", "done-marks.js"))
        ec = rd("static", "eta-calc.js")
        self.assertIn("waiting ? nowMs : S.etd", ec)
        self.assertIn('class="wt"', ec)
        self.assertIn(".ec-day i.wt", rd("static", "eta-calc.css"))


if __name__ == "__main__":
    unittest.main()
