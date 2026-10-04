"""Общий Флот (v2.00+): строки в Firestore (или в памяти при FLEET_STORE=memory),
права на удаление, 🔒 блокировка строки, корзина 7 дней, проверка полей; v3.22 — архив завершённых трипов."""
import json
import os
import re


from fetat.clients.firestore import FS_BASE, _fs_check, _fs_decode, fs_delete, fs_get, fs_query, fs_request, fs_set
from fetat.config import FLEET_ADMINS


# Документ коллекции fleet_rows = одна строка Флота. Поля строки лежат в map "data" как JSON-строки
# (правка по полю: два человека правят разные поля одной строки — ничего не теряется).
# Мета: created_by/at, updated_by/at (мс), deleted (+ by/at) — удалённое 7 дней лежит "в корзине".
FLEET_COLL = "fleet_rows"


FLEET_FIELD_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,40}$")


FLEET_VALUE_MAX = 30000          # байт JSON на одно поле


FLEET_TRASH_MS = 7 * 24 * 3600 * 1000   # v3.09: корзина — неделя


def _fp(name):
    return name if FLEET_FIELD_RE.match(name) else "`" + name.replace("`", "\\`") + "`"


class FleetStoreFS:
    def query(self, since=None):
        q = {"from": [{"collectionId": FLEET_COLL}]}
        if since is not None:
            q["where"] = {"fieldFilter": {"field": {"fieldPath": "updated_at"}, "op": "GREATER_THAN_OR_EQUAL",
                                          "value": {"integerValue": str(int(since))}}}
        r = _fs_check(fs_request("post", f"{FS_BASE}:runQuery", json={"structuredQuery": q}, timeout=20))
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
        _fs_check(fs_request("patch", f"{FS_BASE}/{FLEET_COLL}/{rid}", params=[("updateMask.fieldPaths", m) for m in mask],
                                 json={"fields": fields}, timeout=20))

    def purge(self, rid):
        _fs_check(fs_request("delete", f"{FS_BASE}/{FLEET_COLL}/{rid}", timeout=20))

    def get(self, rid):
        r = fs_request("get", f"{FS_BASE}/{FLEET_COLL}/{rid}", timeout=20)
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


# ---------- v3.20: чужая правка — метки «кто изменил» до клика хозяина трипа ----------
CHG_TOP = ("unit", "lo", "target", "delivery", "note", "com", "trailer", "crew", "disp", "done", "fban", "noban")


CHG_SUB = ("target", "lo", "delivery", "note", "com")


CHG_MAX = 60


def fleet_owner(d):
    """Хозяин трипа: диспетчер строки, иначе создатель."""
    disp = str((d.get("data") or {}).get("disp") or "").lower()
    if disp:
        return disp
    c = str((d.get("meta") or {}).get("created_by") or "").lower()
    return "" if c == "local" else c


def chg_keys(old, new):
    """Какие поля изменились: имена полей ① и "x{k}.{поле}" для точек ②③… (k — номер точки, ② = 1)."""
    out = []
    for f in CHG_TOP:
        if f in new and json.dumps(old.get(f), sort_keys=True) != json.dumps(new.get(f), sort_keys=True):
            out.append(f)
    if "extra" in new:
        a = old.get("extra") or []
        b = new.get("extra") or []
        for i in range(max(len(a), len(b))):
            x = a[i] if i < len(a) and isinstance(a[i], dict) else {}
            y = b[i] if i < len(b) and isinstance(b[i], dict) else {}
            if i >= len(b):
                continue                       # точку убрали — нечего подсвечивать
            for f in CHG_SUB:
                if (x.get(f) or "") != (y.get(f) or ""):
                    out.append(f"x{i + 1}.{f}")
    return out


def chg_apply(d, user, set_data, unset, now):
    """Обновить метки chg строки d после правки user. Возвращает новый chg (dict) или None — без изменений.
    Хозяин своей правкой снимает метки с этих полей; чужая правка ставит {by, at}."""
    data = d.get("data") or {}
    old_chg = data.get("chg") if isinstance(data.get("chg"), dict) else {}
    new = dict(set_data)
    for k in unset:
        new[k] = None
    keys = chg_keys(data, new)
    if not keys:
        return None
    chg = dict(old_chg)
    owner = fleet_owner(d)
    if not owner or user.lower() == owner:
        for k in keys:
            chg.pop(k, None)
    else:
        for k in keys:
            chg[k] = {"by": user, "at": now}
        if len(chg) > CHG_MAX:
            chg = dict(sorted(chg.items(), key=lambda kv: kv[1].get("at", 0))[-CHG_MAX:])
    return None if chg == old_chg else chg


# ---------- v3.22: завершённые трипы — архив навсегда (задел на v5+) ----------
# Завершённая строка: в fleet_rows помечается completed (клиенты убирают её из Флота как удалённую,
# через FLEET_TRASH_MS она оттуда стирается), а целиком копируется в fleet_done — там хранится всегда.
# Документ архива: row / meta — JSON-строки (как было во Флоте), плюс поля для будущих поисков и отчётов.
FLEET_DONE_COLL = "fleet_done"


def done_record(d, user, now):
    """Запись архива из документа строки Флота."""
    row = dict(d.get("data") or {})
    pts = [row.get("target")] + [x.get("target") for x in (row.get("extra") or []) if isinstance(x, dict)]
    return {
        "row": json.dumps(row, ensure_ascii=False),
        "meta": json.dumps({k: v for k, v in (d.get("meta") or {}).items() if v is not None}, ensure_ascii=False),
        "unit": str(row.get("unit") or ""),
        "points": " → ".join(str(p) for p in pts if p),
        "disp": str(row.get("disp") or ""),
        "owner": fleet_owner(d),
        "created_by": str((d.get("meta") or {}).get("created_by") or ""),
        "created_at": int((d.get("meta") or {}).get("created_at") or 0),
        "completed_by": user,
        "completed_at": int(now),
    }


def done_out(rec):
    """Запись архива для браузера: строка, мета, кто и когда завершил."""
    try:
        row = json.loads(rec.get("row") or "{}")
    except ValueError:
        row = {}
    try:
        row["id"] = int(rec.get("id"))
    except (TypeError, ValueError):
        row["id"] = rec.get("id")
    return {"row": row, "completed_by": rec.get("completed_by") or "", "completed_at": int(rec.get("completed_at") or 0),
            "owner": rec.get("owner") or ""}


class FleetDoneFS:
    def put(self, rid, rec):
        fs_set(FLEET_DONE_COLL, rid, rec)

    def get(self, rid):
        return fs_get(FLEET_DONE_COLL, rid)

    def all(self):
        return fs_query(FLEET_DONE_COLL)

    def remove(self, rid):
        fs_delete(FLEET_DONE_COLL, rid)


class FleetDoneMem:
    def __init__(self):
        self.docs = {}

    def put(self, rid, rec):
        self.docs[rid] = dict(rec, id=rid)

    def get(self, rid):
        d = self.docs.get(rid)
        return dict(d) if d else None

    def all(self):
        return [dict(d) for d in self.docs.values()]

    def remove(self, rid):
        self.docs.pop(rid, None)


FLEET_DONE = FleetDoneMem() if os.environ.get("FLEET_STORE") == "memory" else FleetDoneFS()
