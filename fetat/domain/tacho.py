"""Тахограф (EU 561/2006 в упрощении проекта): простой ETA, тахо-ETA, недельный отдых, лимиты 56/90 ч.
Правила — CLAUDE.md → Предметные правила."""
from datetime import datetime, timedelta, timezone

from fetat.clients.mapon import ACT_DAYS, get_driver_rests
from fetat.config import WEST_EUROPE_OFFSET
from fetat.utils.timefmt import _hm, round_to_15min


def calc_eta(dist_km):
    duration_h = dist_km / 70
    now_utc = datetime.now(timezone.utc)
    eta_utc = now_utc + timedelta(hours=duration_h)
    eta_local = round_to_15min(eta_utc + timedelta(hours=WEST_EUROPE_OFFSET))
    return duration_h, eta_local


TACHO_SPEED_KMH = 70


REST_MARGIN_DAILY = 3600        # запас к каждому суточному отдыху (смена, осмотр, заправка) — 1 ч


REST_MARGIN_WEEKLY = 1800       # запас к недельному отдыху — 30 мин


BREAK_SEC = 2700                # перерыв 45 мин (одиночка), без запаса


CONT_DRIVE_SEC = 16200          # 4:30 непрерывного вождения


WEEKLY_MIN_SEC = 24 * 3600      # отдых от 24 ч — недельный (сокращённый)


WEEKLY_FULL_SEC = 45 * 3600     # от 45 ч — обычный недельный


WEEKLY_PERIOD_SEC = 144 * 3600  # следующий недельный — не позже 6×24 ч после конца прошлого


def weekly_status(driver_id, now_ts=None):
    """Недельный отдых водителя по истории:
    last — последний отдых от 24 ч (идёт сейчас или завершён), prev — предыдущий;
    deadline — начать следующий недельный не позже (конец last + 144 ч);
    need_sec — какой нужен следующий (после сокращённого — 45 ч, иначе 24 ч).
    Если недельный отдых идёт прямо сейчас — ongoing=True, can_go — когда он станет
    достаточным (начало + need текущего)."""
    import time
    now = float(now_ts or time.time())
    hist, err = get_driver_rests(driver_id)
    if not hist:
        return None, err
    weekly = [r for r in hist["rests"] if r["end"] - r["start"] >= WEEKLY_MIN_SEC
              and r["start"] > hist["from"] + 60]          # отдых, обрезанный началом окна, не берём
    last_rest = hist["rests"][-1] if hist["rests"] else None
    ongoing_rest = last_rest if last_rest and now - last_rest["end"] < 1800 else None
    res = {"weekly": [{"start": r["start"], "end": r["end"], "hours": round((r["end"] - r["start"]) / 3600, 1),
                       "full": r["end"] - r["start"] >= WEEKLY_FULL_SEC, "src": r["src"]} for r in weekly][-4:],
           "ongoing": False, "resting_sec": 0}
    if ongoing_rest:
        res["resting_sec"] = int(now - ongoing_rest["start"])
    if not weekly:
        res["error"] = f"за {ACT_DAYS} дн. нет отдыха от 24 ч"
        return res, None
    last = weekly[-1]
    prev = weekly[-2] if len(weekly) >= 2 else None
    ongoing = ongoing_rest is last
    # какой недельный нужен "этот" (для идущего) и следующий
    prev_reduced = prev is not None and prev["end"] - prev["start"] < WEEKLY_FULL_SEC
    if ongoing:
        need_now = WEEKLY_FULL_SEC if prev_reduced else WEEKLY_MIN_SEC
        can_go = last["start"] + need_now
        # если отдых дойдёт до 45 ч — следующий может быть сокращённым; считаем по минимуму
        end_est = max(now, can_go)
        full_now = end_est - last["start"] >= WEEKLY_FULL_SEC
        res.update(ongoing=True, can_go=can_go, need_now=need_now,
                   deadline=end_est + WEEKLY_PERIOD_SEC,
                   need_sec=WEEKLY_MIN_SEC if full_now else WEEKLY_FULL_SEC)
    else:
        last_reduced = last["end"] - last["start"] < WEEKLY_FULL_SEC
        res.update(deadline=last["end"] + WEEKLY_PERIOD_SEC,
                   need_sec=WEEKLY_FULL_SEC if last_reduced else WEEKLY_MIN_SEC)
    return res, None


