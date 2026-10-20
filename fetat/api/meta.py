"""Главная страница, кто вошёл (IAP), история версий, счётчик запросов Google."""
import os
import re
from datetime import datetime, timedelta, timezone

from flask import Blueprint, jsonify, render_template, request

from fetat import APP_VERSION
from fetat.config import NOTES_TAB_USERS
from fetat.utils.text import canon_email
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
    v = canon_email(v.split(":", 1)[-1])   # v3.127: Gmail без точек и «+метки»
    return v or None


@bp.route("/")
def index():
    """Главная страница аппы (Флот, From → To, Локатор, Справка)."""
    email = current_user_email()
    # локальный запуск (без IAP) — видно всем; в проде — только NOTES_TAB_USERS
    show_notes = email is None or canon_email(email) in NOTES_TAB_USERS
    return render_template("index.html", google_maps_js_key=GOOGLE_MAPS_JS_KEY, app_version=APP_VERSION,
                           user_email=email, show_notes=show_notes, can_edit_addr=show_notes)   # v3.171: правка адресов — те же аккаунты


@bp.route("/map-window")
def map_window():
    """Карта Флота в отдельном окне (откреплённая, для второго монитора): данные приходят из основного окна через BroadcastChannel."""
    return render_template("map_window.html", google_maps_js_key=GOOGLE_MAPS_JS_KEY, app_version=APP_VERSION,
                           user_email=current_user_email())


@bp.route("/api/me")
def api_me():
    """Под каким аккаунтом вошёл (e-mail из IAP)."""
    return jsonify({"email": current_user_email(), "iap": current_user_email() is not None})


@bp.route("/api/google-usage")
def api_google_usage():
    """Счётчик запросов к Google Routes (JSON): сутки, месяц, прогноз."""
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
    """Страница «Лог запросов к Google по суткам и часам»."""
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
    # v3.26: тексты «Для Claude» — сразу в ответе (по суткам с данными): кнопка копирует без своего запроса
    tail = f"\n\nСчёт Google недоступен: {err}" if err else ""
    texts = {d["day"]: log_text(days, d["day"]) + tail for d in days if d["c"] or d["h"] or d["g"]}
    if days[0]["day"] not in texts:
        texts[days[0]["day"]] = log_text(days, days[0]["day"]) + tail
    return jsonify({"days": days, "today": days[0]["day"], "google_error": err, "texts": texts})


CHANGELOG_PATH = os.path.join(ROOT_DIR, "CHANGELOG.md")


def read_changelog():
    try:
        with open(CHANGELOG_PATH, encoding="utf-8") as f:
            return f.read()
    except OSError:
        return ""


def parse_changelog(doc):
    """Записи вида "1.57 (2026-09-27) — текст" + строки с отступом. Старая нумерация
    "4 (2026-09-23)" тоже понимается. Возвращает [{ver, date, title, disp, text}] свежие первыми."""
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
        # v3.175: строка «Для диспетчеров: …» — для поп-апа «Что нового» (нет строки — поле пустое)
        disp = next((ln.split(":", 1)[1].strip() for ln in it["lines"] if ln.startswith("Для диспетчеров:")), "")
        out.append({"ver": it["ver"], "date": it["date"], "title": it["title"], "disp": disp,
                    "text": "\n".join(it["lines"])})
    return out


_changelog_cache = {"mtime": None, "items": None}


@bp.route("/api/changelog")
def api_changelog():
    """История версий из CHANGELOG.md (JSON, для вкладки [.])."""
    # v3.67: разбор CHANGELOG.md — один раз на изменение файла, а не на каждый запрос
    try:
        mtime = os.path.getmtime(CHANGELOG_PATH)
    except OSError:
        mtime = None
    if _changelog_cache["items"] is None or _changelog_cache["mtime"] != mtime:
        _changelog_cache["items"] = parse_changelog(read_changelog())
        _changelog_cache["mtime"] = mtime
    return jsonify({"version": APP_VERSION, "items": _changelog_cache["items"]})


# ---------- v3.126: статистика рефрешей и список эндпоинтов для Справки ----------
_REFRESH_LOG = []          # последние проходы расчёта Флота (память воркера; постоянная история — только строки [refresh] в логе)
_REFRESH_MAX = 200
_REFRESH_KINDS = ("open", "auto", "manual")


def _num(v, lo, hi, nd=1):
    try:
        return round(min(hi, max(lo, float(v))), nd)
    except (TypeError, ValueError):
        return 0.0


