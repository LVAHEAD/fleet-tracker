"""v3.225: nakordoni API v2 — ключ из переменной окружения, разбор `data`, без деления по truncated."""
import json
import os
import unittest
from unittest import mock

from tests import A  # noqa: F401
from fetat.clients import nakordoni as nk

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
with open(os.path.join(ROOT, "tests", "fixtures", "nakordoni_v2_sample.json"), encoding="utf-8") as f:
    SAMPLE = json.load(f)


class _Resp:
    def __init__(self, status, body):
        self.status_code = status
        self._body = body
        self.text = json.dumps(body)
        self.headers = {}

    def json(self):
        return self._body


class NakordoniV2Test(unittest.TestCase):
    def setUp(self):
        nk._bans_cc.clear()
        nk._bans_window["w"] = None
        p = mock.patch.dict(os.environ, {}, clear=False)
        p.start()
        self.addCleanup(p.stop)
        os.environ.pop(nk.BANS_KEY_ENV, None)

    def test_no_key_sends_no_request(self):
        with mock.patch.object(nk.requests, "get") as get:
            with self.assertRaises(nk.BansNoKey):
                nk._bans_get({"country": "AT"})
            get.assert_not_called()

    def test_key_goes_in_bearer_header_and_returns_data(self):
        os.environ[nk.BANS_KEY_ENV] = "TEST-KEY"
        with mock.patch.object(nk.requests, "get", return_value=_Resp(200, SAMPLE)) as get:
            d = nk._bans_get({"country": "AT,CZ,DE"})
        self.assertEqual(get.call_args.args[0], "https://nakordoni.eu/api/v2/data/truck-bans")
        self.assertEqual(get.call_args.kwargs["headers"]["Authorization"], "Bearer TEST-KEY")
        self.assertEqual(get.call_args.kwargs["params"], {"country": "AT,CZ,DE"})
        self.assertEqual(d["country"], SAMPLE["data"]["country"])

    def test_error_envelope_raises_with_code(self):
        os.environ[nk.BANS_KEY_ENV] = "TEST-KEY"
        body = {"ok": False, "error": {"code": "version_sunset", "message": "Please switch to v2."}}
        with mock.patch.object(nk.requests, "get", return_value=_Resp(200, body)):
            with self.assertRaises(RuntimeError) as cm:
                nk._bans_get({"country": "AT"})
        self.assertIn("version_sunset", str(cm.exception))

    def test_store_reads_nested_data_and_marks_only_answered_countries(self):
        nk._bans_store(["AT", "CZ", "DE"], SAMPLE["data"])
        self.assertEqual(set(nk._bans_cc), {"AT", "CZ", "DE"})
        want_at = [b for b in SAMPLE["data"]["upcoming_bans"] if b["country_code"] == "AT"]
        self.assertEqual(len(nk._bans_cc["AT"]["upcoming"]), len(want_at))
        self.assertEqual(nk._bans_window["w"], SAMPLE["data"]["window"])

    def test_group_is_not_split_on_truncated_flag(self):
        self.assertTrue(SAMPLE["data"]["truncated"])   # в ответе флаг стоит, хотя страницы нет
        with mock.patch.object(nk, "_bans_get", return_value=SAMPLE["data"]) as get, \
                mock.patch("time.sleep"):
            nk._bans_fetch_group(["AT", "CZ", "DE"])
        self.assertEqual(get.call_count, 1)


if __name__ == "__main__":
    unittest.main()
