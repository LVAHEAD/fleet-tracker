"""Тахограф (EU 561/2006 в упрощении проекта): простой ETA, тахо-ETA, недельный отдых, лимиты 56/90 ч.
Правила — CLAUDE.md → Предметные правила."""
from datetime import datetime, timedelta, timezone

from fetat.clients.mapon import ACT_DAYS, get_driver_rests
from fetat.utils.timefmt import _hm, ceil_15min, ts_west, ts_zone, to_west


def calc_eta(dist_km):
    duration_h = dist_km / 70
    now_utc = datetime.now(timezone.utc)
    eta_utc = now_utc + timedelta(hours=duration_h)
    eta_local = ceil_15min(to_west(eta_utc))   # v3.39: вверх до 15 мин
    return duration_h, eta_local


TACHO_SPEED_KMH = 70


REST_MARGIN_DAILY = 0           # v3.39: отдых — чистые 9 / 11 ч (было +1 ч запаса)


REST_MARGIN_WEEKLY = 0          # v3.39: без запаса (было +30 мин)


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


TEAM_HIST_DAY_SEC = 10.5 * 3600  # v3.15: трак ехал дольше этого за сутки — значит экипаж


CREW_MEMORY_SEC = 14 * 24 * 3600   # v3.105: «видели экипаж по двум картам» помним 14 суток (пока тот же трак)


def crew_mode(tacho, override=None, drive_days=None, seen_ts=None, now=None):
    """v3.15: соло или экипаж. Возвращает (team, src, hist_max_sec).
    override "solo"/"team" — ручная правка диспетчера; иначе карта во втором слоте тахографа
    (два водителя — экипаж); если карта одна — история трака за неделю (сутки с ездой
    дольше TEAM_HIST_DAY_SEC — экипаж: второй водитель мог вынуть карту на стоянке);
    v3.105: иначе память строки — seen_ts (сек), когда по тахографу видели две карты: не старше CREW_MEMORY_SEC —
    экипаж ("memory"), вторая карта могла пропасть из Mapon (OI-3194: два дня 👥, потом «соло»)."""
    hist_max = max((drive_days or {}).values(), default=0.0)
    if override in ("solo", "team"):
        return override == "team", "manual", hist_max
    if len((tacho or {}).get("drivers") or []) >= 2:
        return True, "tacho", hist_max
    if hist_max > TEAM_HIST_DAY_SEC:
        return True, "hist", hist_max
    if seen_ts:
        import time
        t = float(now or time.time())
        if 0 <= t - float(seen_ts) <= CREW_MEMORY_SEC:
            return True, "memory", hist_max
    return False, "tacho", hist_max


GPS_REST_SEC = 9 * 3600      # v3.104: стоянка по GPS от 9 ч — суточный отдых, её конец — начало смены


GPS_TINY_M = 500             # короткий проезд (до 500 м и 15 мин — манёвр) стоянку не прерывает


GPS_FERRY_SEC = 30 * 60      # длинный (от 30 мин) и медленный проезд — паром: не вождение, для смены — отдых


GPS_FERRY_KMH = 45


GPS_STAND_REST_SEC = 3 * 3600   # v3.125: идущая стоянка по GPS от 3 ч (решение Владимира 15.10) — суточный отдых уже идёт (тахограф отстаёт)
GPS_STAND_FRESH_SEC = 2400      # конец стоянки в истории не старше 40 мин (кеш истории обновляется раз в 30 мин)


GPS_BLIND_SEC = 3600         # тахограф отстаёт от GPS больше чем на час — верим GPS


