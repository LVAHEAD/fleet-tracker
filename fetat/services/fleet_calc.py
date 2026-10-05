"""Флот: расчёт строки — статус машины, прицеп/реф, точки (✓ пройдено), км/ETA, тахо-ETA,
следующие точки цепочкой, страны, «на объекте», запреты, плашки кодов."""
from datetime import datetime, timedelta, timezone

from fetat.utils.timefmt import ts_west
from fetat.clients.google_routes import road_distance_km_google
from fetat.clients.mapon import fetch_group_unit_ids, fetch_reefer_units, fetch_units, get_tacho, unit_driving_days
from fetat.config import GOOGLE_API_KEY, HEAD_TRUCK_GROUP_ID, MAPON_API_KEY
from fetat.domain.bans import (bans_hits_text, bans_near_text, bans_on_route, countries_times_text, country_chain,
                               needs_at_night_ban)
from fetat.domain.points import (
    find_unit_by_label, find_unit_exact, NEAR_LABEL_MAX_KM, on_target, points_done,
    resolve_fleet_target, STATUS_RU, target_badge_info,
)
from fetat.domain.regions import nearest_region_code
from fetat.services.corridors import fleet_waypoints_resolved as fleet_waypoints   # v3.26: + выбор коридора
from fetat.domain.tacho import TACHO_SPEED_KMH, calc_eta, crew_mode, tacho_eta, tacho_summary, week_left_info
from fetat.domain.trailers import find_hitch, is_trailer, reefer_summary, TRAILER_FAR_KM
from fetat.utils.geo import haversine_km
from fetat.utils.timefmt import format_duration, round_to_15min


UNLOAD_STOP_SEC = 30 * 60   # v1.64: время на выгрузку/погрузку между точками одной машины


def calc_extra_stops(extras, units, unit, first, tacho, sim):
    """v1.64: точки 2..N строки Флота. Для каждой: км от машины по цепочке, км плеча,
    ETA (простой и по тахографу) с учётом UNLOAD_STOP_SEC на каждой предыдущей точке,
    запреты на плече, плашка кода региона, координаты и линия плеча для карты."""
    import time
    loc = lambda ts: ts_west(ts)
    now = time.time()
    prev_lat, prev_lng = first["target_lat"], first["target_lng"]
    cum_km = float(first.get("dist_km") or 0)
    # приезд на 1-ю точку
    prev_arr = sim["eta_ts"] if sim else now + cum_km / 70 * 3600
    out = []
    n_stops = 0          # сколько точек уже пройдено (на каждой UNLOAD_STOP_SEC)
    for tstr in extras:
        if not tstr:
            out.append({"empty": True})
            continue
        try:
            t = resolve_fleet_target(tstr, units, unit)
        except ValueError as e:
            out.append({"error": str(e)})
            break
        lat, lng = t.pop("lat"), t.pop("lng")
        if lat is None:
            out.append({"error": f"Не удалось распознать: {tstr}"})
            break
        leg_km, leg_poly = road_distance_km_google(prev_lat, prev_lng, lat, lng, GOOGLE_API_KEY,
                                                   fleet_waypoints(prev_lat, prev_lng, lat, lng),   # v2.03
                                                   kind="leg")   # v3.13: плечо — долгий общий кеш
        cum_km += leg_km
        n_stops += 1
        dwell = n_stops * UNLOAD_STOP_SEC
        simple_ts = now + cum_km / 70 * 3600 + dwell
        item = dict(t)
        item.update({
            "lat": lat, "lng": lng,
            "dist_km": round(cum_km, 1),
            "leg_km": round(leg_km, 1),
            "polyline": leg_poly,
            "eta_local": round_to_15min(loc(simple_ts)).strftime("%d/%m %H:%M"),
        })
        arr = simple_ts
        if tacho:
            try:
                sk = tacho_eta(tacho, cum_km, no_week=True)   # v3.16: недельный стоп — только до первой точки
                arr = sk["eta_ts"] + dwell
                item["eta_tacho"] = round_to_15min(loc(arr)).strftime("%d/%m %H:%M")
                item["tacho_rest_ahead"] = any(st["kind"] in ("daily", "weeklimit") for st in sk["stops"])
                item["tacho_weeklimit"] = bool(sk.get("week", {}).get("hit"))
            except Exception:
                pass
        item["badge"], item["badge_hint"] = target_badge_info(tstr, lat, lng, t.get("target_address"))
        if leg_poly and leg_km >= 5:
            try:
                det = {}
                hits, _bst = bans_on_route(leg_poly, leg_km, None, prev_arr + UNLOAD_STOP_SEC,
                                           at_night=needs_at_night_ban(unit), detail=det)
                fmt = lambda ts: loc(ts).strftime("%d/%m %H:%M")
                item["bans_route"] = bans_hits_text(hits, fmt)
                item["bans_near"] = bans_near_text(det.get("near") or [], fmt)   # v3.12
                item["bans_times"] = countries_times_text(det.get("countries") or [], fmt)
            except Exception:
                pass
        out.append(item)
        prev_lat, prev_lng, prev_arr = lat, lng, arr
    return out


