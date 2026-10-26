"""v3.223: «45 h / 24 h» в плитке недельного отдыха, задержка подсказок 2 с, окно комментария не выше экрана."""
import os
import unittest

from tests import A, ROOT
from tests.test_v3104 import H, blank_team


def rd(*p):
    with open(os.path.join(ROOT, *p), encoding="utf-8") as f:
        return f.read()


def crew(mins):
    t = blank_team(len(mins))
    for d, m in zip(t["drivers"], mins):
        d.setdefault("week", {})["weekly_rest_min"] = m
    t["drivers"][0]["current_state"] = "DRIVING"
    return t


class V3223(unittest.TestCase):
    def test_weekly_need_from_mapon(self):                    # OS-2431: 24 ч у обоих; NR-7206: 45 ч у обоих
        p = A.tacho_panel(crew([86400, 86400]))
        self.assertEqual((p["weekly_need"], p["weekly_mixed"]), (86400, False))
        p = A.tacho_panel(crew([162000, 162000]))
        self.assertEqual((p["weekly_need"], p["weekly_mixed"]), (162000, False))

    def test_weekly_need_strictest(self):
        p = A.tacho_panel(crew([86400, 162000]))
        self.assertEqual((p["weekly_need"], p["weekly_mixed"]), (162000, True))

    def test_front(self):
        js = rd("static", "tacho-pop.js")
        self.assertIn("weeklyNeed(pp)", js)
        self.assertIn("tiles(ds[tab] || null, p.at, p)", js)
        self.assertIn("open(el), 2000)", js)
        self.assertIn("open(el), 2000)", rd("static", "reefer-pop.js"))

    def test_comment_window_fits_screen(self):
        rc = rd("static", "row-comments.js")
        self.assertIn('el.classList.contains("com-ed")', rc)
        self.assertIn("window.innerHeight - H - 8", rc)
        css = rd("static", "style.css")
        self.assertIn(".com-ed { max-height: calc(100vh - 16px)", css)


if __name__ == "__main__":
    unittest.main()
