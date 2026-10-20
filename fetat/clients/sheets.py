"""Google Sheets: чтение листов таблицы «Fleet Tracker — данные» сервисным аккаунтом Cloud Run."""

import requests

from fetat.config import SHEET_ID


def _sheets_token():
    import google.auth
    import google.auth.transport.requests
    creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"])
    creds.refresh(google.auth.transport.requests.Request())
    return creds.token


def _sheets_write_token():
    """v3.171: токен с правом записи (scope spreadsheets). Нужен «Редактор» у сервисного аккаунта Cloud Run."""
    import google.auth
    import google.auth.transport.requests
    creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/spreadsheets"])
    creds.refresh(google.auth.transport.requests.Request())
    return creds.token


def write_cells(sheet_name, cells):
    """v3.171: записать отдельные ячейки листа как есть (RAW — формулы и даты не разбираются).
    cells — список (A1-адрес без имени листа, например "C12", значение)."""
    if not cells:
        return
    url = f"https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}/values:batchUpdate"
    body = {"valueInputOption": "RAW",
            "data": [{"range": f"'{sheet_name}'!{a1}", "values": [[value]]} for a1, value in cells]}
    resp = requests.post(url, headers={"Authorization": f"Bearer {_sheets_write_token()}"}, json=body, timeout=60)
    if resp.status_code == 403:
        raise PermissionError("Нет права записи в таблицу: дайте сервисному аккаунту приложения доступ «Редактор»")
    resp.raise_for_status()


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
