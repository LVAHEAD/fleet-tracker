"""v3.21: лог запросов к Google Routes для страницы /gusage — по суткам Google и по часам Риги.

Наш счёт — счётчики routes_stats (что сервер отправил в Google и что взял из кеша, почему, что, кто).
Счёт Google — Cloud Monitoring кусками по 5 минут, разложенными по тем же суткам и часам.
"""
from datetime import datetime, timedelta, timezone

from fetat.clients.google_routes import quota_day_of
from fetat.utils.timefmt import to_riga

LOG_DAYS = 14

WHY = {"edit": "правка строки", "all": "«Обновить всё» / загрузка", "auto": "автообновление",
       "sync": "чужие правки", "route": "From → To", "other": "прочее"}
KIND = {"truck": "машина → точка", "leg": "точка → точка", "multi": "From → To", "corridor": "выбор коридора"}


def day_start_utc(day):
    """Начало суток Google (полночь по Тихоокеанскому) для даты 'ГГГГ-ММ-ДД' — в UTC."""
    d = datetime.strptime(day, "%Y-%m-%d")
    try:
        from zoneinfo import ZoneInfo
        return d.replace(tzinfo=ZoneInfo("America/Los_Angeles")).astimezone(timezone.utc)
    except Exception:
        return d.replace(tzinfo=timezone.utc) + timedelta(hours=7)


def hour_order(day):
    """Часы Риги по порядку внутри суток Google: обычно 10, 11 … 23, 00 … 09."""
    h0 = int(to_riga(day_start_utc(day)).strftime("%H"))
    return [f"{(h0 + i) % 24:02d}" for i in range(24)]


def _part(st, prefix):
    return {k[len(prefix):]: v for k, v in st.items() if k.startswith(prefix) and v}


def key_label(cred, our_key=None):
    """v3.25: подпись ключа из credential_id Monitoring ("apikey:…"): хвост, «наш» — если совпал с нашим ключом."""
    c = str(cred or "")
    if not c:
        return "без ключа"
    kind, _, val = c.partition(":")
    tail = (val or c)[-6:]
    ours = bool(our_key) and (our_key in c or (len(our_key) >= 6 and c.endswith(our_key[-6:])))
    name = "ключ" if kind.lower() == "apikey" else kind
    return f"{name} …{tail}" + (" (наш)" if ours else "")


def _method_short(m):
    return str(m or "").rsplit(".", 1)[-1] or "?"


