"""Флот: расчёт строки — статус машины, прицеп/реф, точки (✓ пройдено), км/ETA, тахо-ETA,
следующие точки цепочкой, страны, «на объекте», запреты, плашки кодов."""

from fetat.domain.local_time import local_tz, to_local_str
from fetat.domain.regions import _country_at
from fetat.utils.timefmt import ts_west
from fetat.clients.google_routes import road_distance_km_google
from fetat.clients.mapon import (fetch_group_unit_ids, fetch_reefer_units, fetch_units, get_tacho, unit_driver_names,
                                 unit_driving_days, unit_route_segments)
from fetat.config import GOOGLE_API_KEY, HEAD_TRUCK_GROUP_ID, MAPON_API_KEY
from fetat.domain.bans import (bans_hits_text, bans_near_text, bans_on_route, countries_times_text, country_chain,
                               needs_at_night_ban)
from fetat.domain.points import (
    find_unit_by_label, find_unit_exact, NEAR_LABEL_MAX_KM, on_target, points_done, site_arrival,
    resolve_fleet_target, STATUS_RU, target_badge_info,
)
from fetat.domain.regions import nearest_region_code
from fetat.services.corridors import fleet_waypoints_resolved as fleet_waypoints   # v3.26: + выбор коридора
from fetat.services.corridors import clean_corridor, corridor_info, fleet_corridor_cands   # v3.32: выбор диспетчера
from fetat.domain.ferries import PORT_RADIUS_KM, clean_line_id, ferry_options, ferry_sec, find_ferry
from fetat.domain.tacho import (FRESH_SOLO_TACHO, TZ_DEFAULT, plan as tacho_plan, TACHO_SPEED_KMH, calc_eta, calc_seed, country_tz, crew_mode, gps_shift,
                               tacho_eta, tacho_no_subscription,
                               tacho_panel, tacho_summary, week_left_info)
from fetat.domain.trailers import find_hitch, is_trailer, reefer_summary, TRAILER_FAR_KM, truck_fuel, truck_weight
from fetat.utils.geo import haversine_km
from fetat.utils.timefmt import ceil_15min, format_duration
from fetat.utils.log import warn


UNLOAD_STOP_SEC = 30 * 60    # стоянка на каждой пройденной точке цепочки — 30 мин по умолчанию (15.10; в v3.39 было 0, до того 30 мин)


