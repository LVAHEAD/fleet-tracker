"""v3.136: опубликованные CSV Google-таблицы «Инструкция по заправкам» (страница SIA HEAD).

Адрес «Опубликовать в интернете» постоянный, содержимое живое (кеш Google ~5 мин). Ссылки вида
doc-XX-XX-sheets.googleusercontent.com — одноразовые, их не используем: docs.google.com сам перенаправляет на свежую.
"""
import threading
import time

import requests

FUEL_PUB_ID = "2PACX-1vTIb_CZuKwVFJfrY9KMPb24idCfhUq5eLq4E8prXR_-wOQTvz93aAxraiS-ZcEWmEGi3RFAibQtOSNO"
FUEL_GIDS = {"meta": "772559255", "blocks": "1707662453"}
FUEL_TTL = 300                  # как у Google: чаще раза в 5 минут не перечитываем (кнопка «обновить» — в обход)

_lock = threading.Lock()
_cache = {"at": 0.0, "data": None}


def _url(gid):
    return f"https://docs.google.com/spreadsheets/d/e/{FUEL_PUB_ID}/pub?gid={gid}&single=true&output=csv"


def fetch_fuel_csv(force=False):
    """{'meta': текст, 'blocks': текст, 'at': время загрузки}. Ошибка сети — RuntimeError."""
    with _lock:
        now = time.time()
        if not force and _cache["data"] is not None and now - _cache["at"] < FUEL_TTL:
            return _cache["data"]
        out = {}
        for key, gid in FUEL_GIDS.items():
            try:
                resp = requests.get(_url(gid), timeout=25)
                resp.raise_for_status()
            except requests.RequestException as e:
                raise RuntimeError(f"не удалось прочитать лист {key}: {e}")
            out[key] = resp.content.decode("utf-8", errors="replace")
        out["at"] = now
        _cache.update(at=now, data=out)
        return out
