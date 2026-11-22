"""Стоянки машин за всё время (v3.368): сбор из Mapon route/list в хранилище и статистика «где паркуются».
Сбор — по всем машинам HEAD TRUCK, раз в SAVE_EVERY (фоновый поток) или вручную (/api/stops-collect).
Статистика — по коду зоны (ES46) или по тексту адреса (город): число стоянок, часы, машины, топ мест (сетка ~300 м)."""
import time

from fetat.domain.regions import nearest_region_code
from fetat.store.stops_store import STOPS_STORE

KEEP_DAYS = 400
MIN_SEC = 3600            # пишем стоянки от 1 ч; в отчёте порог выбирают (по умолчанию 2 ч)
FIRST_DAYS = 28           # первый сбор — на глубину окна Mapon
GRID = 0.003              # ~300 м


def parse_stops(routes, now):
    """Отрезки route/list -> завершённые стоянки от MIN_SEC (куски, разрезанные полуночью, склеены):
    [{s, e, lat, lng, a}]. Идущая сейчас стоянка не берётся — допишется, когда закончится."""
    from fetat.clients.mapon import _rts
    out = []
    for r in routes:
        if r.get("type") != "stop":
            continue
        st = r.get("start") or {}
        s, lat, lng = _rts(st), st.get("lat"), st.get("lng")
        if s is None or lat is None or lng is None or not (r.get("end") or {}).get("time"):
            continue
        e = _rts(r.get("end"))
        if e is None:
            continue
        a = st.get("address") or ""
        if out and abs(s - out[-1]["e"]) <= 60 and out[-1]["a"] == a:
            out[-1]["e"] = int(e)
        else:
            out.append({"s": int(s), "e": int(e), "lat": float(lat), "lng": float(lng), "a": a})
    return [x for x in out if x["e"] - x["s"] >= MIN_SEC]


def merge_stops(old, fresh, now, keep_days=KEEP_DAYS):
    """Ключ — начало стоянки; при совпадении побеждает более поздний конец. Старше keep_days выбрасываем."""
    by = {int(x["s"]): dict(x) for x in old or []}
    for x in fresh:
        k = int(x["s"])
        if k not in by or int(x["e"]) >= int(by[k]["e"]):
            if "c" not in x:
                x = dict(x, c=(nearest_region_code(x["lat"], x["lng"])[0] or ""))
            by[k] = x
    lo = now - keep_days * 86400
    return sorted((v for v in by.values() if v["e"] >= lo), key=lambda v: v["s"])


def collect_unit(unit_id, now=None, route_list=None):
    """Дописывает в хранилище стоянки одной машины. Берём с конца последней записи (−6 ч), впервые — FIRST_DAYS."""
    now = float(now or time.time())
    if route_list is None:
        from fetat.clients.mapon import _route_list as route_list
    rec = STOPS_STORE.get(unit_id) or {}
    old = rec.get("stops") or []
    since = (max(x["e"] for x in old) - 6 * 3600) if old else now - FIRST_DAYS * 86400
    since = max(since, now - FIRST_DAYS * 86400)
    routes = route_list(unit_id, since, now, polyline=False)
    merged = merge_stops(old, parse_stops(routes, now), now)
    if merged != old:
        STOPS_STORE.put(unit_id, {"stops": merged, "saved_at": int(now)})
    return len(merged) - len(old)


_state = {"running": False, "last": 0.0, "units": 0, "added": 0, "errors": 0}


def collect_all(unit_ids, now=None, route_list=None, pause=0.2):
    """Сбор по всем машинам; одна ошибка не рвёт остальных. Возвращает {units, added, errors}."""
    if _state["running"]:
        return dict(_state, skipped=True)
    _state.update(running=True, units=0, added=0, errors=0)
    try:
        for uid in sorted(unit_ids):
            try:
                _state["added"] += collect_unit(uid, now, route_list)
            except Exception:
                _state["errors"] += 1
            _state["units"] += 1
            if pause:
                time.sleep(pause)
        _state["last"] = time.time()
    finally:
        _state["running"] = False
    return dict(_state)


