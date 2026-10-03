"""
Fleet ETA Tracker — веб-версия Mapon + Google Routes ETA Calculator.

Точка входа для gunicorn (Procfile: gunicorn app:app). Весь код — в пакете fetat/
(карта модулей — CLAUDE.md). История изменений — CHANGELOG.md.
"""
import os

from fetat import APP_VERSION, create_app  # noqa: F401  (APP_VERSION — для совместимости)

app = create_app()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port, debug=False)
