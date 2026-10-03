"""Адресная база (лист «Адреса»), поиск точки по названию, База (Baza Parking, Riga) и FIN/EE → База."""
import re

from fetat.clients.sheets import read_sheet_values
from fetat.config import ADDRESS_SHEET
from fetat.utils.geo import parse_gps
from fetat.utils.text import _hkey, normalize


ADDRESS_TTL_SEC = 600  # перечитываем лист не чаще раза в 10 минут


ADDRESS_TYPES = {"load", "unload", "port", "customs", "misc"}


_addr_cache = {"items": [], "problems": [], "loaded_at": 0.0, "error": None}


def parse_address_rows(values):
    """values — строки листа "Адреса" (первая — заголовки). -> (items, problems)."""
    if not values:
        return [], []
    head = [_hkey(h) for h in values[0]]
    col = {k: i for i, k in enumerate(head) if k}
    alias_map = {"supplier": ("supplier", "suplier"), "notes": ("notes",), "fulladdress": ("fulladdress", "address")}

    def get(row, key):
        for k in alias_map.get(key, (key,)):
            i = col.get(k)
            if i is not None and i < len(row):
                return str(row[i] or "").strip()
        return ""

    items, problems = [], []
    for n, row in enumerate(values[1:], start=2):
        if not any(str(c or "").strip() for c in row):
            continue  # пустая строка
        name = get(row, "name")
        if not name:
            # v1.29: пустой Name — берём первую строку Full address (не GPS)
            for line in get(row, "fulladdress").splitlines():
                line = line.strip()
                if line and not parse_gps(line):
                    name = line
                    break
        if not name:
            problems.append(f"строка {n}: нет Name и адреса")
            continue
        gps = parse_gps(get(row, "gps")) or parse_gps(get(row, "fulladdress"))
        if not gps:
            problems.append(f"строка {n}: {name} — нет GPS")
            continue
        typ = get(row, "type").lower()
        full = get(row, "fulladdress")
        # "город" для подсказки: строка адреса с запятой и индексом/страной, иначе ничего
        city = ""
        for line in full.splitlines():
            if "," in line and not parse_gps(line):
                city = line.split(",")[0].strip()
        items.append({
            "name": name,
            "alias": get(row, "alias"),
            "type": typ if typ in ADDRESS_TYPES else ("misc" if typ else ""),
            "open": get(row, "open"),
            "notes": get(row, "notes"),
            "client": get(row, "client"),
            "supplier": get(row, "supplier"),
            "country": get(row, "country").upper()[:2],
            "city": city,
            "lat": gps[0], "lng": gps[1],
        })
    return items, problems


def get_addresses(force=False):
    """Адреса из таблицы с кешем на ADDRESS_TTL_SEC. Ошибка чтения не ломает
    приложение: остаётся последняя удачная копия, текст ошибки — в _addr_cache."""
    import time
    now = time.time()
    if force or now - _addr_cache["loaded_at"] > ADDRESS_TTL_SEC:
        try:
            items, problems = parse_address_rows(read_sheet_values(ADDRESS_SHEET))
            _addr_cache.update(items=items, problems=problems, loaded_at=now, error=None)
        except Exception as e:
            _addr_cache["error"] = str(e)
            _addr_cache["loaded_at"] = now - ADDRESS_TTL_SEC + 60  # повторить через минуту
    return _addr_cache["items"]


def find_address(query):
    """Точное совпадение по Name или Alias (без регистра/пробелов/дефисов).
    Если совпал только Supplier и склад у него один — тоже он."""
    q = normalize(query)
    if not q:
        return None
    try:
        items = get_addresses()
    except Exception:
        return None
    for a in items:
        if q == normalize(a["name"]) or (a["alias"] and q == normalize(a["alias"])):
            return a
    by_supplier = [a for a in items if a["supplier"] and q == normalize(a["supplier"])]
    if len(by_supplier) == 1:
        return by_supplier[0]
    if len(by_supplier) > 1:
        names = ", ".join(a["name"] for a in by_supplier[:6])
        raise ValueError(f"У {query} несколько складов — выберите конкретный: {names}")
    return None


def address_public(a):
    return {k: a[k] for k in ("name", "alias", "type", "open", "notes", "client", "supplier", "country", "city")}


# ~99% грузов в Финляндию и ~70% в Эстонию основная машина везёт до Базы (Рига),
# дальше отдельный довоз. Ввод страной (fin / FI / Финляндия / ee / Эстония)
# = маршрут до Базы + плашка "+довоз FI/EE". Конкретная точка в EE — напрямую.
BASE_FALLBACK = (56.94643, 24.03196)


BASE_NAME_KEYS = ("bazaparking", "baza", "база")


DOVOZ_COUNTRY_WORDS = {
    "FI": {"fi", "fin", "finland", "finnland", "suomi", "финляндия", "фин"},
    "EE": {"ee", "est", "estonia", "eesti", "эстония", "эст"},
}


# v1.62: "lv" / "Латвия" в поле From/To или таргете — это База в Риге
BASE_COUNTRY_WORDS = {"lv", "lat", "latvia", "latvija", "lettland", "латвия", "лат", "лв", "база", "baza"}


def is_base_word(raw):
    return re.sub(r"[\s.\-_]", "", str(raw or "")).lower() in BASE_COUNTRY_WORDS


def dovoz_country(raw):
    """"fin" / "FI" / "Финляндия" -> "FI"; "ee" / "Эстония" -> "EE"; иначе None."""
    k = re.sub(r"[\s.\-_]", "", str(raw or "")).lower()
    for cc, words in DOVOZ_COUNTRY_WORDS.items():
        if k in words:
            return cc
    return None


def base_point():
    """Координаты и имя Базы: из адресной базы (строка "Baza Parking"), иначе константа."""
    try:
        for a in get_addresses():
            if any(k in normalize(a["name"]) or k in normalize(a.get("alias")) for k in BASE_NAME_KEYS):
                return a["lat"], a["lng"], a["name"]
    except Exception:
        pass
    return BASE_FALLBACK[0], BASE_FALLBACK[1], "Baza Parking"
