"""Сборка папки макета: настоящие static/*.js|css аппы + index.html из шаблона + stub.js + данные.
Запуск: python3 -I build.py <work> <dist>"""
import sys, os, re, json, shutil, glob
W, D = sys.argv[1], sys.argv[2]
SCR = os.path.dirname(os.path.abspath(__file__))
ST = "/home/claude/fleet-tracker/static"
shutil.rmtree(D, ignore_errors=True); os.makedirs(D)

for f in glob.glob(ST + "/*.js") + glob.glob(ST + "/*.css"):
    shutil.copy(f, D)
shutil.copy(SCR + "/stub.js", D)

html = open(W + "/index_raw.html", encoding="utf-8").read()
html = re.sub(r'<script[^>]*maps\.googleapis\.com[^>]*></script>', "", html)          # ключ Google в макет не попадает
html = re.sub(r'/static/([A-Za-z0-9_\-./]+?)(\?v=[\d.]+)?(?=["\'])', r"\1", html)       # относительные пути
body = re.search(r"<body[^>]*>(.*)</body>", html, re.S).group(1)
links = "\n".join(re.findall(r'<link rel="stylesheet"[^>]*>', html))
shutil.copy(SCR + "/variants.css", D); shutil.copy(SCR + "/variants.js", D); shutil.copy(SCR + "/colorder.js", D); shutil.copy(SCR + "/sorttoggle.js", D)
html = ('<title>Песочница Флота</title>\n<script src="stub.js"></script>\n'
        '<style>body{background:#fff}</style>\n' + links + '\n<link rel="stylesheet" href="variants.css">\n' + body +
        '\n<script src="variants.js"></script>\n<script src="colorder.js"></script>\n<script src="sorttoggle.js"></script>')   # оболочку (doctype/head/body) дописывает публикация
assert "maps/api/js" not in html and "key=" not in html, "ключ Google в HTML"
open(D + "/index.html", "w", encoding="utf-8").write(html)

snap = json.load(open(W + "/snap.json", encoding="utf-8"))
# диспетчеры — обезличить
dm = snap["gets"]["/api/dispatchers"]["json"]
n = 2
for x in dm["dispatchers"]:
    e = x["email"]
    if "vladimirs.head" in e: x["email"] = "dispatcher1@example.com"
    elif "jzemesarajs" in e: x["email"] = "dispatcher2@example.com"
    else:
        n += 1; x["email"] = "dispatcher%d@example.com" % n
dm["user"] = "dispatcher1@example.com"
dm["error"] = None
snap["gets"]["/api/me"]["json"] = {"email": "dispatcher1@example.com", "iap": True}
for k in ("error", "settings_error"):
    snap["gets"]["/api/freights"]["json"][k] = None
    snap["gets"]["/api/links"]["json"][k] = None
snap["gets"]["/api/addresses"]["json"]["error"] = None
snap["calc"] = {json.dumps(json.loads(k), ensure_ascii=False, separators=(",", ":")): v for k, v in snap["calc"].items()}   # ключ как у JSON.stringify
json.dump(snap, open(D + "/snap.json", "w", encoding="utf-8"), ensure_ascii=False)
shutil.copy(W + "/fleet_anon.json", D + "/fleet.json")
for dd in ("ferries", "postcode-maps"):
    if os.path.isdir(ST + "/" + dd): shutil.copytree(ST + "/" + dd, D + "/" + dd)
tot = sum(os.path.getsize(os.path.join(r, f)) for r, _, fs in os.walk(D) for f in fs)
print("files", sum(len(fs) for _, _, fs in os.walk(D)), "bytes", tot)
