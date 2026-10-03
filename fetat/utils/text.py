"""Нормализация строк для поиска и заголовков."""
import re


def normalize(s):
    return str(s or "").lower().replace(" ", "").replace("-", "")


def _hkey(h):
    """Заголовок колонки -> ключ: "Full address" -> "fulladdress", "Notes," -> "notes"."""
    return re.sub(r"[^a-z0-9]", "", str(h or "").lower())
