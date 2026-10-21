/*
Fleet ETA Tracker — трипы без машины (v3.178, переделано в v3.179).
1) Плашки кодов точек в таблице (ES46 и т. п.) — как у трипов с машиной; код считает сервер по координатам (/api/locate, без Google).
2) Клик по трипу без машины — на карте Флота флажки всех его точек с номерами, масштаб под них (вызывается из drawRoute, map-core.js).
Координаты точки — только из адресной базы (точное совпадение таргета с названием или alias) или вписанный GPS; иначе точка молчит.
Цвет флажков по цветной метке (row.mark) — только у VL (markAllowed); у остальных — обычный цвет L / O.
Опирается на глобалы app.js / map-core.js (rows, map, makeBadge, flagIcon, targetColors, numChip, pointOf, ptFlagCls, ptFlagStyle,
markAllowed, escapeHtml). PrepMap.sync() — из saveRows, renderRows, initMap и после загрузки адресов; PrepMap.select(rowId, keepView) — из drawRoute.
*/
(function () {
  "use strict";
  const MARK_COLORS = { 1: ["#ff9800", "#e08600"], 2: ["#00e5ff", "#00b8cc"], 3: ["#34b36b", "#278f55"], 4: ["#ffeb00", "#d1bf00"] };
  const codes = {};   // ключ точки -> { code, place } | "wait" | "none"
  let sel = null;     // { id, items: [{ marker, badge }] } — выбранный трип без машины
  let timer = null;

  const norm = (s) => String(s || "").toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").trim();
  function parseGps(text) {
    const m = String(text || "").match(/(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/);
    if (!m) return null;
    const lat = Number(m[1]), lng = Number(m[2]);
    return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
  }
  function resolve(text) {
    const g = parseGps(text);
    if (g) return g;
    const n = norm(text);
    if (!n) return null;
    const list = Array.isArray(window.addressList) ? window.addressList : [];
    const a = list.find((x) => x.lat != null && x.lng != null && (norm(x.name) === n || (x.alias && norm(x.alias) === n)));
    return a ? { lat: a.lat, lng: a.lng } : null;
  }
  // точки трипа: k = 0 — основная, k ≥ 1 — row.extra[k - 1]
  function points(row) {
    const n = 1 + (row.extra ? row.extra.length : 0);
    const out = [];
    for (let k = 0; k < n; k++) {
      const text = k === 0 ? row.target : ((row.extra[k - 1] && row.extra[k - 1].target) || "");
      const p = pointOf(row, k) || {};
      out.push({ k, text: String(text || "").trim(), lo: p.lo || "", pos: resolve(text) });
    }
    return out;
  }

  // ---------- плашки кодов в таблице ----------
  function fetchCode(key, pos) {
    if (key in codes) return;
    codes[key] = "wait";
    fetch("/api/locate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q: pos.lat + ", " + pos.lng }) })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { codes[key] = j && j.code ? { code: j.code, place: j.code_place || "" } : "none"; sync(); })
      .catch(() => { delete codes[key]; });
  }
  function chipHtml(cls, info) {
    return `<span class="cc-badge ${cls} prep-cc${ptFlagCls(info.code)}"${ptFlagStyle(info.code)} title="${escapeHtml(info.place || info.code)}">${escapeHtml(info.code)}</span>`;
  }
  function hiddenHtml(cls) { return `<span class="cc-badge ${cls}" hidden></span>`; }
  function fill() {
    rows.forEach((row) => {
      if (row.unit) return;
      const tr = document.querySelector(`#fleet-tbody tr[data-id="${row.id}"]`);
      if (!tr) return;
      points(row).forEach((p) => {
        const cls = p.k === 0 ? "target-cc" : "x-cc";
        const el = p.k === 0 ? tr.querySelector(".target-cc") : tr.querySelector(`.x-stop[data-k="${p.k}"] .x-cc`);
        if (!el) return;
        const key = p.text.toLowerCase();
        let info = null;
        if (p.pos) { info = codes[key]; if (info === undefined) fetchCode(key, p.pos); }
        const ok = info && info !== "wait" && info !== "none";
        if (ok) {
          if (el.classList.contains("prep-cc") && el.textContent === info.code) return;
          el.outerHTML = chipHtml(cls, info);
        } else if (el.classList.contains("prep-cc")) {
          el.outerHTML = hiddenHtml(cls);
        }
      });
    });
  }

  // ---------- флажки выбранного трипа на карте ----------
  function flag(c) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="30">
      <line x1="4" y1="2" x2="4" y2="28" stroke="${c.stroke}" stroke-width="2.5"/>
      <path d="M4,3 L22,8 L4,13 Z" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1"/></svg>`;
    return { url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg), scaledSize: new google.maps.Size(26, 30), anchor: new google.maps.Point(4, 28) };
  }
  function clearSel() {
    if (!sel) return;
    sel.items.forEach((o) => { o.marker.setMap(null); o.badge.setMap(null); });
    sel = null;
  }
  function select(rowId, keepView) {
    clearSel();
    if (typeof map === "undefined" || !map || !window.google || !google.maps) return false;
    const row = rows.find((r) => String(r.id) === String(rowId));
    if (!row || row.unit) return false;
    const placed = points(row).filter((p) => p.pos);
    if (!placed.length) return false;
    const mk = markAllowed() ? MARK_COLORS[Number(row.mark) || 0] : null;
    const items = [];
    const bounds = new google.maps.LatLngBounds();
    placed.forEach((p) => {
      const base = targetColors(p.lo);
      const colors = mk ? { fill: mk[0], stroke: mk[1] } : base;
      const title = `${row.client ? row.client + " · " : ""}${p.text} (${p.k + 1}, без машины)`;
      const marker = new google.maps.Marker({ position: p.pos, map, icon: flag(colors), title, zIndex: 50 });
      const html = `${numChip(p.k + 1, p.lo)} ${escapeHtml(p.text)}`;
      const badge = makeBadge(p.pos.lat, p.pos.lng, html, "mk-tbadge mk-prep", 34, null);
      badge.border = colors.fill;
      if (badge.div) badge.div.style.borderColor = colors.fill;
      badge.setTop(true);
      items.push({ marker, badge });
      bounds.extend(p.pos);
    });
    sel = { id: String(row.id), items };
    if (!keepView) {
      if (placed.length === 1) { map.setCenter(placed[0].pos); map.setZoom(Math.max(map.getZoom() || 0, 9)); }
      else map.fitBounds(bounds, 60);
    }
    return true;
  }

  function run() {
    timer = null;
    fill();
    if (sel) select(sel.id, true);   // правка трипа — перерисовать без сдвига карты
  }
  // дребезг: saveRows бывает часто — раз в 150 мс
  function sync() { if (!timer) timer = setTimeout(run, 150); }
  window.PrepMap = { sync, select, fill };
})();
