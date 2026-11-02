"""v3.254: строка не уходит из вида при смене диспетчера до ухода из поля (pinnedRowId)."""
import os
import unittest

ROOT = os.path.join(os.path.dirname(__file__), "..")


def _read(*p):
    with open(os.path.join(ROOT, *p), encoding="utf-8") as f:
        return f.read()


class V3254(unittest.TestCase):
    def test_pin_declared_and_respected(self):
        disp = _read("static", "dispatchers.js")
        self.assertIn("let pinnedRowId = null;", disp)
        self.assertIn("if (pinnedRowId != null && String(row.id) === String(pinnedRowId)) return true;", disp)

    def test_change_pins_blur_releases(self):
        app = _read("static", "app.js")
        self.assertIn("pinnedRowId = id;", app)
        self.assertIn('dsel.addEventListener("blur"', app)
        self.assertIn("pinnedRowId = null; renderRows();", app)


if __name__ == "__main__":
    unittest.main()
