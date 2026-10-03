"""Google Sheets: чтение листов таблицы «Fleet Tracker — данные» сервисным аккаунтом Cloud Run."""

import requests

from fetat.config import SHEET_ID


def _sheets_token():
    import google.auth
    import google.auth.transport.requests
    creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"])
    creds.refresh(google.auth.transport.requests.Request())
    return creds.token


def read_sheet_values(sheet_name, render="FORMATTED_VALUE"):
    """Все значения листа как список строк. render: FORMATTED_VALUE (как видно
    в таблице) или UNFORMATTED_VALUE (числа — числами)."""
    from urllib.parse import quote
    rng = quote(f"'{sheet_name}'", safe="")
    url = f"https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}/values/{rng}"
    resp = requests.get(url, headers={"Authorization": f"Bearer {_sheets_token()}"},
                        params={"valueRenderOption": render}, timeout=60)
    if resp.status_code == 403:
        raise RuntimeError("Нет доступа к таблице: расшарьте её на сервисный аккаунт приложения (Читатель)")
    resp.raise_for_status()
    return resp.json().get("values", [])