def _unit_status(unit):
    """Статус машины из Mapon: стоит/едет, сколько, скорость, курс, координаты."""
    state = unit.get("state", {})
    status_name = state.get("name")
    duration_sec = state.get("duration", 0)

    result = {
        "number": unit.get("number"),
        "status": status_name,
        "status_ru": STATUS_RU.get(status_name, status_name),
        "duration_str": format_duration(duration_sec),
        "speed": unit.get("speed"),
        # v1.30: курс (градусы) для стрелки на плашке, если Mapon его отдаёт
        "direction": next((unit.get(k) for k in ("direction", "course", "heading", "angle")
                           if isinstance(unit.get(k), (int, float))), None),
        "last_update": unit.get("last_update"),
        "unit_lat": unit.get("lat"),
        "unit_lng": unit.get("lng"),
        "dist_km": None,
        "eta_local": None,
    }
    return result


def _add_trailer_info(result, unit, units, payload):
    """v1.70/v1.71: прицеп — реф и тягач рядом; у тягача — прицеп рядом и прицеп, привязанный вручную.
    Возвращает: юнит — прицеп или нет."""
    # v1.70: прицеп — рефка и тягач рядом; у тягача — прицеп рядом (Mapon их не связывает)
    trailer = is_trailer(unit)
    result["is_trailer"] = trailer
    try:
        truck_ids = fetch_group_unit_ids(MAPON_API_KEY, HEAD_TRUCK_GROUP_ID)
        h = find_hitch(unit, units, truck_ids)
        if h:
            result["hitch"] = h
    except Exception:
        pass
    if trailer:
        try:
            result["reefer"] = reefer_summary(fetch_reefer_units().get(unit.get("unit_id")))
        except Exception as e:
            result["reefer_error"] = str(e)
    # v1.71: прицеп, привязанный к тягачу вручную (строка Флота) — где он и что с рефкой
    lt = str(payload.get("trailer") or "").strip()
    if lt and not trailer:
        tu = find_unit_exact(units, lt)
        if tu is None:
            result["linked_trailer"] = {"number": lt, "error": "прицеп не найден в Mapon"}
        else:
            info = {"number": tu.get("number") or lt, "lat": tu.get("lat"), "lng": tu.get("lng"),
                    "status": (tu.get("state") or {}).get("name")}
            if None not in (unit.get("lat"), unit.get("lng"), tu.get("lat"), tu.get("lng")):
                info["km"] = round(haversine_km(unit["lat"], unit["lng"], tu["lat"], tu["lng"]), 2)
                info["far"] = info["km"] > TRAILER_FAR_KM
            try:
                info["reefer"] = reefer_summary(fetch_reefer_units().get(tu.get("unit_id")))
            except Exception as e:
                info["reefer_error"] = str(e)
            result["linked_trailer"] = info
    return trailer


def _apply_points_done(result, payload, target_str, unit, units):
    """v1.79: пройденные точки (✓) — считаем от машины сразу до первой непройденной.
    Возвращает (первая непройденная точка, следующие непройденные)."""
    # v1.79: пройденные точки (✓) — считаем от машины сразу до первой непройденной
    pts_all = [target_str] + [str(x or "").strip() for x in (payload.get("extra") or [])][:11]
    manual = [(v if v in (True, False) else None) for v in (payload.get("done") or [])]
    active_extras = pts_all[1:]
    if any(pts_all):
        try:
            seen = [(v if isinstance(v, str) else None) for v in (payload.get("done_seen") or [])]
            dn = points_done(pts_all, manual, unit, units, seen)
        except Exception:
            dn = [{"done": False} for _ in pts_all]
        result["points_done"] = dn
        active = [i for i, p in enumerate(pts_all) if not dn[i]["done"]]
        result["active_idx"] = active
        if not active:
            result["all_done"] = True
            target_str, active_extras = "", []
        else:
            target_str = pts_all[active[0]]
            active_extras = [pts_all[i] for i in active[1:]]
    return target_str, active_extras


