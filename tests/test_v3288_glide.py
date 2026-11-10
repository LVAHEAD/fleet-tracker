import os
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return f.read()


class TruckGlideTest(unittest.TestCase):
    """v3.288: машины на карте Флота плывут к новой позиции; позиции обновляются раз в 30 с без Google."""

    def test_glide_wired_into_update_marker(self):
        js = _read("static/map-core.js")
        self.assertIn("function glideTruck(rowId, from, to, dur)", js)
        self.assertIn("if (!glideOk(from, pos)) markers[rowId].setPosition(pos);", js)
        self.assertIn("if (gl) glideTruck(rowId, from, pos, status === \"driving\" ? LIVE_GLIDE_MS : GLIDE_MS);", js)

    def test_poll_only_positions_when_map_open_and_visible(self):
        js = _read("static/map-core.js")
        self.assertIn("!document.hidden && map && window.fleetMapPanel && window.fleetMapPanel.isOpen()", js)
        self.assertIn("refreshFleetPositions().catch(() => {});\n}, 30 * 1000);", js)
        # опрос позиций не зовёт расчёт строк
        body = js.split("async function refreshFleetPositions()")[1].split("// v3.288: «живые»")[0]
        self.assertNotIn("calcAllRows", body)
        self.assertIn('"/api/positions?t="', body)


if __name__ == "__main__":
    unittest.main()
