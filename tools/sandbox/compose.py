import json, sys
W = sys.argv[1]
d = json.load(open(W + "/fleet_anon_full.json", encoding="utf-8"))
ME = "dispatcher1@example.com"
rows = d["rows"]
mine = [x for x in rows if x["row"].get("unit") and x["row"]["disp"] == ME]
empty = [x for x in rows if not x["row"].get("unit")]
def first_o(r):
    for i, x in enumerate(r.get("extra") or []):
        if x.get("lo") == "O": return i + 1          # индекс точки (0 — основная)
    return None
O, L, used = [], [], set()
for x in mine:                                          # O: есть выгрузка среди точек, 2+ точек
    r = x["row"]; k = first_o(r)
    if k is not None and len(O) < 8:
        r["done"] = {str(i): True for i in range(k)}     # погрузки пройдены, первая открытая — выгрузка
        O.append(x); used.add(id(x))
for x in mine:
    if id(x) in used: continue
    if len(L) < 8:
        r = x["row"]
        for f in ("done", "doneArr", "doneSeen"): r.pop(f, None)
        r["lo"] = "L"; L.append(x)
for x in empty[:5]:
    x["row"]["disp"] = ME
d["rows"] = L + O + empty[:5]
json.dump(d, open(W + "/fleet_anon.json", "w", encoding="utf-8"), ensure_ascii=False)
print("L", len(L), "O", len(O), "empty", len(empty[:5]), "total", len(d["rows"]))
