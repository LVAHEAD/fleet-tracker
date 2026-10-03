"""Запреты движения: сборка фида (полные запреты, без ADR), запреты по пути по тахо-времени,
ночь Австрии 22:00–05:00 для MAN без L-наклейки (только предупреждение), страны по маршруту."""
import re
import threading
from datetime import datetime, timedelta, timezone

from fetat.clients.nakordoni import (
    _bans_cache, _bans_cc, _bans_fetch_group, _bans_fetch_lock, _bans_lock, _bans_window,
    BansRateLimited,
)
from fetat.config import RIGA_UTC_OFFSET
from fetat.domain.regions import _country_at, OUR_COUNTRIES
from fetat.domain.tacho import TACHO_SPEED_KMH
from fetat.domain.trailers import is_trailer
from fetat.utils.geo import _decode_polyline, haversine_km


BANS_TTL = 3 * 3600          # данные о запретах меняются редко


BANS_MANUAL_MIN = 600        # "↻ Обновить" не чаще раза в 10 минут


BANS_COOLDOWN_429 = 1800     # после 429 не трогаем фид 30 минут


BANS_GROUP = 3               # стран в одном запросе: фид принимает не больше 3 (иначе 400)


BANS_FULL_TYPES = {"Sunday", "Holiday", "General"}   # запрет по всей стране — выделяем


BANS_ADR_WORDS = ("dangerous", "adr", "hazard", "опасн", "небезпеч")  # ADR не возим — скрываем


def _is_adr(b):
    t = f"{b.get('restriction_details') or ''} {b.get('restriction_type') or ''}".lower()
    return any(w in t for w in BANS_ADR_WORDS)


def _bans_build():
    """Собрать данные вкладки из кеша по странам (даже если часть стран не скачалась)."""
    with _bans_lock:
        cc_data = dict(_bans_cc)
        window = _bans_window["w"]
    codes = sorted(OUR_COUNTRIES)
    seen, upcoming, current = set(), [], []
    for cc in codes:
        src = cc_data.get(cc)
        if not src:
            continue
        for key, dst in (("upcoming", upcoming), ("current", current)):
            for b in src[key]:
                if _is_adr(b) or b.get("country_code") not in OUR_COUNTRIES:
                    continue
                k = (key, b.get("country_code"), b.get("date"), b.get("time_from"), b.get("time_until"),
                     b.get("restriction_type"), b.get("restriction_details"))
                if k in seen:
                    continue
                seen.add(k)
                dst.append({
                    "cc": b.get("country_code"), "country": b.get("country_name"),
                    "date": b.get("date"), "from": b.get("time_from"), "until": b.get("time_until"),
                    "type": b.get("restriction_type"), "details": b.get("restriction_details"),
                    "min_weight": b.get("min_weight_tons"), "url": b.get("details_url"),
                    "full": b.get("restriction_type") in BANS_FULL_TYPES,
                })
    by_day = {}
    for b in upcoming:
        by_day.setdefault(b["date"], []).append(b)
    for lst in by_day.values():
        lst.sort(key=lambda b: (not b["full"], b["cc"] or "", b["from"] or ""))
    current.sort(key=lambda b: (not b["full"], b["cc"] or ""))
    return {
        "window": window,
        "now": current,
        "days": [{"date": d, "bans": by_day[d]} for d in sorted(by_day)],
        "countries": codes,
        "missing": [c for c in codes if c not in cc_data],
    }