def calc_extra_stops(extras, units, unit, first, tacho, sim, corridor=None, deps=None, first_str="", ferry_id=None):
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
    deps = deps or {}     # v3.192: {текст точки: отход (epoch, сек)} — из «Даты» точек
    prev_str = str(first_str or "").strip().lower()
    ferry_late = False
    ferry_extra = 0.0    # v3.191: сек. парома (рейс + Gate-In) сверх обычной стоянки — в простой ETA
    fb = None            # v3.191: точка отсчёта тахо-плана после парома (приход в порт + рейс)
    for xi, tstr in enumerate(extras):
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
        fr = find_ferry(prev_lat, prev_lng, lat, lng, ferry_id)   # v3.191: предыдущая точка — порт, таргет за морем
        if fr and haversine_km(lat, lng, fr["to"][0], fr["to"][1]) <= PORT_RADIUS_KM:
            leg_wps, leg_km, leg_poly = None, 0.0, None   # таргет — сам порт назначения
        elif fr:
            leg_wps = None
            leg_km, leg_poly = road_distance_km_google(fr["to"][0], fr["to"][1], lat, lng, GOOGLE_API_KEY, None, kind="leg")
        else:
            leg_wps = fleet_waypoints(prev_lat, prev_lng, lat, lng, corridor)   # v2.03; v3.32: + выбор коридора
            leg_km, leg_poly = road_distance_km_google(prev_lat, prev_lng, lat, lng, GOOGLE_API_KEY, leg_wps,
                                                       kind="leg")   # v3.13: плечо — долгий общий кеш
        if not fr and "corridor" not in first:                       # v3.32: плашка коридора — по первому такому плечу
            cc = fleet_corridor_cands(prev_lat, prev_lng, lat, lng)
            if cc:
                first["corridor"] = corridor_info(cc, leg_wps, corridor, (prev_lat, prev_lng, lat, lng), to=xi + 1)   # v3.45: плечо к точке xi + 2
                if _enters_switzerland(leg_poly, leg_km):
                    first["corridor"]["swiss"] = True     # v3.84: ⚠ на плашке коридора
        cum_km += leg_km
        n_stops += 1
        dwell = n_stops * UNLOAD_STOP_SEC
        fsec = fr["sec"] if fr else 0.0
        if fr:
            dep_ts = deps.get(prev_str)
            prev_simple = now + (cum_km - leg_km) / 70 * 3600 + (n_stops - 1) * UNLOAD_STOP_SEC + ferry_extra
            fsec_s, _l = ferry_sec(fr, prev_simple, dep_ts)
            ferry_extra += fsec_s - UNLOAD_STOP_SEC
            fsec, ferry_late = ferry_sec(fr, prev_arr, dep_ts)
        simple_ts = now + cum_km / 70 * 3600 + dwell + ferry_extra
        item = dict(t)
        item.update({
            "lat": lat, "lng": lng,
            "dist_km": round(cum_km, 1),
            "leg_km": round(leg_km, 1),
            "polyline": leg_poly,
            "eta_local": ceil_15min(loc(simple_ts)).strftime("%d/%m %H:%M"),
        })
        if fr:
            item["ferry"] = {"label": fr["label"], "hours": fr["hours"], "gate_in_h": fr["gate_in_h"],
                             "from": fr["from_name"], "to": fr["to_name"],
                             "arrive": ceil_15min(loc(prev_arr + fsec)).strftime("%d/%m %H:%M"),
                             "port_arr": ceil_15min(loc(prev_arr)).strftime("%d/%m %H:%M"), "late": ferry_late,
                             "dep": ceil_15min(loc(deps[prev_str])).strftime("%d/%m %H:%M") if deps.get(prev_str) else None,
                             "from_ll": list(fr["from"]), "to_ll": list(fr["to"]),
                             "id": fr["id"], "manual": fr["manual"], "options": ferry_options(prev_lat, prev_lng, lat, lng)}
        arr = simple_ts
        if tacho and fr:
            try:
                tm = bool(tacho_eta(tacho, max(cum_km - leg_km, 1.0)).get("team"))
                fb = {"ts": prev_arr + fsec, "km0": cum_km - leg_km, "n0": n_stops, "team": tm,
                      "tz": country_tz("FI") if fr["to_fi"] else TZ_DEFAULT}
            except Exception as _e:
                warn("fleet_calc:ferry", _e)
                fb = None
        if tacho and fb:
            try:
                pl = tacho_plan(fb["ts"], max(cum_km - fb["km0"], 0.0), team=fb["team"], tz=fb["tz"])
                arr = pl["eta_ts"] + (n_stops - fb["n0"]) * UNLOAD_STOP_SEC
                item["eta_tacho"] = ceil_15min(loc(arr)).strftime("%d/%m %H:%M")
                item["tacho_rest_ahead"] = any(e["k"] == "r" for e in pl["ev"])
                item["tacho_weeklimit"] = False
            except Exception as _e:
                warn("fleet_calc:ferry-plan", _e)
        elif tacho:
            try:
                sk = tacho_eta(tacho, cum_km)   # v3.39: неделя — только отметка, и на ②③
                arr = sk["eta_ts"] + dwell
                item["eta_tacho"] = ceil_15min(loc(arr)).strftime("%d/%m %H:%M")
                item["tacho_rest_ahead"] = any(st["kind"] in ("daily", "weeklimit") for st in sk["stops"])
                item["tacho_weeklimit"] = bool(sk.get("week", {}).get("hit"))   # отметка, ETA не сдвинут
            except Exception as _e:
                warn("fleet_calc:83", _e)
                pass
        item["badge"], item["badge_hint"] = target_badge_info(tstr, lat, lng, t.get("target_address"))
        if leg_poly and leg_km >= 5:
            try:
                det = {}
                hits, _bst = bans_on_route(leg_poly, leg_km, None, (fb["ts"] if fr and fb else prev_arr + UNLOAD_STOP_SEC),
                                           at_night=needs_at_night_ban(unit), detail=det)
                fmt = lambda ts: loc(ts).strftime("%d/%m %H:%M")
                item["bans_route"] = bans_hits_text(hits, fmt)
                item["bans_near"] = bans_near_text(det.get("near") or [], fmt)   # v3.12
                item["bans_times"] = countries_times_text(det.get("countries") or [], fmt)
            except Exception as _e:
                warn("fleet_calc:95", _e)
                pass
        out.append(item)
        prev_lat, prev_lng, prev_arr = lat, lng, arr
        prev_str = str(tstr or "").strip().lower()
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
    except Exception as _e:
        warn("fleet_calc:137", _e)
        pass
    if trailer:
        try:
            result["reefer"] = reefer_summary(fetch_reefer_units().get(unit.get("unit_id")))
        except Exception as e:
            result["reefer_error"] = str(e)
    else:
        # v3.30: топливо тягача — показываем и мигаем, только когда меньше TRUCK_FUEL_LOW_L
        try:
            tf = truck_fuel(fetch_reefer_units().get(unit.get("unit_id")))
            if tf:
                result["truck_fuel"] = tf
            tw = truck_weight(fetch_reefer_units().get(unit.get("unit_id")))   # v3.34: гружён ли — для тревоги рефа
            if tw:
                result["truck_weight"] = tw
        except Exception as _e:
            warn("fleet_calc:153", _e)
            pass
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


