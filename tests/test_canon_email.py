import unittest
from fetat.utils.text import canon_email


class CanonEmail(unittest.TestCase):
    def test_gmail_dots_and_plus(self):
        self.assertEqual(canon_email("J.Zemesarajs@Gmail.com"), "jzemesarajs@gmail.com")
        self.assertEqual(canon_email("jzemesarajs+x@googlemail.com"), "jzemesarajs@gmail.com")

    def test_other_domains_untouched(self):
        self.assertEqual(canon_email("a.b@firma.lv"), "a.b@firma.lv")

    def test_empty(self):
        self.assertEqual(canon_email(None), "")
        self.assertEqual(canon_email("local"), "local")


if __name__ == "__main__":
    unittest.main()
