"""v3.156: «Флот (N)» на вкладке; автообновление не считает скрытые фильтром строки."""
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent


def read(*p):
    with open(ROOT.joinpath(*p), encoding="utf-8") as f:
        return f.read()


class FleetCountTest(unittest.TestCase):
    def test_tab_has_counter_span(self):
        html = read("templates", "index.html")
        self.assertIn('data-tab="fleet">Флот<span id="fleet-count"', html)

    def test_counter_counts_all_rows_with_unit(self):
        js = read("static", "app.js")
        self.assertIn("function updateFleetCount()", js)
        self.assertIn("rows.filter((r) => r.unit).length", js)
        self.assertIn("updateFleetCount();\n}", js)           # вызов в конце renderRows
        self.assertIn('field === "unit") { delete row.done; updateFleetCount(); }', js)

    def test_auto_refresh_skips_hidden_rows(self):
        js = read("static", "app.js")
        self.assertIn('const queue = kind === "auto" ? [] : rest.filter(', js)


if __name__ == "__main__":
    unittest.main()
