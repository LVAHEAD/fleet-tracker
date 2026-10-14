"""v3.114: ⏱ калькулятор подтягивает данные машины (общий сбор seed как у строки Флота, /api/unit-seed)
и фильтр по клиентам во Флоте (static/client-filter.js, чистые функции — через node; нет node — пропуск)."""
import json
import os
import shutil
import subprocess
import unittest

from tests import A, ROOT

NODE = shutil.which("node")
H = 3600


def solo(left=5 * H):
    return {"drivers": [{
        "current_state": "DRIVING", "now": {"rest": 0, "driving": 0},
        "today": {"driving_remaining": left, "shift_remaining": 8 * H},
        "week": {"driving_remaining": 30 * H, "9h_rest_shortening_remaining": 2,
                 "10h_driving_extensions_remaining": 0}}]}


UNIT = {"unit_id": 7, "number": "NU-8704", "label": "NU-8704", "lat": 50.0, "lng": 8.0,
        "state": {"name": "driving", "duration": H}}


class _Patch(unittest.TestCase):
    NAMES = ("get_tacho", "unit_driving_days", "unit_driver_names", "unit_route_segments", "fetch_units", "MAPON_API_KEY")

    def setUp(self):
        self._saved = {k: getattr(A, k) for k in self.NAMES}
        A.unit_driving_days = lambda uid: {"d1": 6 * H}
        A.unit_driver_names = lambda uid: []
        A.unit_route_segments = lambda uid: []
        A.MAPON_API_KEY = "test-key"

    def tearDown(self):
        for k, v in self._saved.items():
            setattr(A, k, v)


class TruckSeedTest(_Patch):
    def test_seed_like_fleet_row(self):
        A.get_tacho = lambda uid: (solo(), None)
        s = A.truck_seed(UNIT)
        self.assertEqual(s["left_h"], 5.0)
        self.assertFalse(s["team"])
        res = {"dist_km": 900.0}
        A._add_tacho(res, UNIT, False, None)
        self.assertEqual({k: v for k, v in s.items() if k not in ("crew_src", "crew_hist_h")}, res["calc_seed"])   # тот же путь, что у строки Флота
        self.assertEqual(s["crew_src"], "tacho")                                              # + откуда состав — для подписи в калькуляторе

    def test_route_seed_uses_it(self):
        A.get_tacho = lambda uid: (solo(), None)
        self.assertEqual(A._truck_seed(UNIT), A.truck_seed(UNIT))

    def test_manual_crew_from_fleet_row_beats_history(self):
        # v3.115: во Флоте у машины 👤 вручную — From → To и калькулятор берут его, а не «езда за сутки» по GPS
        A.get_tacho = lambda uid: (solo(), None)
        A.unit_driving_days = lambda uid: {"d1": 20 * H}
        auto = A.truck_seed(UNIT)
        self.assertTrue(auto["team"])
        self.assertEqual(auto["crew_src"], "hist")
        self.assertEqual(auto["crew_hist_h"], 20.0)
        man = A.truck_seed(UNIT, crew="solo")
        self.assertFalse(man["team"])
        self.assertEqual(man["crew_src"], "manual")
        self.assertEqual(man["left_h"], 5.0)

    def test_from_crew_payload(self):
        self.assertEqual(A.from_crew({"from_crew": "solo", "from_crew_seen": 1700000000}), ("solo", 1700000000.0))
        self.assertEqual(A.from_crew({"from_crew": "bad", "from_crew_seen": "x"}), (None, None))
        self.assertEqual(A.from_crew({}), (None, None))

    def test_unit_seed_takes_crew(self):
        A.get_tacho = lambda uid: (solo(), None)
        A.unit_driving_days = lambda uid: {"d1": 20 * H}
        A.fetch_units = lambda key: [UNIT]
        self.assertTrue(A.unit_seed("NU-8704")[0]["calc_seed"]["team"])
        self.assertFalse(A.unit_seed("NU-8704", "solo")[0]["calc_seed"]["team"])

    def test_no_card_gives_unknown_seed(self):
        A.get_tacho = lambda uid: (None, "нет данных водителя")
        s = A.truck_seed(UNIT)
        self.assertTrue(s["unknown"])
        self.assertEqual(s["left_h"], 9.0)


