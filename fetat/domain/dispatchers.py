"""v3.11: диспетчеры — лист «Диспетчеры» (Email, Инициалы, Цвет, Назначает).
Из листа берутся инициалы и цвета (строка Флота, плашки на карте), список в фильтре и в 👤,
и кто может назначать диспетчера строки. Лист не читается — работает список по умолчанию.
Вход в приложение лист не даёт: доступ — по IAP."""
import re
import time

from fetat.clients.sheets import read_sheet_values
from fetat.config import DISP_SHEET, FLEET_ADMINS

DISP_TTL_SEC = 600   # перечитываем лист не чаще раза в 10 минут

# список по умолчанию (как было в коде до v3.11); v3.25: порядок — как кнопки фильтра (VL VJ JZ JB AA VV)
DEFAULT_DISPATCHERS = [
    {"email": "vladimirs.head@gmail.com", "tag": "VL", "color": "#ebebeb", "assign": True},
    {"email": "vadims@gmail.com", "tag": "VJ", "color": "#fde6cc", "assign": False},
    {"email": "janis@gmail.com", "tag": "JZ", "color": "#eceefc", "assign": False},
    {"email": "jekaterina@gmail.com", "tag": "JB", "color": "#dcf1e0", "assign": False},
    {"email": "antons@gmail.com", "tag": "AA", "color": "#ffffff", "assign": False},
    {"email": "ladins@gmail.com", "tag": "VV", "color": "#e8dcf7", "assign": False},
]

_disp_cache = {"list": None, "loaded_at": 0.0, "error": None, "source": "default"}

_YES = {"да", "yes", "y", "1", "true", "x", "+", "✓", "v"}


def _col(header, *keys):
    for i, h in enumerate(header):
        t = str(h).strip().lower()
        if any(k in t for k in keys):
            return i
    return None


def _color(v):
    s = str(v or "").strip().lower()
    if re.fullmatch(r"#?[0-9a-f]{6}", s):
        return s if s.startswith("#") else "#" + s
    if re.fullmatch(r"#?[0-9a-f]{3}", s):
        s = s.lstrip("#")
        return "#" + "".join(c * 2 for c in s)
    return ""


def parse_dispatchers(values):
    """Строки листа -> [{email, tag, color, assign}]. Без колонки Email — пустой список."""
    if not values:
        return []
    head = values[0]
    ce, ct = _col(head, "email", "почт", "e-mail"), _col(head, "инициал", "initial", "tag")
    cc, ca = _col(head, "цвет", "color"), _col(head, "назнач", "assign")
    if ce is None:
        return []
    out, seen = [], set()
    for r in values[1:]:
        cell = lambda c: str(r[c]).strip() if c is not None and c < len(r) else ""
        email = cell(ce).lower()
        if "@" not in email or email in seen:
            continue
        seen.add(email)
        tag = re.sub(r"[^0-9A-Za-zА-Яа-яЁё]", "", cell(ct)).upper()[:3] or email.split("@")[0][:2].upper()
        out.append({"email": email, "tag": tag, "color": _color(cell(cc)),
                    "assign": cell(ca).lower() in _YES})
    return out


def get_dispatchers(force=False):
    now = time.time()
    if force or _disp_cache["list"] is None or now - _disp_cache["loaded_at"] > DISP_TTL_SEC:
        try:
            lst = parse_dispatchers(read_sheet_values(DISP_SHEET))
            if not lst:
                raise ValueError(f"лист «{DISP_SHEET}» пуст или без колонки Email")
            _disp_cache.update(list=lst, loaded_at=now, error=None, source="sheet")
        except Exception as e:
            if _disp_cache["list"] is None or _disp_cache["source"] == "default":
                _disp_cache.update(list=[dict(d) for d in DEFAULT_DISPATCHERS], source="default")
            _disp_cache["error"] = str(e)
            _disp_cache["loaded_at"] = now - DISP_TTL_SEC + 60   # повтор через минуту
    return _disp_cache["list"]


def can_assign(user):
    """Может ли пользователь менять диспетчера строки: админ или «Назначает = да» в листе."""
    u = str(user or "").strip().lower()
    if not u or u == "local":
        return u == "local"   # локальный запуск без IAP
    if u in FLEET_ADMINS:
        return True
    return any(d["email"] == u and d["assign"] for d in get_dispatchers())