def gps_shift(segs, now_ts):
    """v3.104: смена по GPS-истории Mapon (route/list за ~48 ч). segs — [{k: route | stop, s, e, m (метры)}].
    Начало смены — конец последней стоянки от GPS_REST_SEC (манёвры и паромы стоянку не прерывают); driven —
    время в движении после неё (паром не считается). Такой стоянки в окне нет — None (смену не знаем).
    Возвращает {"start": ts, "driven": сек} или None."""
    now = float(now_ts)
    stat, drive, cur = [], [], None
    for g in sorted(segs or [], key=lambda x: x["s"]):
        s, e = float(g["s"]), min(float(g["e"]), now)
        if e <= s:
            continue
        dur, m = e - s, float(g.get("m") or 0)
        still = (g["k"] == "stop" or (m < GPS_TINY_M and dur < 900)
                 or (dur >= GPS_FERRY_SEC and m > 0 and (m / dur) * 3.6 < GPS_FERRY_KMH))   # дистанции нет (идущая поездка) — не паром
        if still:
            if cur is not None and s - cur[1] <= 300:
                cur[1] = max(cur[1], e)
            else:
                cur = [s, e]
                stat.append(cur)
        else:
            cur = None
            drive.append((s, e))
    rests = [x for x in stat if x[1] - x[0] >= GPS_REST_SEC]
    last = stat[-1] if stat else None
    stand = (now - last[0]) if (last and now - last[1] <= GPS_STAND_FRESH_SEC and not (drive and drive[-1][1] > last[1])) else 0.0
    if not rests:
        return {"start": None, "driven": 0.0, "stand": stand} if stand >= GPS_STAND_REST_SEC else None
    start = rests[-1][1]
    return {"start": start, "driven": sum(e - max(s, start) for s, e in drive if e > start), "stand": stand}


def gps_adjust(tacho, day_left, day_max):
    """v3.104: остаток дня по тахографу против GPS-смены (tacho["gps"] из gps_shift). Если у Mapon нет вождения
    (карты не считаны, ddd не скачан — счётчики «чистые»), а по GPS в смене езды больше на GPS_BLIND_SEC, остаток —
    day_max минус вождение по GPS. Возвращает (day_left, fix | None); fix {start, driven, tacho} — поправка применена."""
    g = (tacho or {}).get("gps")
    if not g or g.get("start") is None or day_left is None:
        return day_left, None
    implied = max(0.0, day_max - float(day_left))
    if float(g["driven"]) - implied <= GPS_BLIND_SEC:
        return day_left, None
    return max(0.0, day_max - float(g["driven"])), dict(g, tacho=implied)


def gps_rest_now(tacho, d0, rest_now):
    """v3.125: сколько машина уже отдыхает. Тахограф Mapon отстаёт (карты не считаны, состояние не REST) — а по GPS
    она стоит от GPS_STAND_REST_SEC: считаем, что суточный отдых идёт с начала этой стоянки. Едет по тахографу — без поправки."""
    g = (tacho or {}).get("gps")
    stand = float(g.get("stand") or 0) if g else 0.0
    if stand >= GPS_STAND_REST_SEC and stand > rest_now and d0.get("current_state") != "DRIVING":
        return stand
    return rest_now


def _team(tacho):
    """Экипаж: решение crew_mode (поле "team"), без него — по числу карт в тахографе."""
    if "team" in tacho:
        return bool(tacho["team"])
    return len(tacho["drivers"]) >= 2


def week_left_info(tacho):
    """v3.15: остаток вождения на неделю для одиночки (секунды) и какой лимит режет.
    Mapon отдаёт остаток недели уже с учётом правила 90 ч за две недели."""
    d0 = next((d for d in tacho["drivers"] if d.get("current_state") == "DRIVING"), tacho["drivers"][0])
    week = d0.get("week") or {}
    left = week.get("driving_remaining")
    if left is None:
        return None
    left = max(0.0, float(left))
    out = {"left": left, "limit": "56 ч"}
    driven = week.get("driving")
    if driven is not None:
        out["driven"] = float(driven)
        if left < WEEK_MAX_SEC - float(driven) - 60:
            out["limit"] = "90 ч за 2 недели"
    nfw = week.get("next_fixed_week_driving_remaining")
    if nfw is not None:
        out["next"] = float(nfw)
    return out