def _add_done_legs(dn, pts_all, units, unit):
    """v3.122: км плеча у пройденных точек ②③… — от предыдущей точки до этой (у ① плеча нет: там путь от машины).
    Тот же расчёт и общий долгий кеш плеч, что у непройденных (kind="leg"): Google только при первом показе плеча.
    Точки-траки (встреча) пропускаем — у них нет постоянных координат; любая ошибка — просто без км."""
    for k in range(1, len(pts_all)):
        if not dn[k].get("done") or not pts_all[k] or not pts_all[k - 1]:
            continue
        try:
            a = resolve_fleet_target(pts_all[k - 1], units, unit)
            b = resolve_fleet_target(pts_all[k], units, unit)
            if a.get("target_is_truck") or b.get("target_is_truck"):
                continue
            wps = fleet_waypoints(a["lat"], a["lng"], b["lat"], b["lng"], None)
            km, _poly = road_distance_km_google(a["lat"], a["lng"], b["lat"], b["lng"], GOOGLE_API_KEY, wps, kind="leg")
            if km is not None:
                dn[k]["leg_km"] = round(km, 1)
        except Exception as e:
            warn("fleet:done_leg", e)


def _apply_points_done(result, payload, target_str, unit, units, tm=None):
    """v1.79: пройденные точки (✓) — считаем от машины сразу до первой непройденной.
    Возвращает (первая непройденная точка, следующие непройденные)."""
    # v1.79: пройденные точки (✓) — считаем от машины сразу до первой непройденной
    pts_all = [target_str] + [str(x or "").strip() for x in (payload.get("extra") or [])][:11]
    manual = [(v if v in (True, False) else None) for v in (payload.get("done") or [])]
    active_extras = pts_all[1:]
    if any(pts_all):
        try:
            seen = [(v if isinstance(v, str) else None) for v in (payload.get("done_seen") or [])]
            seen_arr = [(v if isinstance(v, str) else None) for v in (payload.get("done_arr") or [])]   # v3.57
            click = [(v if isinstance(v, str) else None) for v in (payload.get("done_click") or [])]   # v3.172: время нажатия ручной ✓
            dn = points_done(pts_all, manual, unit, units, seen, seen_arr, click)
        except Exception as e:
            warn("fleet:points_done", e)      # v3.98: раньше молча — вся строка без ✓
            dn = [{"done": False} for _ in pts_all]
        if tm:
            tm.mark("d_pts")                          # v3.124: подшаги done
        _add_done_legs(dn, pts_all, units, unit)   # v3.122
        if tm:
            tm.mark("d_legs")
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


