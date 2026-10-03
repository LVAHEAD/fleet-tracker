"""Firestore через REST: токен сервисного аккаунта, проверка ответа, разбор документа."""
import json
import threading

from fetat.config import GOOGLE_PROJECT_ID


FS_BASE = f"https://firestore.googleapis.com/v1/projects/{GOOGLE_PROJECT_ID}/databases/(default)/documents"


_fs_tok = {"tok": None, "exp": 0.0}


_fs_lock = threading.Lock()


def _fs_headers():
    import time
    with _fs_lock:
        if not _fs_tok["tok"] or time.time() > _fs_tok["exp"]:
            import google.auth
            import google.auth.transport.requests
            creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/datastore"])
            creds.refresh(google.auth.transport.requests.Request())
            _fs_tok.update(tok=creds.token, exp=time.time() + 45 * 60)
        return {"Authorization": f"Bearer {_fs_tok['tok']}"}


def _fs_check(r):
    if r.status_code >= 400:
        try:
            msg = r.json().get("error", {}).get("message") or r.text
        except Exception:
            msg = r.text
        raise RuntimeError(f"Firestore {r.status_code}: {str(msg)[:300]}")
    return r


def _fs_decode(doc):
    f = doc.get("fields") or {}

    def val(v):
        if v is None:
            return None
        if "integerValue" in v:
            return int(v["integerValue"])
        if "booleanValue" in v:
            return bool(v["booleanValue"])
        if "stringValue" in v:
            return v["stringValue"]
        return None
    data = {}
    for k, v in ((f.get("data") or {}).get("mapValue", {}).get("fields") or {}).items():
        try:
            data[k] = json.loads(v.get("stringValue", "null"))
        except Exception:
            data[k] = None
    rid = doc["name"].rsplit("/", 1)[-1]
    meta = {k: val(f.get(k)) for k in ("created_by", "created_at", "updated_by", "updated_at", "edited_at",
                                         "deleted", "deleted_by", "deleted_at", "lock_by", "lock_until")}
    return {"id": rid, "data": data, "meta": meta}
