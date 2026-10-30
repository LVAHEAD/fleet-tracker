"""Расчёты: строка Флота (/api/calc) и From → To (/api/route). Логика — fetat/services/."""

import json
import threading
import time

from flask import Blueprint, jsonify, request

from fetat.api.meta import current_user_email
from fetat.clients.google_routes import set_route_ctx
from fetat.domain.tacho import calc_plan
from fetat.services.corridors import corridor_options
from fetat.services.fleet_calc import calc_row
from fetat.services.route_calc import from_crew, route_calc, unit_seed

bp = Blueprint("calc", __name__)

# Кеш готового расчёта строки: Флот общий, автообновление идёт из каждой открытой вкладки.
# Автопроход (why=auto) берёт свежий результат того же запроса, если он моложе CALC_RESULT_TTL;
# правка, загрузка и ручной ↻ всегда считают заново и кладут результат в кеш.
CALC_RESULT_TTL = 180
_calc_cache = {}
_calc_cache_lock = threading.Lock()


def _calc_key(payload):
    p = {k: v for k, v in payload.items() if k != "why"}
    return json.dumps(p, sort_keys=True, ensure_ascii=False, default=str)


def _calc_cached(key, now):
    with _calc_cache_lock:
        hit = _calc_cache.get(key)
    if hit and now - hit[0] < CALC_RESULT_TTL:
        return hit[1]
    return None


def _calc_store(key, body, now):
    with _calc_cache_lock:
        for k in [k for k, v in _calc_cache.items() if now - v[0] >= CALC_RESULT_TTL]:
            del _calc_cache[k]
        _calc_cache[key] = (now, body)


@bp.route("/api/calc", methods=["POST"])
def api_calc():
    """Строка Флота — fetat/services/fleet_calc.py: calc_row."""
    payload = request.get_json(force=True, silent=True) or {}
    why = payload.get("why") or "edit"
    key, now = _calc_key(payload), time.time()
    if why == "auto":
        hit = _calc_cached(key, now)
        if hit is not None:
            return jsonify(hit), 200
    set_route_ctx(why, current_user_email(), payload.get("unit"))   # v3.13: разбивка в счётчике
    body, code = calc_row(payload)
    if code == 200 and isinstance(body, dict) and not body.get("error"):
        _calc_store(key, body, now)
    return jsonify(body), code


@bp.route("/api/route", methods=["POST"])
def api_route():
    """From → To — fetat/services/route_calc.py: route_calc."""
    set_route_ctx("route", current_user_email())
    body, code = route_calc(request.get_json(force=True, silent=True) or {})
    return jsonify(body), code


@bp.route("/api/unit-seed", methods=["POST"])
def api_unit_seed():
    """v3.114: ⏱ калькулятор — данные машины из From без маршрута (fetat/services/route_calc.py: unit_seed).
    body: {"from": "NU-8704", "from_crew": "solo" | "team" (из строки Флота, необязательно), "from_crew_seen": сек}. Google не нужен."""
    payload = request.get_json(force=True, silent=True) or {}
    body, code = unit_seed(payload.get("from"), *from_crew(payload))
    return jsonify(body), code


@bp.route("/api/eta-plan", methods=["POST"])
def api_eta_plan():
    """v3.39: ⏱ калькулятор — расклад рейса тем же движком, что Флот (domain/tacho: calc_plan). Google не нужен."""
    try:
        return jsonify(calc_plan(request.get_json(force=True, silent=True) or {}))
    except (TypeError, ValueError) as e:
        return jsonify({"error": f"плохие данные: {e}"}), 400


@bp.route("/api/corridors", methods=["POST"])
def api_corridors():
    """v3.32: меню выбора коридора ИТ ↔ Бенелюкс — км через каждый коридор. body: {"leg": [lat1, lng1, lat2, lng2],
    "countries": [a, b] (From → To; без них — страны по кодам регионов, как во Флоте)}."""
    payload = request.get_json(force=True, silent=True) or {}
    try:
        lat1, lng1, lat2, lng2 = (float(x) for x in payload.get("leg") or [])
    except (TypeError, ValueError):
        return jsonify({"error": "Нужен отрезок: leg = [lat1, lng1, lat2, lng2]"}), 400
    cc = payload.get("countries") or [None, None]
    set_route_ctx("corridor", current_user_email())
    body = corridor_options(lat1, lng1, lat2, lng2, *(cc[:2] if len(cc) >= 2 and all(cc[:2]) else (None, None)))
    return jsonify(body), (400 if "error" in body else 200)
