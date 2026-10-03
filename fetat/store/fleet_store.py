"""Общий Флот (v2.00+): строки в Firestore (или в памяти при FLEET_STORE=memory),
права на удаление, 🔒 блокировка строки, корзина 24 ч, проверка полей."""
import json
import os
import re

import requests

from fetat.clients.firestore import FS_BASE, _fs_check, _fs_decode, _fs_headers
from fetat.config import FLEET_ADMINS


# Документ коллекции fleet_rows = одна строка Флота. Поля строки лежат в map "data" как JSON-строки
# (правка по полю: два человека правят разные поля одной строки — ничего не теряется).
# Мета: created_by/at, updated_by/at (мс), deleted (+ by/at) — удалённое 24 ч лежит "в корзине".
FLEET_COLL = "fleet_rows"


FLEET_FIELD_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,40}$")


FLEET_VALUE_MAX = 30000          # байт JSON на одно поле


FLEET_TRASH_MS = 24 * 3600 * 1000


def _fp(name):
    return name if FLEET_FIELD_RE.match(name) else "`" + name.replace("`", "\\`") + "`"


class FleetStoreFS:
    def query(self, since=None):
        q = {"from": [{"collectionId": FLEET_COLL}]}
        if since is not None:
            q["where"] = {"fieldFilter": {"field": {"fieldPath": "updated_at"}, "op": "GREATER_THAN_OR_EQUAL",
                                          "value": {"integerValue": str(int(since))}}}
        r = _fs_check(requests.post(f"{FS_BASE}:runQuery", json={"structuredQuery": q},
                                    headers=_fs_headers(), timeout=20))
        return [_fs_decode(x["document"]) for x in r.json() if x.get("document")]

    def patch(self, rid, set_data=None, unset=(), meta=None):
        fields, mask = {}, []
        if set_data:
            fields["data"] = {"mapValue": {"fields": {k: {"stringValue": json.dumps(v, ensure_ascii=False)}
                                                      for k, v in set_data.items()}}}
            mask += [f"data.{_fp(k)}" for k in set_data]
        for k in unset or ():
            mask.append(f"data.{_fp(k)}")
        for k, v in (meta or {}).items():
            mask.append(k)
            if isinstance(v, bool):
                fields[k] = {"booleanValue": v}
            elif isinstance(v, int):
                fields[k] = {"integerValue": str(v)}
            elif v is None:
                fields[k] = {"nullValue": None}
            else:
                fields[k] = {"stringValue": str(v)}
        _fs_check(requests.patch(f"{FS_BASE}/{FLEET_COLL}/{rid}", params=[("updateMask.fieldPaths", m) for m in mask],
                                 json={"fields": fields}, headers=_fs_headers(), timeout=20))

    def purge(self, rid):
        _fs_check(requests.delete(f"{FS_BASE}/{FLEET_COLL}/{rid}", headers=_fs_headers(), timeout=20))

    def get(self, rid):
        r = requests.get(f"{FS_BASE}/{FLEET_COLL}/{rid}", headers=_fs_headers(), timeout=20)
        if r.status_code == 404:
            return None
        return _fs_decode(_fs_check(r).json())


class FleetStoreMem:
    """Для локальной проверки без Firestore (FLEET_STORE=memory)."""
    def __init__(self):
        self.docs = {}

    def query(self, since=None):
        out = []
        for rid, d in self.docs.items():
            if since is None or (d["meta"].get("updated_at") or 0) >= since:
                out.append({"id": rid, "data": dict(d["data"]), "meta": dict(d["meta"])})
        return out

    def patch(self, rid, set_data=None, unset=(), meta=None):
        d = self.docs.setdefault(rid, {"data": {}, "meta": {}})
        d["data"].update(json.loads(json.dumps(set_data or {})))
        for k in unset or ():
            d["data"].pop(k, None)
        d["meta"].update(meta or {})

    def purge(self, rid):
        self.docs.pop(rid, None)

    def get(self, rid):
        d = self.docs.get(rid)
        return {"id": rid, "data": dict(d["data"]), "meta": dict(d["meta"])} if d else None


FLEET_STORE = FleetStoreMem() if os.environ.get("FLEET_STORE") == "memory" else FleetStoreFS()


FLEET_LOCK_MS = 60 * 1000


def _fleet_can_delete(user, d):
    if user in FLEET_ADMINS:
        return True
    created = str(d["meta"].get("created_by") or "").lower()
    disp = str(d["data"].get("disp") or "").lower()
    if not created or created == "local":
        return True
    return user.lower() in (created, disp)


def _fleet_row_out(d):
    row = dict(d["data"])
    try:
        row["id"] = int(d["id"])
    except ValueError:
        row["id"] = d["id"]
    return {"row": row, "meta": {k: v for k, v in d["meta"].items() if v is not None}}


def _fleet_rid(v):
    s = str(v if v is not None else "").strip()
    if not re.fullmatch(r"\d{1,17}", s):
        raise ValueError(f"плохой id строки: {v!r}")
    return s


def _fleet_clean(fields):
    out = {}
    for k, v in (fields or {}).items():
        if k == "id" or not FLEET_FIELD_RE.match(str(k)):
            continue
        if len(json.dumps(v, ensure_ascii=False)) > FLEET_VALUE_MAX:
            raise ValueError(f"поле {k} слишком большое")
        out[k] = v
    return out