class UnitSeedTest(_Patch):
    def test_machine(self):
        A.get_tacho = lambda uid: (solo(), None)
        A.fetch_units = lambda key: [UNIT]
        body, code = A.unit_seed(" nu-8704 ")
        self.assertEqual(code, 200)
        self.assertTrue(body["truck"])
        self.assertEqual(body["unit"], "NU-8704")
        self.assertEqual(body["calc_seed"]["left_h"], 5.0)

    def test_not_machine_no_geocoder(self):
        def boom(key):
            raise AssertionError("список машин не нужен")
        A.fetch_units = lambda key: []
        self.assertEqual(A.unit_seed("Riga"), ({"truck": False}, 200))
        A.fetch_units = boom
        self.assertEqual(A.unit_seed("57.1, 24.2"), ({"truck": False}, 200))   # GPS
        self.assertEqual(A.unit_seed("NL29"), ({"truck": False}, 200))         # код региона
        self.assertEqual(A.unit_seed(""), ({"truck": False}, 200))
        self.assertEqual(A.unit_seed(None), ({"truck": False}, 200))

    def test_error_is_502(self):
        def boom(key):
            raise RuntimeError("Mapon недоступен")
        A.fetch_units = boom
        body, code = A.unit_seed("NU-8704")
        self.assertEqual(code, 502)
        self.assertIn("Mapon", body["error"])

    def test_endpoint(self):
        c = A.app.test_client()
        r = c.post("/api/unit-seed", json={"from": ""})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.get_json(), {"truck": False})


def _read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as f:
        return f.read()


class WiringTest(unittest.TestCase):
    def test_calc_front(self):
        js = _read("static", "eta-calc.js")
        self.assertIn("function applySeed(", js)
        self.assertIn("/api/unit-seed", js)
        self.assertEqual(js.count("applySeed("), 3)    # объявление, fromRow, ftSeed
        self.assertEqual(js.count("fleetCrewFor(from)"), 2)       # v3.115: ручной 👤 / 👥 из строки Флота — и в /api/route, и в /api/unit-seed
        self.assertIn("fleetCrewFor(froms[0])", _read("static", "route-tab.js"))
        self.assertIn("function fleetCrewFor(", _read("static", "app.js"))

    def test_client_filter_wiring(self):
        self.assertIn("rowPassesClient(row)", _read("static", "fleet-sort-filter.js"))
        html = _read("templates", "index.html")
        self.assertIn('id="client-flt-th"', html)
        self.assertLess(html.index("client-filter.js"), html.index("app.js"))
        sf = _read("static", "fleet-sort-filter.js")
        self.assertLess(sf.index("awaitsComplete(row)) return true"), sf.index("rowPassesClient(row)"))


DRIVER = r"""
const fs = require('fs'), vm = require('vm');
const code = fs.readFileSync(process.argv[1], 'utf8');
vm.runInThisContext(code + "\n;globalThis.__api = { clientName, clientKey, clientList, rowPassesClient, set: (a) => { clientFilter = a; } };");
const a = globalThis.__api;
const rows = [
  { unit: "A", client: "Kesko" }, { unit: "B", client: "  kesko " }, { unit: "C", client: "STEF Italia spa" },
  { unit: "D", client: "STEF Italia" }, { unit: "E", client: "Bama" }, { unit: "F", client: "" }, { unit: "", client: "Kesko" },
];
const out = {};
out.name = a.clientName({ client: "  STEF   Italia  " });
out.key = [a.clientKey("Kesko"), a.clientKey(" KE sko "), a.clientKey(null)];
out.list = a.clientList(rows, []).map((x) => [x.name, x.count, x.on]);
out.listSel = a.clientList(rows, ["bama", "gone"]).map((x) => [x.key, x.count, x.on]);
a.set([]);
out.noFilter = rows.map((r) => a.rowPassesClient(r));
a.set(["kesko"]);
out.kesko = rows.map((r) => a.rowPassesClient(r));
a.set(["kesko", "bama"]);
out.two = rows.map((r) => a.rowPassesClient(r));
console.log(JSON.stringify(out));
"""


@unittest.skipUnless(NODE, "нет node")
class ClientFilterTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        out = subprocess.run([NODE, "-e", DRIVER, os.path.join(ROOT, "static", "client-filter.js")],
                             capture_output=True, text=True, timeout=60)
        if out.returncode:
            raise RuntimeError(out.stderr)
        cls.r = json.loads(out.stdout)

    def test_name_and_key(self):
        self.assertEqual(self.r["name"], "STEF Italia")
        self.assertEqual(self.r["key"], ["kesko", "kesko", ""])

    def test_list_alphabetical_with_counts(self):
        # Kesko / kesko — один пункт (без учёта регистра и пробелов), «STEF Italia spa» и «STEF Italia» — разные;
        # пустая строка без машины и без клиента не считается
        self.assertEqual(self.r["list"], [["Bama", 1, False], ["Kesko", 2, False],
                                          ["STEF Italia", 1, False], ["STEF Italia spa", 1, False]])

    def test_list_keeps_selected_missing(self):
        self.assertEqual(self.r["listSel"], [["bama", 1, True], ["gone", 0, True], ["kesko", 2, False],
                                             ["stefitalia", 1, False], ["stefitaliaspa", 1, False]])

    def test_filter(self):
        self.assertEqual(self.r["noFilter"], [True] * 7)
        # пустая строка без машины видна всегда; клиент без названия при фильтре скрыт
        self.assertEqual(self.r["kesko"], [True, True, False, False, False, False, True])
        self.assertEqual(self.r["two"], [True, True, False, False, True, False, True])


if __name__ == "__main__":
    unittest.main()
