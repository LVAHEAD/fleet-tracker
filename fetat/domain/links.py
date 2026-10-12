"""Лист «Ссылки» (Links, левая выезжалка): A — ссылка (http / https / mailto) или заголовок группы, B — название.
Заголовок группы — строка, где заполнена только A и это не ссылка. Пустые строки пропускаются.
Лист не читается — работает список по умолчанию (то, что было вшито в шаблон)."""
import re
import time

from fetat.clients.sheets import read_sheet_values
from fetat.config import LINKS_SHEET

LINKS_TTL_SEC = 600   # перечитываем лист не чаще раза в 10 минут

_URL_RE = re.compile(r"(?i)^(https?://\S+|mailto:\S+@\S+)$")

DEFAULT_LINKS = [
    {"title": "заказ паромов", "items": [
        {"url": "https://cargo.eckeroline.com/", "name": "Eckero Portal"},
        {"url": "mailto:cargo@eckeroline.fi", "name": "Eckero mail"},
        {"url": "mailto:booking.cargo@tallink.ee", "name": "Tallink mail"},
        {"url": "mailto:booking@kreiss.lv", "name": "Kreiss mail"}]},
    {"title": "Partner's Portals", "items": [
        {"url": "https://login.transporeon.com/?locale=en_US#UnityStart", "name": "Transporeon"},
        {"url": "https://www.skypass.no/", "name": "SkyPass"},
        {"url": "https://express.tnt.com/subcontractor/login.jsp", "name": "FedEx"},
        {"url": "https://osfc.userlogin.eu/", "name": "OSFC"}]},
    {"title": "Parkings, truck was, etc", "items": [
        {"url": "https://app.yourtravis.com/customer/login?session-expired=true", "name": "Travis"},
        {"url": "https://web.trucksnb.eu/", "name": "TrucksNB"},
        {"url": "https://truckerapps.eu/transparking/en/map/", "name": "Parkings EU"},
        {"url": "https://www.truckfly.com/search?category=PARKIN", "name": "TruckFly"},
        {"url": "https://www.autohof-guide.de/strassenkarte.html", "name": "autohof"}]},
    {"title": "Fuel", "items": [
        {"url": "https://login.eurowag.com/", "name": "EWAG"},
        {"url": "https://network.as24.com/stationfinder/en/stations?countries=FRA&products=03", "name": "AS24"}]},
]

_links_cache = {"groups": None, "loaded_at": 0.0, "error": None, "source": "default"}


def _short(url):
    return re.sub(r"(?i)^(https?://|mailto:)", "", url).split("/")[0][:40]


def parse_links(values):
    """Строки листа -> [{title, items: [{url, name}]}]. Группы без ссылок отбрасываются."""
    groups, cur = [], None
    for r in values or []:
        a = str(r[0]).strip() if len(r) > 0 and r[0] is not None else ""
        b = str(r[1]).strip() if len(r) > 1 and r[1] is not None else ""
        if not a:
            continue
        if _URL_RE.match(a):
            if cur is None:
                cur = {"title": "", "items": []}
                groups.append(cur)
            cur["items"].append({"url": a, "name": b or _short(a)})
        elif not b:
            cur = {"title": a, "items": []}
            groups.append(cur)
    return [g for g in groups if g["items"]]


def get_links(force=False):
    now = time.time()
    if force or _links_cache["groups"] is None or now - _links_cache["loaded_at"] > LINKS_TTL_SEC:
        try:
            groups = parse_links(read_sheet_values(LINKS_SHEET))
            if not groups:
                raise ValueError(f"лист «{LINKS_SHEET}» пуст или без ссылок")
            _links_cache.update(groups=groups, loaded_at=now, error=None, source="sheet")
        except Exception as e:
            if _links_cache["groups"] is None or _links_cache["source"] == "default":
                _links_cache.update(groups=[{**g, "items": [dict(i) for i in g["items"]]} for g in DEFAULT_LINKS],
                                    source="default")
            _links_cache["error"] = str(e)
            _links_cache["loaded_at"] = now - LINKS_TTL_SEC + 60   # повтор через минуту
    return _links_cache["groups"]