def weekly_for_tacho(tacho):
    """Недельный отдых экипажа: самый ранний срок и самый длинный нужный отдых из водителей."""
    best = None
    for d in tacho.get("drivers") or []:
        did = d.get("driver_id")
        if not did:
            continue
        w, _ = weekly_status(did)
        if not w or not w.get("deadline"):
            continue
        if best is None or w["deadline"] < best["deadline"]:
            best = dict(w)
        best["need_sec"] = max(best["need_sec"], w["need_sec"])
    return best


TEAM_DAY_SEC = 18 * 3600         # v1.47: экипаж — 18 ч вождения в сутки (20 — крайне редко, не считаем)


WEEK_MAX_SEC = 56 * 3600         # вождение за календарную неделю (пн 00:00 – вс 24:00 UTC)


FORTNIGHT_MAX_SEC = 90 * 3600    # за две соседние недели


def _next_monday_utc(ts):
    """Ближайший понедельник 00:00 UTC после ts (граница недели тахографа)."""
    d = datetime.fromtimestamp(ts, timezone.utc)
    mon = (d - timedelta(days=d.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    return (mon + timedelta(days=7)).timestamp()


def tacho_eta(tacho, dist_km, now_ts=None, weekly=None):
    """Симуляция рейса по данным тахографа (v1.46: только суточные нормы + недельный
    лимит вождения для одиночки; недельные отдыхи 24/45 НЕ учитываются — их решает диспетчер).
    Одиночка: 4:30 -> перерыв 45 мин; дневной лимит / окно смены -> суточный отдых
    (9 ч пока есть сокращения, иначе 11 ч) + 1 ч запаса; день 10 ч пока есть продления.
    Если уже стоит дольше суточного отдыха — может ехать сразу.
    Недельный лимит (одиночка): остаток недели из Mapon (правило 90 ч в нём учтено);
    кончился — стоп до пн 00:00 UTC; новая неделя = min(56, 90 − наезжено за прошлую).
    Экипаж: без перерывов, день = сумма остатков обоих (в пределах окна смены),
    суточный отдых 9 ч + 1 ч; недельный лимит не учитывается.
    Возвращает dict: eta_ts, stops [{kind, start, end}], team, first_limit_sec, week."""
    import time
    t = float(now_ts or time.time())
    v = TACHO_SPEED_KMH / 3600.0
    km_left = max(0.0, float(dist_km or 0))
    drivers = tacho["drivers"]
    team = len(drivers) >= 2
    d0 = next((d for d in drivers if d.get("current_state") == "DRIVING"), drivers[0])
    today = d0.get("today", {}) or {}
    week = d0.get("week", {}) or {}
    nowd = d0.get("now", {}) or {}

    ext_left = int(week.get("10h_driving_extensions_remaining") or 0)
    short_left = int(week.get("9h_rest_shortening_remaining") or 0)
    shift_end = t + float(today.get("shift_remaining") or 0)
    stops = []
    inf = float("inf")

    # недельный лимит — только одиночка
    if team:
        week_left = inf
        next_week_avail = inf
    else:
        week_left = float(week.get("driving_remaining") if week.get("driving_remaining") is not None else WEEK_MAX_SEC)
        nfw = week.get("next_fixed_week_driving_remaining")
        # нет данных Mapon — считаем, что на этой неделе уже наезжено (56 − остаток)
        next_week_avail = float(nfw) if nfw is not None else FORTNIGHT_MAX_SEC - (WEEK_MAX_SEC - week_left)
    week_end = _next_monday_utc(t)
    driven_this_week = 0.0          # сколько симуляция проехала в текущей неделе
    first_rollover = True
    week_info = {"left": None if team else week_left, "need": km_left / v, "next": None, "hit": False}

    def rollover():
        nonlocal week_left, week_end, driven_this_week, first_rollover, ext_left
        if not team:
            if first_rollover:
                avail = min(WEEK_MAX_SEC, next_week_avail - driven_this_week)
                week_info["next"] = max(0.0, avail)
            else:
                avail = min(WEEK_MAX_SEC, FORTNIGHT_MAX_SEC - driven_this_week)
            week_left = max(0.0, avail)
        first_rollover = False
        driven_this_week = 0.0
        week_end += 7 * 86400
        ext_left = 2

    def new_day():
        nonlocal day_left, shift_end, until_break, ext_left
        per_driver = 10 * 3600 if ext_left > 0 else 9 * 3600
        if not team and ext_left > 0:
            ext_left -= 1
        if team:
            day_left = TEAM_DAY_SEC           # v1.47: экипаж — всегда 18 ч вождения в сутки
            shift_end = t + 21 * 3600
            until_break = inf
        else:
            day_left = per_driver
            shift_end = t + (15 if short_left > 0 else 13) * 3600
            until_break = CONT_DRIVE_SEC

    if team:
        day_left = min(TEAM_DAY_SEC, sum(float((d.get("today") or {}).get("driving_remaining") or 0) for d in drivers))
        until_break = inf
    else:
        day_left = float(today.get("driving_remaining") or 0)
        cont = float(nowd.get("driving") or 0)
        until_break = max(0.0, CONT_DRIVE_SEC - cont)

    rest_now = float(nowd.get("rest") or 0) if d0.get("current_state") == "REST" else 0.0
    need_rest = 9 * 3600 if (team or short_left > 0) else 11 * 3600
    if rest_now >= need_rest:
        # v1.46: стоит дольше суточного отдыха (ожидание погрузки/выгрузки) — едет сразу
        new_day()
    elif not team and d0.get("current_state") == "REST" and 0 < rest_now < BREAK_SEC:
        # идёт перерыв 45 мин — дождаться конца
        stops.append({"kind": "break", "start": t, "end": t + BREAK_SEC - rest_now})
        t += BREAK_SEC - rest_now
        until_break = CONT_DRIVE_SEC
    elif not team and rest_now >= BREAK_SEC:
        until_break = CONT_DRIVE_SEC    # перерыв уже отбыт
    if rest_now >= 3 * 3600 and rest_now < need_rest and day_left < 3600:
        # на суточном отдыхе, дня не осталось — добыть отдых до нормы
        end = t + (need_rest - rest_now) + REST_MARGIN_DAILY
        stops.append({"kind": "daily", "start": t, "end": end})
        if need_rest == 9 * 3600 and not team:
            short_left -= 1
        t = end
        new_day()
    while t >= week_end:
        rollover()

    first_rest = True
    first_limit = None
    for _ in range(600):
        if km_left <= 1e-6:
            break
        seg_limits = {
            "km": km_left / v,
            "day": max(0.0, day_left),
            "shift": max(0.0, shift_end - t),
            "week": max(0.0, week_left),
            "break": until_break,
            "wk_boundary": max(0.0, week_end - t),
        }
        kind = min(seg_limits, key=seg_limits.get)
        seg = seg_limits[kind]
        if first_limit is None and kind not in ("km", "wk_boundary"):
            first_limit = seg
        t += seg
        km_left -= seg * v
        day_left -= seg
        week_left -= seg
        until_break -= seg
        driven_this_week += seg
        if kind == "km":
            break
        if kind == "wk_boundary":
            rollover()
            continue
        if kind == "break":
            stops.append({"kind": "break", "start": t, "end": t + BREAK_SEC})
            t += BREAK_SEC
            until_break = CONT_DRIVE_SEC
        elif kind == "week":
            # недельный лимит вождения исчерпан — стоим до пн 00:00 UTC
            week_info["hit"] = True
            stops.append({"kind": "weeklimit", "start": t, "end": week_end})
            t = week_end
            rollover()
            new_day()
        else:  # дневной лимит или окно смены -> суточный отдых
            if team:
                rest = 9 * 3600
            elif first_rest:
                rest = float(today.get("daily_rest_min") or 11 * 3600)
                if rest <= 9 * 3600 and short_left > 0:
                    short_left -= 1
            elif short_left > 0:
                rest = 9 * 3600
                short_left -= 1
            else:
                rest = 11 * 3600
            first_rest = False
            stops.append({"kind": "daily", "start": t, "end": t + rest + REST_MARGIN_DAILY})
            t += rest + REST_MARGIN_DAILY
            new_day()
        while t >= week_end:
            rollover()
    return {"eta_ts": t, "stops": stops, "team": team, "first_limit_sec": first_limit, "week": week_info}


def tacho_summary(tacho, sim=None, weekly=None):
    """Короткие строки для подсказки: "сегодня осталось 3:24", "отдых 26/09 01:15–11:15",
    недельный лимит вождения (одиночка)."""
    d0 = next((d for d in tacho["drivers"] if d.get("current_state") == "DRIVING"), tacho["drivers"][0])
    nowd, today = d0.get("now", {}) or {}, d0.get("today", {}) or {}
    loc = lambda ts: (datetime.fromtimestamp(ts, timezone.utc) + timedelta(hours=WEST_EUROPE_OFFSET)).strftime("%d/%m %H:%M")
    parts = []
    state = {"DRIVING": "едет", "REST": "отдыхает", "AVAILABLE": "готовность", "WORK": "работа"}.get(d0.get("current_state"), d0.get("current_state") or "")
    team = len(tacho["drivers"]) >= 2
    if team:
        parts.append("экипаж")
    if state:
        rest_now = float(nowd.get("rest") or 0)
        parts.append(state + (f" {_hm(rest_now)}" if d0.get("current_state") == "REST" and rest_now >= 3600 else ""))
    if d0.get("current_state") == "DRIVING" and nowd.get("driving_remaining") is not None:
        parts.append(f"до остановки {_hm(nowd.get('driving_remaining'))}")
    rest_now = float(nowd.get("rest") or 0) if d0.get("current_state") == "REST" else 0.0
    short_left = int((d0.get("week") or {}).get("9h_rest_shortening_remaining") or 0)
    if rest_now >= (9 * 3600 if (team or short_left > 0) else 11 * 3600):
        parts.append("суточный отдых выполнен — может ехать")
    else:
        parts.append(f"сегодня осталось {_hm(today.get('driving_remaining'))}")
    if sim and not team and sim.get("week"):
        w = sim["week"]
        if w.get("left") is not None:
            ok = w["left"] >= w["need"]
            parts.append(f"неделя: осталось {_hm(w['left'])}, нужно {_hm(w['need'])}"
                         + (" — хватает" if ok else f" — не хватает {_hm(w['need'] - w['left'])}"))
        if w.get("next") is not None:
            parts.append(f"с пн доступно {_hm(w['next'])} (правило 90 ч)")
    if sim:
        for st in [x for x in sim["stops"] if x["kind"] in ("daily", "weeklimit")][:3]:
            s_txt, e_txt = loc(st["start"]), loc(st["end"])
            same_day = s_txt[:5] == e_txt[:5]
            span = f"{s_txt}–{e_txt[-5:] if same_day else e_txt}"
            parts.append(f"отдых {span}" if st["kind"] == "daily" else f"стоп {span}: исчерпан лимит недели")
    return [p for p in parts if p]


FRESH_SOLO_TACHO = {"drivers": [{
    "current_state": "REST", "now": {"rest": 11 * 3600, "driving": 0},
    "today": {"driving_remaining": 9 * 3600, "shift_remaining": 13 * 3600, "daily_rest_min": 11 * 3600},
    "week": {"driving_remaining": 56 * 3600, "10h_driving_extensions_remaining": 2,
             "9h_rest_shortening_remaining": 3, "weekly_rest_min": 45 * 3600}}]}
