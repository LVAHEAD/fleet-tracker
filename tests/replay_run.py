"""Прогон эндпоинтов с подменённой сетью (Mapon, Google, nakordoni) и замороженным временем.

Запуск: python3 tests/replay_run.py <корень проекта> <out.json>
Вызывается из tests/test_replay.py в отдельном процессе (подменяет requests и time глобально)."""
import sys, os, json, time as _t
root, out = sys.argv[1], sys.argv[2]
os.environ["FLEET_STORE"] = "memory"; os.environ["MAPON_API_KEY"] = "k"; os.environ["GOOGLE_API_KEY"] = "g"
sys.path.insert(0, root); os.chdir(root)
FIX = 1791338400.0  # 2026-10-07 06:00 UTC
_t.time = lambda: FIX
_t.sleep = lambda s: None
import datetime as _dt
class FDT(_dt.datetime):
    @classmethod
    def now(cls, tz=None):
        return _dt.datetime.fromtimestamp(FIX, tz)
_dt.datetime = FDT
import requests
calls = []
class R:
    def __init__(self, d, code=200): self._d, self.status_code, self.ok = d, code, code < 400; self.text = json.dumps(d); self.headers = {}
    def json(self): return self._d
    def raise_for_status(self):
        if self.status_code >= 400: raise requests.HTTPError(str(self.status_code))
UNITS = [
 {"unit_id": 1, "number": "OI-1778", "label": "OI-1778", "vehicle_title": "MAN TGX", "type": "car", "lat": 45.4, "lng": 11.9,
  "state": {"name": "driving", "duration": 1200}, "speed": 80, "last_update": "2026-10-07T05:59:00Z"},
 {"unit_id": 2, "number": "NP-2044", "label": "NP-2044", "make": "DAF", "type": "car", "lat": 56.95, "lng": 24.03,
  "state": {"name": "standing", "duration": 40000}, "speed": 0, "last_update": "2026-10-07T05:59:00Z"},
 {"unit_id": 3, "number": "C-640A", "label": "C-640A", "type": "trailer", "lat": 56.9501, "lng": 24.0301,
  "state": {"name": "standing", "duration": 40000}, "last_update": "2026-10-07T05:59:00Z"},
]
def enc(pts):
    sys.path.insert(0, root)
    from fetat.utils.geo import _encode_polyline
    return _encode_polyline(pts)
def fake(method, url, *a, **kw):
    calls.append((method, url.split("?")[0]))
    if "unit/list" in url: return R({"data": {"units": UNITS}})
    if "unit_groups/list_units" in url: return R({"data": {"units": [{"id": 1}, {"id": 2}, {"id": 3}]}})
    if "driving_time_extended" in url:
        return R({"data": {"drivers": [{"current_state": "DRIVING", "now": {"rest": 0, "driving": 3600},
                 "today": {"driving_remaining": 6 * 3600, "shift_remaining": 10 * 3600, "daily_rest_min": 11 * 3600},
                 "week": {"driving_remaining": 40 * 3600, "10h_driving_extensions_remaining": 1,
                          "9h_rest_shortening_remaining": 2, "weekly_rest_min": 45 * 3600}}]}})
    if "routes.googleapis.com" in url:
        body = kw.get("json") or {}
        o = body.get("origin", {}).get("location", {}).get("latLng", {})
        d = body.get("destination", {}).get("location", {}).get("latLng", {})
        pts = [(o.get("latitude", 45), o.get("longitude", 11)), (47.27, 11.40), (d.get("latitude", 56), d.get("longitude", 24))]
        n = len(body.get("intermediates") or [])
        return R({"routes": [{"distanceMeters": 1543210, "duration": "80000s",
                              "legs": [{"distanceMeters": 1543210 // (n + 1)} for _ in range(n + 1)],
                              "polyline": {"encodedPolyline": enc(pts)}}]})
    if "nominatim" in url: return R([{"lat": "52.52", "lon": "13.40", "display_name": "Berlin", "address": {"country_code": "de"}}])
    if "photon" in url: return R({"features": []})
    if "nakordoni" in url: return R({"bans": []})
    if "object/list" in url: return R({"data": {"objects": []}})
    return R({"data": {"units": []}})
requests.get = lambda url, *a, **kw: fake("GET", url, *a, **kw)
requests.post = lambda url, *a, **kw: fake("POST", url, *a, **kw)
import app
c = app.app.test_client()
res = {}
def call(name, m, url, body=None):
    r = c.post(url, json=body) if m == "POST" else c.get(url)
    try: res[name] = [r.status_code, r.get_json()]
    except Exception: res[name] = [r.status_code, r.data[:200].decode("utf-8", "replace")]
call("units", "GET", "/api/units")
call("calc_code", "POST", "/api/calc", {"unit": "OI-1778", "target": "LV10"})
call("calc_gps_multi", "POST", "/api/calc", {"unit": "OI-1778", "target": "45.78075, 12.01714", "extra": ["57.00781, 24.10356", "SE25"]})
call("calc_standing", "POST", "/api/calc", {"unit": "NP-2044", "target": "DE20"})
call("calc_trailer", "POST", "/api/calc", {"unit": "C-640A"})
call("calc_linked_trailer", "POST", "/api/calc", {"unit": "NP-2044", "target": "LV10", "trailer": "C-640A"})
call("calc_manual_done", "POST", "/api/calc", {"unit": "OI-1778", "target": "IT63", "extra": ["DE20", "LV10"], "done": [True, None, False]})
call("calc_all_done", "POST", "/api/calc", {"unit": "OI-1778", "target": "IT63", "done": [True]})
call("calc_unknown", "POST", "/api/calc", {"unit": "ZZ-0000", "target": "LV10"})
call("calc_empty", "POST", "/api/calc", {"target": "LV10"})
call("calc_ambiguous", "POST", "/api/calc", {"unit": "-"})
call("route_empty", "POST", "/api/route", {"from": "", "to": []})
call("route_one_point", "POST", "/api/route", {"to": "LV10"})
call("route_it_lv", "POST", "/api/route", {"from": "IT63", "to": "LV10"})
call("route_es_se", "POST", "/api/route", {"from": ["ES46", "ES08"], "to": "SE25"})
call("route_truck", "POST", "/api/route", {"from": "OI-1778", "to": "Berlin"})
call("locate", "POST", "/api/locate", {"q": "OI-1778"})
call("locate2", "POST", "/api/locate", {"q": "Berlin"})
call("nearest", "GET", "/api/nearest-units?lat=56.9&lng=24.1")
call("truckinfo", "GET", "/api/truck-info?unit=OI-1778")
call("mapon_units", "GET", "/api/mapon-units")
call("mapon_objects", "GET", "/api/mapon-objects")
call("bans", "GET", "/api/bans")
call("addresses", "GET", "/api/addresses")
call("freights", "GET", "/api/freights")
call("gusage", "GET", "/api/google-usage")
call("fleet", "GET", "/api/fleet")
res["_calls"] = sorted(set(map(tuple, calls)))
json.dump(res, open(out, "w"), ensure_ascii=False, indent=1, sort_keys=True, default=str)
print("done", {k: v[0] for k, v in res.items() if k != "_calls"})
