"""v3.152: вкладка «Адреса» — поиск, карточка, проверка дубля и форма (без отправки на аппрув)."""
import os
import unittest

from tests import ROOT


def read(*p):
    with open(os.path.join(ROOT, *p), encoding="utf-8") as f:
        return f.read()


class AddrTab(unittest.TestCase):
    def test_version_and_changelog(self):
        from fetat import APP_VERSION
        self.assertEqual(APP_VERSION, "3.152")
        top = [ln for ln in read("CHANGELOG.md").splitlines() if ln[:1].isdigit()][0]
        self.assertTrue(top.startswith("3.152 ("))

    def test_markup(self):
        html = read("templates", "index.html")
        for id_ in ("addrQuery", "addrResults", "addrCard", "addrNewBtn", "addrForm",
                    "af-name", "af-country", "af-gps", "addrDup", "addrSubmitBtn"):
            self.assertIn(f'id="{id_}"', html, id_)
        self.assertIn("addr-tab.js", html)
        self.assertNotIn("Этот раздел в разработке", html.split('id="lp-addr"')[1].split("</section>")[0])

    def test_script_is_safe_and_has_limits(self):
        js = read("static", "addr-tab.js")
        self.assertNotIn("innerHTML", js)          # весь текст — через textContent
        self.assertIn("SHOW_MAX = 30", js)
        self.assertIn("SEARCH_DELAY_MS = 180", js)
        self.assertIn("DUP_RADIUS_M = 150", js)

    def test_submit_does_not_write(self):
        js = read("static", "addr-tab.js")
        self.assertNotIn("fetch(", js)             # на этом шаге сети нет
        self.assertIn("никуда не сохраняются", js)


if __name__ == "__main__":
    unittest.main()
