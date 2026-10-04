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
KIND = {"truck": "машина → точка", "leg": "точка → точка", "multi": "From → To"}


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


def build_log(stats_days, series=None, today=None, days=LOG_DAYS):
    """stats_days — {сутки: счётчики routes_stats}; series — [(UTC, число)] из Monitoring или None.
    Возвращает сутки свежие первыми, у каждых — итоги, разбивка и часы с данными."""
    today = today or quota_day_of(datetime.now(timezone.utc))
    d0 = datetime.strptime(today, "%Y-%m-%d")
    labels = [(d0 - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(days)]
    g_day, g_hour = {}, {}
    for at, n in series or []:
        day = quota_day_of(at)
        hh = to_riga(at).strftime("%H")
        g_day[day] = g_day.get(day, 0) + n
        g_hour[(day, hh)] = g_hour.get((day, hh), 0) + n
    out = []
    for day in labels:
        st = stats_days.get(day) or {}
        hours = []
        for hh in hour_order(day):
            c, h = st.get(f"c_hr_{hh}", 0), st.get(f"h_hr_{hh}", 0)
            g = g_hour.get((day, hh), 0) if series is not None else None
            if c or h or g:
                hours.append({"hh": hh, "c": c, "h": h, "g": g})
        out.append({
            "day": day, "label": f"{day[8:10]}.{day[5:7]}",
            "c": st.get("c", 0), "h": st.get("h", 0),
            "g": g_day.get(day, 0) if series is not None else None,
            "why": _part(st, "c_why_"), "kind": _part(st, "c_kind_"), "user": _part(st, "c_user_"),
            "hours": hours,
        })
    return out


def log_text(days, sel=None):
    """Текст «📋 Для Claude»: таблица по суткам и часы выбранных суток."""
    def n(v):
        return "—" if v is None else str(v)
    lines = ["Запросы к Google Routes — лог /gusage (сутки Google с полуночи по Тихоокеанскому, часы — Рига)",
             "", "По суткам: Google насчитал / наш сервер в Google / из кеша — почему · что · кто"]
    for d in days:
        if not (d["c"] or d["h"] or d["g"]):
            continue
        why = ", ".join(f"{WHY.get(k, k)} {v}" for k, v in sorted(d["why"].items(), key=lambda x: -x[1]))
        kind = ", ".join(f"{KIND.get(k, k)} {v}" for k, v in sorted(d["kind"].items(), key=lambda x: -x[1]))
        user = ", ".join(f"{k} {v}" for k, v in sorted(d["user"].items(), key=lambda x: -x[1]))
        lines.append(f"  {d['label']}: {n(d['g'])} / {d['c']} / {d['h']}"
                     + (f" — {why}" if why else "") + (f" · {kind}" if kind else "") + (f" · {user}" if user else ""))
    for d in days:
        if d["day"] != sel:
            continue
        lines += ["", f"По часам {d['label']} (Рига): Google / наш в Google / из кеша"]
        lines += [f"  {x['hh']}:00  {n(x['g'])} / {x['c']} / {x['h']}" for x in d["hours"]]
    return "\n".join(lines)
