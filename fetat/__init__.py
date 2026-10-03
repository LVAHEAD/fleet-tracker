"""F.ETA.T — пакет приложения. Структура и правила — CLAUDE.md, история рефакторинга — REFACTOR.md."""

APP_VERSION = "3.07"


def create_app():
    """Flask-приложение со всеми Blueprints. Шаблоны и static — от корня проекта."""
    from flask import Flask

    from fetat.api import calc, fleet, mapon, meta, notebook, reference
    from fetat.config import ROOT_DIR

    app = Flask("app", root_path=ROOT_DIR)
    for bp in (meta.bp, mapon.bp, calc.bp, reference.bp, fleet.bp, notebook.bp):
        app.register_blueprint(bp)
    return app