def build_log(stats_days, series=None, today=None, days=LOG_DAYS, now=None, our_key=None):
    """stats_days — {сутки: счётчики routes_stats}; series — [(UTC, число[, метки])] из Monitoring или None.
    Возвращает сутки свежие первыми, у каждых — итоги, разбивка и часы с данными.
    v3.25: у суток — разбивка счёта Google по ключам (g_keys), методам (g_methods) и ошибкам (g_err: 4xx/5xx),
    у часа — ошибки (ge) и метка «час ещё идёт» (now)."""
    now = now or datetime.now(timezone.utc)
    today = today or quota_day_of(now)
    d0 = datetime.strptime(today, "%Y-%m-%d")
    labels = [(d0 - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(days)]
    g_day, g_hour, g_keys, g_meth, g_err, g_herr = {}, {}, {}, {}, {}, {}
    has_labels = False
    for item in series or []:
        at, n = item[0], item[1]
        lab = item[2] if len(item) > 2 else {}
        day = quota_day_of(at)
        hh = to_riga(at).strftime("%H")
        g_day[day] = g_day.get(day, 0) + n
        g_hour[(day, hh)] = g_hour.get((day, hh), 0) + n
        if lab:
            has_labels = True
            if lab.get("credential_id"):
                k = key_label(lab["credential_id"], our_key)
                g_keys.setdefault(day, {})[k] = g_keys.get(day, {}).get(k, 0) + n
            if lab.get("method"):
                m = _method_short(lab["method"])
                g_meth.setdefault(day, {})[m] = g_meth.get(day, {}).get(m, 0) + n
            cls = str(lab.get("response_code_class") or "")
            if cls and not cls.startswith("2"):
                g_err.setdefault(day, {})[cls] = g_err.get(day, {}).get(cls, 0) + n
                g_herr[(day, hh)] = g_herr.get((day, hh), 0) + n
    now_day, now_hh = quota_day_of(now), to_riga(now).strftime("%H")
    out = []
    for day in labels:
        st = stats_days.get(day) or {}
        hours = []
        for hh in hour_order(day):
            c, h = st.get(f"c_hr_{hh}", 0), st.get(f"h_hr_{hh}", 0)
            g = g_hour.get((day, hh), 0) if series is not None else None
            cur = day == now_day and hh == now_hh
            if c or h or g or cur:
                x = {"hh": hh, "c": c, "h": h, "g": g}
                if g_herr.get((day, hh)):
                    x["ge"] = g_herr[(day, hh)]
                if cur:
                    x["now"] = True
                hours.append(x)
        d = {
            "day": day, "label": f"{day[8:10]}.{day[5:7]}",
            "c": st.get("c", 0), "h": st.get("h", 0),
            "g": g_day.get(day, 0) if series is not None else None,
            "why": _part(st, "c_why_"), "kind": _part(st, "c_kind_"), "user": _part(st, "c_user_"),
            "hours": hours,
        }
        if has_labels:
            d["g_keys"] = g_keys.get(day, {})
            d["g_methods"] = g_meth.get(day, {})
            d["g_err"] = g_err.get(day, {})
        out.append(d)
    return out


def _sorted_parts(obj, names=None):
    return ", ".join(f"{(names or {}).get(k, k)} {v}" for k, v in sorted((obj or {}).items(), key=lambda x: -x[1]))


def log_text(days, sel=None):
    """Текст «📋 Для Claude»: таблица по суткам и часы выбранных суток."""
    def n(v):
        return "—" if v is None else str(v)
    lines = ["Запросы к Google Routes — лог /gusage (сутки Google с полуночи по Тихоокеанскому, часы — Рига)",
             "", "По суткам: Google насчитал / наш сервер в Google / из кеша — почему · что · кто"]
    for d in days:
        if not (d["c"] or d["h"] or d["g"]):
            continue
        why, kind, user = _sorted_parts(d["why"], WHY), _sorted_parts(d["kind"], KIND), _sorted_parts(d["user"])
        line = (f"  {d['label']}: {n(d['g'])} / {d['c']} / {d['h']}"
                + (f" — {why}" if why else "") + (f" · {kind}" if kind else "") + (f" · {user}" if user else ""))
        g_extra = []      # v3.25: разбивка счёта Google
        if d.get("g_keys"):
            g_extra.append("по ключам: " + _sorted_parts(d["g_keys"]))
        if d.get("g_methods") and (len(d["g_methods"]) > 1 or "ComputeRoutes" not in d["g_methods"]):
            g_extra.append("методы: " + _sorted_parts(d["g_methods"]))
        if d.get("g_err"):
            g_extra.append("ошибки: " + _sorted_parts(d["g_err"]))
        elif "g_err" in d and d["g"]:
            g_extra.append("ошибок нет")
        if g_extra:
            line += "\n      Google — " + "; ".join(g_extra)
        lines.append(line)
    for d in days:
        if d["day"] != sel:
            continue
        lines += ["", f"По часам {d['label']} (Рига): Google / наш в Google / из кеша"]
        for x in d["hours"]:
            tail = (f"  (ошибок {x['ge']})" if x.get("ge") else "") + ("  (час ещё идёт)" if x.get("now") else "")
            lines.append(f"  {x['hh']}:00  {n(x['g'])} / {x['c']} / {x['h']}{tail}")
    return "\n".join(lines)


def month_forecast(month_so_far, full_days, days_in_month, elapsed_days, free):
    """v3.25: прогноз на месяц по последним полным суткам Google, а не по среднему с 1-го числа
    (в начале месяца среднее тянет дни до экономии). full_days — счёт Google за последние полные сутки,
    свежие первыми (None — нет данных). Образец — медиана последних 3 полных суток: сутки с провалом
    (зависание, деплой) или со старым темпом не перекашивают прогноз.
    Возвращает {forecast, per_day, sample_days, left, days_left, per_day_allowed} или None."""
    if month_so_far is None:
        return None
    sample = [int(x) for x in (full_days or [])[:3] if x is not None]
    days_left = max(0.0, days_in_month - elapsed_days)
    if sample:
        srt = sorted(sample)
        mid = len(srt) // 2
        per_day = srt[mid] if len(srt) % 2 else (srt[mid - 1] + srt[mid]) / 2
    else:
        per_day = month_so_far / max(1.0, elapsed_days)
    left = free - month_so_far
    return {
        "forecast": int(round(month_so_far + per_day * days_left)),
        "per_day": int(round(per_day)),
        "sample_days": sample,
        "left": int(left),
        "days_left": round(days_left, 1),
        "per_day_allowed": int(left / days_left) if days_left >= 0.5 and left > 0 else 0,
    }
