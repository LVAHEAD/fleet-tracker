"""v3.90: вкладка [.] «Справка» — только для NOTES_TAB_USERS (остальным кнопка скрыта)."""
import unittest

from tests import A  # noqa: F401  (поднимает приложение и пути)

ALLOWED = {"X-Goog-Authenticated-User-Email": "accounts.google.com:ladins@gmail.com"}
OWNER = {"X-Goog-Authenticated-User-Email": "accounts.google.com:vladimirs.head@gmail.com"}
OTHER = {"X-Goog-Authenticated-User-Email": "accounts.google.com:janis@gmail.com"}


class NotesTabTest(unittest.TestCase):
    def _notes_btn(self, headers):
        html = A.app.test_client().get("/", headers=headers).get_data(as_text=True)
        line = next(x for x in html.splitlines() if 'data-tab="notes"' in x)
        return line

    def test_allowed_sees_tab(self):
        self.assertNotIn("notes-hidden", self._notes_btn(ALLOWED))
        self.assertNotIn("notes-hidden", self._notes_btn(OWNER))

    def test_others_do_not(self):
        self.assertIn("notes-hidden", self._notes_btn(OTHER))


if __name__ == "__main__":
    unittest.main()
