"""Обезличивание выгрузки /api/fleet для макета: машины, прицепы, клиенты, e-mail, телефоны, номера заказов.
Запуск: python3 -I anon.py <in.json> <out.json>"""
import json, re, random, sys

src, dst = sys.argv[1], sys.argv[2]
d = json.load(open(src, encoding="utf-8"))
rng = random.Random(20261020)

EMAIL_MAP = {"vladimirs.head@gmail.com": "dispatcher1@example.com", "vladimirshead@gmail.com": "dispatcher1@example.com",
             "jzemesarajs@gmail.com": "dispatcher2@example.com"}
FAKE_CLIENTS = ["Nordfrukt", "Kalevi", "VerdeFresh", "ServiFema", "Fjord Markets AS", "Sudmarkt", "LietPak", "Alpenfresh",
                "Baltfrost", "Iberika", "Oresund Food", "Polfrukt", "Rigafresh", "Tavastia", "Marenostrum", "Kuldfrukt"]

# --- собираем клиентов (без учёта регистра) ---
clients = {}
for r in d["rows"]:
    c = (r["row"].get("client") or "").strip()
    if c and c.lower() not in clients:
        clients[c.lower()] = FAKE_CLIENTS[len(clients) % len(FAKE_CLIENTS)]

UNIT_RE = re.compile(r"\b([A-Z]{2})([- ]?)(\d{4})\b")
TRL_RE = re.compile(r"\b([A-Z])([- ]?)(\d{3}[A-Z])\b")
PHONE_RE = re.compile(r"\+\d{9,13}")
LONGNUM_RE = re.compile(r"(?<![\d.])\d{6,}(?!\d)")
unit_map, trl_map, num_map = {}, {}, {}


def m_unit(m):
    k = m.group(1) + m.group(3)
    if k not in unit_map:
        while True:
            v = m.group(1) + "%04d" % rng.randint(1000, 9999)
            if v not in unit_map.values() and v != k:
                unit_map[k] = v
                break
    v = unit_map[k]
    return v[:2] + m.group(2) + v[2:]


def m_trl(m):
    k = m.group(1) + m.group(3)
    if k not in trl_map:
        while True:
            v = m.group(1) + "%03d" % rng.randint(100, 999) + rng.choice("ABCDEHKLMNPRSTUVXZ")
            if v not in trl_map.values() and v != k:
                trl_map[k] = v
                break
    v = trl_map[k]
    return v[0] + m.group(2) + v[1:]


def m_num(m):
    k = m.group(0)
    if k not in num_map:
        num_map[k] = "".join(str(rng.randint(0, 9)) for _ in k)
        if num_map[k][0] == "0":
            num_map[k] = "1" + num_map[k][1:]
    return num_map[k]


def anon_str(s):
    for a, b in EMAIL_MAP.items():
        s = s.replace(a, b)
    s = PHONE_RE.sub("+37100000000", s)
    s = UNIT_RE.sub(m_unit, s)
    s = TRL_RE.sub(m_trl, s)
    s = LONGNUM_RE.sub(m_num, s)
    for low, new in sorted(clients.items(), key=lambda kv: -len(kv[0])):
        s = re.sub(re.escape(low), new, s, flags=re.I)
    return s


def walk(o):
    if isinstance(o, str):
        return anon_str(o)
    if isinstance(o, list):
        return [walk(x) for x in o]
    if isinstance(o, dict):
        return {(anon_str(k) if isinstance(k, str) and not k.isdigit() else k): walk(v) for k, v in o.items()}
    return o


out = walk(d)
out["user"] = "dispatcher1@example.com"
json.dump(out, open(dst, "w", encoding="utf-8"), ensure_ascii=False)
print("rows", len(out["rows"]), "units", len(unit_map), "trailers", len(trl_map), "clients", len(clients), "nums", len(num_map))