def _add_tacho(result, unit, trailer, crew=None, x10=False, crew_seen=None, tm=None):
    """v1.33: тахограф — ETA по режиму труда и отдыха + подробности. Возвращает (tacho, sim).
    v3.15: crew — ручная правка "solo"/"team"; иначе тахограф (2 карты) + история трака за неделю;
    v3.105: crew_seen — когда по тахографу видели две карты (сек), память строки."""
    tacho, sim = None, None
    try:
        tacho, terr = (None, None) if trailer else get_tacho(unit.get("unit_id"))
        if tm:
            tm.mark("t_get")                             # v3.124: подшаги tacho
        if tacho:
            days = None
            if crew not in ("solo", "team") and len(tacho["drivers"]) < 2:
                days = unit_driving_days(unit.get("unit_id"))
            team, src, hist_max = crew_mode(tacho, crew, days, crew_seen)
            if tm:
                tm.mark("t_crew")
            tacho = dict(tacho, team=team, crew_src=src)     # копия: кеш тахографа не трогаем
            tacho.update(_eta_opts(unit, x10))               # v3.39: пояс страны (ночная смена) и 10-й час
            g = _gps_shift_of(unit)                          # v3.104: смена по GPS — поправка, если тахограф отстаёт
            if g:
                tacho["gps"] = g
            result["crew"] = "team" if team else "solo"
            result["crew_src"] = src
            if src == "memory":
                result["crew_seen_at"] = int(float(crew_seen))   # v3.105: когда видели две карты
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
                if tm:
                    tm.mark("t_sim")
                eta_t = ceil_15min(ts_west(sim["eta_ts"]))
                result["eta_tacho"] = eta_t.strftime("%d/%m %H:%M")
                result["tacho_rest_ahead"] = any(st["kind"] in ("daily", "weeklimit") for st in sim["stops"])
                result["_sim_stops"] = sim["stops"]
                gf = sim.get("gps_fix")
                if gf:                                       # v3.104: для подсказки значка «экипаж / соло»
                    result["tacho_gps_fix"] = {"driven": int(gf["driven"]), "tacho": int(gf["tacho"]),
                                               "start": int(gf["start"])}
            d0 = next((d for d in tacho["drivers"] if d.get("current_state") == "DRIVING"), tacho["drivers"][0])
            result["tacho_resting_now"] = d0.get("current_state") == "REST"
            result["tacho_team"] = team
            result["tacho_summary"] = tacho_summary(tacho, sim)
            try:                                              # v3.217: числа для всплывашки статуса; только показ
                result["tacho_panel"] = tacho_panel(tacho, sim)
            except Exception:
                pass
            result["tacho_weeklimit"] = bool(sim and sim.get("week", {}).get("hit"))
            result["calc_seed"] = calc_seed(tacho)          # v3.31: для ⏱ калькулятора по клику на строку
        else:
            result["tacho_error"] = terr
            if not trailer:
                tacho, sim = _no_card_crew(result, unit, crew, terr, crew_seen)
    except Exception as e:
        result["tacho_error"] = str(e)
    return tacho, sim


def truck_seed(unit, crew=None, crew_seen=None):
    """v3.114: стартовые данные машины для ⏱ калькулятора — тем же путём, что у строки Флота (`_add_tacho`):
    память режима, пояс страны, GPS-поправка, начало смены, машина без карт. Нет данных — None."""
    res = {}
    _add_tacho(res, unit, None, crew, False, crew_seen)
    seed = res.get("calc_seed")
    if seed is None:
        return None
    seed = dict(seed, crew_src=res.get("crew_src"))        # откуда состав: manual / tacho / hist / memory — калькулятор показывает
    if res.get("crew_hist_max_h"):
        seed["crew_hist_h"] = res["crew_hist_max_h"]
    if res.get("crew_seen_at"):
        seed["crew_seen_at"] = res["crew_seen_at"]
    return seed


def _crew_seen(payload):
    """v3.105: когда по тахографу видели две карты (сек) — память строки; мусор — None."""
    try:
        v = float(payload.get("crew_seen") or 0)
        return v if v > 0 else None
    except (TypeError, ValueError):
        return None


