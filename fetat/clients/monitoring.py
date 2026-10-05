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


# v3.25: разбивка счёта Google — по ключу (credential_id), методу и классу ответа (2xx / 4xx / 5xx)
SERIES_GROUP_BY = ["resource.labels.credential_id", "resource.labels.method", "metric.labels.response_code_class"]


def monitoring_series(token, start, end):
    """v3.21: запросы к Routes API кусками по 5 минут: [(начало куска UTC, число, метки), ...].
    Мелкий шаг — чтобы по часам Риги и суткам Google раскладывать самим, не завися от того,
    как Monitoring выравнивает крупные интервалы.
    v3.25: метки — {"credential_id", "method", "response_code_class"} (ключ, метод, 2xx/4xx/5xx);
    если Monitoring разбивку не принял (400) — без разбивки, метки пустые."""
    try:
        return _series(token, start, end, SERIES_GROUP_BY)
    except requests.HTTPError as e:
        if getattr(e.response, "status_code", None) != 400:
            raise
        return _series(token, start, end, None)


def _series(token, start, end, group_by):
    out, page = [], None
    for _ in range(40):
        params = {
            "filter": _ROUTES_FILTER,
            "interval.startTime": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "interval.endTime": end.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "aggregation.alignmentPeriod": f"{SERIES_STEP_SEC}s",
            "aggregation.perSeriesAligner": "ALIGN_SUM",
            "aggregation.crossSeriesReducer": "REDUCE_SUM",
        }
        if group_by:
            params["aggregation.groupByFields"] = group_by
        if page:
            params["pageToken"] = page
        js = _get(token, params)
        for ts in js.get("timeSeries") or []:
            labels = {}
            for src in ((ts.get("resource") or {}).get("labels") or {}, (ts.get("metric") or {}).get("labels") or {}):
                for k in ("credential_id", "method", "response_code_class"):
                    if src.get(k):
                        labels[k] = src[k]
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
                out.append((at, n, labels))
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