def _add_tacho(result, unit, trailer, crew=None):
    """v1.33: тахограф — ETA по режиму труда и отдыха + подробности. Возвращает (tacho, sim).
    v3.15: crew — ручная правка "solo"/"team"; иначе тахограф (2 карты) + история трака за неделю."""
    tacho, sim = None, None
    try:
        tacho, terr = (None, None) if trailer else get_tacho(unit.get("unit_id"))
        if tacho:
            days = None
            if crew not in ("solo", "team") and len(tacho["drivers"]) < 2:
                days = unit_driving_days(unit.get("unit_id"))
            team, src, hist_max = crew_mode(tacho, crew, days)
            tacho = dict(tacho, team=team, crew_src=src)     # копия: кеш тахографа не трогаем
            result["crew"] = "team" if team else "solo"
            result["crew_src"] = src
            # v3.18: имена водителей из Mapon (карты в тахографе)
            names = [" ".join(filter(None, [(d.get("driver_name") or "").strip(), (d.get("driver_surname") or "").strip()]))
                     for d in tacho["drivers"]]
            names = [n for n in names if n]
            if names:
                result["crew_names"] = names
            if hist_max:
                result["crew_hist_max_h"] = round(hist_max / 3600, 1)
            if not team:
                wk = week_left_info(tacho)
                if wk:
                    result["week_left_sec"] = int(wk["left"])
                    result["week_limit"] = wk["limit"]
                    if wk.get("driven") is not None:
                        result["week_driven_sec"] = int(wk["driven"])
                    if wk.get("next") is not None:
                        result["week_next_sec"] = int(wk["next"])
            sim = None
            if result.get("dist_km") is not None:
                sim = tacho_eta(tacho, result["dist_km"])
                eta_t = round_to_15min(ts_west(sim["eta_ts"]))
                result["eta_tacho"] = eta_t.strftime("%d/%m %H:%M")
                result["tacho_rest_ahead"] = any(st["kind"] in ("daily", "weeklimit") for st in sim["stops"])
                result["_sim_stops"] = sim["stops"]
            d0 = next((d for d in tacho["drivers"] if d.get("current_state") == "DRIVING"), tacho["drivers"][0])
            result["tacho_resting_now"] = d0.get("current_state") == "REST"
            result["tacho_team"] = team
            result["tacho_summary"] = tacho_summary(tacho, sim)
            result["tacho_weeklimit"] = bool(sim and sim.get("week", {}).get("hit"))
        else:
            result["tacho_error"] = terr
    except Exception as e:
        result["tacho_error"] = str(e)
    return tacho, sim


def _week_short_last(result):
    """v3.16: одиночка — хватит ли остатка недели до последней непройденной точки (только предупреждение,
    ETA не сдвигаем): вождение = км до последней точки / 70 км/ч."""
    left = result.get("week_left_sec")
    if result.get("crew") != "solo" or left is None:
        return
    km = result.get("dist_km")
    for x in result.get("extra") or []:
        if x.get("dist_km") is not None:
            km = x["dist_km"]
    if km is None:
        return
    need = float(km) / TACHO_SPEED_KMH * 3600
    if need > left:
        result["week_short_last"] = {"need": int(need), "left": int(left), "short": int(need - left)}


def _add_route_context(result, unit):
    """v1.59/v1.45: страны по маршруту, «на объекте», полные запреты по пути."""
    # v1.59: цепочка стран по маршруту (без времени)
    if result.get("route_polyline") and result.get("dist_km"):
        try:
            result["route_countries"] = country_chain(result["route_polyline"], result["dist_km"])
        except Exception:
            pass
    # v1.59: трак на объекте таргета (полигон Mapon или радиус вокруг точки)
    if result.get("target_lat") is not None:
        try:
            ot = on_target(unit["lat"], unit["lng"], result["target_lat"], result["target_lng"])
            if ot:
                result["on_target"] = ot
        except Exception:
            pass

    # v1.45: полные запреты по пути (по тахо-симуляции, иначе без остановок)
    stops = result.pop("_sim_stops", None)
    # v1.60: трак на объекте или до таргета меньше 5 км — запреты не проверяем
    if (result.get("route_polyline") and result.get("dist_km")
            and result["dist_km"] >= 5 and not result.get("on_target")):
        try:
            det = {}
            hits, bst = bans_on_route(result["route_polyline"], result["dist_km"], stops,
                                     at_night=needs_at_night_ban(unit), detail=det)
            loc = lambda ts: ts_west(ts).strftime("%d/%m %H:%M")
            result["bans_route"] = bans_hits_text(hits, loc)
            result["bans_near"] = bans_near_text(det.get("near") or [], loc)   # v3.12
            result["bans_times"] = countries_times_text(det.get("countries") or [], loc)
            result["bans_status"] = bst
        except Exception as e:
            result["bans_status"] = f"ошибка: {e}"


