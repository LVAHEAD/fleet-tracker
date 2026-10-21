/*
Fleet ETA Tracker — карта Флота: трипы без машины с цветной меткой (v3.178, только VL).
Трип в подготовке (машина не задана) стоит на карте флажком на первой непройденной точке: цвет — по метке строки (row.mark),
подпись — клиент. Координаты — только из адресной базы (точное совпадение таргета с названием или alias) или вписанный GPS;
запросов в Google нет. Когда трипу назначают машину (или метку снимают), флажок исчезает — дальше обычный таргет.
Опирается на глобалы app.js / map-core.js (rows, map, makeBadge, firstOpenIdx, rowPassesFilter, markAllowed, escapeHtml), вызываемые во время работы.
PrepMap.sync() вызывается из saveRows, initMap и после загрузки адресной базы.
*/
(function () {
  "use strict";
  const MARK_COLORS = { 1: ["#ff9800", "#e08600"], 2: ["#00e5ff", "#00b8cc"], 3: ["#34b36b", "#278f55"], 4: ["#ffeb00", "#d1bf00"] };
  const items = {};   // rowId -> { marker, badge }
  let timer = null;

  const norm = (s) => String(s || "").toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").trim();
  function parseGps(text) {
    const m = String(text || "").match(/(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/);
    if (!m) return null;
    const lat = Number(m[1]), lng = Number(m[2]);
    return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
  }
  // координаты таргета: вписанный GPS, иначе точное совпадение с названием / alias адреса из базы
  function resolve(text) {
    const g = parseGps(text);
    if (g) return g;
    const n = norm(text);
    if (!n) return null;
    const list = Array.isArray(window.addressList) ? window.addressList : [];
    const a = list.find((x) => x.lat != null && x.lng != null && (norm(x.name) === n || (x.alias && norm(x.alias) === n)));
    return a ? { lat: a.lat, lng: a.lng } : null;
  }
  function flag(c) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="30">
      <line x1="4" y1="2" x2="4" y2="28" stroke="${c[1]}" stroke-width="2.5"/>
      <path d="M4,3 L22,8 L4,13 Z" fill="${c[0]}" stroke="${c[1]}" stroke-width="1"/></svg>`;
    return { url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg), scaledSize: new google.maps.Size(26, 30),
      anchor: new google.maps.Point(4, 28) };
  }
  function drop(id) {
    const it = items[id];
    if (!it) return;
    if (it.marker) it.marker.setMap(null);
    if (it.badge) it.badge.setMap(null);
    delete items[id];
  }
  function pointText(row) {
    const k = firstOpenIdx(row);
    if (k < 0) return "";
    return k === 0 ? row.target : ((row.extra && row.extra[k - 1] && row.extra[k - 1].target) || "");
  }
  function run() {
    timer = null;
    if (typeof map === "undefined" || !map || !window.google || !google.maps) return;
    const live = new Set();
    if (typeof markAllowed === "function" && markAllowed()) {
      rows.forEach((row) => {
        const c = MARK_COLORS[Number(row.mark) || 0];
        if (row.unit || !c) return;
        const text = pointText(row);
        const pos = resolve(text);
        if (!pos) return;
        const id = String(row.id);
        live.add(id);
        const show = rowPassesFilter(row) ? map : null;
        const html = escapeHtml(row.client || text);
        const title = (row.client ? row.client + " · " : "") + text + " (без машины)";
        let it = items[id];
        if (!it) {
          it = items[id] = { marker: new google.maps.Marker({ position: pos, map: show, icon: flag(c), title }), badge: null };
          it.badge = makeBadge(pos.lat, pos.lng, html, "mk-tbadge mk-prep", 34, null);
        } else {
          it.marker.setPosition(pos); it.marker.setIcon(flag(c)); it.marker.setTitle(title);
          it.badge.update(new google.maps.LatLng(pos.lat, pos.lng), html, "mk-tbadge mk-prep");
        }
        it.badge.border = c[1];
        if (it.badge.div) it.badge.div.style.borderColor = c[1];
        if (it.marker.getMap() !== show) it.marker.setMap(show);
        if (it.badge.getMap() !== show) it.badge.setMap(show);
      });
    }
    Object.keys(items).forEach((id) => { if (!live.has(id)) drop(id); });
  }
  // дребезг: saveRows бывает часто — пересчитываем раз в 150 мс
  function sync() { if (!timer) timer = setTimeout(run, 150); }
  window.PrepMap = { sync };
})();
