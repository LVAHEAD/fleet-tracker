"""Время: форматирование, округление, ISO и метки по Риге."""
from datetime import datetime, timedelta, timezone

from fetat.config import RIGA_UTC_OFFSET


def format_duration(seconds):
    days, rem = divmod(int(seconds or 0), 86400)
    hours, rem = divmod(rem, 3600)
    minutes = rem // 60
    if days > 0:
        return f"{days}д {hours}ч {minutes}м"
    return f"{hours}ч {minutes}м"


def round_to_15min(dt: datetime) -> datetime:
    discard = timedelta(minutes=dt.minute % 15, seconds=dt.second, microseconds=dt.microsecond)
    dt -= discard
    if discard >= timedelta(minutes=7.5):
        dt += timedelta(minutes=15)
    return dt


def _iso_ts(s):
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00")).timestamp()
    except Exception:
        return None


def time_now_ts():
    import time
    return time.time()


def _iso_utc(ts):
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _utc_iso(ts):
    from datetime import datetime, timezone
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _hm(sec):
    sec = max(0, int(sec))
    return f"{sec // 3600}:{sec % 3600 // 60:02d}"


def _lv(ts):
    return (datetime.fromtimestamp(float(ts), timezone.utc) + timedelta(hours=RIGA_UTC_OFFSET)).strftime("%d.%m %H:%M")


def _lv_time(ts):
    from datetime import datetime, timezone, timedelta
    try:
        from zoneinfo import ZoneInfo
        tz = ZoneInfo("Europe/Riga")
    except Exception:
        tz = timezone(timedelta(hours=3))
    return datetime.fromtimestamp(int(ts), tz).strftime("%d.%m %H:%M")


def _now_ms():
    import time
    return int(time.time() * 1000)