def _bans_refresh(max_age=BANS_TTL):
    """v1.84: докачать страны старше max_age. Вызывать под _bans_fetch_lock.
    Удачные группы сохраняются сразу; на 429 — стоп и пауза."""
    import time
    now = time.time()
    with _bans_lock:
        if now < _bans_cache["blocked_until"]:
            return
        need = [c for c in sorted(OUR_COUNTRIES)
                if c not in _bans_cc or now - _bans_cc[c]["at"] > max_age]
    err = None
    try:
        for k in range(0, len(need), BANS_GROUP):
            _bans_fetch_group(need[k:k + BANS_GROUP])
    except BansRateLimited as e:
        err = str(e)
        with _bans_lock:
            _bans_cache["blocked_until"] = time.time() + max(BANS_COOLDOWN_429, e.retry_after)
    except Exception as e:
        err = str(e)
        with _bans_lock:
            _bans_cache["blocked_until"] = time.time() + 300
    with _bans_lock:
        have = bool(_bans_cc)
        oldest = min((v["at"] for v in _bans_cc.values()), default=0.0)
    data = _bans_build() if have else None
    if data and data["missing"] and not err:
        err = "нет данных по: " + ", ".join(data["missing"])
    with _bans_lock:
        if data:
            _bans_cache.update(data=data, at=oldest)
        _bans_cache["error"] = err


def fetch_bans():
    """Совместимость: полное обновление (все страны)."""
    with _bans_fetch_lock:
        _bans_refresh(max_age=0)
    return _bans_cache["data"]


BANS_ROUTE_STEP_KM = 10


COUNTRY_TZ = {"PT": "Europe/Lisbon", "FI": "Europe/Helsinki", "EE": "Europe/Tallinn",
              "LV": "Europe/Riga", "LT": "Europe/Vilnius"}   # остальные наши — CET


def route_countries(polyline, dist_km):
    """Страны по маршруту: [(cc, km_from, km_to)] в км Google-маршрута."""
    pts = _decode_polyline(polyline or "")
    if len(pts) < 2:
        return []
    cum = [0.0]
    for a, b in zip(pts, pts[1:]):
        cum.append(cum[-1] + haversine_km(a[0], a[1], b[0], b[1]))
    total = cum[-1] or 1.0
    scale = float(dist_km or total) / total
    segs, j, km = [], 0, 0.0
    while True:
        while j < len(pts) - 2 and cum[j + 1] < km:
            j += 1
        a, b = pts[j], pts[j + 1]
        f = 0.0 if cum[j + 1] == cum[j] else min(1.0, max(0.0, (km - cum[j]) / (cum[j + 1] - cum[j])))
        cc = _country_at(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f)
        g = km * scale
        if segs and segs[-1][0] == cc:
            segs[-1][2] = g
        else:
            if segs:
                segs[-1][2] = g
            segs.append([cc, g, g])
        if km >= total:
            break
        km = min(total, km + BANS_ROUTE_STEP_KM)
    segs[-1][2] = float(dist_km or total * scale)
    return [tuple(x) for x in segs]


def _drive_intervals(t0, stops, total_drive_sec):
    """Интервалы вождения [(t_start, t_end, sec_driven_before)] между остановками симуляции."""
    out, t, done = [], t0, 0.0
    for st in sorted(stops or [], key=lambda x: x["start"]):
        if done >= total_drive_sec:
            break
        if st["start"] > t:
            seg = min(st["start"] - t, total_drive_sec - done)
            out.append((t, t + seg, done))
            done += seg
        t = max(t, st["end"])
    if done < total_drive_sec:
        out.append((t, t + total_drive_sec - done, done))
    return out


def _ban_window_utc(b):
    """(start_ts, end_ts) запрета в UTC по местному времени страны."""
    try:
        from zoneinfo import ZoneInfo
        tz = ZoneInfo(COUNTRY_TZ.get(b["cc"], "Europe/Berlin"))
    except Exception:
        tz = timezone(timedelta(hours=RIGA_UTC_OFFSET - 1))
    try:
        day = datetime.strptime(b["date"], "%Y-%m-%d")
    except Exception:
        return None

    def at(hm, base):
        hm = (hm or "00:00")[:5]
        h, m = int(hm[:2]), int(hm[3:5])
        return base + timedelta(hours=h, minutes=m)
    s = at(b.get("from"), day)
    e = at(b.get("until") or "24:00", day)
    if e <= s:
        e += timedelta(days=1)
    return s.replace(tzinfo=tz).timestamp(), e.replace(tzinfo=tz).timestamp()


