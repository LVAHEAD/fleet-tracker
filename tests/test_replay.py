"""Эталонный прогон API с подменённой сетью: ответы должны совпадать с tests/fixtures/replay_golden.json.

Если тест упал после переезда кода — поведение изменилось. Если поведение меняется намеренно
(обычный билд с фичей), эталон пересобирается:
    python3 tests/replay_run.py . tests/fixtures/replay_golden.json
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest

from tests import ROOT, FIXTURES


class ReplayTest(unittest.TestCase):
    def test_api_matches_golden(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "replay.json")
            p = subprocess.run([sys.executable, os.path.join(ROOT, "tests", "replay_run.py"), ROOT, out],
                               capture_output=True, text=True, timeout=120)
            self.assertEqual(p.returncode, 0, p.stderr[-2000:])
            with open(out, encoding="utf-8") as f:
                got = json.load(f)
        with open(os.path.join(FIXTURES, "replay_golden.json"), encoding="utf-8") as f:
            want = json.load(f)
        self.assertEqual(sorted(got), sorted(want))
        for k in want:
            self.assertEqual(got[k], want[k], k)


if __name__ == "__main__":
    unittest.main()
