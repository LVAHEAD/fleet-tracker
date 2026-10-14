"""v3.110: кто сейчас держит аппу открытой — инициалы в шапке (☁ (🎧 JZ, VL)).
Вариант А: память инстанса (один worker). Пинг — GET /api/presence раз в минуту, пока вкладка видна.
Себя в список не включаем. Инициалы — из листа «Диспетчеры» (get_dispatchers); незнакомые e-mail не показываем.
E-mail наружу не отдаём — только инициалы."""
import threading
import time

from fetat.domain.dispatchers import get_dispatchers

PRESENCE_TTL_SEC = 150   # нет пинга 2–3 минуты → человек уходит из списка

_seen = {}               # email -> время последнего пинга (сек)
_lock = threading.Lock()


def presence_tags(me):
    """Отметить me как онлайн и вернуть инициалы остальных онлайн, в порядке листа «Диспетчеры»."""
    now = time.time()
    me = str(me or "").strip().lower()
    with _lock:
        if "@" in me:
            _seen[me] = now
        for email in [e for e, ts in _seen.items() if now - ts > PRESENCE_TTL_SEC]:
            del _seen[email]
        online = set(_seen)
    tags = []
    for d in get_dispatchers():
        if d["email"] in online and d["email"] != me and d["tag"] not in tags:
            tags.append(d["tag"])
    return tags
