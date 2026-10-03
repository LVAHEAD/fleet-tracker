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


# --- Публичный API для работы с документами ---

def _encode_value(v):
    """Кодирует Python-значение в Firestore格式."""
    if isinstance(v, bool):
        return {"booleanValue": v}
    elif isinstance(v, int):
        return {"integerValue": str(v)}
    elif isinstance(v, str):
        return {"stringValue": v}
    elif isinstance(v, float):
        return {"doubleValue": v}
    elif v is None:
        return {"nullValue": "NULL_VALUE"}
    else:
        # Для сложных объектов кодируем как JSON строку
        return {"stringValue": json.dumps(v, default=str)}


def fs_insert(collection: str, doc_id: str, data: dict):
    """Вставить документ в Firestore."""
    import requests

    fields = {}
    for k, v in data.items():
        fields[k] = _encode_value(v)

    url = f"{FS_BASE}/{collection}/{doc_id}"
    body = {"fields": fields}

    resp = requests.patch(url, json={"document": body}, headers=_fs_headers())
    _fs_check(resp)
    return resp.json()


def fs_get(collection: str, doc_id: str) -> dict:
    """Получить документ из Firestore."""
    import requests

    url = f"{FS_BASE}/{collection}/{doc_id}"
    resp = requests.get(url, headers=_fs_headers())
    _fs_check(resp)

    doc = resp.json()
    # Декодируем поля обратно в Python
    data = {}
    for k, v in (doc.get("fields") or {}).items():
        if "stringValue" in v:
            try:
                data[k] = json.loads(v["stringValue"])
            except Exception:
                data[k] = v["stringValue"]
        elif "booleanValue" in v:
            data[k] = v["booleanValue"]
        elif "integerValue" in v:
            data[k] = int(v["integerValue"])
        elif "doubleValue" in v:
            data[k] = float(v["doubleValue"])
        else:
            data[k] = None

    data["id"] = doc_id
    return data


def fs_query(collection: str, filters: list) -> list:
    """Запрос документов из Firestore (пока без фильтров — все документы)."""
    import requests

    url = f"{FS_BASE}/{collection}"
    resp = requests.get(url, headers=_fs_headers())
    _fs_check(resp)

    docs = resp.json().get("documents", [])
    result = []
    for doc in docs:
        doc_id = doc["name"].rsplit("/", 1)[-1]
        data = {}
        for k, v in (doc.get("fields") or {}).items():
            if "stringValue" in v:
                try:
                    data[k] = json.loads(v["stringValue"])
                except Exception:
                    data[k] = v["stringValue"]
            elif "booleanValue" in v:
                data[k] = v["booleanValue"]
            elif "integerValue" in v:
                data[k] = int(v["integerValue"])
            elif "doubleValue" in v:
                data[k] = float(v["doubleValue"])
            else:
                data[k] = None
        data["id"] = doc_id
        result.append(data)

    return result


def fs_update(collection: str, doc_id: str, data: dict):
    """Обновить поля документа в Firestore."""
    import requests

    fields = {}
    for k, v in data.items():
        fields[k] = _encode_value(v)

    url = f"{FS_BASE}/{collection}/{doc_id}"
    body = {"fields": fields}

    resp = requests.patch(url, json={"document": body}, headers=_fs_headers())
    _fs_check(resp)
    return resp.json()


def fs_delete(collection: str, doc_id: str):
    """Удалить документ из Firestore."""
    import requests

    url = f"{FS_BASE}/{collection}/{doc_id}"
    resp = requests.delete(url, headers=_fs_headers())
    _fs_check(resp)
