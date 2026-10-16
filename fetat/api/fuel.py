"""Список АЗС (инструкция по заправкам) и его сверка с группой Mapon — только чтение."""
from flask import Blueprint, jsonify, request

from fetat.services.fuel_report import fuel_report

bp = Blueprint("fuel", __name__)


@bp.route("/api/fuel-stations")
def api_fuel_stations():
    """Список АЗС из инструкции по заправкам и сверка с группой Mapon «Actual Petrol Station» (только чтение; ?refresh=1 — перечитать таблицу)."""
    return jsonify(fuel_report(force=request.args.get("refresh") == "1"))
