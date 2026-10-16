"""Настройки F.ETA.T: переменные окружения и общие значения.
Ключи и ID задаются в сервисе Cloud Run; здесь только чтение с умолчаниями."""
import os

from fetat.utils.text import canon_email

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

MAPON_API_KEY = os.environ.get("MAPON_API_KEY", "")
MAPON_WRITE_KEY = os.environ.get("MAPON_WRITE_KEY", "")   # v3.139: ключ с правом записи объектов (только для АЗС ⛽)

GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY", "")

# Ключ для клиентского Maps JavaScript API (виден в браузере — это нормально для
# этого типа ключа, если он ограничен по HTTP referrer в Google Cloud Console).
# Если не задан отдельно, используется тот же GOOGLE_API_KEY.
GOOGLE_MAPS_JS_KEY = os.environ.get("GOOGLE_MAPS_JS_KEY", GOOGLE_API_KEY)

HEAD_TRUCK_GROUP_ID = int(os.environ.get("HEAD_TRUCK_GROUP_ID", "62269"))

# v3.18: часовые пояса с переводом часов (DST) вместо жёстких сдвигов +3 / +2.
# Рига — Europe/Riga (лето UTC+3, зима UTC+2); «западное» время на экране — Europe/Berlin (CEST/CET).
RIGA_TZ_NAME = "Europe/Riga"

WEST_TZ_NAME = "Europe/Berlin"

# Справочники: коды регионов (из GPS_Codes.xlsx) и коды GeoNames.
DATA_DIR = os.path.join(ROOT_DIR, "data")

# Таблица "Fleet Tracker — данные", лист "Адреса". Доступ — сервисный аккаунт
# Cloud Run (таблица расшарена на него "Читателем"), ключи не нужны.
SHEET_ID = os.environ.get("SHEET_ID", "1m0oM8cNixVDM1kgQKCZKPgF-aSQN-0loqdLc-dWkD7g")

ADDRESS_SHEET = os.environ.get("ADDRESS_SHEET", "Адреса")

FREIGHT_SHEET = os.environ.get("FREIGHT_SHEET", "Фрахты")

SETTINGS_SHEET = os.environ.get("SETTINGS_SHEET", "Настройки")
# v3.11: лист со списком диспетчеров (Email, Инициалы, Цвет, Назначает)
DISP_SHEET = os.environ.get("DISP_SHEET", "Диспетчеры")
# лист со ссылками левой выезжалки Links (A — ссылка или заголовок группы, B — название)
LINKS_SHEET = os.environ.get("LINKS_SHEET", "Ссылки")

GOOGLE_PROJECT_ID = os.environ.get("GOOGLE_CLOUD_PROJECT") or "my-n8n-bot-496614"

# v2.02: кто может удалять любую строку (кроме создателя и диспетчера строки)
FLEET_ADMINS = {canon_email(e) for e in (os.environ.get("FLEET_ADMINS") or "vladimirs.head@gmail.com").split(",") if e.strip()}
# [.] «Справка» (блокнот, история версий, фрахты, адреса): видят только эти аккаунты (13.10). Остальным вкладка не показывается
NOTES_TAB_USERS = {canon_email(e) for e in (os.environ.get("NOTES_TAB_USERS") or "vladimirs.head@gmail.com,ladins@gmail.com").split(",") if e.strip()}
