"""v3.299: лёгкий /api/positions, пауза опроса без активности, непрерывный заезд едущей машины."""
import pathlib
import unittest
from unittest import mock

from tests import A  # noqa: F401  (поднимает приложение и пути)

ROOT = pathlib.Path(__file__).resolve().parents[1]
HDR = {"X-Goog-Authenticated-User-Email": "accounts.google.com:vladimirs.head@gmail.com"}


class Positions(unittest.TestCase):
    def test_light_payload(self):
        import app as appmod
        from fetat.api import mapon
        units = [
            {"unit_id": 1, "number": "OB-1", "lat": 50.0, "lng": 20.0, "state": {"name": "driving"}, "direction": 90, "speed": 70},
            {"unit_id": 2, "number": "OB-2", "lat": 51.0, "lng": 21.0, "state": {"name": "standing"}},
            {"unit_id": 3, "number": "TRL", "lat": 52.0, "lng": 22.0, "state": {"name": "standing"}},   # не из группы
            {"unit_id": 4, "number": "NOPOS", "lat": None, "lng": None, "state": {"name": "standing"}},
        ]
        with mock.patch.object(mapon, "MAPON_API_KEY", "k"), \
             mock.patch.object(mapon, "fetch_units", return_value=units), \
             mock.patch.object(mapon, "fetch_group_unit_ids", return_value={1, 2, 4}):
            r = appmod.app.test_client().get("/api/positions", headers=HDR)
        self.assertEqual(r.status_code, 200)
        us = r.get_json()["units"]
        self.assertEqual([u["number"] for u in us], ["OB-1", "OB-2"])
        self.assertEqual(us[0]["st"], "driving")
        self.assertEqual(us[0]["dir"], 90)
        self.assertEqual(set(us[0]), {"number", "kind", "lat", "lng", "st", "dir"})   # без spd / dur / code


class Client(unittest.TestCase):
    def test_map_core(self):
        s = (ROOT / "static" / "map-core.js").read_text(encoding="utf-8")
        self.assertIn('"/api/positions?t="', s)
        self.assertIn("IDLE_MS = 5 * 60 * 1000", s)
        self.assertIn("pollPaused", s)
        self.assertIn("LIVE_GLIDE_MS = 30000", s)
        self.assertIn('status === "driving" ? LIVE_GLIDE_MS : GLIDE_MS', s)
        self.assertIn("truckCur[rowId] || lastTruckPos[rowId]", s)