def status():
    return dict(_state)


MERGE_KM = 0.5  # соседние ячейки ближе 500 м — одно место (адрес — у самой частой)


def _merge_near(cells):
    """Склеить ячейки сетки, центры которых ближе MERGE_KM; cells уже по убыванию n."""
    import math
    out = []
    for c in cells:
        la, lo = c["lat"] / c["n"], c["lng"] / c["n"]
        for m in out:
            ml, mg = m["lat"] / m["n"], m["lng"] / m["n"]
            dy = (la - ml) * 111.2
            dx = (lo - mg) * 111.2 * math.cos(math.radians(ml))
            if dx * dx + dy * dy <= MERGE_KM ** 2:
                for k in ("n", "hours", "lat", "lng"):
                    m[k] += c[k]
                m["units"] |= c["units"]
                break
        else:
            out.append(c)
    return sorted(out, key=lambda c: (-c["n"], -c["hours"]))


def where(code=None, city=None, days=None, min_h=2.0, now=None, top=15):
    """Статистика стоянок: по коду зоны или по тексту адреса. -> {stops, hours, units, from, top: [{n, hours, units, lat, lng, address}]}"""
    now = float(now or time.time())
    lo = now - days * 86400 if days else 0
    code = (code or "").strip().upper()
    city = (city or "").strip().lower()
    cl, units, total, hours, first = {}, set(), 0, 0.0, None
    for uid, rec in STOPS_STORE.all().items():
        for x in rec.get("stops") or []:
            if x["e"] < lo or x["e"] - x["s"] < min_h * 3600:
                continue
            if code and x.get("c") != code:
                continue
            if city and city not in (x.get("a") or "").lower():
                continue
            h = (x["e"] - x["s"]) / 3600
            total += 1
            hours += h
            units.add(uid)
            first = x["s"] if first is None else min(first, x["s"])
            k = (round(x["lat"] / GRID), round(x["lng"] / GRID))
            c = cl.setdefault(k, {"n": 0, "hours": 0.0, "units": set(), "lat": 0.0, "lng": 0.0, "address": x.get("a") or ""})
            c["n"] += 1
            c["hours"] += h
            c["units"].add(uid)
            c["lat"] += x["lat"]
            c["lng"] += x["lng"]
    items = _merge_near(sorted(cl.values(), key=lambda c: (-c["n"], -c["hours"])))[:top]
    return {"stops": total, "hours": round(hours, 1), "units": len(units), "from": first,
            "top": [{"n": c["n"], "hours": round(c["hours"], 1), "units": len(c["units"]),
                     "lat": round(c["lat"] / c["n"], 5), "lng": round(c["lng"] / c["n"], 5), "address": c["address"]} for c in items]}


def _unit_ids():
    from fetat.clients.mapon import fetch_group_unit_ids
    from fetat.config import HEAD_TRUCK_GROUP_ID, MAPON_API_KEY
    return fetch_group_unit_ids(MAPON_API_KEY, HEAD_TRUCK_GROUP_ID)


def start_background(every=6 * 3600, first_delay=180):
    """Фоновый сбор: через first_delay после старта и дальше раз в every. Cloud Run между запросами замораживает
    процессы — сбор идёт, пока аппой пользуются (автообновление Флота); пропущенное Mapon отдаёт за прошлое окно."""
    import os
    import threading

    from fetat.config import MAPON_API_KEY
    if not MAPON_API_KEY or os.environ.get("FLEET_STORE") == "memory":
        return None

    def loop():
        time.sleep(first_delay)
        while True:
            try:
                collect_all(_unit_ids())
            except Exception:
                pass
            time.sleep(every)

    t = threading.Thread(target=loop, name="stops-collector", daemon=True)
    t.start()
    return t