def bans_cached():
    """Данные о запретах из кеша; если кеша нет/устарел — обновление в фоне (не ждём).
    v1.84: через общий замок — не качает фид одновременно с вкладкой "Запреты"."""
    import time
    now = time.time()
    with _bans_lock:
        data = _bans_cache["data"]
        stale = data is None or now - _bans_cache["at"] > BANS_TTL or bool((data or {}).get("missing"))
        blocked = now < _bans_cache["blocked_until"]
    if stale and not blocked and _bans_fetch_lock.acquire(blocking=False):
        def job():
            try:
                _bans_refresh()
            finally:
                _bans_fetch_lock.release()
        threading.Thread(target=job, daemon=True).start()
    return data


AT_NIGHT_FROM, AT_NIGHT_UNTIL = "22:00", "05:00"


BRAND_WMI = {"WMA": "MAN", "XLR": "DAF", "YV2": "VOLVO", "YB3": "VOLVO", "YV5": "VOLVO"}


def unit_brand(u):
    """Марка тягача из данных Mapon: make, затем название/метка, затем VIN (WMI). None — не знаем."""
    u = u or {}
    for k in ("make", "vehicle_make", "brand", "vehicle_title", "label"):
        t = str(u.get(k) or "").upper()
        for b in ("MAN", "DAF", "VOLVO"):
            if re.search(rf"\b{b}\b", t):
                return b
    vin = str(u.get("vin") or "").upper().strip()
    return BRAND_WMI.get(vin[:3]) if len(vin) >= 3 else None


def needs_at_night_ban(u):
    """Правило для всего парка (29.09.2026): все MAN без L-наклейки, DAF/Volvo — с ней."""
    return unit_brand(u) == "MAN" and not is_trailer(u)