def _gps_shift_of(unit):
    """v3.104: {"start", "driven"} — смена по GPS-истории Mapon или None (нет истории / ошибка — без поправки)."""
    import time
    try:
        return gps_shift(unit_route_segments(unit.get("unit_id")), time.time())
    except Exception as e:
        warn("fleet:gps_shift", e)
        return None


def _eta_opts(unit, x10):
    """v3.39: для движка ETA — пояс страны, где машина (ночь 00:00–04:00 по местному), и 10-й час в первый день."""
    out = {"ext": (0,) if x10 else ()}
    try:
        if unit.get("lat") is not None:
            code, _d = nearest_region_code(unit["lat"], unit["lng"])
            if code:
                out["tz"] = country_tz(code[:2])
    except Exception as _e:
        warn("fleet_calc:263", _e)
        pass
    return out


NO_CARD_FRESH_SEC = 9 * 3600     # v3.29: без карт — стоит не меньше суточного отдыха → считаем со свежего дня


def _no_card_crew(result, unit, crew=None, terr=None, crew_seen=None):
    """v3.29 (OS-2438): Mapon не видит карт водителя, хотя водители в машине. Соло / экипаж — по истории
    вождения за неделю (или вручную); стоит ≥ 9 ч — тахо-ETA со свежего дня (без недельного лимита),
    иначе ETA простой. Возвращает (tacho, sim) — подменный тахограф или (None, None)."""
    import copy
    days = None if crew in ("solo", "team") else unit_driving_days(unit.get("unit_id"))
    team, src, hist_max = crew_mode(None, crew, days, crew_seen)
    result["crew"] = "team" if team else "solo"
    result["crew_src"] = src if src in ("manual", "memory") else "hist"
    if src == "memory":
        result["crew_seen_at"] = int(float(crew_seen))   # v3.105
    result["crew_nocard"] = True
    nosub = tacho_no_subscription(terr)     # v3.30: нет подписки на тахограф (Mapon 1015) — не временно
    if nosub:
        result["crew_nosub"] = True
    if hist_max:
        result["crew_hist_max_h"] = round(hist_max / 3600, 1)
    try:
        names = unit_driver_names(unit.get("unit_id"))
    except Exception:
        names = []
    if names:
        result["crew_names"] = names
    state = unit.get("state") or {}
    stood = float(state.get("duration") or 0) if state.get("name") == "standing" else 0.0
    summ = ["⚠ Нет подписки Mapon на тахограф (Tachograph remote download) — данных тахографа не будет" if nosub
            else "⚠ Mapon не видит карт водителя — тахографа нет",
            ("вручную: " if src == "manual" else "по истории недели: ") + ("экипаж" if team else "соло")]
    if names:
        summ.append("водитель в Mapon: " + ", ".join(names))
    if stood >= NO_CARD_FRESH_SEC and result.get("dist_km") is not None:
        fresh = copy.deepcopy(FRESH_SOLO_TACHO)
        fresh["drivers"][0]["now"]["rest"] = stood
        fresh.update(team=team, crew_src=result["crew_src"], nocard=True, **_eta_opts(unit, False))
        sim = tacho_eta(fresh, result["dist_km"], no_week=True)
        eta_t = ceil_15min(ts_west(sim["eta_ts"]))
        result["eta_tacho"] = eta_t.strftime("%d/%m %H:%M")
        result["tacho_rest_ahead"] = any(st["kind"] in ("daily", "weeklimit") for st in sim["stops"])
        result["_sim_stops"] = sim["stops"]
        result["tacho_resting_now"] = True
        result["tacho_team"] = team
        result["tacho_weeklimit"] = False
        summ.append(f"стоит {format_duration(stood)} — считаем, что отдохнул: ETA со свежего дня")
        result["tacho_summary"] = summ
        result["calc_seed"] = calc_seed(fresh)              # v3.31: свежий день, недельного остатка нет
        return fresh, sim
    summ.append("едет или стоит меньше 9 ч — ETA простой, без отдыхов")
    result["tacho_summary"] = summ
    # v3.31: остатка вождения не знаем — калькулятору только состав, остаток по максимуму
    result["calc_seed"] = {"team": team, "left_h": 18.0 if team else 9.0, "shift_h": 0.0, "resting": False,
                           "shorts": 3, "nocard": True, "unknown": True}
    return None, None


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


