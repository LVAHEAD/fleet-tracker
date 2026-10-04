"""Cloud Monitoring: сколько запросов к Routes API за месяц; v3.21 — ряд по 5 минут для лога /gusage."""

from datetime import datetime, timezone

import requests

from fetat.config import GOOGLE_PROJECT_ID


_gusage_cache = {"at": 0.0, "data": None}


_ROUTES_FILTER = ('metric.type="serviceruntime.googleapis.com/api/request_count" '
                  'AND resource.type="consumed_api" AND resource.labels.service="routes.googleapis.com"')


def monitoring_token():
    """Токен сервисного аккаунта Cloud Run на чтение Monitoring."""
    import google.auth
    import google.auth.transport.requests
    creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/monitoring.read"])
    creds.refresh(google.auth.transport.requests.Request())
    return creds.token


def _get(token, params):
    r = requests.get(f"https://monitoring.googleapis.com/v3/projects/{GOOGLE_PROJECT_ID}/timeSeries",
                     params=params, headers={"Authorization": f"Bearer {token}"}, timeout=20)
    if r.status_code == 403:
        raise PermissionError("нет доступа к Cloud Monitoring: выдайте сервисному аккаунту роль Monitoring Viewer")
    r.raise_for_status()
    return r.json()


def _value(pt):
    v = pt.get("value") or {}
    return int(v.get("int64Value") or v.get("doubleValue") or 0)


def _monitoring_sum(token, start, end):
    """Сумма запросов к routes.googleapis.com за интервал (как на графике в консоли)."""
    secs = max(60, int((end - start).total_seconds()))
    js = _get(token, {
        "filter": _ROUTES_FILTER,
        "interval.startTime": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "interval.endTime": end.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "aggregation.alignmentPeriod": f"{secs}s",
        "aggregation.perSeriesAligner": "ALIGN_SUM",
        "aggregation.crossSeriesReducer": "REDUCE_SUM",
    })
    return sum(_value(pt) for ts in js.get("timeSeries") or [] for pt in ts.get("points") or [])


SERIES_STEP_SEC = 300


def monitoring_series(token, start, end):
    """v3.21: запросы к Routes API кусками по 5 минут: [(начало куска UTC, число), ...].
    Мелкий шаг — чтобы по часам Риги и суткам Google раскладывать самим, не завися от того,
    как Monitoring выравнивает крупные интервалы."""
    out, page = [], None
    for _ in range(20):
        params = {
            "filter": _ROUTES_FILTER,
            "interval.startTime": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "interval.endTime": end.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "aggregation.alignmentPeriod": f"{SERIES_STEP_SEC}s",
            "aggregation.perSeriesAligner": "ALIGN_SUM",
            "aggregation.crossSeriesReducer": "REDUCE_SUM",
        }
        if page:
            params["pageToken"] = page
        js = _get(token, params)
        for ts in js.get("timeSeries") or []:
            for pt in ts.get("points") or []:
                n = _value(pt)
                if not n:
                    continue
                iv = pt.get("interval") or {}
                stamp = iv.get("startTime") or iv.get("endTime")
                if not stamp:
                    continue
                at = _parse_ts(stamp)
                if iv.get("startTime") is None or at >= _parse_ts(iv.get("endTime") or stamp):
                    at = datetime.fromtimestamp(at.timestamp() - SERIES_STEP_SEC, timezone.utc)
                out.append((at, n))
        page = js.get("nextPageToken")
        if not page:
            break
    return out


def _parse_ts(s):
    """'2026-10-04T09:05:00Z' / с долями секунды → datetime UTC."""
    s = s.rstrip("Z")
    if "." in s:
        s = s.split(".", 1)[0]
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)
