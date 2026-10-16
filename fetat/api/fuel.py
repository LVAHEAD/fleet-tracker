"""Список АЗС (инструкция по заправкам), его сверка с группой Mapon и (v3.139) создание недостающих объектов."""
from flask import Blueprint, jsonify, request

from fetat.api.meta import current_user_email
from fetat.config import NOTES_TAB_USERS
from fetat.services.fuel_create import fuel_create
from fetat.services.fuel_report import fuel_report
from fetat.utils.text import canon_email

bp = Blueprint("fuel", __name__)


@bp.route("/api/fuel-stations")
def api_fuel_stations():
    """Список АЗС из инструкции по заправкам и сверка с группой Mapon «Actual Petrol Station» (только чтение; ?refresh=1 — перечитать таблицу)."""
    return jsonify(fuel_report(force=request.args.get("refresh") == "1"))


@bp.route("/api/fuel-stations/create", methods=["POST"])
def api_fuel_create():
    """Создать в группе Mapon «Actual Petrol Station» недостающие АЗС. Тело: {mode: 'trial'|'all', confirm: true}; только тем, кому видна кнопка ⛽."""
    email = current_user_email()
    if email is not None and canon_email(email) not in NOTES_TAB_USERS:
        return jsonify({"error": "нет доступа"}), 403
    body = request.get_json(silent=True) or {}
    if body.get("confirm") is not True:
        return jsonify({"error": "нужно подтверждение"}), 400
    return jsonify(fuel_create(body.get("mode")))
