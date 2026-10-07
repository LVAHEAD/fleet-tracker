"""Время: форматирование, округление, ISO и метки по Риге."""
from datetime import datetime, timedelta, timezone

from fetat.config import RIGA_TZ_NAME, WEST_TZ_NAME


def _last_sunday(year, month):
    d = datetime(year, month + 1, 1) - timedelta(days=1) if month < 12 else datetime(year, 12, 31)
    return d - timedelta(days=(d.weekday() + 1) % 7)


def _eu_summer(dt_utc):
    """Летнее время ЕС: с последнего воскресенья марта 01:00 UTC до последнего воскресенья октября 01:00 UTC."""
    y = dt_utc.year
    start = _last_sunday(y, 3).replace(hour=1, tzinfo=timezone.utc)
    end = _last_sunday(y, 10).replace(hour=1, tzinfo=timezone.utc)
    return start <= dt_utc < end


def _zone(name):
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo(name)
    except Exception:
        return None


_ZONES = {}


def _to_zone(dt_utc, name, std_hours):
    """UTC -> местное время зоны name (без tzinfo, как раньше после «+ timedelta»).
    Без базы tzdata — правило перевода часов ЕС."""
    if dt_utc.tzinfo is None:
        dt_utc = dt_utc.replace(tzinfo=timezone.utc)
    if name not in _ZONES:
        _ZONES[name] = _zone(name)
    z = _ZONES[name]
    if z is not None:
        return dt_utc.astimezone(z).replace(tzinfo=None)
    off = std_hours + (1 if _eu_summer(dt_utc.astimezone(timezone.utc)) else 0)
    return (dt_utc.astimezone(timezone.utc) + timedelta(hours=off)).replace(tzinfo=None)


def to_west(dt_utc):
    """UTC -> время Центральной Европы (CET/CEST) — так показываем ETA и времена."""
    return _to_zone(dt_utc, WEST_TZ_NAME, 1)


def to_riga(dt_utc):
    """UTC -> время Риги (EET/EEST)."""
    return _to_zone(dt_utc, RIGA_TZ_NAME, 2)


def ts_west(ts):
    return to_west(datetime.fromtimestamp(float(ts), timezone.utc))


def ts_riga(ts):
    return to_riga(datetime.fromtimestamp(float(ts), timezone.utc))


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


def ceil_15min(dt: datetime) -> datetime:
    """v3.39: ETA / ETD — вверх до 15 мин (везде одинаково)."""
    dt = dt.replace(second=0, microsecond=0) + (timedelta(minutes=1) if (dt.second or dt.microsecond) else timedelta(0))
    rem = dt.minute % 15
    return dt + timedelta(minutes=15 - rem) if rem else dt


def ceil_15_ts(ts):
    """Метка времени — вверх до 15 мин."""
    q = 900
    return -(-float(ts) // q) * q


def ts_zone(ts, name, std_hours):
    """v3.39: местное время зоны (для ночной смены — по стране, где машина)."""
    return _to_zone(datetime.fromtimestamp(float(ts), tz=timezone.utc), name, std_hours)


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
    return ts_riga(ts).strftime("%d.%m %H:%M")


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