def _enters_switzerland(polyline, dist_km):
    """v3.84: линия маршрута заходит в Швейцарию (для плашки коридора обхода Швейцарии)."""
    try:
        return bool(polyline and dist_km) and "CH" in country_chain(polyline, dist_km)
    except Exception as _e:
        warn("fleet_calc:swiss", _e)
        return False


def _add_route_context(result, unit):
    """v1.59/v1.45: страны по маршруту, «на объекте», полные запреты по пути."""
    # v1.59: цепочка стран по маршруту (без времени)
    if result.get("route_polyline") and result.get("dist_km"):
        try:
            result["route_countries"] = country_chain(result["route_polyline"], result["dist_km"])
            if result.get("corridor") and "CH" in result["route_countries"]:
                result["corridor"]["swiss"] = True        # v3.84: ⚠ на плашке коридора
        except Exception as _e:
            warn("fleet_calc:346", _e)
            pass
    # v1.59: трак на объекте таргета (полигон Mapon или радиус вокруг точки)
    if result.get("target_lat") is not None:
        try:
            ot = on_target(unit["lat"], unit["lng"], result["target_lat"], result["target_lng"])
            if ot:
                ot = dict(ot)
                arr = site_arrival(unit)      # v3.82: приезд на объект — в ETA точки вместо расчёта
                if arr:
                    ot["arr"] = arr
                result["on_target"] = ot
        except Exception as _e:
            warn("fleet_calc:354", _e)
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
    except Exception as _e:
        warn("fleet_calc:387", _e)
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


SLOW_ROW_SEC = 1.5   # v3.124: было 3.0 — в лог попадает больше строк, чтобы видеть, что тормозит


def calc_row(payload):
    tm = _StepTimer()
    res = _calc_row(payload, tm)
    total = tm.total()
    if total >= SLOW_ROW_SEC:
        steps = " ".join(f"{n}={d:.1f}" for n, d in tm.steps if d >= 0.05)
        print(f"[calc] {payload.get('unit', '')} {total:.1f}s why={payload.get('why', '')} {steps}", flush=True)
    return res


def _find_unit(units, unit_query):
    """-> (unit, None) или (None, (ответ, код))."""
    exact = find_unit_exact(units, unit_query)
    matches = [exact] if exact else find_unit_by_label(units, unit_query)
    if not matches:
        return None, ({"error": f"Машина '{unit_query}' не найдена"}, 404)
    if len(matches) > 1:
        return None, ({
            "error": "Найдено несколько машин, уточните запрос",
            "candidates": [u.get("number") for u in matches],
        }, 409)
    return matches[0], None


def _add_route_to_target(result, unit, target_lat, target_lng, payload, tm=None):
    """Маршрут «машина → цель»: коридор, км, ETA по простой скорости, линия."""
    cur_lat, cur_lng = unit["lat"], unit["lng"]
    corridor = clean_corridor(payload.get("corridor"))                # v3.32: коридор выбрал диспетчер
    wps = fleet_waypoints(cur_lat, cur_lng, target_lat, target_lng, corridor)   # v2.03: паромы/Инсбрук и во Флоте
    if tm:
        tm.mark("r_wps")      # v3.124: из чего состоит шаг route (в лог — только то, что ≥ 0,05 с)
    cc = fleet_corridor_cands(cur_lat, cur_lng, target_lat, target_lng)
    if cc:
        result["corridor"] = corridor_info(cc, wps, corridor, (cur_lat, cur_lng, target_lat, target_lng))
    if tm:
        tm.mark("r_cor")
    dist_km, polyline = road_distance_km_google(cur_lat, cur_lng, target_lat, target_lng, GOOGLE_API_KEY, wps)
    if tm:
        tm.mark("r_gmaps")
    if wps:
        result["waypoints_applied"] = True
    _, eta_local = calc_eta(dist_km)
    result["dist_km"] = round(dist_km, 1)
    result["eta_local"] = eta_local.strftime("%d/%m %H:%M")
    result["target_lat"] = target_lat
    result["target_lng"] = target_lng
    result["route_polyline"] = polyline


