"""v3.263: название объекта Mapon рядом с кодом у таргета по ГПС."""
import unittest
from unittest import mock

from fetat.services import fleet_calc as fc


class TargetObjectV3263(unittest.TestCase):
    def _run(self, **extra):
        res = {"target_lat": 59.11039, "target_lng": 11.26030, **extra}
        with mock.patch.object(fc, "object_at", return_value={"name": "SVINESUND Border", "group": "Lad TEMP"}):
            fc._add_code_badges(res, "59.11039, 11.26030")
        return res

    def test_gps_target(self):
        self.assertEqual(self._run().get("target_object"), "SVINESUND Border")

    def test_address_or_truck(self):
        self.assertNotIn("target_object", self._run(target_address={"name": "X"}))
        self.assertNotIn("target_object", self._run(target_is_truck=True))


if __name__ == "__main__":
    unittest.main()
