"""v3.204: фильтр по машинам во Флоте (static/unit-filter.js, чистые функции — через node; нет node — пропуск),
столбец «C» (цепи), сортировка «загрузка», розовое «C» (SE / NO), метка под клиентом."""
import json
import os
import shutil
import subprocess
import unittest

from tests import ROOT

NODE = shutil.which("node")


def _read(*p):
    with open(os.path.join(ROOT, *p), encoding="utf-8") as f:
        return f.read()


DRIVER = r"""
const fs = require('fs'), vm = require('vm');
const code = fs.readFileSync(process.argv[1], 'utf8');
vm.runInThisContext(code + "\n;globalThis.__api = { unitKey, unitList, rowPassesUnit, unitSlot, curUnits, set: (a) => { unitFilters['all|all'] = a; }, sets: (all, L, O, who) => { const w = who || 'all'; unitFilters[w + '|all'] = all; unitFilters[w + '|L'] = L; unitFilters[w + '|O'] = O; } };");
const a = globalThis.__api;
const rows = [
  { unit: "NP-7209" }, { unit: "np-7209 " }, { unit: "OI-7251" }, { unit: "OB-2697" }, { unit: "" }, { unit: "OB-10" }, { unit: "OB-9" },
];
const out = {};
out.key = [a.unitKey("NP-7209"), a.unitKey(" np -7209 "), a.unitKey(null)];
out.list = a.unitList(rows, []).map((x) => [x.name, x.count, x.on]);
out.listSel = a.unitList(rows, ["OI-7251", "GONE"]).map((x) => [x.key, x.count, x.on]);
a.set([]);
out.noFilter = rows.map((r) => a.rowPassesUnit(r));
a.set(["NP-7209"]);
out.one = rows.map((r) => a.rowPassesUnit(r));
a.set(["NP-7209", "OI-7251"]);
out.two = rows.map((r) => a.rowPassesUnit(r));
// v3.205: у режимов все / L / O свои наборы машин
a.sets([], ["NP-7209"], ["OI-7251"]);
const pass = () => rows.map((r) => a.rowPassesUnit(r));
globalThis.loFilter = "all"; out.slotAll = [a.unitSlot(), pass().every(Boolean)];
globalThis.loFilter = "L"; out.slotL = [a.unitSlot(), pass()];
globalThis.loFilter = "O"; out.slotO = [a.unitSlot(), pass()];
globalThis.loFilter = "L"; out.backL = pass();
// и у каждого диспетчера свой набор: другой диспетчер — свои наборы, возврат — прежние
a.sets([], ["OB-2697"], [], "vl@x.com");
globalThis.ownFilter = "vl@x.com"; out.vlL = [a.unitSlot(), pass()];
globalThis.ownFilter = "all"; out.allAgain = [a.unitSlot(), pass()];
globalThis.fleetMe = () => "vl@x.com"; globalThis.ownFilter = "mine"; out.mine = a.unitSlot();
console.log(JSON.stringify(out));
"""


@unittest.skipUnless(NODE, "нет node")
class UnitFilterTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        out = subprocess.run([NODE, "-e", DRIVER, os.path.join(ROOT, "static", "unit-filter.js")],
                             capture_output=True, text=True, timeout=60)
        if out.returncode:
            raise RuntimeError(out.stderr)
        cls.r = json.loads(out.stdout)

    def test_key(self):
        self.assertEqual(self.r["key"], ["NP-7209", "NP-7209", ""])

    def test_list_sorted_with_counts(self):
        # NP-7209 и «np-7209 » — одна машина; пустая строка без машины не считается; числа в номере — по возрастанию (9, 10, 2697)
        self.assertEqual(self.r["list"], [["NP-7209", 2, False], ["OB-9", 1, False], ["OB-10", 1, False],
                                          ["OB-2697", 1, False], ["OI-7251", 1, False]])

    def test_list_keeps_selected_missing(self):
        on = {k: o for k, c, o in self.r["listSel"]}
        self.assertTrue(on["OI-7251"])
        self.assertTrue(on["GONE"])
        self.assertFalse(on["NP-7209"])

    def test_filter(self):
        self.assertEqual(self.r["noFilter"], [True] * 7)
        # пустая строка без машины видна всегда
        self.assertEqual(self.r["one"], [True, True, False, False, True, False, False])
        self.assertEqual(self.r["two"], [True, True, True, False, True, False, False])


class UnitFilterSlotsTest(UnitFilterTest):
    def test_separate_sets_per_lo_mode(self):
        self.assertEqual(self.r["slotAll"], ["all|all", True])
        self.assertEqual(self.r["slotL"], ["all|L", [True, True, False, False, True, False, False]])
        self.assertEqual(self.r["slotO"], ["all|O", [False, False, True, False, True, False, False]])
        self.assertEqual(self.r["backL"], self.r["slotL"][1])   # вернулись на L — набор L прежний

    def test_separate_sets_per_dispatcher(self):
        self.assertEqual(self.r["vlL"], ["vl@x.com|L", [False, False, False, True, True, False, False]])
        self.assertEqual(self.r["allAgain"], ["all|L", self.r["slotL"][1]])   # вернулись к «Все» — набор «Все / L» прежний
        self.assertEqual(self.r["mine"], "vl@x.com|L")   # «Мои» = набор своего диспетчера


class WiringTest(unittest.TestCase):
    def test_unit_filter_wiring(self):
        html = _read("templates", "index.html")
        self.assertIn('id="unit-flt-th"', html)
        self.assertLess(html.index("unit-filter.js"), html.index("app.js"))
        sf = _read("static", "fleet-sort-filter.js")
        self.assertLess(sf.index("awaitsComplete(row)) return true"), sf.index("rowPassesUnit(row)"))   # «ждущие ✓» видны при любом фильтре
        self.assertLess(sf.index("rowPassesClient(row)"), sf.index("rowPassesUnit(row)"))
        css = _read("static", "style.css")
        self.assertIn("th.th-unit.unit-on", css)
        self.assertIn("unitFilterMark()", _read("static", "app.js"))   # заголовок обновляется при смене L / O

    def test_chain_column(self):
        html = _read("templates", "index.html")
        self.assertLess(html.index("col-unit"), html.index("col-chain"))
        self.assertLess(html.index("col-chain"), html.index("col-status"))
        self.assertIn(">C</th>", html)
        self.assertIn('"chain"', _read("fetat", "store", "fleet_store.py"))
        js = _read("static", "app.js")
        self.assertIn('class="chain-cell"', js)
        self.assertIn('setRowField(id, "chain"', js)
        self.assertIn("chain-need", js)
        self.assertIn("NO|SE", js)

    def test_load_sort_and_mark(self):
        sf = _read("static", "fleet-sort-filter.js")
        self.assertIn('"load"', sf)
        self.assertIn("function loadKey", sf)
        self.assertIn('data-sort="load"', _read("templates", "index.html"))
        app = _read("static", "app.js")
        self.assertIn("markDateText", app)
        self.assertIn('"красный"', app)
        self.assertIn("seg-open", app)


if __name__ == "__main__":
    unittest.main()
