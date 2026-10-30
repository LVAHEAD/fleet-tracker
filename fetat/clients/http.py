"""Общие HTTP-соединения (keep-alive): один пул на процесс вместо нового TLS-соединения на каждый запрос.
Mapon, Firestore, Google Routes — каждый вызов без пула открывал соединение заново (~50–150 мс).
Если requests.get / post / patch / delete подменены (тесты, replay), идём через подмену."""
import threading

import requests
from requests.adapters import HTTPAdapter

import requests.api

# оригиналы — из requests.api: подмена requests.get (до или после импорта этого модуля) их не трогает
_ORIG = {m: getattr(requests.api, m) for m in ("get", "post", "patch", "delete")}
_session = None
_lock = threading.Lock()


def _get_session():
    global _session
    if _session is None:
        with _lock:
            if _session is None:
                s = requests.Session()
                ad = HTTPAdapter(pool_connections=8, pool_maxsize=32)
                s.mount("https://", ad)
                s.mount("http://", ad)
                _session = s
    return _session


def call(method, url, **kw):
    fn = getattr(requests, method)
    if fn is not _ORIG[method]:
        return fn(url, **kw)
    return getattr(_get_session(), method)(url, **kw)


def get(url, **kw):
    return call("get", url, **kw)


def post(url, **kw):
    return call("post", url, **kw)
