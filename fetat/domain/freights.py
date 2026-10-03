"""База фрахтов (лист «Фрахты»): разбор ячеек, контрактные клиенты, похожие рейсы и ориентир цены."""
import re
from datetime import datetime, timezone, timedelta

from fetat.clients.sheets import read_sheet_values
from fetat.config import FREIGHT_SHEET, SETTINGS_SHEET
from fetat.domain.addresses import ADDRESS_TTL_SEC, DOVOZ_COUNTRY_WORDS, base_point
from fetat.domain.regions import REGION_CODES
from fetat.utils.geo import haversine_km
from fetat.utils.text import _hkey


FREIGHT_ROAD_FACTOR = 1.25   # км по дорогам ~ км по прямой x 1.25 (для €/км старых рейсов)


FREIGHT_NEAR_KM = 150        # "соседний регион" — центры в пределах 150 км


COUNTRY_ALIASES = {"FIN": "FI", "EST": "EE", "LAT": "LV", "LTU": "LT", "SWE": "SE", "NOR": "NO",
                   "GER": "DE", "DEN": "DK", "ESP": "ES", "POL": "PL", "ITA": "IT", "UK": "GB"}


_frt_cache = {"items": [], "stats": {}, "loaded_at": 0.0, "error": None}


def parse_region_cell(text, pick_last):
    """"3xES30+ES46" / "FIN" / "SE(ST)" / "2xFIN" -> (code|None, country|None).
    Для погрузки берём первый регион, для выгрузки — последний."""
    t = re.sub(r"\([^)]*\)", "", str(text or "")).upper().replace(" ", "")
    tokens = [re.sub(r"^\d+X", "", tok) for tok in re.split(r"[+&,]", t) if tok]
    parsed = []
    for tok in tokens:
        m = re.match(r"^([A-Z]{2})(\d{2})", tok)
        if m:
            parsed.append((m.group(1) + m.group(2), m.group(1)))
            continue
        m = re.match(r"^([A-Z]{2,3})$", tok)
        if m:
            cc = COUNTRY_ALIASES.get(m.group(1), m.group(1))
            if len(cc) == 2:
                parsed.append((None, cc))
    if not parsed:
        return None, None
    return parsed[-1] if pick_last else parsed[0]


def parse_freight_value(v):
    """2400 / "2650+400" / "6729/5500" / "6200+" -> (цена|None, аутсорс?)."""
    if isinstance(v, (int, float)):
        return (float(v), False) if v > 0 else (None, False)
    t = str(v or "").strip().replace(" ", "")
    m = re.match(r"^(\d+(?:[.,]\d+)?)", t)
    if not m:
        return None, False
    price = float(m.group(1).replace(",", "."))
    return (price if price > 0 else None), ("/" in t)


def parse_trip_date(v, year):
    """"03.08." / "02+03.08." / "05.08.at 08:00" / serial -> date (последняя дата в ячейке)."""
    from datetime import date
    if isinstance(v, (int, float)) and v > 30000:
        return (datetime(1899, 12, 30) + timedelta(days=int(v))).date()
    found = re.findall(r"(\d{1,2})\.(\d{1,2})", str(v or ""))
    if not found or not year:
        return None
    d, mth = int(found[-1][0]), int(found[-1][1])
    try:
        return date(int(year), mth, d)
    except ValueError:
        return None


def _region_ll(code):
    v = REGION_CODES.get(code or "")
    return (v["lat"], v["lng"]) if v else (None, None)


