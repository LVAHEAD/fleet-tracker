"""v3.279: замок 🔒 строки не продлевается вечно — без действий 3 минуты клиент его снимает (static/sync.js)."""
import os
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class LockIdleTest(unittest.TestCase):
    def test_idle_release_wired(self):
        src = open(os.path.join(ROOT, "static", "sync.js"), encoding="utf-8").read()
        self.assertIn("const LOCK_IDLE_MS = 3 * 60 * 1000;", src)
        self.assertIn("Date.now() - lastAct > LOCK_IDLE_MS", src)     # в таймере продления
        self.assertIn('["keydown", "input", "mousedown", "wheel", "touchstart"]', src)   # действия, которые продлевают
        self.assertLess(src.index("Date.now() - lastAct > LOCK_IDLE_MS"), src.index("lockReq(S.lockedId, false);\n    }, 25000)"))


if __name__ == "__main__":
    unittest.main()
