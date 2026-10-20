"""Офлайн-снимок ответов аппы для макета: настоящий движок, подменённая сеть, замороженное время.
Запуск: python3 snap.py <рабочая папка с fleet_anon.json>   (результат — туда же)"""
import sys, os, json, math, random, re, time as _t
W = sys.argv[1]
root = "/home/claude/fleet-tracker"
data = json.load(open(W + "/fleet_anon.json", encoding="utf-8"))
FIX = data["now"] / 1000.0
os.environ.update(FLEET_STORE="memory", MAPON_API_KEY="k", GOOGLE_API_KEY="g",
                  FLEET_ADMINS="dispatcher1@example.com", NOTES_TAB_USERS="dispatcher1@example.com")
sys.path.insert(0, root); os.chdir(root)
_t.time = lambda: FIX
_t.sleep = lambda s: None
import datetime as _dt
class FDT(_dt.datetime):
    @classmethod
    def now(cls, tz=None):
        return _dt.datetime.fromtimestamp(FIX, tz)
_dt.datetime = FDT
import requests
rng = random.Random(7)
GPS = re.compile(r"(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})")

from fetat.domain.points import REGION_CODES
rows = [x["row"] for x in data["rows"]]

# ---------- адреса и позиции ----------
def targets(r):
    return [r.get("target") or ""] + [(x.get("target") or "") for x in (r.get("extra") or [])]

def is_plain(t):
    t = t.strip()
    return (not t) or bool(re.fullmatch(r"-?\d+\.\d+\s*,\s*-?\d+\.\d+", t)) or t.upper().replace(" ", "") in REGION_CODES

addr = {}      # name -> (lat, lng, client)
def locate(t, com, used):
    key = t.lower()[:10]
    low = (com or "").lower()
    i = low.find(key)
    if i >= 0:
        m = GPS.search(com, i, i + 320)
        if m: return float(m.group(1)), float(m.group(2))
        for m in GPS.finditer(com, max(0, i - 160), i):
            pass
        ms = list(GPS.finditer(com, max(0, i - 160), i))
        if ms: return float(ms[-1].group(1)), float(ms[-1].group(2))
    for m in GPS.finditer(com or ""):
        p = (float(m.group(1)), float(m.group(2)))
        if p not in used: return p
    return 50.0 + rng.random() * 4, 9.0 + rng.random() * 8

for r in rows:
    used = set()
    for t in targets(r):
        if is_plain(t) or t in addr: continue
        p = locate(t, r.get("com"), used); used.add(p)
        addr[t] = (p[0], p[1], r.get("client") or "")

def first_point(r):
    for t in targets(r):
        if t in addr: return addr[t][:2]
        m = re.fullmatch(r"\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*", t)
        if m: return float(m.group(1)), float(m.group(2))
        k = t.upper().replace(" ", "")
        if k in REGION_CODES: return REGION_CODES[k]["lat"], REGION_CODES[k]["lng"]
    return 52.0, 10.0

def offset(lat, lng, km, brg):
    dlat = km * math.cos(brg) / 111.0
    dlng = km * math.sin(brg) / (111.0 * max(0.2, math.cos(math.radians(lat))))
    return max(36.0, min(68.0, lat + dlat)), max(-8.0, min(30.0, lng + dlng))

UNITS, uid = [], 0
seen = set()
for r in rows:
    u = r.get("unit")
    if not u or u in seen: continue
    seen.add(u)
    lat, lng = offset(*first_point(r), rng.uniform(60, 1400), rng.uniform(0, 6.28))
    driving = rng.random() < 0.65
    st = {"name": "driving" if driving else "standing", "duration": rng.randint(600, 14000) if driving else rng.randint(1200, 90000)}
    uid += 1
    UNITS.append({"unit_id": uid, "number": u, "label": u, "make": "DAF", "type": "car", "lat": lat, "lng": lng, "state": st,
                  "speed": rng.randint(58, 88) if driving else 0, "last_update": "2026-10-20T20:10:00Z", "_drv": driving})
    t = r.get("trailer")
    if t:
        uid += 1
        UNITS.append({"unit_id": uid, "number": t, "label": t, "type": "trailer", "lat": lat + 0.0001, "lng": lng + 0.0001,
                      "state": st, "last_update": "2026-10-20T20:10:00Z"})
BYID = {u["unit_id"]: u for u in UNITS}
PUB_UNITS = [{k: v for k, v in u.items() if not k.startswith("_")} for u in UNITS]

# ---------- подменённая сеть ----------
calls = []
class R:
    def __init__(self, d, code=200): self._d, self.status_code, self.ok = d, code, code < 400; self.text = json.dumps(d); self.headers = {}
    def json(self): return self._d
    def raise_for_status(self):
        if self.status_code >= 400: raise requests.HTTPError(str(self.status_code))

def hav(a, b):
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dl = math.radians(b[1] - a[1]); dp = p2 - p1
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(h))

def enc(pts):
    from fetat.utils.geo import _encode_polyline
    return _encode_polyline(pts)

def ll(x):
    x = (x or {}).get("location", x or {})
    x = x.get("latLng", x)
    return x.get("latitude", 50.0), x.get("longitude", 10.0)

