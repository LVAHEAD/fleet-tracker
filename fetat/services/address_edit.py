"""v3.171: правка адреса в листе «Адреса» (кнопка «Редактировать» в карточке вкладки 📍).
Пишутся только изменённые ячейки одной строки. Перед записью строка перечитывается из таблицы и сверяется по Name,
чтобы правка не попала в чужую строку, если лист успели поменять руками."""
import re

from fetat.clients.sheets import read_sheet_values, write_cells
from fetat.config import ADDRESS_SHEET
from fetat.domain.addresses import ADDRESS_TYPES, get_addresses
from fetat.utils.geo import parse_gps
from fetat.utils.text import _hkey, normalize


# поле карточки -> возможные заголовки колонки листа (после _hkey), как в parse_address_rows
FIELD_COLUMNS = {
    "name": ("name",),
    "alias": ("alias",),
    "country": ("country",),
    "gps": ("gps",),
    "full": ("fulladdress", "address"),
    "type": ("type",),
    "open": ("open",),
    "client": ("client",),
    "supplier": ("supplier", "suplier"),
    "notes": ("notes",),
}

MAX_LEN = {"name": 120, "country": 2}
DEFAULT_MAX_LEN = 1000


class AddressEditError(Exception):
    """Ошибка правки с понятным текстом и HTTP-кодом."""

    def __init__(self, message, code=400):
        super().__init__(message)
        self.code = code


def col_letter(i):
    """Индекс колонки с нуля -> буква A1 (0 -> A, 26 -> AA)."""
    s = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def clean_changes(changes):
    """Проверка и нормализация правок: -> {поле: строка для записи}. Бросает AddressEditError."""
    if not isinstance(changes, dict) or not changes:
        raise AddressEditError("Нечего сохранять: поля не менялись")
    out = {}
    for field, raw in changes.items():
        if field not in FIELD_COLUMNS:
            raise AddressEditError(f"Неизвестное поле: {field}")
        v = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", str(raw if raw is not None else "")).strip()
        if len(v) > MAX_LEN.get(field, DEFAULT_MAX_LEN):
            raise AddressEditError(f"Поле «{field}» слишком длинное")
        if field == "name" and not v:
            raise AddressEditError("Введите Name")
        if field == "country":
            v = v.upper()
            if not re.fullmatch(r"[A-Z]{2}", v):
                raise AddressEditError("Country — две латинские буквы, например LV")
        if field == "gps":
            g = parse_gps(v)
            if not g:
                raise AddressEditError("GPS — координаты вида 51.48302, 4.72959")
            v = f"{g[0]}, {g[1]}"
        if field == "type" and v and v not in ADDRESS_TYPES:
            raise AddressEditError("Type — load, unload, port, customs или misc")
        out[field] = v
    return out


def edit_address(row, orig_name, changes):
    """Записать правки в строку row листа «Адреса». orig_name — Name, каким адрес был в карточке (защита от сдвига строк).
    Возвращает обновлённый элемент базы (из перечитанного листа)."""
    if not isinstance(row, int) or isinstance(row, bool) or row < 2:
        raise AddressEditError("Не указана строка адреса")
    if not str(orig_name or "").strip():
        raise AddressEditError("Не указан исходный Name")
    new = clean_changes(changes)

    values = read_sheet_values(ADDRESS_SHEET)
    if not values:
        raise AddressEditError("Лист «Адреса» пуст", 409)
    col = {}
    for i, h in enumerate(values[0]):
        k = _hkey(h)
        if k and k not in col:
            col[k] = i

    def col_of(field):
        for k in FIELD_COLUMNS[field]:
            if k in col:
                return col[k]
        return None

    if row > len(values):
        raise AddressEditError("Строка в таблице изменилась — обновите список адресов", 409)
    cur = values[row - 1]

    def cell(i):
        return str(cur[i] or "").strip() if i is not None and i < len(cur) else ""

    # тот же Name, что и в парсере: колонка Name, иначе первая строка Full address без GPS
    cur_name = cell(col_of("name"))
    if not cur_name:
        for line in cell(col_of("full")).splitlines():
            line = line.strip()
            if line and not parse_gps(line):
                cur_name = line
                break
    if normalize(cur_name) != normalize(orig_name):
        raise AddressEditError("Строка в таблице изменилась — обновите список адресов", 409)

    cells = []
    for field, value in new.items():
        i = col_of(field)
        if i is None:
            raise AddressEditError(f"В листе «Адреса» нет колонки для поля «{field}»")
        if cell(i) != value:
            cells.append((f"{col_letter(i)}{row}", value))
    write_cells(ADDRESS_SHEET, cells)

    for a in get_addresses(force=True):
        if a.get("row") == row:
            return a
    return None
