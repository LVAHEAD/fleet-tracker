"""v3.136: список АЗС (опубликованные CSV) и сверка с группой Mapon «Actual Petrol Station» — только чтение."""
import os
import unittest
from unittest import mock

from tests import ROOT


def read(*p):
    with open(os.path.join(ROOT, *p), encoding="utf-8") as f:
        return f.read()


BLOCKS = (
    'Заголовок,Основная,Резервная\n'
    '"Выезд","Польша: AS24 - SLUBICE  GPS: (52.33445, 14.61741) или  AS24 - TORZYM  GPS:  (52.31622, 15.04464)",'
    '"Польша (PL) / EWAG - Slubice GPS: ( 52.334433, 14.615347 ) - оплата картой EWAG!\n'
    '✔  56.93053, 24.01397 - Šampetera 180 (рядом с БАЗОЙ)\n'
    'Чехия (CZ) Eurowag - Rozvadov II  (49.649333, 12.532833) - оплата картой EWAG - пока не работает - сюда не едем\n'
    'Пробег 450.5, 300 литров, цена 1.2, 3.4"\n'
    '"Ещё раз","AS24 - SLUBICE GPS: (52.33445, 14.61741)",""\n'
)
META = (
    'Цены обновлены,16.10.2026 10:40\n'
    ',"x","Страна  /  Станция  -  Платим картой\n'
    ' SWE  /  AS24 - FALKENBERG   -   AS24\n'
    ' LV  /  VIADA LV    -   VIADA"\n'
)


class FuelParse(unittest.TestCase):
    def test_blocks_stations(self):
        from fetat.domain.fuel_stations import parse_blocks
        st = parse_blocks(BLOCKS)
        names = {s["name"] for s in st}
        self.assertIn("AS24 - SLUBICE", names)
        self.assertIn("AS24 - TORZYM", names)
        self.assertIn("Šampetera 180 рядом с БАЗОЙ", names)     # название после координат
        self.assertEqual(len(st), 5)                             # дубль SLUBICE склеен, «450.5, 300» и «1.2, 3.4» — не координаты

    def test_dedup_same_place_counts_mentions(self):
        from fetat.domain.fuel_stations import parse_blocks
        s = [x for x in parse_blocks(BLOCKS) if x["name"] == "AS24 - SLUBICE"][0]
        self.assertEqual(s["mentions"], 2)

    def test_neighbour_stations_of_other_network_kept(self):
        from fetat.domain.fuel_stations import parse_blocks
        st = parse_blocks(BLOCKS)
        self.assertEqual({s["network"] for s in st if s["lat"] > 52.3 and s["lng"] < 14.7}, {"AS24", "EWAG"})

    def test_not_working_flag(self):
        from fetat.domain.fuel_stations import parse_blocks
        st = parse_blocks(BLOCKS)
        self.assertEqual([s["name"] for s in st if s["not_working"]], ["Чехия CZ Eurowag - Rozvadov II"])

    def test_meta(self):
        from fetat.domain.fuel_stations import parse_meta
        m = parse_meta(META)
        self.assertEqual(m["updated"], "16.10.2026 10:40")
        self.assertEqual([(s["country"], s["card"]) for s in m["stations"]], [("SWE", "AS24"), ("LV", "VIADA")])

    def test_match_to_mapon(self):
        from fetat.domain.fuel_stations import match_to_mapon
        sts = [{"name": "A", "lat": 50.0, "lng": 10.0}, {"name": "B", "lat": 51.0, "lng": 10.0},
               {"name": "C", "lat": 52.0, "lng": 10.0, "not_working": True}]
        objs = [{"id": 1, "name": "ob A", "lat": 50.0005, "lng": 10.0}, {"id": 2, "name": "лишний", "lat": 40.0, "lng": 0.0}]
        r = match_to_mapon(sts, objs)
        self.assertEqual([s["name"] for s in r["matched"]], ["A"])
        self.assertEqual(r["matched"][0]["mapon_name"], "ob A")
        self.assertEqual([s["name"] for s in r["to_create"]], ["B"])
        self.assertEqual([s["name"] for s in r["not_working"]], ["C"])      # нерабочие не «создаём»
        self.assertEqual([o["id"] for o in r["extra"]], [2])

    def test_empty_group_means_create_all(self):
        from fetat.domain.fuel_stations import match_to_mapon
        r = match_to_mapon([{"name": "A", "lat": 50.0, "lng": 10.0}], [])
        self.assertEqual(len(r["to_create"]), 1)
        self.assertEqual(r["matched"], [])


