"""v3.280: Ctrl/Cmd+клик по свободному месту трипа обновляет трип (static/app.js, обработчик клика строки)."""
import os
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class CtrlRefreshTest(unittest.TestCase):
    def test_wired(self):
        src = open(os.path.join(ROOT, "static", "app.js"), encoding="utf-8").read()
        i = src.index("v3.280: Ctrl/Cmd+клик")
        blk = src[i:i + 700]
        self.assertIn('tr.querySelector(".refresh-row-btn")', blk)
        self.assertIn('closest("input, button, select, textarea, a, .com-tri")', blk)
        # Ctrl+клик по полю таргета (карточка адреса, v3.163) идёт раньше и не затронут
        self.assertLess(src.index("window.addrOpenFor(e.target.value)"), i)


if __name__ == "__main__":
    unittest.main()