def _at_night_bans(t0, horizon_sec):
    """Ночные окна 22:00–05:00 (Вена) на весь горизонт рейса — как запреты AT."""
    out = {}
    d0 = datetime.fromtimestamp(t0 - 86400, timezone.utc).date()
    for i in range(int(horizon_sec // 86400) + 3):
        b = {"cc": "AT", "date": (d0 + timedelta(days=i)).isoformat(), "from": AT_NIGHT_FROM,
             "until": AT_NIGHT_UNTIL, "type": "NightAT", "details": "ночной запрет для траков без L-наклейки"}
        w = _ban_window_utc(b)
        if w:
            out[(b["date"], "night")] = (b, w)
    return out


BANS_NEAR_SEC = 2 * 3600   # v3.12: «впритык» — выезд из страны меньше чем за 2 ч до начала её запрета


def bans_on_route(polyline, dist_km, stops=None, t0=None, at_night=False, detail=None):
    """Полные запреты (воскресные/праздничные/общие), под которые попадает вождение
    по маршруту. Возвращает (hits, status): hits = [{cc, date, from, until, type,
    enter_ts}], status = "ok" | "loading".
    v1.83: at_night=True (MAN / "если MAN") — плюс ночной запрет Австрии 22:00–05:00.
    v3.12: detail (dict) — заполняется: "countries" = [{cc, enter_ts, exit_ts}] по порядку,
    "near" = запреты, до начала которых трак успевает выехать из страны меньше чем за BANS_NEAR_SEC."""
    import time
    data = bans_cached()
    if data is None and not at_night:
        return [], "loading"
    status = "ok" if data is not None else "loading"
    data = data or {}
    t0 = float(t0 or time.time())
    v = TACHO_SPEED_KMH / 3600.0
    drive = _drive_intervals(t0, stops, float(dist_km or 0) / v)
    bans = {}
    for b in (data.get("now") or []) + [x for d in data.get("days") or [] for x in d["bans"]]:
        if not b.get("full"):
            continue
        w = _ban_window_utc(b)
        if w:
            bans.setdefault(b["cc"], {})[(b["date"], b.get("from"), b.get("until"))] = (b, w)
    if at_night:
        horizon = (drive[-1][1] - t0) if drive else 0
        bans.setdefault("AT", {}).update(_at_night_bans(t0, horizon))
    hits, near, countries = [], [], []
    for cc, km_a, km_b in route_countries(polyline, dist_km):
        sa, sb = km_a / v, km_b / v      # секунды вождения от старта до входа/выхода
        # время в стране, когда трак едет
        spans = []
        for ts, te, before in drive:
            x0, x1 = max(sa, before), min(sb, before + (te - ts))
            if x1 > x0:
                spans.append((ts + (x0 - before), ts + (x1 - before)))
        if not spans:
            continue
        enter, leave = spans[0][0], spans[-1][1]
        if cc:
            if countries and countries[-1]["cc"] == cc:
                countries[-1]["exit_ts"] = leave
            else:
                countries.append({"cc": cc, "enter_ts": enter, "exit_ts": leave})
        if cc not in bans:
            continue
        for b, (ws, we) in bans[cc].values():
            item = {"cc": cc, "date": b["date"], "from": b.get("from"), "until": b.get("until"),
                    "type": b.get("type"), "details": b.get("details"), "enter_ts": enter}
            if any(a < we and e > ws for a, e in spans):
                hits.append(item)
            elif leave <= ws < leave + BANS_NEAR_SEC:
                near.append(dict(item, exit_ts=leave, ban_ts=ws))
    hits.sort(key=lambda h: (h["date"], h["cc"]))
    if detail is not None:
        hit_keys = {(h["cc"], h["date"]) for h in hits}
        detail["countries"] = countries
        detail["near"] = [n for n in near if (n["cc"], n["date"]) not in hit_keys]
    return hits, status


def bans_near_text(near, loc):
    """v3.12: «FR: выезд ~03/10 21:40, запрет с 22:00 — впритык»."""
    out = []
    for n in near:
        out.append(f"{n['cc']}: выезд ~{loc(n['exit_ts'])}, запрет с {(n.get('from') or '')[:5] or loc(n['ban_ts'])} — впритык")
    return out


def countries_times_text(countries, loc):
    """v3.12: «FR 03/10 10:15–21:40 · BE 21:40–23:05» — когда трак едет по каждой стране."""
    parts = []
    for c in countries:
        a, b = loc(c["enter_ts"]), loc(c["exit_ts"])
        if a[:5] == b[:5]:
            b = b[6:]
        parts.append(f"{c['cc']} {a}–{b}")
    return " · ".join(parts)


def bans_hits_text(hits, loc, at_label="MAN без L"):
    TYPE_RU = {"Sunday": "воскр.", "Holiday": "праздн.", "General": "общий"}
    out = []
    for h in hits:
        if h.get("type") == "NightAT":   # v1.83
            out.append(f"AT ночь {h['date'][8:10]}/{h['date'][5:7]} 22–05 ({at_label}), въезд ~{loc(h['enter_ts'])}")
            continue
        d = datetime.strptime(h["date"], "%Y-%m-%d").strftime("%d/%m")
        out.append(f"{h['cc']} {d} {(h['from'] or '')[:5]}–{(h['until'] or '')[:5]} "
                   f"({TYPE_RU.get(h['type'], h['type'] or '')}), въезд ~{loc(h['enter_ts'])}")
    return out


def country_chain(polyline, dist_km, min_km=15):
    """Страны по маршруту по порядку, без коротких "мерцаний" у границы (< min_km)."""
    segs = [(cc, a, b) for cc, a, b in route_countries(polyline, dist_km) if cc]
    keep = [s for s in segs if s[2] - s[1] >= min_km] or segs
    out = []
    for cc, _, _ in keep:
        if not out or out[-1] != cc:
            out.append(cc)
    return out
