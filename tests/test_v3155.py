"""v3.155: подсказка таргета — полный адрес и type · client · supplier (static/app.js)."""
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent


class TargetTipTest(unittest.TestCase):
    def test_tip_function_and_hover_hook_present(self):
        js = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
        self.assertIn("function addressTipFor(v)", js)
        self.assertIn("a.full || a.name", js)
        self.assertIn('input[list="points-list"]', js)
        self.assertIn("inp.dataset.tipOrig", js)

    def test_changelog_top_entry_is_this_version(self):
        import fetat
        first = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8").split("\n")
        entry = next(l for l in first if l and not l.startswith((" ", "#", "Формат", "Новые", "Файл")))
        self.assertTrue(entry.startswith(fetat.APP_VERSION + " "), entry)


if __name__ == "__main__":
    unittest.main()
