"""После v3.132: свой фильтр диспетчеров у Карты Флота (map-disp-filter.js), «Таблица» — как раньше."""
import os
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return f.read()


class MapDispFilterSourceTest(unittest.TestCase):
    def test_module_modes_and_storage(self):
        js = _read("static/map-disp-filter.js")
        for part in ('"fleet-map-disp"', 'sel === "table"', 'sel === "all"', 'sel = cur.length ? cur : "all"',
                     "ControlPosition.TOP_CENTER", "window.MapDispFilter"):
            self.assertIn(part, js)

    def test_map_uses_own_filter(self):
        core = _read("static/map-core.js")
        self.assertIn("rowPassesFilterWith(row, window.MapDispFilter.pass)", core)
        self.assertIn("MapDispFilter.attach(map)", core)
        self.assertIn("function rowPassesFilterWith(row, ownPass)", _read("static/fleet-sort-filter.js"))

    def test_loaded_after_dispatchers(self):
        html = _read("templates/index.html")
        self.assertLess(html.index("'dispatchers.js'"), html.index("'map-disp-filter.js'"))
        self.assertIn("MapDispFilter.render", _read("static/dispatchers.js"))

    def test_styles(self):
        css = _read("static/style.css")
        self.assertIn(".mdf .mdf-b.on", css)


if __name__ == "__main__":
    unittest.main()
