"""v3.136: опубликованные CSV Google-таблицы «Инструкция по заправкам» (страница SIA HEAD).

Адрес «Опубликовать в интернете» постоянный, содержимое живое (кеш Google ~5 мин). Ссылки вида
doc-XX-XX-sheets.googleusercontent.com — одноразовые, их не используем: docs.google.com сам перенаправляет на свежую.
v3.137: BOM убираем, ходим с User-Agent и Accept; HTML вместо CSV не кешируем; в ответе — что именно пришло (info).
"""
import threading
import time

import requests

FUEL_PUB_ID = "2PACX-1vTIb_CZuKwVFJfrY9KMPb24idCfhUq5eLq4E8prXR_-wOQTvz93aAxraiS-ZcEWmEGi3RFAibQtOSNO"
FUEL_GIDS = {"meta": "772559255", "blocks": "1707662453"}
FUEL_TTL = 300                  # как у Google: чаще раза в 5 минут не перечитываем (кнопка «обновить» — в обход)
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; FETAT)", "Accept": "text/csv,text/plain;q=0.9,*/*;q=0.8"}

_lock = threading.Lock()
_cache = {"at": 0.0, "data": None}


def _url(gid):
    return f"https://docs.google.com/spreadsheets/d/e/{FUEL_PUB_ID}/pub?gid={gid}&single=true&output=csv"


def looks_like_html(text):
    head = (text or "").lstrip()[:200].lower()
    return head.startswith("<!doctype") or head.startswith("<html") or "<html" in head


def fetch_fuel_csv(force=False):
    """{'meta': текст, 'blocks': текст, 'at': время, 'info': {лист: {status, type, bytes, head}}}.
    Ошибка сети — RuntimeError."""
    with _lock:
        now = time.time()
        if not force and _cache["data"] is not None and now - _cache["at"] < FUEL_TTL:
            return _cache["data"]
        out = {"info": {}}
        for key, gid in FUEL_GIDS.items():
            try:
                resp = requests.get(_url(gid), timeout=25, headers=HEADERS)
                resp.raise_for_status()
            except requests.RequestException as e:
                raise RuntimeError(f"не удалось прочитать лист {key}: {e}")
            text = resp.content.decode("utf-8-sig", errors="replace")
            out[key] = text
            out["info"][key] = {"status": resp.status_code, "type": resp.headers.get("Content-Type", ""),
                                "bytes": len(resp.content), "head": " ".join(text[:80].split())}
        out["at"] = now
        if not any(looks_like_html(out[k]) or not out[k].strip() for k in FUEL_GIDS):
            _cache.update(at=now, data=out)        # пустой ответ и HTML-страницу не запоминаем
        return out
