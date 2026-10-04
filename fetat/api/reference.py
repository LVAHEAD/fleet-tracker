"""Справочники: коды регионов, Локатор, адреса, фрахты, запреты движения."""
from datetime import datetime, timedelta, timezone

from flask import Blueprint, jsonify, request

from fetat.utils.timefmt import ts_west
from fetat.clients.mapon import fetch_units
from fetat.clients.nakordoni import _bans_cache, _bans_fetch_lock, _bans_lock
from fetat.config import MAPON_API_KEY
from fetat.domain.addresses import _addr_cache, address_public, get_addresses
from fetat.domain.bans import BANS_MANUAL_MIN, _bans_refresh, BANS_TTL
from fetat.domain.freights import _frt_cache, get_contract_clients, get_freights, _set_cache
from fetat.domain.points import resolve_point
from fetat.domain.regions import nearest_region_code, REGION_CODES

bp = Blueprint("reference", __name__)


@bp.route("/api/region-codes")
def api_region_codes():
    """v1.24, Локатор: все коды регионов одним списком [{code, lat, lng, place}]."""
    return jsonify({"codes": [
        {"code": code, "lat": v["lat"], "lng": v["lng"], "place": v.get("place", "")}
        for code, v in sorted(REGION_CODES.items())
    ]})


@bp.route("/api/locate", methods=["POST"])
def api_locate():
    """
    v1.24, Локатор. body: {"q": "SE25" | "Jönköping" | "59.93, 10.86" | "OI-3194"}
    Возвращает точку и ближайший код региона (для кода — сам код).
    """
    payload = request.get_json(force=True, silent=True) or {}
    q = str(payload.get("q", "")).strip()
    if not q:
        return jsonify({"error": "Введите код, город, GPS или машину"}), 400

    units_cache = {}
    def units_getter():
        if "units" not in units_cache:
            units_cache["units"] = fetch_units(MAPON_API_KEY)
        return units_cache["units"]

    try:
        try:
            pt = resolve_point(q, units_getter)
        except ValueError as e:
            return jsonify({"error": str(e)}), 404

        exact = q.upper().replace(" ", "")
        if exact in REGION_CODES:
            code, dist = exact, 0.0
        else:
            code, dist = nearest_region_code(pt["lat"], pt["lng"])
        info = REGION_CODES.get(code, {})
        return jsonify({
            "lat": pt["lat"], "lng": pt["lng"],
            "label": pt["label"],
            "is_truck": pt["is_truck"],
            "is_code": exact in REGION_CODES,
            "code": code,
            "code_place": info.get("place", ""),
            "code_lat": info.get("lat"), "code_lng": info.get("lng"),
            "dist_km": round(dist, 1),
            "address": pt.get("address"),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 502


@bp.route("/api/addresses")
def api_addresses():
    """v1.28: адресная база для подсказок. ?refresh=1 — перечитать таблицу сейчас."""
    import time
    items = get_addresses(force=request.args.get("refresh") == "1")
    return jsonify({
        "addresses": [{**address_public(a), "lat": a["lat"], "lng": a["lng"]} for a in items],
        "problems": _addr_cache["problems"],
        "error": _addr_cache["error"],
        "loaded_at": ts_west(_addr_cache["loaded_at"]).strftime("%d/%m %H:%M") if _addr_cache["loaded_at"] else None,
    })


@bp.route("/api/freights")
def api_freights():
    """v1.29: состояние базы фрахтов (для вкладки [.]). ?refresh=1 — перечитать сейчас."""
    get_freights(force=request.args.get("refresh") == "1")
    la = _frt_cache["loaded_at"]
    return jsonify({
        "stats": _frt_cache["stats"],
        "contract_clients": get_contract_clients(force=request.args.get("refresh") == "1"),
        "settings_error": _set_cache["error"],
        "error": _frt_cache["error"],
        "loaded_at": ts_west(la).strftime("%d/%m %H:%M") if la else None,
    })


@bp.route("/api/bans")
def api_bans():
    """Запреты движения из nakordoni.eu (кеш 3 ч; ?refresh=1 — не чаще раза в 10 мин)."""
    import time
    now = time.time()
    with _bans_lock:
        age = now - _bans_cache["at"]
        stale = _bans_cache["data"] is None or age > BANS_TTL or bool(
            (_bans_cache["data"] or {}).get("missing"))
        manual = request.args.get("refresh") == "1" and age > BANS_MANUAL_MIN
    if stale or manual:
        # если уже качает фоновое обновление — ждём его (до 40 с), а не шлём второй поток запросов
        if _bans_fetch_lock.acquire(timeout=40):
            try:
                _bans_refresh(max_age=BANS_MANUAL_MIN if manual else BANS_TTL)
            finally:
                _bans_fetch_lock.release()
    with _bans_lock:
        data = _bans_cache["data"]
        loaded = _bans_cache["at"]
        err = _bans_cache["error"]
    loaded_txt = (ts_west(loaded)
                  .strftime("%d/%m %H:%M")) if data else None
    if data is None:
        return jsonify({"error": err or "нет данных — попробуйте позже"}), 502
    return jsonify({**data, "error": err, "loaded_at": loaded_txt})