def _next_monday_utc(ts):
    """Ближайший понедельник 00:00 UTC после ts (граница недели тахографа)."""
    d = datetime.fromtimestamp(ts, timezone.utc)
    mon = (d - timedelta(days=d.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    return (mon + timedelta(days=7)).timestamp()


# ---------- v3.39: один движок ETA — Флот, From → To и ⏱ калькулятор (правила — BACKLOG / CLAUDE.md) ----------
SOLO_DAY_SEC = 9 * 3600           # соло — 9 ч; 10-й час — вручную (ext_days)
EXT_SEC = 3600
BREAK_AFTER_SEC = 4.5 * 3600
SHIFT_SOLO_SEC = 15 * 3600        # окно смены соло
SHIFT_NIGHT_SEC = 11 * 3600       # смена хоть частично в 00:00–04:00 — 11 ч (9 вождения + 2 остальное)
SHIFT_TEAM_SEC = 21 * 3600
NIGHT_END_HOUR = 4
TZ_DEFAULT = ("Europe/Berlin", 1)
# страна, где машина -> пояс (ночь по местному времени)
COUNTRY_TZ = {
    "PT": ("Europe/Lisbon", 0), "IE": ("Europe/Dublin", 0), "GB": ("Europe/London", 0), "UK": ("Europe/London", 0),
    "LV": ("Europe/Riga", 2), "LT": ("Europe/Vilnius", 2), "EE": ("Europe/Tallinn", 2), "FI": ("Europe/Helsinki", 2),
    "RO": ("Europe/Bucharest", 2), "BG": ("Europe/Sofia", 2), "GR": ("Europe/Athens", 2), "UA": ("Europe/Kyiv", 2),
    "MD": ("Europe/Chisinau", 2), "TR": ("Europe/Istanbul", 3),
}


def country_tz(cc):
    return COUNTRY_TZ.get(str(cc or "").upper()[:2], TZ_DEFAULT)


def shift_window_end(start_ts, team=False, tz=TZ_DEFAULT):
    """Конец окна смены, начатой в start_ts. Экипаж — 21 ч. Соло: открыта 00:00–04:00 — 11 ч; после 04:00 — до 15 ч,
    но не дальше 00:00, а если ночь не обойти — 11 ч от начала (что больше)."""
    if team:
        return start_ts + SHIFT_TEAM_SEC
    loc = ts_zone(start_ts, tz[0], tz[1])
    if loc.hour < NIGHT_END_HOUR:
        return start_ts + SHIFT_NIGHT_SEC
    to_midnight = (24 * 3600) - (loc.hour * 3600 + loc.minute * 60 + loc.second)
    return start_ts + max(SHIFT_NIGHT_SEC, min(SHIFT_SOLO_SEC, to_midnight))


def plan(start_ts, dist_km, team=False, day_left=None, since_drive=0.0, rest_pref=9, shorts=3, first_rest=None,
         ext_days=(), extras=None, shifts=None, week_left=None, shift_start=None, tz=TZ_DEFAULT):
    """Расклад рейса с start_ts (сек). Скорость 70 км/ч. Соло: 9 ч в день (+1 ч в днях ext_days), 4:30 → перерыв
    45 мин, отдых 9 ч (rest_pref 9 и остались сокращения shorts) или 11 ч, первый — first_rest, если задан; экипаж:
    18 ч, отдых 9 ч. Отдых — чистый, без запаса. Окно смены — shift_window_end (день 0 — от shift_start).
    extras {№ отдыха: +сек} — отдых длиннее (от 24 ч — недельный: неделя и сокращения заново); shifts {№ отдыха: сек}
    — встать на отдых раньше (вождения в этот день меньше). Неделя (week_left, соло) — только отметка wk.
    Возвращает {ev: [{k: d|b|r, t0, t1 (сек), km0, km1, i, short, extra, shift}], eta_ts, wk: {ts, km} | None}."""
    v = TACHO_SPEED_KMH / 3600.0
    extras, shifts, ext = extras or {}, shifts or {}, set(ext_days or ())
    eps = 1e-6

    def m(i):
        return TEAM_DAY_SEC if team else SOLO_DAY_SEC + (EXT_SEC if i in ext else 0)

    cut = {}

    def allow(base, i):
        cut[i] = min(float(shifts.get(i, 0) or 0), base)
        return base - cut[i]

    t = float(start_ts)
    km_left, km_done = max(0.0, float(dist_km or 0)), 0.0
    since = 0.0 if team else float(since_drive or 0)
    sl = int(shorts or 0)
    d0 = m(0) if day_left is None else min(float(day_left), m(0))
    day = allow(max(0.0, d0), 0)
    win_end = shift_window_end(float(shift_start if shift_start is not None else t), team, tz)
    monday = _next_monday_utc(t)
    week_cap = None if (team or week_left is None) else max(0.0, float(week_left))
    week_driven, wk = 0.0, None
    if week_cap is not None and week_cap <= 0:
        wk = {"ts": t, "km": 0.0}
    ev = []
    n_rest = 0
    for _ in range(2000):
        if km_left <= 0.01:
            break
        win = win_end - t
        can = day if team else min(day, BREAK_AFTER_SEC - since)
        can = min(can, win)
        if can <= eps:
            if not team and since >= BREAK_AFTER_SEC - eps and day > eps and win > BREAK_SEC + eps:
                ev.append({"k": "b", "t0": t, "t1": t + BREAK_SEC, "km0": km_done, "km1": km_done})
                t += BREAK_SEC
                since = 0.0
                continue
            i = n_rest
            if team:
                base = 9 * 3600
            elif i == 0 and first_rest:
                base = float(first_rest)
            else:
                base = 9 * 3600 if (rest_pref == 9 and sl > 0) else 11 * 3600
            add = float(extras.get(i, 0) or 0)
            ln = base + add
            short = (not team) and ln < 11 * 3600 and sl > 0
            if short:
                sl -= 1
            ev.append({"k": "r", "t0": t, "t1": t + ln, "km0": km_done, "km1": km_done, "i": i, "short": short,
                       "extra": add, "shift": cut.get(i, 0.0)})
            t += ln
            n_rest += 1
            since = 0.0
            day = allow(m(n_rest), n_rest)
            win_end = shift_window_end(t, team, tz)
            if ln >= WEEKLY_MIN_SEC:                 # недельный — неделя и сокращения заново
                sl = 3
                if wk is None and week_cap is not None:
                    week_driven, week_cap, monday = 0.0, WEEK_MAX_SEC, _next_monday_utc(t)
            continue
        d = min(can, km_left / v)
        if wk is None and week_cap is not None:
            room = week_cap - week_driven
            if d >= room - 1e-9 and t + room < monday:
                wk = {"ts": t + room, "km": km_done + room * v}
        last = ev[-1] if ev else None
        if last and last["k"] == "d":
            last["t1"] += d
            last["km1"] += d * v
        else:
            ev.append({"k": "d", "t0": t, "t1": t + d, "km0": km_done, "km1": km_done + d * v})
        if t < monday:
            week_driven += min(d, max(0.0, monday - t))
        t += d
        km_left -= d * v
        km_done += d * v
        day -= d
        since += d
    return {"ev": ev, "eta_ts": t, "wk": wk}


GPS_START_MAX_SEC = 24 * 3600   # v3.106: начало смены по GPS старше суток — не верим (стоянку не распознали)


def _shift_start(tacho, d0, team, short_left, t):
    """v3.106: когда началась текущая смена (ts). Соло — по shift_remaining Mapon (13/15 ч). Экипаж — окно 21 ч:
    при двух картах по shift_remaining тахографа (самый ранний конец окна), и/или по GPS-стоянке ≥ 9 ч
    (tacho["gps"]); нет ни того ни другого — от сейчас."""
    if not team:
        sr = ((d0.get("today") or {}).get("shift_remaining"))
        if sr is None:
            return t
        return t - max(0.0, (SHIFT_SOLO_SEC if short_left > 0 else 13 * 3600) - float(sr))
    cands = []
    drivers = tacho.get("drivers") or []
    if len(drivers) >= 2:
        srs = [float((d.get("today") or {}).get("shift_remaining")) for d in drivers
               if (d.get("today") or {}).get("shift_remaining") is not None]
        if srs:
            cands.append(t - max(0.0, SHIFT_TEAM_SEC - min(srs)))
    g = tacho.get("gps")
    if g and g.get("start") is not None and 0 <= t - float(g["start"]) <= GPS_START_MAX_SEC:
        cands.append(float(g["start"]))
    return min(cands) if cands else t


def tacho_eta(tacho, dist_km, now_ts=None, weekly=None, no_week=False, ext_days=(), tz=TZ_DEFAULT):
    """Тахо-ETA машины по данным Mapon (v3.39 — через plan, правила калькулятора). Старт: стоит дольше нормы
    отдыха — свежий день; идёт перерыв 45 мин — дождаться конца; на суточном отдыхе и дня не осталось — добыть
    отдых до нормы (чисто) и свежий день; иначе — остаток дня из Mapon, окно смены — от её начала по Mapon.
    Неделя кончилась — только отметка (week.hit), ETA не сдвигаем. Возвращает eta_ts, stops [{kind, start, end}],
    team, first_limit_sec, week {left, need, next, hit}."""
    import time
    t = float(now_ts or time.time())
    ext_days = ext_days or tacho.get("ext") or ()       # v3.39: 10-й час — отметка у строки Флота
    tz = tacho.get("tz") or tz                          # пояс страны, где машина (ночная смена)
    drivers = tacho["drivers"]
    team = _team(tacho)
    d0 = next((d for d in drivers if d.get("current_state") == "DRIVING"), drivers[0])
    today, week, nowd = d0.get("today", {}) or {}, d0.get("week", {}) or {}, d0.get("now", {}) or {}
    short_left = int(week.get("9h_rest_shortening_remaining") or 0)
    pre = []
    if team:
        day_left = min(TEAM_DAY_SEC, sum(float((d.get("today") or {}).get("driving_remaining") or 0) for d in drivers)
                       + (9 * 3600 if len(drivers) < 2 else 0))   # v3.15: карта второго не вставлена — свежий
        since = 0.0
    else:
        day_left = float(today.get("driving_remaining") or 0)
        since = float(nowd.get("driving") or 0)
    day_left, gfix = gps_adjust(tacho, day_left, TEAM_DAY_SEC if team else SOLO_DAY_SEC)   # v3.104
    shift_start = _shift_start(tacho, d0, team, short_left, t)   # v3.106: и для экипажа
    if gfix:
        shift_start = min(shift_start, gfix["start"])   # v3.104: окно смены — от начала по GPS
    first_rest = None if team else (float(today.get("daily_rest_min")) if today.get("daily_rest_min") else None)
    resting = d0.get("current_state") == "REST"
    rest_now = float(nowd.get("rest") or 0) if resting else 0.0
    rest_gps = gps_rest_now(tacho, d0, rest_now)     # v3.125: стоит по GPS, а тахограф отстаёт
    gstand, rest_now = rest_gps > rest_now, rest_gps
    need_rest = 9 * 3600 if (team or short_left > 0) else 11 * 3600
    fresh = False
    if rest_now >= need_rest:
        fresh = True                                   # стоит дольше суточного отдыха — едет сразу
    elif not team and resting and 0 < rest_now < BREAK_SEC:
        pre.append({"kind": "break", "start": t, "end": t + BREAK_SEC - rest_now})
        t += BREAK_SEC - rest_now
        since = 0.0
    elif not team and rest_now >= BREAK_SEC:
        since = 0.0                                    # перерыв уже отбыт
    if not fresh and rest_now >= 3 * 3600 and (day_left < 3600 or gstand):
        end = t + (need_rest - rest_now)               # добыть отдых до нормы — чисто
        pre.append({"kind": "daily", "start": t, "end": end})
        if need_rest == 9 * 3600 and not team:
            short_left -= 1
        t = end
        fresh = True
    if fresh:
        day_left, since, shift_start, first_rest, gfix = None, 0.0, t, None, None
    elif not team and 0 in set(ext_days or ()):
        day_left = day_left + EXT_SEC                 # 10-й час сегодня — к остатку из Mapon +1 ч
    week_left = None
    if not team and not no_week:
        week_left = float(week.get("driving_remaining") if week.get("driving_remaining") is not None else WEEK_MAX_SEC)
    p = plan(t, dist_km, team=team, day_left=day_left, since_drive=since, rest_pref=9, shorts=short_left,
             first_rest=first_rest, ext_days=ext_days, week_left=week_left, shift_start=shift_start, tz=tz)
    stops = pre + [{"kind": "break" if e["k"] == "b" else "daily", "start": e["t0"], "end": e["t1"]}
                   for e in p["ev"] if e["k"] != "d"]
    first_stop = next((s for s in stops), None)
    first_limit = (first_stop["start"] - float(now_ts or t)) if first_stop else None
    week_info = {"left": week_left, "need": max(0.0, float(dist_km or 0)) / (TACHO_SPEED_KMH / 3600.0),
                 "next": None, "hit": p["wk"] is not None}
    return {"eta_ts": p["eta_ts"], "stops": stops, "team": team, "first_limit_sec": first_limit, "week": week_info,
            "wk": p["wk"], "gps_fix": gfix}


def tacho_summary(tacho, sim=None, weekly=None):
    """Короткие строки для подсказки: "сегодня осталось 3:24", "отдых 26/09 01:15–11:15",
    недельный лимит вождения (одиночка)."""
    d0 = next((d for d in tacho["drivers"] if d.get("current_state") == "DRIVING"), tacho["drivers"][0])
    nowd, today = d0.get("now", {}) or {}, d0.get("today", {}) or {}
    loc = lambda ts: ts_west(ts).strftime("%d/%m %H:%M")
    parts = []
    state = {"DRIVING": "едет", "REST": "отдыхает", "AVAILABLE": "готовность", "WORK": "работа"}.get(d0.get("current_state"), d0.get("current_state") or "")
    team = _team(tacho)
    if team:
        parts.append({"manual": "экипаж (вручную)", "hist": "экипаж (по истории: ехал > 10 ч за сутки)",
                      "memory": "экипаж (из памяти: две карты видели раньше, сейчас одна)"}
                     .get(tacho.get("crew_src"), "экипаж"))
    if state:
        rest_now = float(nowd.get("rest") or 0)
        parts.append(state + (f" {_hm(rest_now)}" if d0.get("current_state") == "REST" and rest_now >= 3600 else ""))
    if d0.get("current_state") == "DRIVING" and nowd.get("driving_remaining") is not None:
        parts.append(f"до остановки {_hm(nowd.get('driving_remaining'))}")
    rest_now = float(nowd.get("rest") or 0) if d0.get("current_state") == "REST" else 0.0
    short_left = int((d0.get("week") or {}).get("9h_rest_shortening_remaining") or 0)
    gf = sim.get("gps_fix") if sim else None
    if rest_now >= (9 * 3600 if (team or short_left > 0) else 11 * 3600):
        parts.append("суточный отдых выполнен — может ехать")
    elif gf:        # v3.104: тахограф отстаёт от GPS — остаток по GPS
        day_max = TEAM_DAY_SEC if team else SOLO_DAY_SEC
        parts.append(f"сегодня осталось {_hm(max(0.0, day_max - gf['driven']))} (по GPS)")
        parts.append(f"⚠ тахограф отстаёт от GPS: в смене с {loc(gf['start'])} по GPS {_hm(gf['driven'])} вождения, "
                     f"по тахографу {_hm(gf['tacho'])} — считаем по GPS")
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


def tacho_no_subscription(err):
    """v3.30: Mapon 1015 «Endpoint needs Tachograph remote download subscription» — у юнита не подключено
    удалённое считывание тахографа: данных не будет, пока не подключат (не временный сбой)."""
    e = str(err or "")
    return "1015" in e or "remote download subscription" in e.lower()


def calc_seed(tacho, now_ts=None):
    """v3.31: стартовые данные машины для ⏱ ETA-калькулятора (клик по строке Флота): экипаж / соло, остаток
    вождения на момент выезда, через сколько выезд (стоит на суточном отдыхе — до конца отдыха, чистого,
    без запаса: запас в калькуляторе диспетчер добавляет сам), оставшиеся 9-ки и недельный остаток (соло).
    Начало — то же, что у tacho_eta: стоит дольше нормы отдыха — свежий день; на отдыхе и дня не осталось —
    выезд после отдыха со свежим днём; иначе — сколько осталось сегодня. Часы, с точностью до 15 мин."""
    drivers = tacho["drivers"]
    team = _team(tacho)
    d0 = next((d for d in drivers if d.get("current_state") == "DRIVING"), drivers[0])
    today = d0.get("today", {}) or {}
    week = d0.get("week", {}) or {}
    nowd = d0.get("now", {}) or {}
    short_left = int(week.get("9h_rest_shortening_remaining") or 0)
    day_max = TEAM_DAY_SEC if team else 9 * 3600
    if team:
        day_left = min(TEAM_DAY_SEC, sum(float((d.get("today") or {}).get("driving_remaining") or 0) for d in drivers)
                       + (9 * 3600 if len(drivers) < 2 else 0))
    else:
        day_left = float(today.get("driving_remaining") or 0)
    day_left, gfix = gps_adjust(tacho, day_left, day_max)    # v3.104: остаток по GPS, если тахограф отстаёт
    rest_now = float(nowd.get("rest") or 0) if d0.get("current_state") == "REST" else 0.0
    rest_tacho = rest_now                            # v3.145: отдых по тахографу (резерв, если GPS не даёт стоянку)
    rest_gps = gps_rest_now(tacho, d0, rest_now)     # v3.125
    gstand, rest_now = rest_gps > rest_now, rest_gps
    need_rest = 9 * 3600 if (team or short_left > 0) else 11 * 3600
    shift = 0.0
    if rest_now >= need_rest:
        day_left, gfix = day_max, None
    elif rest_now >= 3 * 3600 and (day_left < 3600 or gstand):
        shift = need_rest - rest_now
        day_left = day_max
        if need_rest == 9 * 3600 and not team:
            short_left -= 1
    q = lambda sec: round(max(0.0, sec) / 900) / 4   # noqa: E731 — часы с шагом 15 мин
    out = {"team": team, "left_h": min(q(day_left), day_max / 3600), "shift_h": q(shift),
           "resting": shift > 0, "shorts": max(0, min(3, short_left))}
    if not team:
        wl = week.get("driving_remaining")
        out["week_left_h"] = min(56.0, q(float(wl))) if wl is not None else None
    if tacho.get("nocard"):              # v3.29: подменный тахограф «отдохнул» — недельного остатка не знаем
        out["nocard"] = True
        out.pop("week_left_h", None)
    if gfix:
        out["gps_fix"] = True            # v3.104: остаток вождения — по GPS (тахограф отстаёт)
    g0 = tacho.get("gps")
    if g0 and float(g0.get("stand") or 0) > 0 and d0.get("current_state") != "DRIVING":
        out["stand_h"] = round(float(g0["stand"]) / 3600, 2)   # v3.125: сколько уже стоит — калькулятор прибавляет к сдвигу выезда
    if rest_tacho > 0:
        out["rest_h"] = round(rest_tacho / 3600, 2)            # v3.145: сколько уже стоит по тахографу — «N:MM назад» в ⏱, если GPS молчит
    if shift <= 0 and rest_now < need_rest:      # v3.106: сколько окна смены уже съедено — калькулятору
        import time
        t = float(now_ts or time.time())
        st = _shift_start(tacho, d0, team, short_left, t)
        if gfix:
            st = min(st, gfix["start"])
        used = max(0.0, t - st)
        if used > 0:
            out["used_h"] = round(used / 3600, 2)
            out["start_ts"] = int(st)                                   # v3.107: для заметки калькулятора
            out["end_ts"] = int(shift_window_end(st, team, tacho.get("tz") or TZ_DEFAULT))
            g = tacho.get("gps")
            if g:
                out["driven_h"] = round(float(g["driven"]) / 3600, 2)
            out["shift_src"] = "gps" if (gfix or (g and not (team and len(tacho["drivers"]) >= 2))) else "tacho"
    return out


FRESH_SOLO_TACHO = {"drivers": [{
    "current_state": "REST", "now": {"rest": 11 * 3600, "driving": 0},
    "today": {"driving_remaining": 9 * 3600, "shift_remaining": 13 * 3600, "daily_rest_min": 11 * 3600},
    "week": {"driving_remaining": 56 * 3600, "10h_driving_extensions_remaining": 2,
             "9h_rest_shortening_remaining": 3, "weekly_rest_min": 45 * 3600}}]}


def _calc_shift_start(p, etd, now):
    """v3.106: начало смены в калькуляторе — реальное (shiftStartMs из seed), а не ETD; не раньше суток назад."""
    ms = p.get("shiftStartMs")
    try:
        st = float(ms) / 1000.0 if ms not in (None, "") else None
    except (TypeError, ValueError):
        st = None
    if st is None or st >= etd or now - st > GPS_START_MAX_SEC:
        return etd
    if shift_window_end(st, bool(p.get("team")), TZ_DEFAULT) <= etd:
        return etd   # сдвиг выезда ушёл за конец окна старой смены — между ними был отдых, смена новая: с выезда
    return st


def calc_plan(p):
    """v3.39: ⏱ калькулятор — расклад тем же движком (plan), что Флот и From → To. p — поля калькулятора:
    dist (км), shiftH (сдвиг выезда, ч), leftH (остаток вождения, ч), team, rest (9 | 11), shorts, wkLeft (ч, соло),
    extras / shifts ({№ отдыха: ч}), ext ([№ дня с 10-м часом]), nowMs. Времена в ответе — часы от ETD (как раньше
    в браузере), etd / eta — мс, EU time считает браузер."""
    H = 3600.0
    now = float(p.get("nowMs") or 0) / 1000.0
    if not now:
        import time
        now = time.time()
    etd = -(-now // 900) * 900 + max(0.0, float(p.get("shiftH") or 0)) * H     # ETD — вверх до 15 мин + сдвиг
    team = bool(p.get("team"))
    hrs = lambda d: {int(k): float(v) * H for k, v in (d or {}).items() if float(v or 0) > 0}   # noqa: E731
    wk_left = None if team or p.get("wkLeft") in (None, "") else max(0.0, float(p.get("wkLeft"))) * H
    day_left = max(0.0, float(p.get("leftH") or 0)) * H
    shift_start = _calc_shift_start(p, etd, now)
    shift_sec = max(0.0, float(p.get("shiftH") or 0)) * H
    # свежий день: 9 ч (экипаж 18); 10-й час первого дня («д1 +1 ч») сохраняем — раньше он терялся при сдвиге выезда
    fresh_day = TEAM_DAY_SEC if team else SOLO_DAY_SEC + (EXT_SEC if 0 in {int(x) for x in (p.get("ext") or [])} else 0)
    if shift_sec > 0 and float(p.get("standH") or 0) * H + shift_sec >= int(p.get("rest") or 9) * H:
        day_left, shift_start = fresh_day, etd   # v3.125: стоит + сдвиг = отдых отбыт — свежий день
    rest_end = float(p.get("restEndMs") or 0) / 1000.0
    if rest_end and etd >= rest_end:   # v3.140: диспетчер отметил «встал на отдых» — выезд после его конца = свежий день
        day_left, shift_start = fresh_day, etd
    r = plan(etd, float(p.get("dist") or 0), team=team, day_left=day_left,
             rest_pref=int(p.get("rest") or 9), shorts=int(p.get("shorts") or 0),
             ext_days=[int(x) for x in (p.get("ext") or [])], extras=hrs(p.get("extras")), shifts=hrs(p.get("shifts")),
             week_left=wk_left, shift_start=shift_start, tz=TZ_DEFAULT)
    ev = []
    for e in r["ev"]:
        x = dict(e, t0=(e["t0"] - etd) / H, t1=(e["t1"] - etd) / H)
        if e["k"] == "r":
            x.update(extra=e["extra"] / H, shift=e["shift"] / H)
        ev.append(x)
    eta = -(-r["eta_ts"] // 900) * 900
    dist = max(0.0, float(p.get("dist") or 0))
    return {"ev": ev, "etd": etd * 1000, "eta": eta * 1000, "dist": dist, "drive": dist / TACHO_SPEED_KMH,
            "wk": {"ms": r["wk"]["ts"] * 1000, "km": r["wk"]["km"]} if r["wk"] else None,
            "wkLeft": (wk_left / H) if wk_left is not None else None}