def _add_code_badges(result, target_str):
    """v1.31: страна машины и код региона таргета (плашки в таблице)."""
    # v1.31: страна машины и код региона таргета (плашки в таблице)
    try:
        if result.get("unit_lat") is not None:
            code, d = nearest_region_code(result["unit_lat"], result["unit_lng"])
            if code:
                result["unit_country"] = code[:2]
                result["unit_code_hint"] = f"{code[:2]} · около {code}" + (f" ({round(d)} км)" if d > NEAR_LABEL_MAX_KM else "")
        if result.get("target_lat") is not None:
            result["target_badge"], result["target_code_hint"] = target_badge_info(
                target_str, result["target_lat"], result["target_lng"], result.get("target_address"))
    except Exception:
        pass


class _StepTimer:
    """v3.20: время шагов расчёта строки — в лог Cloud Run, если строка считалась дольше SLOW_ROW_SEC."""
    def __init__(self):
        import time
        self._t = time.perf_counter
        self.t0 = self.last = self._t()
        self.steps = []

    def mark(self, name):
        now = self._t()
        self.steps.append((name, now - self.last))
        self.last = now

    def total(self):
        return self._t() - self.t0


SLOW_ROW_SEC = 3.0


def calc_row(payload):
    tm = _StepTimer()
    res = _calc_row(payload, tm)
    total = tm.total()
    if total >= SLOW_ROW_SEC:
        steps = " ".join(f"{n}={d:.1f}" for n, d in tm.steps if d >= 0.05)
        print(f"[calc] {payload.get('unit', '')} {total:.1f}s why={payload.get('why', '')} {steps}", flush=True)
    return res


def _calc_row(payload, tm):
    """Строка Флота. payload: {"unit", "target", "extra": [...], "done": [...], "trailer"}.
    target — "43.30726, -8.48246" | "Oslo" | "NO01" | "". Возвращает (ответ, HTTP-код)."""
    if not MAPON_API_KEY:
        return {"error": "MAPON_API_KEY не настроен на сервере"}, 500

    unit_query = payload.get("unit", "")
    target_str = payload.get("target", "")

    if not unit_query:
        return {"error": "Не указана машина"}, 400

    try:
        units = fetch_units(MAPON_API_KEY)
        tm.mark("units")
        exact = find_unit_exact(units, unit_query)
        matches = [exact] if exact else find_unit_by_label(units, unit_query)
        if not matches:
            return {"error": f"Машина '{unit_query}' не найдена"}, 404
        if len(matches) > 1:
            return ({
                "error": "Найдено несколько машин, уточните запрос",
                "candidates": [u.get("number") for u in matches],
            }), 409

        unit = matches[0]
        result = _unit_status(unit)

        trailer = _add_trailer_info(result, unit, units, payload)
        tm.mark("trailer")

        target_str, active_extras = _apply_points_done(result, payload, target_str, unit, units)
        tm.mark("done")

        try:
            tgt = resolve_fleet_target(target_str, units, unit)
        except ValueError as e:
            return {"error": str(e)}, 400
        target_lat, target_lng = tgt.pop("lat"), tgt.pop("lng")
        result.update(tgt)
        tm.mark("target")
        if target_lat is not None and not GOOGLE_API_KEY:
            return {"error": "GOOGLE_API_KEY не настроен на сервере"}, 500

        if target_lat is not None:
            cur_lat, cur_lng = unit["lat"], unit["lng"]
            wps = fleet_waypoints(cur_lat, cur_lng, target_lat, target_lng)   # v2.03: паромы/Инсбрук и во Флоте
            dist_km, polyline = road_distance_km_google(cur_lat, cur_lng, target_lat, target_lng, GOOGLE_API_KEY, wps)
            if wps:
                result["waypoints_applied"] = True
            _, eta_local = calc_eta(dist_km)
            result["dist_km"] = round(dist_km, 1)
            result["eta_local"] = eta_local.strftime("%d/%m %H:%M")
            result["target_lat"] = target_lat
            result["target_lng"] = target_lng
            result["route_polyline"] = polyline
            tm.mark("route")

        tacho, sim = _add_tacho(result, unit, trailer, payload.get("crew"))
        tm.mark("tacho")

        # v1.64: следующие точки той же машины (2-я, 3-я выгрузка...) — цепочкой от
        # предыдущей точки, плюс UNLOAD_STOP_SEC на каждую предыдущую точку
        extras = active_extras   # v1.74: до 12 точек; v1.79: без пройденных
        if extras and result.get("target_lat") is not None:
            try:
                result["extra"] = calc_extra_stops(extras, units, unit, result, tacho, sim)
            except Exception as e:
                result["extra"] = [{"error": str(e)} for _ in extras]

        tm.mark("extra")
        _week_short_last(result)

        _add_route_context(result, unit)

        _add_code_badges(result, target_str)
        tm.mark("context")

        return result, 200

    except Exception as e:
        return {"error": str(e)}, 502