@bp.route("/api/refresh-stat", methods=["POST"])
def api_refresh_stat_post():
    """Страница сообщает, сколько заняло обновление Флота: тип (open / auto / manual), машин всего и видимых,
    секунды видимого и полного прохода, самая медленная машина. Пишет строку [refresh] в лог."""
    b = request.get_json(force=True, silent=True) or {}
    kind = b.get("kind") if b.get("kind") in _REFRESH_KINDS else "manual"
    rec = {"t": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"), "kind": kind,
           "rows": int(_num(b.get("rows"), 0, 500, 0)), "vis": int(_num(b.get("rows_visible"), 0, 500, 0)),
           "sec_vis": _num(b.get("sec_visible"), 0, 3600), "sec": _num(b.get("sec_full"), 0, 3600),
           "slow": re.sub(r"[^\w .\-]", "", str(b.get("slowest_unit") or ""))[:20],
           "slow_sec": _num(b.get("slowest_sec"), 0, 3600)}
    _REFRESH_LOG.append(rec)
    del _REFRESH_LOG[:-_REFRESH_MAX]
    print(f"[refresh] kind={kind} rows={rec['rows']} vis={rec['vis']} sec_vis={rec['sec_vis']} sec={rec['sec']} "
          f"slowest={rec['slow']}/{rec['slow_sec']}", flush=True)
    return jsonify({"ok": True})


@bp.route("/api/refresh-stat")
def api_refresh_stat():
    """Статистика обновлений Флота: таблица последних 200 проходов и средние по типам (в памяти воркера;
    сбрасывается при рестарте). ?json=1 — те же данные JSON."""
    log = list(_REFRESH_LOG)
    avg = {}
    for k in _REFRESH_KINDS:
        xs = [r for r in log if r["kind"] == k]
        if xs:
            avg[k] = {"n": len(xs), "rows": round(sum(r["rows"] for r in xs) / len(xs), 1),
                      "sec_vis": round(sum(r["sec_vis"] for r in xs) / len(xs), 1),
                      "sec": round(sum(r["sec"] for r in xs) / len(xs), 1)}
    if request.args.get("json") == "1":
        return jsonify({"ok": True, "avg": avg, "log": log})
    th = "<tr>" + "".join(f"<th>{h}</th>" for h in ("Время (UTC)", "Тип", "Машин", "Видимых", "Видимые, с", "Полный, с", "Самая медленная")) + "</tr>"
    body = "".join(f"<tr><td>{r['t']}</td><td>{r['kind']}</td><td>{r['rows']}</td><td>{r['vis']}</td><td>{r['sec_vis']}</td>"
                   f"<td>{r['sec']}</td><td>{r['slow']} / {r['slow_sec']} с</td></tr>" for r in reversed(log))
    av = "".join(f"<tr><td>{k}</td><td>{v['n']}</td><td>{v['rows']}</td><td>{v['sec_vis']}</td><td>{v['sec']}</td></tr>"
                 for k, v in avg.items()) or "<tr><td colspan=5>пока нет данных</td></tr>"
    html = ("<!doctype html><meta charset=utf-8><title>Обновления Флота</title>"
            "<style>body{font:14px system-ui;margin:24px}table{border-collapse:collapse;margin-bottom:24px}"
            "td,th{border:1px solid #c9d6ee;padding:4px 10px;text-align:left}th{background:#2f6fd6;color:#fff}</style>"
            "<h3>Средние по типам</h3><table><tr><th>Тип</th><th>Проходов</th><th>Машин</th><th>Видимые, с</th><th>Полный, с</th></tr>"
            f"{av}</table><h3>Последние проходы</h3><table>{th}{body}</table>")
    return html


@bp.route("/api/endpoints")
def api_endpoints():
    """Список эндпоинтов аппы с описанием (из докстрингов) — для вкладки [.] Справка."""
    from flask import current_app
    out = []
    for r in current_app.url_map.iter_rules():
        if r.endpoint == "static":
            continue
        doc = (current_app.view_functions[r.endpoint].__doc__ or "").strip().split("\n")[0]
        out.append({"path": r.rule, "methods": sorted(r.methods - {"HEAD", "OPTIONS"}), "doc": doc})
    out.sort(key=lambda x: (x["path"], x["methods"]))
    return jsonify({"ok": True, "endpoints": out})