def parse_freight_rows(values):
    if not values:
        return [], {}
    head = [_hkey(h) for h in values[0]]

    def find(pred):
        for i, k in enumerate(head):
            if pred(k):
                return i
        return None
    c_unl = find(lambda k: k.startswith("unloading") and "reg" in k)
    c_lod = find(lambda k: k.startswith("loading") and "reg" in k)
    c_ldt = find(lambda k: k.startswith("loadingdate"))
    c_ddt = find(lambda k: k.startswith("deliverydate"))
    c_frt = find(lambda k: k.startswith("freight"))
    c_cli = find(lambda k: k == "client")
    c_yr = find(lambda k: k == "year")

    def cell(row, i):
        return row[i] if i is not None and i < len(row) else ""

    items = []
    stats = {"rows": 0, "ok": 0, "no_price": 0, "no_region": 0}
    _b = base_point()
    base_ll = (_b[0], _b[1])
    for row in values[1:]:
        if not any(str(c or "").strip() for c in row):
            continue
        stats["rows"] += 1
        price, outsourced = parse_freight_value(cell(row, c_frt))
        if not price or price > 50000:
            stats["no_price"] += 1
            continue
        fcode, fcc = parse_region_cell(cell(row, c_lod), pick_last=False)
        tcode, tcc = parse_region_cell(cell(row, c_unl), pick_last=True)
        if not fcc or not tcc:
            stats["no_region"] += 1
            continue
        year = cell(row, c_yr)
        try:
            year = int(float(year)) if str(year).strip() else None
        except ValueError:
            year = None
        d = parse_trip_date(cell(row, c_ldt), year) or parse_trip_date(cell(row, c_ddt), year)
        flat, flng = _region_ll(fcode)
        tlat, tlng = _region_ll(tcode)
        if tcode is None and tcc in DOVOZ_COUNTRY_WORDS and tlat is None:
            # v1.40: "FIN"/"EE" без кода — фактически до Базы (для €/км)
            tlat, tlng = base_ll
        km = None
        if flat is not None and tlat is not None:
            km = haversine_km(flat, flng, tlat, tlng) * FREIGHT_ROAD_FACTOR
        items.append({
            "from_raw": str(cell(row, c_lod)).strip(), "to_raw": str(cell(row, c_unl)).strip(),
            "from_code": fcode, "from_cc": fcc, "to_code": tcode, "to_cc": tcc,
            "flat": flat, "flng": flng, "tlat": tlat, "tlng": tlng,
            "price": price, "outsourced": outsourced,
            "client": str(cell(row, c_cli)).strip(), "date": d, "km": km,
        })
        stats["ok"] += 1
    return items, stats


def get_freights(force=False):
    import time
    now = time.time()
    if force or now - _frt_cache["loaded_at"] > ADDRESS_TTL_SEC:
        try:
            items, stats = parse_freight_rows(read_sheet_values(FREIGHT_SHEET, "UNFORMATTED_VALUE"))
            _frt_cache.update(items=items, stats=stats, loaded_at=now, error=None)
        except Exception as e:
            _frt_cache["error"] = str(e)
            _frt_cache["loaded_at"] = now - ADDRESS_TTL_SEC + 60
    return _frt_cache["items"]


_set_cache = {"contract": [], "loaded_at": 0.0, "error": None}


def _client_key(name):
    """"Bama(2k)" -> "bama", "GreenFoodIberica(2k)" -> "greenfoodiberica"."""
    t = re.sub(r"\([^)]*\)", "", str(name or "")).lower()
    return re.sub(r"[^0-9a-zа-яё]", "", t)


def get_contract_clients(force=False):
    """Ключи контрактных клиентов из колонки "Контрактные клиенты" листа "Настройки"."""
    import time
    now = time.time()
    if force or now - _set_cache["loaded_at"] > ADDRESS_TTL_SEC:
        try:
            values = read_sheet_values(SETTINGS_SHEET)
            col = None
            if values:
                for i, h in enumerate(values[0]):
                    if "контракт" in str(h).lower():
                        col = i
                        break
            names = []
            if col is not None:
                names = [_client_key(r[col]) for r in values[1:] if col < len(r) and str(r[col]).strip()]
            _set_cache.update(contract=[n for n in names if n], loaded_at=now, error=None)
        except Exception as e:
            _set_cache["error"] = str(e)
            _set_cache["loaded_at"] = now - ADDRESS_TTL_SEC + 60
    return _set_cache["contract"]


def contract_of(client, contract_keys):
    """Ключ контрактника, если клиент контрактный (по началу названия), иначе None."""
    k = _client_key(client)
    for c in contract_keys:
        if k.startswith(c):
            return c
    return None


def _pct(sorted_vals, q):
    if not sorted_vals:
        return None
    i = (len(sorted_vals) - 1) * q
    lo, hi = int(i), min(int(i) + 1, len(sorted_vals) - 1)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (i - lo)


