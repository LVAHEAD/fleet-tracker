"""v3.300: имя объекта Mapon по введённому GPS — только внутри зоны или у края (до 25 м)."""
import unittest
from unittest import mock

from tests import A  # noqa: F401
from fetat.domain import points as P

# квадрат ~100 × 100 м вокруг (50.7229, 1.5925)
D = 0.0005
POLY = [(50.7229 - D, 1.5925 - D * 1.6), (50.7229 - D, 1.5925 + D * 1.6), (50.7229 + D, 1.5925 + D * 1.6), (50.7229 + D, 1.5925 - D * 1.6)]
OBJ = {"name": "SB JP Maree BSM", "gid": "", "poly": POLY, "c": (50.7229, 1.5925),
       "bbox": (50.7229 - D, 50.7229 + D, 1.5925 - D * 1.6, 1.5925 + D * 1.6)}


class Strict(unittest.TestCase):
    def test_far_point_not_snapped_but_loose_rule_snaps(self):
        with mock.patch.object(P, "mapon_objects", return_value=[OBJ]):
            # точка ~190 м южнее зоны: старое правило (край до 300 м) цепляет, строгое — нет
            self.assertIsNotNone(P.target_object(50.72074, 1.59224))
            self.assertIsNone(P.target_object(50.72074, 1.59224, strict=True))

    def test_inside_and_at_edge_snapped(self):
        with mock.patch.object(P, "mapon_objects", return_value=[OBJ]):
            self.assertIsNotNone(P.target_object(50.7229, 1.5925, strict=True))
            self.assertIsNotNone(P.target_object(50.7229 - D - 0.0001, 1.5925, strict=True))   # ~11 м от края
