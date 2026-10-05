"""Главная страница, кто вошёл (IAP), история версий, счётчик запросов Google."""
import os
import re
from datetime import datetime, timedelta, timezone

from flask import Blueprint, jsonify, render_template, request

from fetat import APP_VERSION
from fetat.clients.google_routes import (_quota_day, _route_stats, read_route_stats, read_route_stats_days,
                                         ROUTES_FREE_MONTH, hourly_from_stats, own_forecast)
from fetat.clients.monitoring import _gusage_cache, _monitoring_sum, monitoring_series, monitoring_token
from fetat.config import GOOGLE_API_KEY, GOOGLE_MAPS_JS_KEY, ROOT_DIR
from fetat.services.gusage import LOG_DAYS, build_log, log_text, month_forecast

bp = Blueprint("meta", __name__)


# v1.84 (2.0a): кто вошёл — IAP кладёт e-mail в заголовок "accounts.google.com:user@gmail.com".
# Без IAP (локально / до включения) — None. Заголовку можно верить только за IAP.
def current_user_email():
    v = request.headers.get("X-Goog-Authenticated-User-Email") or ""
    v = v.split(":", 1)[-1].strip().lower()
    return v or None


@bp.route("/")
def index():
    return render_template("index.html", google_maps_js_key=GOOGLE_MAPS_JS_KEY, app_version=APP_VERSION,
                           user_email=current_user_email())


@bp.route("/api/me")
def api_me():
    return jsonify({"email": current_user_email(), "iap": current_user_email() is not None})


@bp.route("/api/google-usage")
def api_google_usage():
    import time
    now = time.time()
    if _gusage_cache["data"] and now - _gusage_cache["at"] < 600 and request.args.get("refresh") != "1":
        return jsonify(_with_stats(dict(_gusage_cache["data"])))
    try:
        from zoneinfo import ZoneInfo
        pt = ZoneInfo("America/Los_Angeles")
    except Exception:
        pt = timezone(timedelta(hours=-7))
    end = datetime.now(timezone.utc)
    local = end.astimezone(pt)
    day0 = local.replace(hour=0, minute=0, second=0, microsecond=0)
    month0 = day0.replace(day=1)
    out = {"free": ROUTES_FREE_MONTH, "local_day": _route_stats.get("day"),
           "calls_local": _route_stats.get("calls", 0) if _route_stats.get("day") == _quota_day() else 0,
           "cache_hits": _route_stats.get("cache_hits", 0) if _route_stats.get("day") == _quota_day() else 0}
    try:
        token = monitoring_token()
        out["month"] = _monitoring_sum(token, month0.astimezone(timezone.utc), end)
        out["today"] = _monitoring_sum(token, day0.astimezone(timezone.utc), end)
        # v3.25: прогноз на месяц — уже насчитано + медиана последних 3 полных суток Google × оставшиеся дни
        # (раньше — среднее с 1-го числа: в начале месяца тянуло дни до экономии)
        import calendar
        days_in = calendar.monthrange(local.year, local.month)[1]
        elapsed = max(1.0 / 24, (local - month0).total_seconds() / 86400)
        full = None
        series, _err = _google_series()
        if series is not None:
            full = [d["g"] for d in build_log({}, series, days=4)[1:4]]
        fc = month_forecast(out["month"], full, days_in, elapsed, ROUTES_FREE_MONTH)
        out["forecast"] = fc["forecast"]
        out["forecast_info"] = fc
    except Exception as e:
        out["error"] = str(e)
    _gusage_cache.update(at=now, data=out)
    return jsonify(_with_stats(dict(out)))


def _with_stats(out):
    """v3.13: общие счётчики всех процессов за сутки Google: из кеша / в Google, по причинам и людям."""
    st = read_route_stats()
    if st:
        out["stats"] = st
        out["cache_hits"] = st.get("h", out.get("cache_hits", 0))
        out["calls_local"] = st.get("c", out.get("calls_local", 0))
        # v3.15: почасовой лог и прогноз по нашему темпу (рядом с прогнозом по суткам Google)
        out["hourly"] = hourly_from_stats(st)
        import calendar
        now = datetime.now(timezone.utc)
        own = own_forecast(st, calendar.monthrange(now.year, now.month)[1])
        if own:
            out["forecast_own"] = own
    return out


# v3.21: страница лога запросов к Google Routes — по суткам Google и по часам Риги,
# наш счёт рядом со счётом Google (Cloud Monitoring). Ряд Monitoring кешируется на 10 минут.
_gseries_cache = {"at": 0.0, "data": None, "error": None}


@bp.route("/gusage")
def gusage_page():
    return render_template("gusage.html", app_version=APP_VERSION, user_email=current_user_email())


def _google_series(refresh=False):
    import time
    now = time.time()
    if _gseries_cache["at"] and now - _gseries_cache["at"] < 600 and not refresh:
        return _gseries_cache["data"], _gseries_cache["error"]
    data, err = None, None
    try:
        end = datetime.now(timezone.utc).replace(second=0, microsecond=0)
        end = end - timedelta(minutes=end.minute % 5)
        start = end - timedelta(days=LOG_DAYS + 1)
        data = monitoring_series(monitoring_token(), start, end)
    except Exception as e:
        err = str(e)
    _gseries_cache.update(at=now, data=data, error=err)
    return data, err


@bp.route("/api/google-usage/log")
def api_google_usage_log():
    """v3.21: ?day=ГГГГ-ММ-ДД — какие сутки разложить по часам в тексте; ?format=text — текст для Claude;
    ?refresh=1 — счёт Google заново, не из кеша."""
    series, err = _google_series(request.args.get("refresh") == "1")
    days = build_log(read_route_stats_days(), series, our_key=GOOGLE_API_KEY)
    sel = request.args.get("day") or days[0]["day"]
    if request.args.get("format") == "text":
        text = log_text(days, sel)
        if err:
            text += f"\n\nСчёт Google недоступен: {err}"
        return text, 200, {"Content-Type": "text/plain; charset=utf-8"}
    return jsonify({"days": days, "today": days[0]["day"], "google_error": err})


CHANGELOG_PATH = os.path.join(ROOT_DIR, "CHANGELOG.md")


def read_changelog():
    try:
        with open(CHANGELOG_PATH, encoding="utf-8") as f:
            return f.read()
    except OSError:
        return ""


def parse_changelog(doc):
    """Записи вида "1.57 (2026-09-27) — текст" + строки с отступом. Старая нумерация
    "4 (2026-09-23)" тоже понимается. Возвращает [{ver, date, title, text}] свежие первыми."""
    items, cur = [], None
    for line in (doc or "").splitlines():
        m = re.match(r"^(\d+(?:\.\d+)?) \((\d{4})-(\d{2})-(\d{2})\)\s*[—-]?\s*(.*)$", line)
        if m:
            cur = {"ver": m.group(1), "date": f"{m.group(4)}.{m.group(3)}.{m.group(2)}",
                   "title": m.group(5).strip(), "lines": []}
            items.append(cur)
            continue
        if cur is None:
            continue
        if line.startswith("---") or (line and not line.startswith(" ")):
            cur = None if not line.startswith("---") else None
            continue
        if line.strip():
            cur["lines"].append(line.strip())
    out = []
    for it in items:
        out.append({"ver": it["ver"], "date": it["date"], "title": it["title"],
                    "text": "\n".join(it["lines"])})
    return out


@bp.route("/api/changelog")
def api_changelog():
    return jsonify({"version": APP_VERSION, "items": parse_changelog(read_changelog())})
