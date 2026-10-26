"""v3.221: «off» в /gusage по расстоянию до линии; всплывашка тахографа — над флагом / значком экипажа; копирование номера прицепа."""
import pathlib
import time
import unittest

from fetat.clients import google_routes as gr
from fetat.services import gusage

ROOT = pathlib.Path(__file__).resolve().parent.parent


def rd(*p):
    return (ROOT.joinpath(*p)).read_text(encoding="utf-8")


class OffBucketsTest(unittest.TestCase):
    def setUp(self):
        gr._along_cache.clear()

    def test_buckets_by_distance_from_line(self):
        now = time.time()
        k = ("truck", 1.0, 2.0, "")
        # линия — отрезок вдоль меридиана 10.0° от 50.0 до 50.1 (≈ 11 км), машина сдвигается на восток
        gr._along_cache[k] = {"at": now - 60, "pts": [(50.0, 10.0), (50.1, 10.0)], "cum": [0.0, 11.0], "scale": 1}
        kx = 111.32 * 0.6428   # км на градус долготы на 50° с.ш.
        for km, want in ((2.5, "off_2_3"), (4.0, "off_3_5"), (7.0, "off_5_10"), (15.0, "off_far")):
            lng = 10.0 + km / kx
            self.assertEqual(gr._truck_miss_reason(k, True, now, 50.05, lng), want, km)
        self.assertEqual(gr._truck_miss_reason(k, True, now), "off")   # без координат — прежнее поведение

    def test_labels_exist(self):
        for key in ("off_2_3", "off_3_5", "off_5_10", "off_far"):
            self.assertIn(key, gusage.MISS)


class FrontTest(unittest.TestCase):
    def test_tacho_pop_only_over_flag_and_crew(self):
        js = rd("static", "tacho-pop.js")
        self.assertIn('const AREA = ".cc-badge, .crew-b"', js)
        self.assertIn("!t.closest(AREA)", js)

    def test_copy_trailer_number(self):
        js = rd("static", "app.js")
        self.assertIn('class="hitch-pill trl-copy"', js)
        self.assertIn("navigator.clipboard.writeText", js)
        self.assertIn(".trl-copy", rd("static", "style.css"))


if __name__ == "__main__":
    unittest.main()
