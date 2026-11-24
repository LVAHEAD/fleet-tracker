"""Стоянки машин за всё время (v3.368): сбор из Mapon route/list в хранилище и статистика «где паркуются».
Сбор — по всем машинам HEAD TRUCK, раз в SAVE_EVERY (фоновый поток) или вручную (/api/stops-collect).
Статистика — по коду зоны (ES46) или по тексту адреса (город): число стоянок, часы, машины, топ мест (сетка ~300 м)."""
import time

from fetat.domain.regions import nearest_region_code
from fetat.store.stops_store import STOPS_STORE

KEEP_DAYS = 730           # храним 2 года (решение Владимира 23.11)
MIN_SEC = 8 * 3600        # пишем стоянки от 8 ч (решение Владимира 23.11); раньше писали от 1 ч
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
    return sorted((v for v in by.values() if v["e"] >= lo and v["e"] - v["s"] >= MIN_SEC), key=lambda v: v["s"])


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


DIR_MIN_KM = 30   # ближе — направления нет (та же местность)
SIDES = ["С", "СВ", "В", "ЮВ", "Ю", "ЮЗ", "З", "СЗ"]


def _side(lat0, lng0, lat1, lng1):
    """Сторона света (8), в которой от точки 0 лежит точка 1; "" — ближе DIR_MIN_KM."""
    import math
    dy = (lat1 - lat0) * 111.2
    dx = (lng1 - lng0) * 111.2 * math.cos(math.radians(lat0))
    if math.hypot(dx, dy) < DIR_MIN_KM:
        return ""
    return SIDES[int(((math.degrees(math.atan2(dx, dy)) % 360) + 22.5) // 45) % 8]


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
                m["list"] += c["list"]
                for key in ("from", "to"):
                    for k, v in c[key].items():
                        m[key][k] = m[key].get(k, 0) + v
                break
        else:
            out.append(c)
    return sorted(out, key=lambda c: (-c["n"], -c["hours"]))


def where(code=None, city=None, days=None, min_h=2.0, now=None, top=15, names=None, from_side=None):
    """Статистика стоянок: по коду зоны или по тексту адреса. -> {stops, hours, units, from, top: [{n, hours, units, lat, lng, address}]}"""
    now = float(now or time.time())
    lo = now - days * 86400 if days else 0
    code = (code or "").strip().upper()
    city = (city or "").strip().lower()
    cl, units, total, hours, first = {}, set(), 0, 0.0, None
    ok_from = set()
    if from_side in SIDES:   # «еду с …»: выбранная сторона и две соседние
        k = SIDES.index(from_side)
        ok_from = {SIDES[(k - 1) % 8], from_side, SIDES[(k + 1) % 8]}
    for uid, rec in STOPS_STORE.all().items():
        st = sorted(rec.get("stops") or [], key=lambda v: v["s"])
        for i, x in enumerate(st):
            if x["e"] < lo or x["e"] - x["s"] < min_h * 3600:
                continue
            if code and x.get("c") != code:
                continue
            if city and city not in (x.get("a") or "").lower():
                continue
            f = _side(x["lat"], x["lng"], st[i - 1]["lat"], st[i - 1]["lng"]) if i else ""
            t = _side(x["lat"], x["lng"], st[i + 1]["lat"], st[i + 1]["lng"]) if i + 1 < len(st) else ""
            if ok_from and f not in ok_from:
                continue
            h = (x["e"] - x["s"]) / 3600
            total += 1
            hours += h
            units.add(uid)
            first = x["s"] if first is None else min(first, x["s"])
            k = (round(x["lat"] / GRID), round(x["lng"] / GRID))
            c = cl.setdefault(k, {"n": 0, "hours": 0.0, "units": set(), "lat": 0.0, "lng": 0.0, "address": x.get("a") or "", "list": [], "from": {}, "to": {}})
            c["n"] += 1
            c["hours"] += h
            c["units"].add(uid)
            c["list"].append((uid, x["s"], x["e"], f, t))
            for d, k in ((c["from"], f), (c["to"], t)):
                if k:
                    d[k] = d.get(k, 0) + 1
            c["lat"] += x["lat"]
            c["lng"] += x["lng"]
    items = _merge_near(sorted(cl.values(), key=lambda c: (-c["n"], -c["hours"])))[:top]
    return {"stops": total, "hours": round(hours, 1), "units": len(units), "from": first,
            "top": [{"n": c["n"], "hours": round(c["hours"], 1), "units": len(c["units"]),
                     "lat": round(c["lat"] / c["n"], 5), "lng": round(c["lng"] / c["n"], 5), "address": c["address"], "from": c["from"], "to": c["to"],
                     "list": [{"u": (names or {}).get(str(u)) or str(u), "s": a, "e": b, "f": f, "t": t}
                              for u, a, b, f, t in sorted(c["list"], key=lambda r: -r[1])[:40]]} for c in items]}


ALL_TTL = 60   # слой «Паркинги» дёргает базу при каждом сдвиге карты — кеш на минуту
_all_cache = [0.0, None]


def _all_cached():
    now = time.time()
    if ALL_TTL and _all_cache[1] is not None and now - _all_cache[0] < ALL_TTL:
        return _all_cache[1]
    data = STOPS_STORE.all()
    _all_cache[0], _all_cache[1] = now, data
    return data


def places(south, west, north, east, zoom=12, min_n=1, names=None, top=600):
    """Слой «Паркинги»: места стоянок (от MIN_SEC) в границах карты; ячейка сетки крупнее на мелком масштабе.
    -> [{lat, lng, n, hours, units, address, list: [{u, s, e}] (8 последних)}], самые частые первыми."""
    fac = min(32, 2 ** max(0, 12 - int(zoom)))
    g = GRID * fac
    cl = {}
    for uid, rec in _all_cached().items():
        for x in rec.get("stops") or []:
            if not (south <= x["lat"] <= north and west <= x["lng"] <= east) or x["e"] - x["s"] < MIN_SEC:
                continue
            c = cl.setdefault((round(x["lat"] / g), round(x["lng"] / g)),
                              {"n": 0, "hours": 0.0, "units": set(), "lat": 0.0, "lng": 0.0, "address": x.get("a") or "", "list": []})
            c["n"] += 1
            c["hours"] += (x["e"] - x["s"]) / 3600
            c["units"].add(uid)
            c["lat"] += x["lat"]
            c["lng"] += x["lng"]
            c["list"].append((uid, x["s"], x["e"]))
    items = sorted((c for c in cl.values() if c["n"] >= min_n), key=lambda c: (-c["n"], -c["hours"]))[:top]
    return [{"lat": round(c["lat"] / c["n"], 5), "lng": round(c["lng"] / c["n"], 5), "n": c["n"], "hours": round(c["hours"], 1),
             "units": len(c["units"]), "address": c["address"],
             "list": [{"u": (names or {}).get(str(u)) or str(u), "s": a, "e": b}
                      for u, a, b in sorted(c["list"], key=lambda r: -r[1])[:8]]} for c in items]


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
