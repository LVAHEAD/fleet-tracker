"""v3.171: правка адреса в листе «Адреса» (кнопка «Редактировать»)."""
import unittest
from unittest import mock

from fetat import create_app
from fetat.services import address_edit
from fetat.services.address_edit import AddressEditError, clean_changes, col_letter, edit_address

HEAD = ["Name", "Alias", "Country", "GPS", "Full address", "Type", "Open", "Notes", "Client", "Supplier"]
ROWS = [
    HEAD,
    ["Alpha", "", "ES", "36.7493, -2.6302", "Cam. 1", "load", "", "", "Bama", ""],
    ["Beta", "b", "", "40.0, 3.0", "Calle 2", "hub", "8-17", "", "", "Sup"],
]
ITEM = {"row": 3, "name": "Beta", "alias": "b", "type": "misc", "open": "8-17", "notes": "", "client": "", "supplier": "Sup",
        "country": "FR", "city": "", "full": "Calle 2", "lat": 40.0, "lng": 3.0}


class Helpers(unittest.TestCase):
    def test_col_letter(self):
        self.assertEqual([col_letter(i) for i in (0, 1, 25, 26, 27, 51, 52)], ["A", "B", "Z", "AA", "AB", "AZ", "BA"])

    def test_clean_changes_ok(self):
        out = clean_changes({"country": "fr", "gps": "36.7493,-2.6302", "type": "port", "name": " X "})
        self.assertEqual(out, {"country": "FR", "gps": "36.7493, -2.6302", "type": "port", "name": "X"})

    def test_clean_changes_bad(self):
        for bad in ({}, None, {"zzz": "1"}, {"name": " "}, {"country": "FRA"}, {"gps": "abc"}, {"type": "hub"}):
            with self.assertRaises(AddressEditError):
                clean_changes(bad)

    def test_clean_changes_control_chars_and_length(self):
        self.assertEqual(clean_changes({"notes": "a\x00b"}), {"notes": "ab"})
        with self.assertRaises(AddressEditError):
            clean_changes({"name": "x" * 121})


class EditAddress(unittest.TestCase):
    def run_edit(self, row, orig, changes, values=ROWS):
        written = []
        with mock.patch.object(address_edit, "read_sheet_values", return_value=values), \
                mock.patch.object(address_edit, "write_cells", side_effect=lambda sheet, cells: written.extend(cells)), \
                mock.patch.object(address_edit, "get_addresses", return_value=[ITEM]):
            res = edit_address(row, orig, changes)
        return res, written

    def test_writes_only_changed_cells(self):
        res, written = self.run_edit(3, "Beta", {"country": "FR", "client": "Kesko", "supplier": "Sup"})
        self.assertEqual(sorted(written), [("C3", "FR"), ("I3", "Kesko")])   # supplier не изменился — не пишем
        self.assertEqual(res["row"], 3)

    def test_type_not_touched_when_not_sent(self):
        _, written = self.run_edit(3, "Beta", {"notes": "ворота слева"})
        self.assertEqual(written, [("H3", "ворота слева")])   # Type «hub» в листе не затронут

    def test_name_mismatch_is_conflict(self):
        with self.assertRaises(AddressEditError) as cm:
            self.run_edit(3, "Gamma", {"notes": "x"})
        self.assertEqual(cm.exception.code, 409)

    def test_row_out_of_range_is_conflict(self):
        with self.assertRaises(AddressEditError) as cm:
            self.run_edit(9, "Beta", {"notes": "x"})
        self.assertEqual(cm.exception.code, 409)

    def test_missing_column(self):
        values = [["Name", "Country"], ["Beta", "FR"]]
        with self.assertRaises(AddressEditError):
            self.run_edit(2, "Beta", {"open": "8-17"}, values=values)

    def test_name_from_full_address_when_empty(self):
        values = [["Name", "Full address", "Notes"], ["", "Warehouse 7\n36.1, -2.1", ""]]
        _, written = self.run_edit(2, "Warehouse 7", {"notes": "n"}, values=values)
        self.assertEqual(written, [("C2", "n")])

    def test_bad_row_argument(self):
        for bad in (None, 1, "3", True):
            with self.assertRaises(AddressEditError):
                self.run_edit(bad, "Beta", {"notes": "x"})


class Route(unittest.TestCase):
    def post(self, email, body):
        client = create_app().test_client()
        headers = {"X-Goog-Authenticated-User-Email": "accounts.google.com:" + email} if email else {}
        with mock.patch("fetat.api.reference.edit_address", return_value=ITEM) as m:
            return client.post("/api/addresses/update", json=body, headers=headers), m

    def test_other_dispatcher_forbidden(self):
        r, m = self.post("someone@gmail.com", {"row": 3, "orig_name": "Beta", "changes": {"notes": "x"}})
        self.assertEqual(r.status_code, 403)
        m.assert_not_called()

    def test_allowed_accounts(self):
        for email in ("vladimirs.head@gmail.com", "ladins@gmail.com", "Vladimirs.Head+x@gmail.com"):
            r, m = self.post(email, {"row": 3, "orig_name": "Beta", "changes": {"notes": "x"}})
            self.assertEqual(r.status_code, 200, email)
            self.assertEqual(r.get_json()["address"]["row"], 3)
            m.assert_called_once()

    def test_errors_are_mapped(self):
        client = create_app().test_client()
        hdr = {"X-Goog-Authenticated-User-Email": "accounts.google.com:ladins@gmail.com"}
        for exc, code in ((AddressEditError("конфликт", 409), 409), (PermissionError("нет права"), 403), (RuntimeError("сбой"), 502)):
            with mock.patch("fetat.api.reference.edit_address", side_effect=exc):
                r = client.post("/api/addresses/update", json={"row": 3, "orig_name": "Beta", "changes": {"notes": "x"}}, headers=hdr)
            self.assertEqual(r.status_code, code)
            self.assertIn("error", r.get_json())

    def test_button_flag_in_page(self):
        client = create_app().test_client()
        yes = client.get("/", headers={"X-Goog-Authenticated-User-Email": "accounts.google.com:ladins@gmail.com"}).get_data(as_text=True)
        no = client.get("/", headers={"X-Goog-Authenticated-User-Email": "accounts.google.com:someone@gmail.com"}).get_data(as_text=True)
        self.assertIn('id="lp-addr" hidden data-can-edit="1"', yes)
        self.assertIn('id="lp-addr" hidden data-can-edit="0"', no)


if __name__ == "__main__":
    unittest.main()
