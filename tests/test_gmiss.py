"""Пункт 7 разбора 30.10: строка [gmiss] в логе на запрос «машина → точка» в Google."""
import io
import unittest
from contextlib import redirect_stdout

from fetat.clients import google_routes as gr


class GMiss(unittest.TestCase):
    def test_line(self):
        gr.set_route_ctx("auto", "vl@x.lv", "OI-1780")
        k = ("truck", 57.0, 24.0, ())
        gr._along_cache.pop(k, None)
        buf = io.StringIO()
        with redirect_stdout(buf):
            gr._log_gmiss("new", k, 56.95, 24.1)
        s = buf.getvalue()
        for part in ("[gmiss]", "unit=OI-1780", "why=auto", "miss=new", "off_km=-", "to=57.000,24.000"):
            self.assertIn(part, s)


if __name__ == "__main__":
    unittest.main()