def similar_freights(a, b, route_km=None, limit=10):
    """a, b — точки начала и конца (dict с code/near_code/country/lat/lng).
    Уровни: 1 — те же коды, 2 — соседние регионы (<= FREIGHT_NEAR_KM), 3 — пара стран."""
    from datetime import date
    items = get_freights()
    fcode = a.get("code") or a.get("near_code")
    tcode = b.get("code") or b.get("near_code")
    fcc, tcc = a.get("country"), b.get("country")
    dovoz = b.get("dovoz")          # v1.40: To = "FIN"/"EE" через Базу
    found = {}
    for i, t in enumerate(items):
        lvl = None
        if dovoz:
            if t["to_cc"] != dovoz:
                continue
            if fcode and t["from_code"] == fcode:
                lvl = 1
            elif t["flat"] is not None and haversine_km(t["flat"], t["flng"], a["lat"], a["lng"]) <= FREIGHT_NEAR_KM:
                lvl = 2
            elif fcc and t["from_cc"] == fcc:
                lvl = 3
            if lvl:
                found[i] = lvl
            continue
        if fcode and tcode and t["from_code"] == fcode and t["to_code"] == tcode:
            lvl = 1
        elif (t["flat"] is not None and t["tlat"] is not None
              and haversine_km(t["flat"], t["flng"], a["lat"], a["lng"]) <= FREIGHT_NEAR_KM
              and haversine_km(t["tlat"], t["tlng"], b["lat"], b["lng"]) <= FREIGHT_NEAR_KM):
            lvl = 2
        elif fcc and tcc and t["from_cc"] == fcc and t["to_cc"] == tcc:
            lvl = 3
        if lvl:
            found[i] = lvl
    # v1.31: контрактные клиенты (фиксированные цены) — не в ориентир
    try:
        contract_keys = get_contract_clients()
    except Exception:
        contract_keys = []
    ctr = {i: contract_of(items[i]["client"], contract_keys) for i in found}
    market_found = {i: l for i, l in found.items() if not ctr[i]}

    # уровни выбираем по рыночным рейсам: 1; если мало — добавляем 2; если всё ещё мало — 3
    chosen = [i for i, l in market_found.items() if l == 1]
    if len(chosen) < 5:
        chosen += [i for i, l in market_found.items() if l == 2]
    if len(chosen) < 3:
        chosen += [i for i, l in market_found.items() if l == 3]
    levels_used = sorted({found[i] for i in chosen})

    trips = [items[i] | {"level": found[i], "contract": None} for i in chosen]
    trips.sort(key=lambda t: (t["date"] or date(1900, 1, 1)), reverse=True)  # свежие первыми

    # по одному последнему рейсу на каждого контрактника (с лучшего доступного уровня)
    by_client = {}
    for i, l in found.items():
        c = ctr[i]
        if not c:
            continue
        key = (-l, items[i]["date"] or date(1900, 1, 1))  # сначала ближе по уровню, потом свежее
        if c not in by_client or key > by_client[c][0]:
            by_client[c] = (key, i)
    contract_trips = [items[i] | {"level": found[i], "contract": c} for c, (key, i) in by_client.items()]
    contract_trips.sort(key=lambda t: (t["date"] or date(1900, 1, 1)), reverse=True)

    today = datetime.now(timezone.utc).date()
    recent = [t for t in trips if t["date"] and (today - t["date"]).days <= 365]
    basis, basis_label = (recent, "последние 12 мес.") if len(recent) >= 3 else (trips, "все годы")
    prices = sorted(t["price"] for t in basis)
    per_km = sorted(t["price"] / t["km"] for t in basis if t["km"])
    estimate = None
    if prices:
        med = _pct(prices, 0.5)
        estimate = {
            "n": len(prices), "basis": basis_label + ", без контрактов",
            "low": round(_pct(prices, 0.25)), "high": round(_pct(prices, 0.75)), "median": round(med),
            "eur_km_hist": round(_pct(per_km, 0.5), 2) if per_km else None,
            "eur_km_route": round(med / route_km, 2) if route_km else None,
        }

    def pub(t):
        return {
            "from": t["from_raw"], "to": t["to_raw"], "client": t["client"],
            "price": round(t["price"]), "outsourced": t["outsourced"],
            "eur_km": round(t["price"] / t["km"], 2) if t["km"] else None,
            "date": t["date"].strftime("%d.%m.%y") if t["date"] else "", "level": t["level"],
            "contract": bool(t.get("contract")),
        }
    return {
        "query": f"{fcode or fcc or '?'} → {(dovoz + ' (через Базу)') if dovoz else (tcode or tcc or '?')}",
        "total": len(trips), "levels": levels_used,
        "trips": [pub(t) for t in contract_trips] + [pub(t) for t in trips[:limit]],
        "estimate": estimate,
    }
