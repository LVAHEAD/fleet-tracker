"""v3.143: местное время страны точки. Во Флоте все времена считаются и хранятся по Берлину (EU time);
для стран с другим поясом (FI, PT, LV, LT, EE, RO, BG, GR, UA, MD, TR, IE, GB — `COUNTRY_TZ`) рядом
с ETA и ✓ показываем время страны точки: TimeSlot у таких точек местный."""
import re
from datetime import datetime, timezone

from fetat.config import WEST_TZ_NAME
from fetat.domain.tacho import COUNTRY_TZ

_RX = re.compile(r"^(\d{2})/(\d{2}) (\d{2}):(\d{2})$")


def local_tz(cc):
    """Имя пояса страны, если он НЕ как у Берлина; иначе None (время остаётся берлинским)."""
    v = COUNTRY_TZ.get(str(cc or "").upper()[:2])
    name = v[0] if v else None
    return name if name and name != WEST_TZ_NAME else None


def to_local_str(s, cc):
    """«дд/мм ЧЧ:ММ» по Берлину -> «дд/мм ЧЧ:ММ» в поясе страны cc. Нет отличия пояса / не разобрали — None."""
    name = local_tz(cc)
    m = _RX.match(str(s or ""))
    if not name or not m:
        return None
    try:
        from zoneinfo import ZoneInfo
        d, mo, h, mi = (int(x) for x in m.groups())
        now = datetime.now(timezone.utc)
        y = now.year
        if mo - now.month > 6:       # декабрь при январе
            y -= 1
        elif now.month - mo > 6:     # январь при декабре
            y += 1
        dt = datetime(y, mo, d, h, mi, tzinfo=ZoneInfo(WEST_TZ_NAME)).astimezone(ZoneInfo(name))
        return dt.strftime("%d/%m %H:%M")
    except Exception:
        return None
