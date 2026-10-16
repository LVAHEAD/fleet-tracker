"""v3.136: отчёт «список АЗС ↔ группа Mapon «Actual Petrol Station»» — только чтение, ничего не пишем в Mapon."""
from fetat.clients.fuel_sheet import fetch_fuel_csv
from fetat.clients.mapon import MAPON_BASE, mapon_get
from fetat.config import MAPON_API_KEY
from fetat.domain.fuel_stations import MATCH_M, match_to_mapon, parse_blocks, parse_meta
from fetat.utils.geo import _wkt_center
from fetat.utils.timefmt import ts_west

GROUP_NAME = "Actual Petrol Station"


def _group_objects(api_key):
    """(группа или None, объекты группы [{id, name, lat, lng}]). Ошибка Mapon — RuntimeError."""
    gl = mapon_get(MAPON_BASE + "object/list_groups.json", {"key": api_key}).get("data") or {}
    groups = gl.get("groups") or gl.get("object_groups") or (gl if isinstance(gl, list) else [])
    group = None
    for g in groups:
        if isinstance(g, dict) and (g.get("name") or g.get("title") or "").strip().lower() == GROUP_NAME.lower():
            group = {"id": g.get("id"), "name": g.get("name") or g.get("title")}
            break
    if group is None:
        return None, []
    objs = (mapon_get(MAPON_BASE + "object/list.json", {"key": api_key}, timeout=60).get("data") or {}).get("objects") or []
    items = []
    for o in objs:
        if str(o.get("group_id")) != str(group["id"]):
            continue
        lat, lng, n = _wkt_center(o.get("wkt"))
        if lat is None:
            continue
        items.append({"id": o.get("id"), "name": (o.get("name") or "").strip(), "lat": lat, "lng": lng})
    return group, items


def _pub(st):
    return {"name": st["name"], "network": st.get("network", ""), "lat": round(st["lat"], 6), "lng": round(st["lng"], 6),
            "gps": f"{st['lat']:.5f}, {st['lng']:.5f}"}


def fuel_report(force=False):
    """Список АЗС из таблицы сверяется с группой Mapon по GPS (до MATCH_M м).
    Возвращает словарь отчёта; поле error — если не удалось прочитать таблицу или Mapon."""
    rep = {"error": None, "mapon_error": None, "radius_m": MATCH_M, "group": None}
    try:
        csvs = fetch_fuel_csv(force=force)
    except RuntimeError as e:
        rep["error"] = str(e)
        return rep
    blocks = parse_blocks(csvs["blocks"])
    meta = parse_meta(csvs["meta"])
    rep["loaded_at"] = ts_west(csvs["at"]).strftime("%d/%m %H:%M")
    rep["sheet_updated"] = meta["updated"]
    group, objs = None, []
    if not MAPON_API_KEY:
        rep["mapon_error"] = "MAPON_API_KEY не настроен"
    else:
        try:
            group, objs = _group_objects(MAPON_API_KEY)
        except Exception as e:
            rep["mapon_error"] = f"Mapon: {e}"
        else:
            if group is None:
                rep["mapon_error"] = f"в Mapon нет группы «{GROUP_NAME}»"
    rep["group"] = {**group, "count": len(objs)} if group else None
    m = match_to_mapon(blocks, objs)
    if rep["mapon_error"]:        # Mapon недоступен — не выдаём «создать всё» за правду
        m = {"matched": [], "to_create": [], "not_working": [], "extra": []}
    rep["matched"] = [{**_pub(s), "mapon_name": s["mapon_name"], "dist_m": s["dist_m"]} for s in m["matched"]]
    rep["to_create"] = [_pub(s) for s in m["to_create"]]
    rep["not_working"] = [_pub(s) for s in m["not_working"]]
    rep["extra"] = [{"id": o["id"], "name": o["name"], "gps": f"{o['lat']:.5f}, {o['lng']:.5f}"} for o in m["extra"]]
    rep["no_gps"] = meta["stations"]
    rep["counts"] = {"list_gps": len(blocks), "matched": len(m["matched"]), "to_create": len(m["to_create"]),
                     "not_working": len(m["not_working"]), "extra": len(m["extra"]), "no_gps": len(meta["stations"])}
    return rep
