"""Длинная история отдыхов водителя (v3.355, решения Владимира 16.11 / 22.11).
Хранить 60 дней, показывать 56. Склейка: ключ — начало отдыха; при совпадении или перекрытии берём запись с более поздним
концом; кусок, обрезанный краем окна, заменяется полным; два куска встык (зазор ≤ 15 мин) сливаем в один."""
import time

from fetat.store.rests_store import RESTS_STORE

KEEP_DAYS = 60                 # храним
SHOW_DAYS = 56                 # показываем
JOIN_GAP_SEC = 15 * 60         # куски встык (≤ 15 мин) — один отдых
ONGOING_SEC = 120              # отдых, закончившийся менее 2 мин назад, ещё идёт — не сохраняем
SAVE_EVERY = 6 * 3600          # писать в хранилище не чаще раза в 6 ч на водителя

_saved_at = {}


def merge_rests(stored, fresh, now, keep_days=KEEP_DAYS, gap=JOIN_GAP_SEC, edge_from=None):
    """Склеивает две истории отдыхов [{start, end, src}] в одну по времени; старше keep_days — отбрасывает.
    Склеиваем только пересекающиеся / соприкасающиеся куски. Зазор ≤ gap (15 мин) закрываем только у куска, начатого
    у края окна (start ≤ edge_from + gap): это обрезанный отдых, его хвост лежит в хранилище. Внутри окна Mapon кусок
    с зазором > 2 мин — отдельный отдых (как в Mapon): иначе «большая 9ка» и недельный склеивались бы через короткую поездку."""
    items = []
    for r in list(stored or []) + list(fresh or []):
        try:
            s, e = float(r["start"]), float(r["end"])
        except (KeyError, TypeError, ValueError):
            continue
        if e > s:
            items.append({"start": s, "end": e, "src": set(r.get("src") or [])})
    items.sort(key=lambda r: (r["start"], r["end"]))
    out = []
    for r in items:
        join = bool(out) and (r["start"] <= out[-1]["end"] or
                              (edge_from is not None and r["start"] <= edge_from + gap and r["start"] <= out[-1]["end"] + gap))
        if join:
            cur = out[-1]
            cur["end"] = max(cur["end"], r["end"])
            cur["src"] |= r["src"]
        else:
            out.append(r)
    cutoff = now - keep_days * 86400
    return [{"start": int(r["start"]), "end": int(r["end"]), "src": sorted(r["src"])} for r in out if r["end"] >= cutoff]


def _outside_window(stored, window_from):
    """Хранилище отдаёт только то, что Mapon уже не показывает: куски, начатые до края окна. Всё, что начато внутри окна,
    берём из свежего ответа Mapon: его правки (CAN-оценка «без карты» заменена данными тахографа) важнее старой записи,
    иначе объединение со старым вариантом растягивает отдых и тянет его начало / конец к прежним значениям."""
    return [r for r in stored or [] if r["start"] < (window_from or 0) + 60]


def _complete(hist, now):
    """Завершённые отдыхи окна: без идущего сейчас и без обрезанного началом окна."""
    t0 = (hist or {}).get("from") or 0
    return [r for r in (hist or {}).get("rests") or []
            if r["start"] > t0 + 60 and r["end"] < now - ONGOING_SEC]


def remember(driver_id, hist, now=None):
    """Дописывает завершённые отдыхи окна в хранилище (не чаще раза в SAVE_EVERY). Сбой хранилища не ломает расчёт."""
    now = float(now or time.time())
    if not driver_id or not hist or now - _saved_at.get(driver_id, 0) < SAVE_EVERY:
        return
    _saved_at[driver_id] = now
    try:
        rec = RESTS_STORE.get(driver_id) or {}
        old = rec.get("rests") or []
        merged = merge_rests(_outside_window(old, hist.get("from")), _complete(hist, now), now)   # края окна здесь нет: берём только завершённые куски
        if merged != [{"start": int(r["start"]), "end": int(r["end"]), "src": sorted(r.get("src") or [])} for r in old]:
            RESTS_STORE.put(driver_id, {"rests": merged, "since": rec.get("since") or int(hist.get("from") or now),
                                        "saved_at": int(now)})
    except Exception:
        _saved_at.pop(driver_id, None)


def long_history(driver_id, hist, now=None):
    """Окно Mapon + хранилище: {"rests", "cards", "from"}. from — начало покрытия, не глубже SHOW_DAYS."""
    now = float(now or time.time())
    hist = hist or {}
    try:
        rec = RESTS_STORE.get(driver_id) or {}
    except Exception:
        rec = {}
    cur_from = hist.get("from") or now
    since = min(rec.get("since") or cur_from, cur_from)
    start = max(since, now - SHOW_DAYS * 86400)
    rests = merge_rests(_outside_window(rec.get("rests"), cur_from), hist.get("rests"), now, keep_days=SHOW_DAYS, edge_from=cur_from)
    return {"rests": rests, "cards": hist.get("cards") or [], "from": start, "window_from": cur_from}
