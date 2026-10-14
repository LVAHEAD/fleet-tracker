"""v3.110: онлайн-диспетчеры — инициалы других, кто сейчас в аппе (себя не включаем, e-mail не отдаём)."""
import unittest
from unittest import mock

from fetat.domain import presence

DISP = [
    {"email": "vladimirs.head@gmail.com", "tag": "VL", "color": "", "assign": True},
    {"email": "j.zemesarajs@gmail.com", "tag": "JZ", "color": "", "assign": False},
    {"email": "vadims@gmail.com", "tag": "VJ", "color": "", "assign": False},
]


class PresenceTest(unittest.TestCase):
    def setUp(self):
        presence._seen.clear()
        self.patch = mock.patch.object(presence, "get_dispatchers", return_value=DISP)
        self.patch.start()

    def tearDown(self):
        self.patch.stop()
        presence._seen.clear()

    def _at(self, t):
        return mock.patch.object(presence.time, "time", return_value=t)

    def test_self_excluded_and_others_listed_in_sheet_order(self):
        with self._at(1000.0):
            presence.presence_tags("vadims@gmail.com")
            presence.presence_tags("j.zemesarajs@gmail.com")
            tags = presence.presence_tags("vladimirs.head@gmail.com")
        self.assertEqual(tags, ["JZ", "VJ"])  # порядок листа «Диспетчеры», себя нет

    def test_stale_ping_drops_out(self):
        with self._at(1000.0):
            presence.presence_tags("j.zemesarajs@gmail.com")
        with self._at(1000.0 + presence.PRESENCE_TTL_SEC + 1):
            tags = presence.presence_tags("vladimirs.head@gmail.com")
        self.assertEqual(tags, [])

    def test_unknown_email_not_shown(self):
        with self._at(1000.0):
            presence.presence_tags("stranger@example.com")
            tags = presence.presence_tags("vladimirs.head@gmail.com")
        self.assertEqual(tags, [])

    def test_local_user_does_not_register(self):
        with self._at(1000.0):
            tags = presence.presence_tags("local")
        self.assertEqual(tags, [])
        self.assertEqual(presence._seen, {})


if __name__ == "__main__":
    unittest.main()
