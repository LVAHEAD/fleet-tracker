"""Нормализация строк для поиска и заголовков."""
import re


def normalize(s):
    return str(s or "").lower().replace(" ", "").replace("-", "")


def canon_email(e):
    """v3.127: e-mail для сравнения. У Gmail точки в имени и «+метка» не различаются (jzemesarajs = j.zemesarajs);
    остальные домены — только нижний регистр. IAP пускает по точной строке — это отдельно (список IAP)."""
    s = str(e or "").strip().lower()
    if "@" not in s:
        return s
    local, dom = s.rsplit("@", 1)
    if dom in ("gmail.com", "googlemail.com"):
        return local.split("+", 1)[0].replace(".", "") + "@gmail.com"
    return s


def _hkey(h):
    """Заголовок колонки -> ключ: "Full address" -> "fulladdress", "Notes," -> "notes"."""
    return re.sub(r"[^a-z0-9]", "", str(h or "").lower())
