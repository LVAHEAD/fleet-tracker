"""F.ETA.T — пакет приложения. Структура и правила — CLAUDE.md, история рефакторинга — REFACTOR.md."""

APP_VERSION = "3.250"


def create_app():
    """Flask-приложение со всеми Blueprints. Шаблоны и static — от корня проекта."""
    from flask import Flask

    from fetat.api import calc, fleet, fuel, mapon, meta, notebook, reference
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
        return _gzip(resp)

    gz_static = {}
    GZ_TYPES = ("text/", "application/json", "application/javascript", "image/svg+xml")

    def _gzip(resp):
        """Сжатие ответов (Cloud Run сам не сжимает): js / css / json / html — в 3–5 раз меньше по сети."""
        import gzip

        from flask import request

        if (resp.status_code != 200 or "Content-Encoding" in resp.headers
                or "gzip" not in (request.headers.get("Accept-Encoding") or "").lower()
                or not (resp.mimetype or "").startswith(GZ_TYPES)):
            return resp
        static = request.endpoint == "static"
        key = (request.path, request.args.get("v")) if static and request.args.get("v") else None
        body = gz_static.get(key) if key else None
        if body is None:
            resp.direct_passthrough = False
            raw = resp.get_data()
            if len(raw) < 1024:
                return resp
            body = gzip.compress(raw, compresslevel=5)
            if key:
                gz_static[key] = body
        resp.set_data(body)
        resp.headers["Content-Encoding"] = "gzip"
        resp.headers["Content-Length"] = str(len(body))
        resp.headers.add("Vary", "Accept-Encoding")
        return resp

    static_ver = {}

    @app.url_defaults
    def _static_file_ver(endpoint, values):
        """?v= у static — хеш самого файла, а не версия аппы: при деплое браузер перекачивает только изменённые файлы."""
        import hashlib
        import os

        if endpoint != "static" or "v" not in values or not values.get("filename"):
            return
        fn = values["filename"]
        path = os.path.join(app.static_folder, fn)
        try:
            mt = os.path.getmtime(path)
        except OSError:
            return
        hit = static_ver.get(fn)
        if not hit or hit[0] != mt:
            with open(path, "rb") as f:
                hit = (mt, hashlib.md5(f.read()).hexdigest()[:10])
            static_ver[fn] = hit
        values["v"] = hit[1]

    for bp in (meta.bp, mapon.bp, calc.bp, reference.bp, fleet.bp, notebook.bp, fuel.bp):
        app.register_blueprint(bp)
    return app
