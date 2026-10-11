"""Короткий лог для «тихих» except: тип ошибки в stdout (Cloud Logging), не чаще раза в 10 минут на место."""
import time

_seen = {}
_EVERY = 600


def warn(where, exc):
    now = time.time()
    key = (where, type(exc).__name__)
    if now - _seen.get(key, 0) < _EVERY:
        return
    if len(_seen) > 500:
        _seen.clear()
    _seen[key] = now
    print(f"[warn] {where}: {type(exc).__name__}: {str(exc)[:160]}", flush=True)
