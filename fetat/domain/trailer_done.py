"""v3.352: режим наблюдения — ✓ точек по юниту прицепа (свой GPS в Mapon) рядом с ✓ по тягачу.
✓ и ETA строки НЕ меняются: результат — только подсказка в плашке привязанного прицепа (linked_trailer.done_cmp).
v3.396: приоритет прицепа — авто-✓ прицепа закрывает точку, даже если тягач на ней не стоял (прицеп выгрузила другая машина без перецепа,
OC-3156 / C-196U, 27.11); без свежего GPS прицепа — ✓ по тягачу, как раньше (`merge_trailer_done`)."""
import time
from datetime import datetime, timezone

TRAILER_GPS_STALE_H = 6       # GPS прицепа старше — считаем несвежим, ✓ ведём по тягачу
TRAILER_DIVERGE_KM = 5        # прицеп дальше от тягача — подсказка «перецепили?» (стартовое значение, подстроим)
STOP_NUMS = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫"


def _parse_ts(v):
    if not v or not isinstance(v, str):
        return None
    try:
        d = datetime.fromisoformat(v.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.timestamp()


def gps_state(tu, now=None):
    """'none' — у прицепа нет координат; 'stale' — данные старше TRAILER_GPS_STALE_H; иначе 'ok'
    (поле last_update не пришло — считаем свежим: проверить нечем)."""
    if not tu or tu.get("lat") is None or tu.get("lng") is None:
        return "none"
    ts = _parse_ts(tu.get("last_update"))
    if ts is not None and (now if now is not None else time.time()) - ts > TRAILER_GPS_STALE_H * 3600:
        return "stale"
    return "ok"


def compare_done(truck_dn, trailer_dn):
    """-> [{i, truck, trailer}]: точки, где ✓ по тягачу и по прицепу расходятся.
    Ручные ✓, перецепы (swap_done) и запомненные ✓ тягача (kept) не сравниваем — по истории Mapon их проверить нечем."""
    out = []
    for i, (a, b) in enumerate(zip(truck_dn or [], trailer_dn or [])):
        if a.get("manual") is not None or a.get("kept") or a.get("swap_done"):
            continue
        ta, tb = bool(a.get("done")), bool(b.get("done"))
        if ta != tb:
            out.append({"i": i, "truck": ta, "trailer": tb})
    return out


def build_cmp(state, diff, km=None, kept=False):
    """Итог для фронта: mode truck_only (✓ по тягачу, у прицепа нет свежего GPS) | compare, text — подсказка."""
    if state != "ok":
        why = "у прицепа нет GPS" if state == "none" else f"GPS прицепа старше {TRAILER_GPS_STALE_H} ч"
        return {"mode": "truck_only", "why": state, "text": f"✓ точек считаем по тягачу — {why}"}
    lines = []
    if km is not None and km > TRAILER_DIVERGE_KM:
        lines.append(f"Прицеп в {km:.0f} км от тягача — перецепили?")
    if kept:
        lines.append("Часть ✓ запомнена раньше окна истории — сравнить с прицепом нельзя")
    elif not diff:
        lines.append("✓ по прицепу и тягачу совпадают")
    for d in diff:
        n = STOP_NUMS[d["i"]] if d["i"] < len(STOP_NUMS) else str(d["i"] + 1)
        lines.append(f"{n} — " + ("тягач был, прицеп нет" if d["truck"] else "прицеп был, тягач нет"))
    return {"mode": "compare", "why": "ok", "diff": diff, "text": "Сравнение ✓ (только подсказка): " + "; ".join(lines)}


def merge_trailer_done(dn, tdn, trailer_no=""):
    """v3.396: приоритет прицепа. dn — ✓ по тягачу, tdn — по прицепу (свежий GPS). Точку, где у тягача нет ни ручной ✓,
    ни перецепа, а у прицепа авто-✓, закрываем по прицепу (by_trailer = номер прицепа); дальше каскад «пройдена следующая — пройдены
    предыдущие». -> (новый список, индексы закрытых по прицепу)."""
    out = [dict(x) for x in dn]
    merged = []
    for i, (a, b) in enumerate(zip(dn, tdn or [])):
        if a.get("done") or a.get("manual") is not None or a.get("swap_done"):
            continue
        if b.get("done") and b.get("auto") and b.get("manual") is None and not b.get("kept") and b.get("by") is None:
            out[i] = {**b, "by_trailer": trailer_no or True}
            merged.append(i)
    if merged:
        last = max(i for i, x in enumerate(out) if x.get("done"))
        for i in range(last):
            x = out[i]
            if not x.get("done") and x.get("manual") is not False:
                x.update(done=True, auto=True, at=None, by=last)
    return out, merged
