"""v3.55: вершины полигона Mapon для слоя объектов на картах и кеш списка объектов."""
import unittest

from fetat.utils.geo import _wkt_vertices


class WktVerticesTest(unittest.TestCase):
    def test_closed_polygon_drops_closing_point(self):
        got = _wkt_vertices("POLYGON((37.94868 -1.25986, 37.9 -1.2, 37.91 -1.3, 37.94868 -1.25986))")
        self.assertEqual(got, [[37.94868, -1.25986], [37.9, -1.2], [37.91, -1.3]])

    def test_empty_or_missing_wkt(self):
        self.assertEqual(_wkt_vertices(None), [])
        self.assertEqual(_wkt_vertices(""), [])

    def test_lng_first_is_swapped_to_lat_first(self):
        got = _wkt_vertices("POLYGON((-1.25986 37.94868, -1.2 37.9))")
        # первая величина по модулю меньше 90 — порядок как в файле (lat первой); большая первая — меняем
        self.assertEqual(got, [[-1.25986, 37.94868], [-1.2, 37.9]])
        swapped = _wkt_vertices("POLYGON((120.5 40.1, 120.6 40.2))")
        self.assertEqual(swapped, [[40.1, 120.5], [40.2, 120.6]])


if __name__ == "__main__":
    unittest.main()