def _deps(payload):
    """v3.192: отходы из «Даты» точек: {текст точки (нижний регистр): epoch сек}; мусор отбрасываем."""
    out = {}
    d = payload.get("dep")
    if isinstance(d, dict):
        for k, v in list(d.items())[:12]:
            if isinstance(v, (int, float)) and v > 0:
                out[str(k).strip().lower()] = float(v)
    return out


def _add_extra(result, extras, units, unit, tacho, sim, payload):
    """v1.64: следующие точки той же машины (2-я, 3-я выгрузка...) — цепочкой от предыдущей точки,
    плюс UNLOAD_STOP_SEC на каждую предыдущую точку. v1.74: до 12 точек; v1.79: без пройденных."""
    if extras and result.get("target_lat") is not None:
        try:
            result["extra"] = calc_extra_stops(extras, units, unit, result, tacho, sim,
                                               clean_corridor(payload.get("corridor")),
                                               _deps(payload), payload.get("target"), clean_line_id(payload.get("ferry")))
        except Exception as e:
            result["extra"] = [{"error": str(e)} for _ in extras]

    # плашка коридора: corridor.to считался по непройденным точкам — в номер точки трипа (с пройденными)
    cor, act = result.get("corridor"), result.get("active_idx")
    if cor and act and isinstance(cor.get("to"), int) and 0 <= cor["to"] < len(act):
        cor["to"] = act[cor["to"]]


def _add_local_times(result):
    """v3.143: ETA и ✓ точек — в местном времени страны точки (FI, PT, Балтия… — `COUNTRY_TZ`), метка eta_tz / tz.
    Оригиналы ✓ (at / arr — по Берлину) не трогаем: они запоминаются в строке трипа; рядом кладём at_loc / arr_loc."""
    def conv(d, keys, lat, lng):
        cc = _country_at(lat, lng) if lat is not None and lng is not None else None
        if not cc or not local_tz(cc):
            return
        for k in keys:
            v = to_local_str(d.get(k), cc)
            if v:
                d[k] = v
        d["eta_tz"] = cc
    try:
        conv(result, ("eta_tacho", "eta_local"), result.get("target_lat"), result.get("target_lng"))
        ot = result.get("on_target")
        if isinstance(ot, dict) and result.get("eta_tz"):
            v = to_local_str(ot.get("arr"), result["eta_tz"])
            if v:
                ot["arr"] = v
        for it in result.get("extra") or []:
            if isinstance(it, dict) and it.get("lat") is not None:
                conv(it, ("eta_tacho", "eta_local"), it.get("lat"), it.get("lng"))
        for x in result.get("points_done") or []:
            cc = x.get("cc")
            if x.get("done") and cc and local_tz(cc):
                a, b = to_local_str(x.get("at"), cc), to_local_str(x.get("arr"), cc)
                if a or b:
                    x["at_loc"], x["arr_loc"], x["tz"] = a, b, cc
    except Exception as e:
        warn("fleet_calc:local_times", e)


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
        unit, err = _find_unit(units, unit_query)
        if err:
            return err
        result = _unit_status(unit)

        trailer = _add_trailer_info(result, unit, units, payload)
        tm.mark("trailer")

        target_str, active_extras = _apply_points_done(result, payload, target_str, unit, units, tm)
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
            _add_route_to_target(result, unit, target_lat, target_lng, payload, tm)
            tm.mark("route")

        tacho, sim = _add_tacho(result, unit, trailer, payload.get("crew"), bool(payload.get("x10")),
                                _crew_seen(payload), tm)
        tm.mark("tacho")

        _add_extra(result, active_extras, units, unit, tacho, sim, payload)
        tm.mark("extra")
        _week_short_last(result)

        _add_route_context(result, unit)

        _add_code_badges(result, target_str)
        tm.mark("context")

        _add_local_times(result)   # v3.143: ETA и ✓ — местное время страны точки

        return result, 200

    except Exception as e:
        return {"error": str(e)}, 502
