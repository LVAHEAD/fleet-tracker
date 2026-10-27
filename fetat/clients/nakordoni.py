"""Фид запретов движения nakordoni.eu (API v2, ключ Explorer): запросы по группам стран, кеш и блокировки.
Сборка запретов (ADR, полные запреты) — в domain/bans.py."""
import os
import threading

import requests


# v3.225: v1 закрыт 8.09.2026 (version_sunset), работаем на v2. Ключ — переменная окружения
# NAKORDONI_API_KEY (Cloud Run), в код и репозиторий не попадает. Без ключа запросов нет вообще.
# v2 принимает до 3 кодов стран за запрос (country=AT,CZ,DE). Бесплатный план Explorer требует
# видимую ссылку «Data by nakordoni.eu» там, где показаны данные.
BANS_URL = "https://nakordoni.eu/api/v2/data/truck-bans"
BANS_KEY_ENV = "NAKORDONI_API_KEY"
BANS_HEADERS_BASE = {"User-Agent": "fleet-eta-tracker", "Accept": "application/json"}


# v1.84: кеш по странам. Раньше любой 429 посреди обновления выбрасывал всё, а после
# каждого деплоя / нового инстанса Cloud Run кеш пустой -> снова 6 запросов подряд,
# плюс вкладка и проверка запретов по пути могли качать фид одновременно (12 запросов).
# Теперь: одно обновление за раз (общий замок), удачные страны сохраняются сразу,
# после 429 — стоп и пауза (Retry-After, не меньше 30 мин), потом докачиваются только
# недостающие страны; пауза между запросами 3 с.


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


class BansNoKey(RuntimeError):
    """Нет ключа NAKORDONI_API_KEY: запросов не шлём, в плашке — понятная причина."""


def _bans_get(params):
    key = (os.environ.get(BANS_KEY_ENV) or "").strip()
    if not key:
        raise BansNoKey(f"нет ключа nakordoni ({BANS_KEY_ENV} не задан)")
    headers = {**BANS_HEADERS_BASE, "Authorization": f"Bearer {key}"}
    r = requests.get(BANS_URL, params=params, timeout=20, headers=headers)
    if r.status_code == 429:
        try:
            ra = int(r.headers.get("Retry-After") or 0)
        except ValueError:
            ra = 0
        raise BansRateLimited("nakordoni: слишком много запросов (429)", ra)
    if r.status_code == 400:
        raise BansBadRequest(f"nakordoni: 400 для {params.get('country')}")
    if r.status_code in (401, 403):
        raise RuntimeError(f"nakordoni: ключ не принят (HTTP {r.status_code})")
    if r.status_code >= 400:
        snippet = " ".join((r.text or "").split())[:120]
        raise RuntimeError(f"nakordoni: HTTP {r.status_code}" + (f" — {snippet}" if snippet else ""))
    body = r.json()
    if not body.get("ok", False):
        err = body.get("error") or {}
        raise RuntimeError(f"nakordoni: {err.get('code') or 'ошибка'} — {(err.get('message') or '')[:120]}")
    data = body.get("data") or {}
    if not data.get("success", True):
        raise RuntimeError("nakordoni: success=false")
    return data


def _bans_store(codes, d):
    """v1.84: ответ по группе стран -> в кеш по странам (страна без запретов тоже отмечается).
    v3.225: d — это `data` ответа v2; страны, которых нет в relevant_countries, не отмечаются (остаются «нет данных»)."""
    import time
    now = time.time()
    answered = set(d.get("relevant_countries") or codes) & set(codes)
    part = {c: {"at": now, "upcoming": [], "current": []} for c in answered}
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
    """Запрос по группе стран (не больше 3 кодов); 400 — делим группу пополам;
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
    _bans_store(codes, d)
