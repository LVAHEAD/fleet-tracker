"""v3.200: авто-✓ — стоянка раньше отъезда с предыдущей пройденной точки (прошлый груз) не засчитывается."""
import unittest
from unittest import mock

from fetat.domain import points
from fetat.domain.points import _auto_done, _parse_west_ts

T = {"lat": 60.0, "lng": 25.0}
UNIT = {"lat": 55.0, "lng": 20.0, "unit_id": 1}      # машина далеко — «уехал»


def stops(*ends):
    return [{"start": e - 3600, "end": e, "lat": 60.0, "lng": 25.0} for e in ends]


class AutoDoneSince(unittest.TestCase):
    def run_auto(self, ends, since):
        with mock.patch.object(points, "target_object", return_value=None):
            return _auto_done("KESKO", T, 60.0, 25.0, UNIT, [stops(*ends)], since)

    def test_old_stop_ignored(self):
        at, arr, _ = self.run_auto([1000.0], 2000.0)
        self.assertIsNone(at)

    def test_new_stop_counts(self):
        at, arr, _ = self.run_auto([1000.0, 3000.0], 2000.0)
        self.assertEqual(at, 3000.0)

    def test_same_stop_as_previous_point_counts(self):       # две точки на одной площадке — одна стоянка
        at, _, _ = self.run_auto([2000.0], 2000.0)
        self.assertEqual(at, 2000.0)

    def test_no_since_as_before(self):
        at, _, _ = self.run_auto([1000.0], None)
        self.assertEqual(at, 1000.0)

    def test_parse_west(self):
        from fetat.utils.timefmt import ts_west
        t = _parse_west_ts("23/10 23:44")
        self.assertEqual(ts_west(t).strftime("%d/%m %H:%M"), "23/10 23:44")
        self.assertIsNone(_parse_west_ts("мусор"))


if __name__ == "__main__":
    unittest.main()
