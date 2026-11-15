"""Лёгкая мобильная страница /m (просмотр): одна страница, один JS, один запрос /api/m/trips.
Сервер сам берёт строки Флота, считает ETA тем же движком (calc_row через кеш /api/calc) и отдаёт карточки с минимумом полей."""
import json
import os

from flask import Blueprint, Response, current_app, jsonify, make_response, render_template, request

from fetat import APP_VERSION
from fetat.api.calc import _calc_one, _calc_pool
from fetat.api.meta import current_user_email
from fetat.domain.dispatchers import get_dispatchers
from fetat.store.fleet_store import FLEET_STORE, fleet_owner
from fetat.utils.log import warn
from fetat.utils.text import canon_email

bp = Blueprint("mobile", __name__)

M_MAX_ROWS = 40   # потолок строк за один запрос (расчёты идут в общем пуле)


def _row_payload(row):
    """Тело расчёта строки — порт calcPayload (static/app.js) без ferryDeps и «не раньше» (fix_at):
    для VL с окнами «Даты» и портовых паромов ETA на телефоне может отличаться от десктопа."""
    extra = row.get("extra") or []
    pts = [row.get("target") or ""] + [(x or {}).get("target") or "" for x in extra]
    done = row.get("done") or {}
    by = row.get("doneBy") or {}
    seen = row.get("doneSeen") or {}
    arr = row.get("doneArr") or {}
    p = {"unit": row.get("unit"), "target": row.get("target")}
    if extra:
        p["extra"] = pts[1:]
    for src, dst in (("ferry", "ferry"), ("trailer", "trailer"), ("crew", "crew"), ("corridor", "corridor")):
        if row.get(src):
            p[dst] = row[src]
    cs = row.get("crewSeen")
    if isinstance(cs, dict) and cs.get("u") == row.get("unit") and cs.get("t"):
        p["crew_seen"] = int(cs["t"] // 1000)
    if row.get("x10"):
        p["x10"] = True
    p["done"] = [done.get(str(i)) if done.get(str(i)) in (True, False) else None for i in range(len(pts))]
    p["done_seen"] = [(t and seen.get(t)) or None for t in pts]
    p["done_arr"] = [(t and arr.get(t)) or None for t in pts]
    p["done_click"] = [((by.get(str(i)) or {}).get("eu") if done.get(str(i)) is True else None) or None
                       for i in range(len(pts))]
    p["why"] = "auto"
    return p


def _eta(x):
    return (x or {}).get("eta_tacho") or (x or {}).get("eta_local")


def _card(rid, row, owner_tag, res):
    """Минимум для карточки: машина, кто, статус, точки (текст, окно, ✓, км, ETA)."""
    extra = row.get("extra") or []
    c = {"id": rid, "unit": row.get("unit") or "", "disp": owner_tag,
         "trailer": row.get("trailer") or "", "comment": (row.get("comment") or "")[:200],
         "cl": (row.get("client") or "").strip()}
    if not isinstance(res, dict) or res.get("error"):
        c["error"] = (res or {}).get("error") or "нет расчёта"
        res = {}
    c.update({"st": res.get("status"), "dur": res.get("duration_str"), "cc": res.get("unit_country"),
              "wk": bool(res.get("tacho_weeklimit")), "out": bool(res.get("outsource"))})
    dn = res.get("points_done") or []
    ex = res.get("extra") or []
    man = row.get("done") or {}

    def _done(i):
        if i < len(dn):
            return bool(dn[i].get("done"))
        return man.get(str(i)) is True   # нет расчёта — по ручным ✓

    def _lo(x):
        x = x or {}
        return "" if x.get("swap") else (x.get("lo") or "")   # как ptLo: у перецепа тип нейтральный

    # движок считает только открытые точки: основной ETA / км — первой непройденной, ex — следующим за ней
    # (как active_idx в fleet_calc._apply_points_done); у пройденных точек ETA нет
    n = 1 + len(extra)
    act = res.get("active_idx")
    if not isinstance(act, list):
        act = [i for i in range(n) if not _done(i)]
    pts = []
    for i in range(n):
        x = row if i == 0 else (extra[i - 1] or {})
        p = {"t": x.get("target") or "", "w": x.get("delivery") or "", "lo": _lo(x), "done": _done(i),
             "km": None, "eta": None}
        if i in act:
            j = act.index(i)
            r = res if j == 0 else (ex[j - 1] if j - 1 < len(ex) and isinstance(ex[j - 1], dict) else {})
            p["km"] = r.get("dist_km") if j == 0 else r.get("leg_km")
            p["eta"] = _eta(r)
            ot = r.get("on_target") if j == 0 else None
            if isinstance(ot, dict) and ot.get("arr"):
                p["arr"] = ot["arr"]   # машина уже на объекте: как на десктопе — время приезда вместо расчётного ETA
            if j and r.get("error"):
                p["err"] = r.get("error")
        pts.append(p)
    c["pts"] = pts
    return c


@bp.route("/m")
def mobile_page():
    """Лёгкая мобильная страница (только просмотр): карточки трипов."""
    resp = make_response(render_template("m.html", app_version=APP_VERSION))
    if request.args.get("lite") == "1":   # «Открыть быструю версию» с плашки полной — снова редиректить телефон с /
        resp.delete_cookie("fetat_full")
    return resp


@bp.route("/m.webmanifest")
def mobile_manifest():
    """PWA: иконка на экране телефона, открывается сразу в /m без адресной строки."""
    m = {"name": "F.ETA.T", "short_name": "F.ETA.T", "start_url": "/m", "scope": "/m", "display": "standalone",
         "background_color": "#fafafa", "theme_color": "#fafafa", "lang": "ru",
         "icons": [{"src": "/static/m-icon-192.png", "sizes": "192x192", "type": "image/png"},
                   {"src": "/static/m-icon-512.png", "sizes": "512x512", "type": "image/png"}]}
    return Response(json.dumps(m, ensure_ascii=False), mimetype="application/manifest+json")


@bp.route("/sw-m.js")
def mobile_sw():
    """Service worker лежит в корне, чтобы покрывать /m (в /static область была бы только /static/)."""
    with open(os.path.join(current_app.static_folder, "m-sw.js"), encoding="utf-8") as f:
        body = f.read()
    return Response(body, mimetype="application/javascript",
                    headers={"Service-Worker-Allowed": "/m", "Cache-Control": "no-cache"})


@bp.route("/api/m/trips")
def api_m_trips():
    """Карточки трипов. По умолчанию только свои (хозяин — я; без хозяина — тоже), ?all=1 — все."""
    me = current_user_email() or "local"
    want_all = request.args.get("all") == "1" or me == "local"
    tags = {canon_email(d.get("email")): d.get("tag") or "" for d in (get_dispatchers() or [])}
    try:
        docs = FLEET_STORE.query(None)
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 503
    pick = []
    for d in docs:
        m = d["meta"]
        row = d["data"]
        if m.get("completed") or m.get("deleted") or not row.get("unit"):
            continue
        owner = fleet_owner(d)
        if want_all or not owner or owner == me:
            pick.append((d, owner))
    pick.sort(key=lambda x: (x[0]["meta"].get("created_at") or 0, str(x[0]["id"])))
    pick = pick[:M_MAX_ROWS]
    user = current_user_email()

    def one(item):
        d = item[0]
        try:
            return _calc_one(_row_payload(d["data"]), user)[0]
        except Exception as e:
            warn("m-trips", e)
            return {"error": "Ошибка расчёта"}

    results = list(_calc_pool.map(one, pick))
    cards = [_card(str(d["id"]), d["data"], tags.get(owner, ""), res) for (d, owner), res in zip(pick, results)]
    return jsonify({"ok": True, "me": me, "all": want_all, "trips": cards})
