"""Настройки F.ETA.T: переменные окружения и общие значения.
Ключи и ID задаются в сервисе Cloud Run; здесь только чтение с умолчаниями."""
import os

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

MAPON_API_KEY = os.environ.get("MAPON_API_KEY", "")

GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY", "")

# Ключ для клиентского Maps JavaScript API (виден в браузере — это нормально для
# этого типа ключа, если он ограничен по HTTP referrer в Google Cloud Console).
# Если не задан отдельно, используется тот же GOOGLE_API_KEY.
GOOGLE_MAPS_JS_KEY = os.environ.get("GOOGLE_MAPS_JS_KEY", GOOGLE_API_KEY)

HEAD_TRUCK_GROUP_ID = int(os.environ.get("HEAD_TRUCK_GROUP_ID", "62269"))

# Сдвиг Риги от UTC. Пока задан жёстко (летнее время), зимой будет на час больше нужного.
RIGA_UTC_OFFSET = 3

WEST_EUROPE_OFFSET = RIGA_UTC_OFFSET - 1

# Справочники: коды регионов (из GPS_Codes.xlsx) и коды GeoNames.
DATA_DIR = os.path.join(ROOT_DIR, "data")

# Таблица "Fleet Tracker — данные", лист "Адреса". Доступ — сервисный аккаунт
# Cloud Run (таблица расшарена на него "Читателем"), ключи не нужны.
SHEET_ID = os.environ.get("SHEET_ID", "1m0oM8cNixVDM1kgQKCZKPgF-aSQN-0loqdLc-dWkD7g")

ADDRESS_SHEET = os.environ.get("ADDRESS_SHEET", "Адреса")

FREIGHT_SHEET = os.environ.get("FREIGHT_SHEET", "Фрахты")

SETTINGS_SHEET = os.environ.get("SETTINGS_SHEET", "Настройки")

GOOGLE_PROJECT_ID = os.environ.get("GOOGLE_CLOUD_PROJECT") or "my-n8n-bot-496614"

# v2.02: кто может удалять любую строку (кроме создателя и диспетчера строки)
FLEET_ADMINS = {e.strip().lower() for e in (os.environ.get("FLEET_ADMINS") or "vladimirs.head@gmail.com").split(",") if e.strip()}
