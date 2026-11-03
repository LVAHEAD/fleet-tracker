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


class GLeg(unittest.TestCase):
    def test_line(self):
        gr.set_route_ctx("edit", "vl@x.lv", "OI-1780")
        buf = io.StringIO()
        with redirect_stdout(buf):
            gr._log_gleg(56.9, 24.1, 54.6, 25.3, [(55.0, 24.5)])
        s = buf.getvalue()
        for part in ("[gleg]", "unit=OI-1780", "why=edit", "from=56.90000,24.10000", "to=54.60000,25.30000", "wps=1"):
            self.assertIn(part, s)
