"""v3.139: создание объектов АЗС в группе Mapon «Actual Petrol Station».

Что создаём — только то, чего в группе ещё нет (по GPS) и что не помечено «не работает». Форма и радиус — как у образца
из этой же группы. Ничего не удаляем и не меняем. Пробный режим создаёт ОДИН объект и проверяет его по чтению из Mapon.
"""
import threading

from fetat.clients.mapon_write import mapon_post
from fetat.config import MAPON_API_KEY, MAPON_WRITE_KEY
from fetat.domain.fuel_shape import make_wkt, shape_from_sample
from fetat.domain.fuel_stations import MATCH_M
from fetat.services import fuel_report as fr
from fetat.utils.geo import haversine_km

MAX_PER_CALL = 100
_lock = threading.Lock()


def _verify(st, gid):
    """Читаем группу заново: есть ли объект с этим именем и центром не дальше MATCH_M от станции."""
    try:
        _, objs = fr._group_objects(MAPON_API_KEY)
    except Exception as e:
        return False, f"не удалось перечитать группу: {e}"
    for o in objs:
        if o["name"] == st["obj_name"]:
            d = haversine_km(st["lat"], st["lng"], o["lat"], o["lng"]) * 1000
            return d <= MATCH_M, f"центр объекта в {round(d)} м от станции"
    return False, "созданный объект в группе не найден"


def fuel_create(mode):
    """mode: 'trial' — один объект с проверкой; 'all' — все недостающие. Возвращает {error | created, failed, verified…}."""
    if mode not in ("trial", "all"):
        return {"error": "неизвестный режим"}
    if not MAPON_WRITE_KEY:
        return {"error": "MAPON_WRITE_KEY не настроен (переменная окружения Cloud Run)"}
    if not _lock.acquire(blocking=False):
        return {"error": "создание уже идёт — подождите"}
    try:
        rep = fr.fuel_report()
        if rep.get("error") or rep.get("mapon_error"):
            return {"error": rep.get("error") or rep.get("mapon_error")}
        if not rep.get("group") or not rep.get("sample"):
            return {"error": "в группе нет образца-многоугольника: форму не с чего повторить"}
        try:
            shape = shape_from_sample(rep["sample"]["wkt"])
        except ValueError as e:
            return {"error": str(e)}
        gid = rep["group"]["id"]
        todo = rep["to_create"][:1] if mode == "trial" else rep["to_create"][:MAX_PER_CALL]
        out = {"mode": mode, "created": [], "failed": [], "left": max(0, len(rep["to_create"]) - len(todo)),
               "shape": {"n": shape["n"], "radius_m": shape["radius_m"]}}
        for st in todo:
            data = {"key": MAPON_WRITE_KEY, "name": st["obj_name"], "group_id": gid, "wkt": make_wkt(shape, st["lat"], st["lng"])}
            if rep["sample"].get("private") is not None:
                data["private"] = rep["sample"]["private"]
            try:
                mapon_post("object/save.json", data)
            except RuntimeError as e:
                out["failed"].append({"name": st["obj_name"], "error": str(e)})
                break                                   # первая же ошибка — стоп, чтобы не сыпать однотипным
            out["created"].append(st["obj_name"])
        if mode == "trial" and out["created"]:
            ok, note = _verify(todo[0], gid)
            out["verified"], out["verify_note"] = ok, note
        out["left"] = max(0, len(rep["to_create"]) - len(out["created"]))
        return out
    finally:
        _lock.release()
