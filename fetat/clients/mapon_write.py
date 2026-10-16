"""v3.139: запись в Mapon (POST). Единственное место, где аппа что-то пишет в Mapon; ключ — MAPON_WRITE_KEY."""
import requests

from fetat.clients.mapon import MAPON_BASE


def mapon_post(path, data, timeout=30):
    """POST в Mapon API; ошибку Mapon или сети — RuntimeError (текст без ключа)."""
    try:
        r = requests.post(MAPON_BASE + path, data=data, timeout=timeout)
    except requests.RequestException as e:
        raise RuntimeError(f"Mapon не отвечает: {type(e).__name__}")
    try:
        j = r.json()
    except ValueError:
        raise RuntimeError(f"Mapon: ответ не JSON, HTTP {r.status_code}: {r.text[:160]!r}")
    err = j.get("error") if isinstance(j, dict) else None
    if err:
        code = err.get("code") if isinstance(err, dict) else ""
        msg = err.get("msg") if isinstance(err, dict) else err
        raise RuntimeError(f"Mapon {code}: {msg}")
    if r.status_code >= 400:
        raise RuntimeError(f"Mapon: HTTP {r.status_code}")
    return j.get("data") if isinstance(j, dict) else j