def fake(method, url, *a, **kw):
    calls.append((method, url.split("?")[0]))
    if "unit/list" in url: return R({"data": {"units": PUB_UNITS}})
    if "unit_groups/list_units" in url: return R({"data": {"units": [{"id": u["unit_id"]} for u in UNITS]}})
    if "driving_time_extended" in url:
        blob = json.dumps(kw.get("params") or kw.get("data") or url)
        m = re.search(r"unit_id\D{0,4}(\d+)", blob)
        u = BYID.get(int(m.group(1))) if m else None
        rs = random.Random(int(m.group(1)) if m else 1)
        drv = bool(u and u.get("_drv"))
        return R({"data": {"drivers": [{"current_state": "DRIVING" if drv else "REST",
                 "now": {"rest": 0 if drv else rs.randint(1800, 40000), "driving": rs.randint(300, 15000) if drv else 0},
                 "today": {"driving_remaining": rs.randint(2, 9) * 3600, "shift_remaining": rs.randint(4, 13) * 3600, "daily_rest_min": 11 * 3600},
                 "week": {"driving_remaining": rs.randint(12, 50) * 3600, "10h_driving_extensions_remaining": rs.randint(0, 2),
                          "9h_rest_shortening_remaining": rs.randint(1, 3), "weekly_rest_min": 45 * 3600}}]}})
    if "routes.googleapis.com" in url:
        body = kw.get("json") or {}
        pts = [ll(body.get("origin"))] + [ll(x) for x in (body.get("intermediates") or [])] + [ll(body.get("destination"))]
        legs = [int(hav(pts[i], pts[i + 1]) * 1250) for i in range(len(pts) - 1)]
        tot = sum(legs)
        return R({"routes": [{"distanceMeters": tot, "duration": "%ds" % int(tot / 1000 / 72 * 3600),
                              "legs": [{"distanceMeters": x, "duration": "%ds" % int(x / 1000 / 72 * 3600)} for x in legs],
                              "polyline": {"encodedPolyline": enc(pts)}}]})
    if "nominatim" in url: return R([{"lat": "52.52", "lon": "13.40", "display_name": "Berlin", "address": {"country_code": "de"}}])
    if "photon" in url: return R({"features": []})
    if "nakordoni" in url: return R({"bans": []})
    if "object/list" in url: return R({"data": {"objects": []}})
    return R({"data": {"units": []}})
requests.get = lambda url, *a, **kw: fake("GET", url, *a, **kw)
requests.post = lambda url, *a, **kw: fake("POST", url, *a, **kw)

import app
from fetat.domain import addresses as A
head = ["Name", "Full address", "GPS", "Open", "Type", "Alias", "Client", "Supplier", "Country", "Notes"]
vals = [head] + [[n, "%s\n%.5f, %.5f" % (n, la, lo), "%.5f, %.5f" % (la, lo), "", "load", "", cl, "", "", ""] for n, (la, lo, cl) in addr.items()]
items, probs = A.parse_address_rows(vals)
A._addr_cache.update(items=items, problems=probs, loaded_at=FIX, error=None)

c = app.app.test_client()
H = {"X-Goog-Authenticated-User-Email": "accounts.google.com:dispatcher1@example.com"}
res = {}
r = c.get("/", headers=H)
open(W + "/index_raw.html", "w", encoding="utf-8").write(r.data.decode("utf-8"))
GETS = ["/api/units", "/api/dispatchers", "/api/presence", "/api/region-codes", "/api/bans", "/api/links", "/api/changelog",
        "/api/addresses", "/api/freights", "/api/endpoints", "/api/mapon-objects", "/api/fuel-stations", "/api/notebook",
        "/api/google-usage", "/api/me", "/api/refresh-stat"]
for p in GETS:
    rr = c.get(p, headers=H)
    j = rr.get_json(silent=True)
    res[p] = {"status": rr.status_code, "json": j}
    print(p, rr.status_code, (list(j)[:6] if isinstance(j, dict) else type(j).__name__))

calc, errs = {}, 0
for r_ in rows:
    if not r_.get("unit"): continue
    ex = [(x.get("target") or "") for x in (r_.get("extra") or [])]
    body = {"unit": r_["unit"], "target": r_.get("target") or ""}
    if ex: body["extra"] = ex
    if r_.get("trailer"): body["trailer"] = r_["trailer"]
    cs = r_.get("crewSeen")
    if cs and cs.get("u") == r_["unit"]: body["crew_seen"] = int(cs["t"] / 1000)
    n = 1 + len(ex)
    dn = r_.get("done") or {}
    body["done"] = [True if dn.get(str(i)) else None for i in range(n)]
    body["why"] = "edit"
    rr = c.post("/api/calc", json=body, headers=H)
    j = rr.get_json(silent=True)
    if not j or j.get("error"): errs += 1; print("ERR", r_["unit"], r_.get("target"), (j or {}).get("error"))
    calc[json.dumps([r_["unit"], r_.get("target") or "", ex])] = j
print("calc rows", len(calc), "errors", errs)
json.dump({"gets": res, "calc": calc}, open(W + "/snap.json", "w", encoding="utf-8"), ensure_ascii=False)
json.dump(sorted(set(map(tuple, calls))), open(W + "/net_calls.json", "w"))
