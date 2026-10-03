"""Фид запретов движения nakordoni.eu: запросы по группам стран, кеш и блокировки.
Сборка запретов (ADR, полные запреты) — пока в app.py, переедет в domain/bans.py."""
import threading

import requests


# v1.84: кеш по странам. Раньше любой 429 посреди обновления выбрасывал всё, а после
# каждого деплоя / нового инстанса Cloud Run кеш пустой -> снова 6 запросов подряд,
# плюс вкладка и проверка запретов по пути могли качать фид одновременно (12 запросов).
# Теперь: одно обновление за раз (общий замок), удачные страны сохраняются сразу,
# после 429 — стоп и пауза (Retry-After, не меньше 30 мин), потом докачиваются только
# недостающие страны; пауза между запросами 3 с.
BANS_URL = "https://nakordoni.eu/api/truckban_json.php"


BANS_PAUSE = 3.0             # пауза между запросами, сек


_bans_cache = {"data": None, "at": 0.0, "error": None, "blocked_until": 0.0}


_bans_cc = {}                # v1.84: cc -> {"at", "upcoming": [...], "current": [...]}


_bans_window = {"w": None}


_bans_lock = threading.Lock()          # короткий — на чтение/запись кеша


_bans_fetch_lock = threading.Lock()    # v1.84: одно обновление фида за раз


class BansRateLimited(RuntimeError):
    def __init__(self, msg, retry_after=0):
        super().__init__(msg)
        self.retry_after = retry_after


class BansBadRequest(RuntimeError):
    pass


def _bans_get(params):
    r = requests.get(BANS_URL, params={"lang": "ru", **params}, timeout=20,
                     headers={"User-Agent": "fleet-eta-tracker"})
    if r.status_code == 429:
        try:
            ra = int(r.headers.get("Retry-After") or 0)
        except ValueError:
            ra = 0
        raise BansRateLimited("nakordoni: слишком много запросов (429)", ra)
    if r.status_code == 400:
        raise BansBadRequest(f"nakordoni: 400 для {params.get('country')}")
    r.raise_for_status()
    d = r.json()
    if not d.get("success", True):
        raise RuntimeError("nakordoni: success=false")
    return d


def _bans_store(codes, d):
    """v1.84: ответ по группе стран -> в кеш по странам (страна без запретов тоже отмечается)."""
    import time
    now = time.time()
    part = {c: {"at": now, "upcoming": [], "current": []} for c in codes}
    for key, dst in (("upcoming_bans", "upcoming"), ("current_bans", "current")):
        for b in d.get(key) or []:
            cc = b.get("country_code")
            if cc in part:
                part[cc][dst].append(b)
    with _bans_lock:
        _bans_cc.update(part)
        if d.get("window"):
            _bans_window["w"] = d["window"]


def _bans_fetch_group(codes):
    """Запрос по группе стран; если ответ обрезан или 400 — делим группу пополам;
    страну, на которую фид отвечает 400, пропускаем. 429 — пробрасываем (стоп)."""
    import time
    try:
        d = _bans_get({"country": ",".join(codes)})
    except BansBadRequest:
        time.sleep(BANS_PAUSE)
        if len(codes) > 1:
            half = len(codes) // 2
            _bans_fetch_group(codes[:half])
            _bans_fetch_group(codes[half:])
        else:
            _bans_store(codes, {})   # фид не знает страну — считаем "без запретов", не спрашиваем снова
        return
    time.sleep(BANS_PAUSE)
    if d.get("truncated") and len(codes) > 1:
        half = len(codes) // 2
        _bans_fetch_group(codes[:half])
        _bans_fetch_group(codes[half:])
        return
    _bans_store(codes, d)
