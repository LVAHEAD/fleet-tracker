import unittest

class IapGuardTest(unittest.TestCase):
    """v3.67: на Cloud Run без заголовка IAP — 403; локально — как раньше."""

    def test_guard(self):
        import os
        from unittest import mock

        from fetat import create_app

        cl = create_app().test_client()
        with mock.patch.dict(os.environ, {"K_SERVICE": "fleet-eta-tracker"}):
            self.assertEqual(cl.get("/api/me").status_code, 403)
            ok = cl.get("/api/me", headers={"X-Goog-Authenticated-User-Email": "accounts.google.com:a@b.c"})
            self.assertEqual(ok.status_code, 200)
        os.environ.pop("K_SERVICE", None)
        self.assertEqual(cl.get("/api/me").status_code, 200)

    def test_static_cache(self):
        from fetat import create_app

        r = create_app().test_client().get("/static/app.js?v=3.67")
        self.assertIn("immutable", r.headers.get("Cache-Control", ""))
        r.close()


if __name__ == "__main__":
    unittest.main()
