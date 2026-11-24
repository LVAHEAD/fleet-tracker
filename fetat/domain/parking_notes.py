"""Заметки о паркингах (v3.381): Норм / Нет, Платный / Бесплатный, метки, текст. Заметка привязана к месту: ищем ближайшую
в NEAR_KM от центра строки стоянок — так она не теряется, когда центр места чуть сдвинулся."""
import time

from fetat.store.parking_store import PARKING
from fetat.utils.geo import haversine_km

NEAR_KM = 0.3
GRID = 0.003
OK_VALUES = ("yes", "no")
PAY_VALUES = ("paid", "free")
TAGS = {"fuel": "Сливы топлива", "guard": "Охраняется", "shower": "Душ", "wc": "Туалет", "tight": "Мало мест"}


def _public(nid, r):
    return {"id": nid, "ok": r.get("ok") or "", "pay": r.get("pay") or "", "tags": list(r.get("tags") or []),
            "text": r.get("text") or "", "by": r.get("by") or "", "at": r.get("at") or 0}


def _nearest(notes, lat, lng):
    best = None
    for nid, r in notes.items():
        if r.get("lat") is None or r.get("lng") is None:
            continue
        d = haversine_km(lat, lng, r["lat"], r["lng"])
        if d <= NEAR_KM and (best is None or d < best[0]):
            best = (d, nid, r)
    return best


def attach(top, notes=None):
    """Дописать в строки топа поле note (или None)."""
    notes = PARKING.all() if notes is None else notes
    for t in top:
        b = _nearest(notes, t["lat"], t["lng"])
        t["note"] = _public(b[1], b[2]) if b else None
    return top


def save(lat, lng, data, user, now=None):
    """Создать / обновить заметку места. data: ok, pay, tags, text. Возвращает публичный вид."""
    lat, lng = float(lat), float(lng)
    ok = data.get("ok") if data.get("ok") in OK_VALUES else ""
    pay = data.get("pay") if data.get("pay") in PAY_VALUES else ""
    tags = [k for k in TAGS if k in (data.get("tags") or [])]
    text = str(data.get("text") or "").strip()[:300]
    notes = PARKING.all()
    b = _nearest(notes, lat, lng)
    nid = b[1] if b else f"{round(lat / GRID)}_{round(lng / GRID)}"
    old = b[2] if b else {}
    rec = {"lat": old.get("lat", lat), "lng": old.get("lng", lng), "ok": ok, "pay": pay, "tags": tags, "text": text,
           "by": user or "", "at": float(now or time.time())}
    PARKING.put(nid, rec)
    return _public(nid, rec)
