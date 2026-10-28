"""v3.231: карточка адреса — объект Mapon и его группа (object_at, /api/mapon-object-at)."""
import unittest
from unittest import mock


SQUARE = [(39.78, -0.20), (39.78, -0.18), (39.79, -0.18), (39.79, -0.20)]
OBJ = {"name": "GREEN FRUITS", "gid": "7", "poly": SQUARE, "bbox": (39.78, 39.79, -0.20, -0.18), "c": (39.785, -0.19)}


class ObjectAtTest(unittest.TestCase):
    def test_inside_with_group(self):
        from fetat.domain import points
        with mock.patch.object(points, "mapon_objects", return_value=[OBJ]), \
             mock.patch.object(points, "mapon_group_names", return_value={"7": "GFI Clients"}):
            self.assertEqual(points.object_at(39.78144, -0.19192), {"name": "GREEN FRUITS", "group": "GFI Clients"})

    def test_group_unknown_and_far(self):
        from fetat.domain import points
        with mock.patch.object(points, "mapon_objects", return_value=[OBJ]), \
             mock.patch.object(points, "mapon_group_names", return_value={}):
            self.assertEqual(points.object_at(39.785, -0.19)["group"], "")
            self.assertIsNone(points.object_at(50.0, 10.0))

    def test_endpoint(self):
        from fetat import create_app
        from fetat.api import mapon as api
        c = create_app().test_client()
        self.assertEqual(c.get("/api/mapon-object-at").status_code, 400)
        with mock.patch.object(api, "MAPON_API_KEY", "k"), \
             mock.patch.object(api, "object_at", return_value={"name": "X", "group": "G"}):
            self.assertEqual(c.get("/api/mapon-object-at?lat=1&lng=2").get_json(), {"object": {"name": "X", "group": "G"}})
        with mock.patch.object(api, "MAPON_API_KEY", "k"), mock.patch.object(api, "object_at", return_value=None):
            self.assertEqual(c.get("/api/mapon-object-at?lat=1&lng=2").get_json(), {"object": None})


if __name__ == "__main__":
    unittest.main()
