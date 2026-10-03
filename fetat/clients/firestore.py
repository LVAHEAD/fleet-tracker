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


# --- Простые документы (блокнот и т. п.): плоские поля, без обёртки data/meta Флота ---

def _encode_value(v):
    """Python → значение Firestore. Строки остаются строками (без JSON)."""
    if v is None:
        return {"nullValue": None}
    if isinstance(v, bool):
        return {"booleanValue": v}
    if isinstance(v, int):
        return {"integerValue": str(v)}
    if isinstance(v, float):
        return {"doubleValue": v}
    if isinstance(v, str):
        return {"stringValue": v}
    if isinstance(v, dict):
        return {"mapValue": {"fields": {k: _encode_value(x) for k, x in v.items()}}}
    if isinstance(v, (list, tuple)):
        return {"arrayValue": {"values": [_encode_value(x) for x in v]}}
    return {"stringValue": str(v)}


def _decode_value(v):
    """Значение Firestore → Python."""
    if not isinstance(v, dict):
        return None
    if "stringValue" in v:
        return v["stringValue"]
    if "booleanValue" in v:
        return bool(v["booleanValue"])
    if "integerValue" in v:
        return int(v["integerValue"])
    if "doubleValue" in v:
        return float(v["doubleValue"])
    if "timestampValue" in v:
        return v["timestampValue"]
    if "mapValue" in v:
        return {k: _decode_value(x) for k, x in ((v["mapValue"] or {}).get("fields") or {}).items()}
    if "arrayValue" in v:
        return [_decode_value(x) for x in ((v["arrayValue"] or {}).get("values") or [])]
    return None


def _decode_doc(doc):
    data = {k: _decode_value(x) for k, x in (doc.get("fields") or {}).items()}
    data["id"] = doc["name"].rsplit("/", 1)[-1]
    return data


def fs_insert(collection: str, doc_id: str, data: dict):
    """Создать документ (если такой id уже есть — ошибка Firestore)."""
    import requests
    fields = {k: _encode_value(v) for k, v in data.items() if k != "id"}
    resp = requests.post(f"{FS_BASE}/{collection}", params={"documentId": doc_id},
                         json={"fields": fields}, headers=_fs_headers(), timeout=20)
    _fs_check(resp)
    return _decode_doc(resp.json())


def fs_get(collection: str, doc_id: str, fields=None):
    """Документ целиком (или только поля fields). Нет документа — None."""
    import requests
    params = [("mask.fieldPaths", f) for f in fields] if fields else None
    resp = requests.get(f"{FS_BASE}/{collection}/{doc_id}", params=params, headers=_fs_headers(), timeout=20)
    if resp.status_code == 404:
        return None
    _fs_check(resp)
    return _decode_doc(resp.json())


def fs_query(collection: str, fields=None) -> list:
    """Все документы коллекции (постранично). fields — только эти поля (тяжёлые не тянем)."""
    import requests
    out, token = [], None
    for _ in range(50):
        params = [("pageSize", "300")]
        if fields:
            params += [("mask.fieldPaths", f) for f in fields]
        if token:
            params.append(("pageToken", token))
        resp = requests.get(f"{FS_BASE}/{collection}", params=params, headers=_fs_headers(), timeout=30)
        _fs_check(resp)
        js = resp.json()
        out += [_decode_doc(d) for d in js.get("documents", [])]
        token = js.get("nextPageToken")
        if not token:
            break
    return out


def fs_update(collection: str, doc_id: str, data: dict):
    """Обновить только переданные поля (остальные не трогаются). Документ должен существовать."""
    import requests
    fields = {k: _encode_value(v) for k, v in data.items() if k != "id"}
    params = [("updateMask.fieldPaths", k) for k in fields] + [("currentDocument.exists", "true")]
    resp = requests.patch(f"{FS_BASE}/{collection}/{doc_id}", params=params,
                          json={"fields": fields}, headers=_fs_headers(), timeout=20)
    _fs_check(resp)
    return _decode_doc(resp.json())


def fs_delete(collection: str, doc_id: str):
    """Удалить документ."""
    import requests
    resp = requests.delete(f"{FS_BASE}/{collection}/{doc_id}", headers=_fs_headers(), timeout=20)
    _fs_check(resp)
