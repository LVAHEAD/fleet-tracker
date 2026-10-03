"""Расчёты: строка Флота (/api/calc) и From → To (/api/route). Логика — fetat/services/."""

from flask import Blueprint, jsonify, request

from fetat.api.meta import current_user_email
from fetat.clients.google_routes import set_route_ctx
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
