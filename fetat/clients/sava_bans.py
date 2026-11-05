"""v3.278: второй источник запретов — открытый API SAVA Logistic (CC BY 4.0, без ключа) для стран вне тарифа nakordoni.
Календарь по датам: AT FR HU LU CH CZ DE IT LI SI SK; «общих запретов нет» (только местные / сезонные): PL RO ES NL BE.
Ответ приводим к формату nakordoni (country_code, date, time_from, time_until, restriction_type, …) и кладём в тот же кеш по странам."""
import threading
import time
from datetime import datetime, timedelta, timezone

import requests

SAVA_URL = "https://www.savaexpress.com/api/geo/traffic-bans"
SAVA_HEADERS = {"User-Agent": "fleet-eta-tracker", "Accept": "application/json"}
SAVA_DAYS = 14               # окно календаря, как у вкладки
SAVA_BLOCK_SEC = 300         # после сбоя — пауза (лимит SAVA 60 запросов в минуту, нам хватает с запасом)

# страны, которые SAVA знает; после первого удачного ответа список берётся из самого ответа
SAVA_COVER = {"AT", "FR", "HU", "LU", "CH", "CZ", "DE", "IT", "LI", "SI", "SK", "PL", "RO", "ES", "NL", "BE"}
SAVA_LOCAL = {"PL", "RO", "ES", "NL", "BE"}    # общего запрета нет — только местные / сезонные (для строки под календарём)

_sava_state = {"blocked_until": 0.0, "cover": set(SAVA_COVER), "local": set(SAVA_LOCAL)}
_sava_lock = threading.Lock()


def _ban_type(b):
    """Тип в словаре nakordoni: Sunday / Holiday / General (полные — выделяются), Local (отдельные дороги)."""
    if b.get("scope") == "specific-roads":
        return "Local"
    r = str(b.get("reason") or "")
    if r.startswith("Public holiday"):
        return "Holiday"
    if r == "Sunday":
        return "Sunday"
    return "General"          # суббота, канун праздника


def _details(b):
    parts = []
    r = str(b.get("reason") or "")
    if r not in ("Sunday", "Saturday"):
        parts.append(r)
    if b.get("note"):
        parts.append(str(b["note"]))
    if b.get("scope") == "transit":
        parts.append("транзит")
    elif b.get("scope") == "specific-roads":
        parts.append("только отдельные дороги")
    return " · ".join(p for p in parts if p)


def sava_to_cc(d, now_ts=None):
    """Ответ SAVA → ({cc: {"at", "upcoming", "current"}}, коды без календаря, коды всех знакомых стран)."""
    now_ts = time.time() if now_ts is None else now_ts
    cover = {c.get("code") for c in d.get("countries") or []} | {c.get("code") for c in d.get("countriesWithoutDatedBans") or []}
    local = {c.get("code") for c in d.get("countriesWithoutDatedBans") or []}
    cover.discard(None)
    part = {c: {"at": now_ts, "upcoming": [], "current": []} for c in cover}
    for b in d.get("bans") or []:
        cc = b.get("country")
        if cc not in part or not b.get("date") or not b.get("start") or not b.get("end"):
            continue
        try:
            s = datetime.fromisoformat(b["startsAt"]).timestamp()
            e = datetime.fromisoformat(b["endsAt"]).timestamp()
        except (KeyError, ValueError):
            continue
        if e <= now_ts:
            continue
        item = {"country_code": cc, "country_name": b.get("countryName"), "date": b["date"],
                "time_from": b["start"], "time_until": b["end"], "restriction_type": _ban_type(b),
                "restriction_details": _details(b), "min_weight_tons": b.get("minimumTonnes"),
                "details_url": b.get("page") or (b.get("officialSource") or {}).get("url"), "source": "sava"}
        part[cc]["current" if s <= now_ts < e else "upcoming"].append(item)
    return part, local, cover


def sava_fetch():
    """Скачать календарь SAVA: ({cc: …}, local, cover). Любая ошибка — RuntimeError."""
    today = datetime.now(timezone.utc).date()
    try:
        r = requests.get(SAVA_URL, params={"from": today.isoformat(), "to": (today + timedelta(days=SAVA_DAYS)).isoformat()},
                         timeout=20, headers=SAVA_HEADERS)
    except requests.RequestException as e:
        raise RuntimeError(f"нет связи ({type(e).__name__})")
    if r.status_code >= 400:
        raise RuntimeError(f"HTTP {r.status_code}")
    try:
        d = r.json()
    except ValueError:
        raise RuntimeError("не JSON")
    if not isinstance(d, dict) or "bans" not in d:
        raise RuntimeError("неожиданный формат")
    return sava_to_cc(d)