class FuelReport(unittest.TestCase):
    def _run(self, group_objs, mapon_err=None):
        from fetat.services import fuel_report as fr
        csvs = {"blocks": BLOCKS, "meta": META, "at": 1.0}
        grp = ({"id": 7, "name": "Actual Petrol Station"}, group_objs)
        with mock.patch.object(fr, "fetch_fuel_csv", return_value=csvs), \
                mock.patch.object(fr, "MAPON_API_KEY", "k"), \
                mock.patch.object(fr, "_group_objects", side_effect=mapon_err, return_value=grp):
            return fr.fuel_report()

    def test_empty_group(self):
        rep = self._run([])
        self.assertEqual(rep["counts"]["list_gps"], 5)
        self.assertEqual(rep["counts"]["to_create"], 4)
        self.assertEqual(rep["counts"]["not_working"], 1)
        self.assertEqual(rep["group"]["count"], 0)
        self.assertIsNone(rep["mapon_error"])

    def test_mapon_error_does_not_say_create_all(self):
        rep = self._run([], mapon_err=RuntimeError("boom"))
        self.assertIn("boom", rep["mapon_error"])
        self.assertEqual(rep["counts"]["to_create"], 0)

    def test_sheet_error(self):
        from fetat.services import fuel_report as fr
        with mock.patch.object(fr, "fetch_fuel_csv", side_effect=RuntimeError("нет сети")):
            self.assertEqual(fr.fuel_report()["error"], "нет сети")

    def test_write_only_in_one_place(self):
        """v3.139: запись в Mapon — только fuel_create.py через clients/mapon_write.py; отчёт и таблица только читают."""
        src = read("fetat", "services", "fuel_report.py") + read("fetat", "clients", "fuel_sheet.py")
        self.assertNotIn("object/save", src)
        self.assertNotIn("MAPON_WRITE_KEY", src)
        self.assertNotIn("requests.post", src)


class FuelFetch(unittest.TestCase):
    """v3.137: что делаем, если от Google пришёл не CSV (на сервере было «в списке с GPS: 0»)."""

    class _Resp:
        def __init__(self, body, ctype="text/csv"):
            self.content, self.status_code, self.headers = body, 200, {"Content-Type": ctype}

        def raise_for_status(self):
            pass

    def _fetch(self, bodies):
        from fetat.clients import fuel_sheet as fs
        fs._cache.update(at=0.0, data=None)
        it = iter(bodies)
        with mock.patch.object(fs.requests, "get", side_effect=lambda *a, **k: self._Resp(next(it))):
            return fs.fetch_fuel_csv(force=True)

    def test_bom_stripped(self):
        d = self._fetch(["﻿Цены обновлены,16.10.2026 10:40\n".encode("utf-8"), BLOCKS.encode("utf-8")])
        self.assertTrue(d["meta"].startswith("Цены обновлены"))
        self.assertEqual(d["info"]["meta"]["status"], 200)

    def test_gids_and_swapped_sheets(self):
        """v3.138: на сервере листы пришли наоборот (meta — со станциями, blocks — с датой): список был 0."""
        from fetat.clients import fuel_sheet as fs
        self.assertEqual(fs.FUEL_GIDS, {"meta": "1707662453", "blocks": "772559255"})
        blocks_txt = "Заголовок,Подзаголовок,Основная\n" + BLOCKS
        d = self._fetch([blocks_txt.encode("utf-8"), META.encode("utf-8")])   # первым пришёл лист со станциями
        self.assertTrue(d["meta"].startswith("Цены обновлены"))
        self.assertTrue(d["blocks"].startswith("Заголовок"))
        self.assertEqual(d["info"]["meta"]["bytes"], len(META.encode("utf-8")))

    def test_html_page_not_cached_and_reported(self):
        from fetat.clients import fuel_sheet as fs
        from fetat.services import fuel_report as fr
        page = b"<!DOCTYPE html><html><body>Sorry, unable to open the file at this time.</body></html>"
        d = self._fetch([page, page])
        self.assertIsNone(fs._cache["data"])                    # HTML-страницу не запоминаем
        with mock.patch.object(fr, "fetch_fuel_csv", return_value=d), mock.patch.object(fr, "MAPON_API_KEY", "k"):
            rep = fr.fuel_report()
        self.assertIn("вместо CSV", rep["error"])
        self.assertIn("Sorry, unable", rep["error"])            # видно, что именно пришло

    def test_unparsed_csv_reported(self):
        from fetat.services import fuel_report as fr
        d = {"meta": "a,b\n", "blocks": "x,y\n", "at": 1.0, "info": {"blocks": {"bytes": 4, "type": "text/csv", "head": "x,y"}}}
        with mock.patch.object(fr, "fetch_fuel_csv", return_value=d), mock.patch.object(fr, "MAPON_API_KEY", "k"):
            rep = fr.fuel_report()
        self.assertIn("станций в ней не найдено", rep["error"])


class FuelWiring(unittest.TestCase):
    def test_endpoint_and_button(self):
        from tests import A
        from fetat.services import fuel_report as fr
        with mock.patch.object(fr, "fetch_fuel_csv", return_value={"blocks": BLOCKS, "meta": META, "at": 1.0}), \
                mock.patch.object(fr, "MAPON_API_KEY", "k"), \
                mock.patch.object(fr, "_group_objects", return_value=(None, [])):
            r = A.app.test_client().get("/api/fuel-stations")
        self.assertEqual(r.status_code, 200)
        self.assertIn("нет группы", r.get_json()["mapon_error"])
        html = read("templates", "index.html")
        self.assertIn('id="fuel-btn"', html)                      # кнопка ⛽ в верхней панели
        self.assertIn("{% if show_notes %}", html.split('id="fuel-btn"')[0][-80:])   # видна тем же, кому Справка
        self.assertLess(html.index('data-tab="notes"'), html.index('id="fuel-btn"'))
        self.assertLess(html.index('id="fuel-btn"'), html.index('id="g-usage"'))     # между [.] и счётчиком G
        self.assertIn("/api/fuel-stations", read("static", "fuel-btn.js"))
        self.assertIn("fuel-btn.js", html)
        self.assertNotIn("fuel-stations", read("static", "notes.js"))


if __name__ == "__main__":
    unittest.main()
