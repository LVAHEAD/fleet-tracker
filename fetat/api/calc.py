"""Расчёты: строка Флота (/api/calc) и From → To (/api/route). Логика — fetat/services/."""

from flask import Blueprint, jsonify, request

from fetat.api.meta import current_user_email
from fetat.clients.google_routes import set_route_ctx
from fetat.domain.tacho import calc_plan
from fetat.services.corridors import corridor_options
from fetat.services.fleet_calc import calc_row
from fetat.services.route_calc import route_calc

bp = Blueprint("calc", __name__)


@bp.route("/api/calc", methods=["POST"])
def api_calc():
    """Строка Флота — fetat/services/fleet_calc.py: calc_row."""
    payload = request.get_json(force=True, silent=True) or {}
    set_route_ctx(payload.get("why") or "edit", current_user_email())   # v3.13: разбивка в счётчике
    body, code = calc_row(payload)
    return jsonify(body), code


@bp.route("/api/route", methods=["POST"])
def api_route():
    """From → To — fetat/services/route_calc.py: route_calc."""
    set_route_ctx("route", current_user_email())
    body, code = route_calc(request.get_json(force=True, silent=True) or {})
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
