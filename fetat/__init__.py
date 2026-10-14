"""F.ETA.T — пакет приложения. Структура и правила — CLAUDE.md, история рефакторинга — REFACTOR.md."""

APP_VERSION = "3.112"


def create_app():
    """Flask-приложение со всеми Blueprints. Шаблоны и static — от корня проекта."""
    from flask import Flask

    from fetat.api import calc, fleet, mapon, meta, notebook, reference
    from fetat.config import ROOT_DIR

    app = Flask("app", root_path=ROOT_DIR)

    @app.before_request
    def _require_iap():
        """v3.67: на Cloud Run (K_SERVICE) без заголовка IAP не пускаем — иначе все стали бы «local» с полными правами."""
        import os

        from flask import abort

        if os.environ.get("K_SERVICE") and not meta.current_user_email():
            abort(403)

    @app.after_request
    def _cache_static(resp):
        """v3.67: js / css с ?v=версия кешируем на год — версия меняется с каждым билдом."""
        from flask import request

        if request.endpoint == "static" and request.args.get("v") and request.path.endswith((".js", ".css")):
            resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return resp

    for bp in (meta.bp, mapon.bp, calc.bp, reference.bp, fleet.bp, notebook.bp):
        app.register_blueprint(bp)
    return app
