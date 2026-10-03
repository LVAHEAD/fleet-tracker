"""Cloud Monitoring: сколько запросов к Routes API за месяц."""

import requests

from fetat.config import GOOGLE_PROJECT_ID


_gusage_cache = {"at": 0.0, "data": None}


def _monitoring_sum(token, start, end):
    """Сумма запросов к routes.googleapis.com за интервал (как на графике в консоли)."""
    secs = max(60, int((end - start).total_seconds()))
    params = {
        "filter": 'metric.type="serviceruntime.googleapis.com/api/request_count" '
                  'AND resource.type="consumed_api" AND resource.labels.service="routes.googleapis.com"',
        "interval.startTime": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "interval.endTime": end.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "aggregation.alignmentPeriod": f"{secs}s",
        "aggregation.perSeriesAligner": "ALIGN_SUM",
        "aggregation.crossSeriesReducer": "REDUCE_SUM",
    }
    r = requests.get(f"https://monitoring.googleapis.com/v3/projects/{GOOGLE_PROJECT_ID}/timeSeries",
                     params=params, headers={"Authorization": f"Bearer {token}"}, timeout=20)
    if r.status_code == 403:
        raise PermissionError("нет доступа к Cloud Monitoring: выдайте сервисному аккаунту роль Monitoring Viewer")
    r.raise_for_status()
    total = 0
    for ts in r.json().get("timeSeries") or []:
        for pt in ts.get("points") or []:
            v = pt.get("value") or {}
            total += int(v.get("int64Value") or v.get("doubleValue") or 0)
    return total
