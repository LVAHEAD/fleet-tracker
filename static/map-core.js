/*
map-core.js — карта Флота (v3.71): машины, таргеты, плашки, кластеры, линия маршрута.
Вынесено из app.js по одному куску за билд (BACKLOG → НекстБилд «Разбивка static/app.js»).
Грузится ДО app.js: переменные карты — одна общая область видимости скриптов страницы, как и раньше.
Пока без сборки; порядок <script> — в templates/index.html.
*/

// --- Карта ---
let map = null;
let markers = {}; // rowId -> google.maps.Marker (машина)
let targetMarkers = {}; // rowId -> google.maps.Marker (таргет, зелёный флажок)
let pendingPositions = {}; // rowId -> {lat, lng, label, status} — на случай если карта ещё грузится
let rowPositions = {}; // rowId -> {unitLat, unitLng, targetLat, targetLng, polyline}
let routePolyline = null; // текущая нарисованная линия маршрута (одна за раз)

function fleetUnitInRows(u) {
  const nrm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return rows.some((r) => r.unit && nrm(r.unit) === nrm(u.number));
}

function initMap() {
  // v1.66: + / − справа сверху под ⛶; v1.67: «джойстик» Google (cameraControl) убран; v3.50: общий конфиг — maps-common.js
  map = MapsCommon.make(document.getElementById("map"), { cameraControl: false });
  MapsCommon.refreshBtn(map, async () => { await refreshFleetPositions(); if (window.fleetMapUnits) await window.fleetMapUnits.refresh(); });   // ↻ на карте Флота — только позиции машин из Mapon (и все машины, если слой включён), без пересчёта строк и Google
  if (window.ObjLayer) ObjLayer.attach(map);   // v3.55: объекты Mapon — 🏭 под ↻
  if (window.PrepMap) PrepMap.sync();           // v3.178: трипы без машины с меткой VL
  ensureOverlap();                              // v3.58: машины в одной точке — счётчик и веер
  if (window.MapDispFilter) MapDispFilter.attach(map);   // после v3.132: свои кнопки диспетчеров на карте
  // v3.180: фильтр карты «Дисп.: Все» — показываем все машины Mapon (слой как в Локаторе), кроме тех, что уже стоят плашками трипов
  if (window.UnitsLayer) window.fleetMapUnits = UnitsLayer.attach(map, { follow: () => !!window.MapDispFilter && MapDispFilter.get() === "mapon", skip: fleetUnitInRows });

  Object.keys(pendingPositions).forEach((rowId) => {
    const p = pendingPositions[rowId];
    updateMarker(Number(rowId), p.lat, p.lng, p.label, p.status, p.heading, p.km, p.trailer, p.tgt);
  });
  pendingPositions = {};

  addTargetModeControl();
  // v3.26: подписи машин при зуме и кластеры — после каждого сдвига / зума
  map.addListener("idle", () => syncMapVisibility());
  map.addListener("zoom_changed", () => syncTruckLabels());
  window.googleMapsReady = true;
  if (window.onGoogleMapsReady) window.onGoogleMapsReady();
  (window._gmQueue || []).forEach((fn) => fn());
  window._gmQueue = [];
}

// ---------- v1.75: режим таргетов на карте — Все / Выбранная / Выкл ----------
const TARGET_MODES = { all: "🚩 Все", sel: "🚩 Выбранная", off: "🚩 Выкл" };
const TARGET_MODE_NEXT = { all: "sel", sel: "off", off: "all" };
const TARGET_MODE_TIP = {
  all: "Таргеты всех машин. Клик — только выбранной строки",
  sel: "Таргеты только выбранной строки (клик по строке в таблице). Клик — выключить таргеты",
  off: "Таргеты скрыты, видны только машины. Клик — показать все",
};
// v3.26 «Карта 2.0»: по умолчанию — «Выбранная»; у кого сохранено «Все» — один раз переключаем
let targetMode = "sel";
try {
  if (localStorage.getItem("fleet-target-v326") !== "1") {
    localStorage.setItem("fleet-target-mode", "sel");
    localStorage.setItem("fleet-target-v326", "1");
  }
  targetMode = localStorage.getItem("fleet-target-mode") || "sel";
} catch (e) {}
if (!TARGET_MODES[targetMode]) targetMode = "sel";
let selectedRowId = null;
function targetVisible(key) {
  const rid = String(key).split("_")[0];
  if (rowFilteredOut(rid)) return false;      // v3.26: строка спрятана фильтром — и её цели не рисуем
  if (targetMode === "all") return true;
  if (targetMode === "off") return false;
  return selectedRowId != null && rid === String(selectedRowId);
}
// only — ключ строки: пересчитать только её флажки (после расчёта строки)
function applyTargetVisibility(only) {
  if (!map) return;
  const pre = only != null ? String(only) : null;
  const touch = (obj) => Object.keys(obj).forEach((key) => {
    if (pre != null && key !== pre && !key.startsWith(pre + "_")) return;
    const want = targetVisible(key) ? map : null;
    const o = obj[key];
    if (o && o.getMap && o.getMap() !== want) o.setMap(want);
  });
  touch(targetMarkers);
  touch(targetBadges);
}
function addTargetModeControl() {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "tgt-mode-btn";
  const paint = () => {
    btn.textContent = TARGET_MODES[targetMode];
    btn.title = TARGET_MODE_TIP[targetMode];
    btn.classList.toggle("tgt-mode-dim", targetMode !== "all");
  };
  paint();
  btn.addEventListener("click", () => {
    targetMode = TARGET_MODE_NEXT[targetMode];
    try { localStorage.setItem("fleet-target-mode", targetMode); } catch (e) {}
    paint();
    applyTargetVisibility();
  });
  map.controls[google.maps.ControlPosition.TOP_LEFT].push(btn);
}

// --- v1.30: плашки на карте (как в Mapon) — HTML-слой поверх карты ---
// Плашка ставится над точкой lat/lng: низ плашки (с указателем) — на offsetY px выше точки.
let BadgeOverlayClass = null;
const BADGE_TOP_Z = 1000;   // v3.144: слой плашек выбранного трипа
// v3.121: onMap — другая карта (From → To); без него — карта Флота
function makeBadge(lat, lng, html, className, offsetY, onClick, onMap) {
  if (!BadgeOverlayClass) {
    BadgeOverlayClass = class extends google.maps.OverlayView {
      constructor(pos, html, cls, off, click) {
        super();
        this.pos = pos; this.html = html; this.cls = cls; this.off = off; this.click = click;
      }
      onAdd() {
        this.div = document.createElement("div");
        this.div.className = this.cls;
        this.div.innerHTML = this.html;
        this.div.style.position = "absolute";
        if (this.border) this.div.style.borderColor = this.border;   // v1.75: цвет рамки после скрытия/показа
        this.applyLook();
        if (this.top) this.div.style.zIndex = String(BADGE_TOP_Z);   // v3.144
        if (this.click) {
          this.div.style.cursor = "pointer";
          this.div.addEventListener("click", (e) => { e.stopPropagation(); this.click(); });
        }
        this.getPanes().overlayMouseTarget.appendChild(this.div);
      }
      draw() {
        const proj = typeof this.getProjection === "function" ? this.getProjection() : null;
        const p = proj && proj.fromLatLngToDivPixel(this.pos);
        if (!p || !this.div) return;
        this.div.style.left = `${p.x}px`;
        this.div.style.top = `${p.y - this.off}px`;
      }
      onRemove() { if (this.div) this.div.remove(); this.div = null; }
      update(pos, html, cls) {
        this.pos = pos;
        if (this.div) { this.div.innerHTML = html; this.div.className = cls; }
        this.html = html; this.cls = cls;
        this.applyLook();
        this.draw();
      }
      // v3.11: цвет диспетчера и бледность (фильтр диспетчера)
      setLook(look) { this.look = look; this.applyLook(); }
      applyLook() {
        const d = this.div, k = this.look;
        if (!d || !k) return;
        d.classList.toggle("mk-disp", !!k.bg);
        d.classList.toggle("mk-pale", !!k.pale);
        d.style.background = k.bg || "";
        d.style.borderColor = k.bg ? k.bd : (this.border || "");
        d.style.boxShadow = k.bg ? `inset 5px 0 0 ${k.st}, 0 1px 3px rgba(0,0,0,0.3)` : "";
        d.style.setProperty("--mk-tip", k.bd || "");
      }
      // v3.144: плашки выбранного трипа — выше всех остальных (по умолчанию слои плашек равны, сверху — созданная позже)
      setTop(on) { this.top = !!on; if (this.div) this.div.style.zIndex = this.top ? String(BADGE_TOP_Z) : ""; }
      getPosition() { return this.pos; }
    };
  }
  const o = new BadgeOverlayClass(new google.maps.LatLng(lat, lng), html, className, offsetY, onClick);
  o.setMap(onMap || map);
  return o;
}

const truckBadges = {}; // rowId -> BadgeOverlay (плашка с номером)
const lastTruckPos = {}; // rowId -> {lat, lng} — для курса, если Mapon его не отдал

function bearingDeg(a, b) {
  const toR = (d) => (d * Math.PI) / 180;
  const y = Math.sin(toR(b.lng - a.lng)) * Math.cos(toR(b.lat));
  const x = Math.cos(toR(a.lat)) * Math.sin(toR(b.lat)) -
            Math.sin(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.cos(toR(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// v1.57: км до таргета на плашке трака: < 10 — с десятыми, дальше целыми, тысячи с пробелом
function fmtKm(km) {
  if (km == null || isNaN(km)) return "";
  const v = Number(km);
  if (v < 10) return v.toFixed(1) + " км";
  return Math.round(v).toLocaleString("ru-RU") + " км";
}

// v3.101: вторая строка плашки — таргет текущей открытой точки строки (как в колонке «Таргет»).
// Координаты «lat, lng» — до 3 знаков после точки (обрезка); название — обрезает CSS по ширине первой строки (.mk-tgt)
function tgtLine(raw) {
  const t = String(raw || "").trim();
  const m = t.match(/^(-?\d+(?:\.\d+)?)[\s,]+(-?\d+(?:\.\d+)?)$/);
  if (!m) return t;
  const cut = (v) => (Math.trunc(parseFloat(v) * 1000) / 1000).toFixed(3);
  return cut(m[1]) + ", " + cut(m[2]);
}
function badgeTargetText(row) {
  const k = firstOpenIdx(row);
  if (k < 0) return "";
  return tgtLine(k === 0 ? row.target : ((row.extra || [])[k - 1] || {}).target);
}

function truckBadgeHtml(label, status, heading, km, tgt) {
  const arrow = status === "driving" && heading != null
    ? `<span class="mk-arrow" style="transform: rotate(${Math.round(heading)}deg)">↑</span>` : "";
  const kmTxt = km != null ? `<span class="mk-km">· ${fmtKm(km)}</span>` : "";
  const tgtTxt = tgt ? `<span class="mk-tgt">${escapeHtml(tgt)}</span>` : "";
  return `${escapeHtml(label || "")}${arrow}${kmTxt}${tgtTxt}`;
}

// v3.51: ↻ на карте Флота — только позиции машин строк из Mapon (/api/units), без пересчёта км и Google
const markerArgs = {};
async function refreshFleetPositions() {
  const d = await fetch("/api/units?t=" + Date.now()).then((r) => r.json());
  const us = (d.units || []).filter((u) => u.kind === "truck" && u.lat != null && u.lng != null);
  const nrm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  Object.keys(markerArgs).forEach((id) => {
    const a = markerArgs[id], row = rows.find((r) => String(r.id) === String(id));
    if (!row || !row.unit) return;
    const u = us.find((x) => nrm(x.number) === nrm(row.unit));
    if (!u) return;
    updateMarker(Number(id), u.lat, u.lng, a.label, u.st, u.dir, a.km, a.trailer, a.tgt);
    if (rowPositions[id]) { rowPositions[id].unitLat = u.lat; rowPositions[id].unitLng = u.lng; }
  });
}
// v3.58: машины в одной точке — счётчик и веер (static/overlap-spider.js); плашка машины едет вместе с маркером
let overlapCtl = null;
let overlapTimer = null;
function ensureOverlap() {
  if (overlapCtl || !map || !window.OverlapSpider) return;
  overlapCtl = OverlapSpider.create(map, {
    refresh: () => scheduleOverlap(),
    move: (id, lat, lng) => {
      const b = truckBadges[id];
      if (b) { b.pos = new google.maps.LatLng(lat, lng); b.draw(); }
    },
  });
}
function scheduleOverlap() {
  clearTimeout(overlapTimer);
  overlapTimer = setTimeout(applyOverlap, 40);
}
function applyOverlap() {
  ensureOverlap();
  if (!overlapCtl) return;
  const items = [];
  Object.keys(markers).forEach((id) => {
    const m = markers[id], p = lastTruckPos[id];
    if (!m || !p || !m.getMap || !m.getMap() || !m.getVisible()) return;
    items.push({ id, lat: p.lat, lng: p.lng, marker: m, st: truckStatus[id], title: (markerArgs[id] && markerArgs[id].label) || String(id) });
  });
  overlapCtl.apply(items);
}

function updateMarker(rowId, lat, lng, label, status, heading, km, trailer, tgt) {
  if (lat == null || lng == null) return;
  markerArgs[rowId] = { label, km, trailer, tgt };
  if (!map) {
    pendingPositions[rowId] = { lat, lng, label, status, heading, km, trailer, tgt };
    return;
  }
  // курс: из Mapon, иначе по двум последним позициям (если сдвинулась заметно)
  if (heading == null && lastTruckPos[rowId]) {
    const prev = lastTruckPos[rowId];
    if (Math.abs(prev.lat - lat) + Math.abs(prev.lng - lng) > 0.003) heading = bearingDeg(prev, { lat, lng });
    else heading = prev.heading;
  }
  lastTruckPos[rowId] = { lat, lng, heading };

  const pos = { lat, lng };
  truckStatus[rowId] = status;
  truckHeading[rowId] = heading;
  truckTrailer[rowId] = !!trailer;
  const icon = truckIcon(rowId);
  if (markers[rowId]) {
    markers[rowId].setPosition(pos);
    markers[rowId].setIcon(icon);
    markers[rowId].setTitle(label || "");
  } else {
    // v3.26: машинка — кружок без подписи; номер + км — при наведении, у выбранной строки и при зуме
    markers[rowId] = new google.maps.Marker({ position: pos, map: map, icon: icon, title: label, zIndex: 20 });
    markers[rowId].addListener("click", () => selectFromMap(rowId));
    markers[rowId].addListener("mouseover", () => { hoverRowId = String(rowId); syncTruckLabels(); });
    markers[rowId].addListener("mouseout", () => { if (hoverRowId === String(rowId)) hoverRowId = null; syncTruckLabels(); });
  }
  const cls = `mk-badge ${status === "driving" ? "mk-driving" : "mk-standing"}${trailer ? " mk-trailer" : ""}`;
  const html = truckBadgeHtml(label, status, heading, km, tgt);
  if (truckBadges[rowId]) truckBadges[rowId].update(new google.maps.LatLng(lat, lng), html, cls);
  else truckBadges[rowId] = makeBadge(lat, lng, html, cls, 14, () => selectFromMap(rowId));
  applyBadgeLook(rowId);
  scheduleMapSync();
  scheduleOverlap();   // v3.58
}

// v3.11: плашка машины — фон цвета диспетчера, рамка темнее, слева полоска статуса (едет/стоит)
// v3.26: чужие при фильтре не бледные, а спрятаны (syncMapVisibility); кружок машины — в цвет диспетчера
const truckStatus = {};
const truckHeading = {};
const truckTrailer = {};
function dispColorOf(rowId) {
  const row = rows.find((r) => String(r.id) === String(rowId));
  const e = row ? dispEntry(rowDisp(row)) : null;
  return e && e.color ? e.color : "";
}
function applyBadgeLook(rowId) {
  const b = truckBadges[rowId];
  if (b && b.setLook) {
    const bg = dispColorOf(rowId);
    const st = truckStatus[rowId] === "driving" ? "#1D9E75" : "#E24B4A";
    b.setLook({ bg, bd: bg ? (shadeHex(bg, 0.42) || "#999") : "", st, pale: false });
  }
  if (markers[rowId]) markers[rowId].setIcon(truckIcon(rowId));
}
function refreshBadgeLooks() {
  Object.keys(truckBadges).forEach((id) => applyBadgeLook(id));
  scheduleMapSync();
}
// v3.26: кружок машины — заливка цветом диспетчера (без диспетчера — серый), обводка — статус
// (едет — зелёная, стоит — красная), тонкий тёмный контур (белый цвет AA тоже виден), у едущей — стрелка курса;
// прицеп — квадратик. Дизайн — потом, сейчас механика.
function truckIcon(rowId) {
  const fill = dispColorOf(rowId) || "#c9ced6";
  const st = truckStatus[rowId] === "driving" ? "#1D9E75" : "#E24B4A";
  const hd = truckHeading[rowId];
  const arrow = truckStatus[rowId] === "driving" && hd != null
    ? `<path d="M12 0.5 L15.6 6 L8.4 6 Z" fill="${st}" stroke="#fff" stroke-width="0.8" transform="rotate(${Math.round(hd)} 12 12)"/>` : "";
  const shape = truckTrailer[rowId]
    ? `<rect x="6" y="6" width="12" height="12" rx="2" fill="${fill}" stroke="${st}" stroke-width="2.6"/>
       <rect x="4.6" y="4.6" width="14.8" height="14.8" rx="3" fill="none" stroke="rgba(0,0,0,.45)" stroke-width="1"/>`
    : `<circle cx="12" cy="12" r="6.2" fill="${fill}" stroke="${st}" stroke-width="2.6"/>
       <circle cx="12" cy="12" r="7.9" fill="none" stroke="rgba(0,0,0,.45)" stroke-width="1"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">${arrow}${shape}</svg>`;
  return {
    url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
    scaledSize: new google.maps.Size(24, 24),
    anchor: new google.maps.Point(12, 12),
  };
}

// ---------- v3.26 «Карта 2.0»: что видно на карте ----------
// Спрятано фильтром (диспетчер, L/O) — машинки и цели не рисуем. Прицеп (строка-прицеп и привязанный
// к тягачу) — только у выбранной строки. Подпись (номер + км) — при наведении, у выбранной строки и при зуме
// от LABEL_ZOOM. При отдалении (зум меньше CLUSTER_MAX_ZOOM) близкие машинки — кластер с цифрой.
const LABEL_ZOOM = 9;
const CLUSTER_MAX_ZOOM = 9;
const CLUSTER_PX = 34;
let hoverRowId = null;
let clusteredIds = new Set();
let clusterOverlays = [];
function rowFilteredOut(rowId) {
  const row = rows.find((r) => String(r.id) === String(rowId));
  if (!row || typeof rowPassesFilter !== "function") return false;
  // после v3.132: у карты свой фильтр диспетчеров (map-disp-filter.js); «Таблица» — как раньше
  if (window.MapDispFilter && typeof rowPassesFilterWith === "function") return !rowPassesFilterWith(row, window.MapDispFilter.pass);
  return !rowPassesFilter(row);
}
function isSelected(rowId) { return selectedRowId != null && String(rowId) === String(selectedRowId); }
function truckHidden(rowId) {
  if (rowFilteredOut(rowId)) return true;
  return !!truckTrailer[rowId] && !isSelected(rowId);
}
function truckLabelVisible(rowId) {
  if (!map || truckHidden(rowId) || clusteredIds.has(String(rowId))) return false;
  return isSelected(rowId) || hoverRowId === String(rowId) || (map.getZoom() || 0) >= LABEL_ZOOM;
}
function syncTruckLabels() {
  if (!map) return;
  Object.keys(truckBadges).forEach((id) => {
    const b = truckBadges[id];
    const want = truckLabelVisible(id) ? map : null;
    if (b && b.getMap() !== want) b.setMap(want);
  });
}
function worldPx(lat, lng, zoom) {
  const scale = 256 * Math.pow(2, zoom);
  const s = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999);
  return { x: ((lng + 180) / 360) * scale, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale };
}
function recluster() {
  clusterOverlays.forEach((o) => o.setMap(null));
  clusterOverlays = [];
  clusteredIds = new Set();
  if (!map) return;
  const zoom = map.getZoom() || 0;
  if (zoom >= CLUSTER_MAX_ZOOM) return;
  const pts = Object.keys(markers)
    .filter((id) => !truckHidden(id) && !isSelected(id))
    .map((id) => { const p = markers[id].getPosition(); return { id, lat: p.lat(), lng: p.lng(), ...worldPx(p.lat(), p.lng(), zoom) }; });
  const used = new Set();
  pts.forEach((a) => {
    if (used.has(a.id)) return;
    const group = pts.filter((b) => !used.has(b.id) && Math.hypot(a.x - b.x, a.y - b.y) <= CLUSTER_PX);
    if (group.length < 2) return;
    group.forEach((g) => { used.add(g.id); clusteredIds.add(String(g.id)); });
    const lat = group.reduce((t, g) => t + g.lat, 0) / group.length;
    const lng = group.reduce((t, g) => t + g.lng, 0) / group.length;
    const o = makeBadge(lat, lng, `<span title="Машин рядом: ${group.length}. Клик — приблизить">${group.length}</span>`, "mk-cluster", 0, () => {
      const bounds = new google.maps.LatLngBounds();
      group.forEach((g) => bounds.extend({ lat: g.lat, lng: g.lng }));
      const ne = bounds.getNorthEast(), sw = bounds.getSouthWest();
      if (Math.abs(ne.lat() - sw.lat()) < 0.01 && Math.abs(ne.lng() - sw.lng()) < 0.01) {
        map.panTo(bounds.getCenter());
        map.setZoom(Math.min(zoom + 3, 14));
      } else map.fitBounds(bounds, 60);
    });
    clusterOverlays.push(o);
  });
}
// v3.144: плашки выбранного трипа (машина и точки ①②③…; ключ точки — «id» или «id_k») — всегда выше остальных
function applyBadgeTop() {
  const top = (b, rid) => { if (b && typeof b.setTop === "function") b.setTop(isSelected(rid)); };
  Object.keys(targetBadges).forEach((k) => top(targetBadges[k], String(k).split("_")[0]));
  Object.keys(truckBadges).forEach((k) => top(truckBadges[k], k));
}
function syncMapVisibility() {
  if (!map) return;
  recluster();
  Object.keys(markers).forEach((id) => {
    const want = !truckHidden(id) && !clusteredIds.has(String(id));
    if (markers[id].getVisible() !== want) markers[id].setVisible(want);
  });
  Object.keys(trailerLinks).forEach((id) => {
    const t = trailerLinks[id];
    const want = isSelected(id) && !rowFilteredOut(id) ? map : null;
    [t.marker, t.badge, t.line].forEach((o) => { if (o && o.getMap() !== want) o.setMap(want); });
  });
  syncTruckLabels();
  applyTargetVisibility();
  applyBadgeTop();     // v3.144
  scheduleOverlap();   // v3.58: кластеры / фильтр поменялись — пересчёт счётчиков
}
window.fleetMapSync = syncMapVisibility;
let mapSyncTimer = null;
function scheduleMapSync() {
  if (mapSyncTimer) return;
  mapSyncTimer = setTimeout(() => { mapSyncTimer = null; syncMapVisibility(); }, 50);
}
// v3.26: выбранная строка — отметка в таблице
// v3.148: строка «в работе» — выбрана на карте или открыта в ⏱ (машина From): тёмная подсветка, как при наведении
// v3.149: в работе — одна строка: последнее действие (новый выбор на карте или открытие ⏱ — window.workSrc)
function markWorkRows() {
  const norm = (s) => String(s || "").replace(/\s+/g, "").toUpperCase();
  const selKey = selectedRowId == null ? null : String(selectedRowId);
  if (selKey !== window.workSelSeen) { window.workSelSeen = selKey; if (selKey != null) { window.workSrc = "map"; window.workRowId = selKey; } }
  const cu = norm(window.etaCalcUnit);
  const src = window.workSrc;
  const wantRow = src === "row" && window.workRowId != null ? String(window.workRowId) : null;
  const byCalc = src === "calc" && !!cu;
  document.querySelectorAll("#fleet-tbody tr.row-work").forEach((tr) => tr.classList.remove("row-work"));
  let done = false;
  document.querySelectorAll("#fleet-tbody tr[data-id]").forEach((tr) => {
    const on = wantRow != null ? String(tr.dataset.id) === wantRow
             : byCalc ? norm((tr.querySelector(".unit-input") || {}).value) === cu
             : selKey != null && String(tr.dataset.id) === selKey;
    if (on && !done) { tr.classList.add("row-work"); done = true; }
  });
}
// v3.149: любой клик в строке трипа (поля, кнопки, страна, точки) — «в работе» переходит на эту строку
function setWorkRow(id) {
  window.workRowId = String(id);
  window.workSrc = "row";
  markWorkRows();
}
function markSelectedRow() {
  markWorkRows();
  document.querySelectorAll("#fleet-tbody tr.row-sel").forEach((tr) => tr.classList.remove("row-sel"));
  if (selectedRowId == null) return;
  const tr = document.querySelector(`#fleet-tbody tr[data-id="${selectedRowId}"]`);
  if (tr) tr.classList.add("row-sel");
}
// v3.26: клик по машинке на карте — выбрать строку, подсветить и прокрутить к ней (на телефоне — только маршрут)
function selectFromMap(rowId) {
  drawRoute(Number(rowId));
  if (document.body.classList.contains("m-map-open")) return;
  const tr = document.querySelector(`#fleet-tbody tr[data-id="${rowId}"]`);
  if (!tr) return;
  tr.classList.remove("row-flash");
  void tr.offsetWidth;
  tr.classList.add("row-flash");
  setTimeout(() => tr.classList.remove("row-flash"), 1700);
  tr.scrollIntoView({ block: "center", behavior: "smooth" });
}

function markerIcon(status, trailer) {
  // v1.30: маленькая точка в позиции машины; номер — на плашке над ней
  const fill = status === "driving" ? "#1D9E75" : "#E24B4A"; // едет — зелёный, стоит — красный
  // v1.70: прицеп — квадратик вместо кружка
  const shape = trailer
    ? `<rect x="2" y="2" width="10" height="10" rx="1.5" fill="${fill}" stroke="white" stroke-width="2"/>`
    : `<circle cx="7" cy="7" r="5" fill="${fill}" stroke="white" stroke-width="2"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14">${shape}</svg>`;
  return {
    url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
    scaledSize: new google.maps.Size(14, 14),
    anchor: new google.maps.Point(7, 7),
  };
}

function labelOpts(text, status) {
  const color = status === "driving" ? "#0F6E56" : "#791F1F";
  return { text: text || "", fontSize: "13px", fontWeight: "600", color: color, className: "marker-label" };
}

function removeMarker(rowId) {
  if (markers[rowId]) {
    markers[rowId].setMap(null);
    delete markers[rowId];
    scheduleOverlap();   // v3.58
  }
  if (truckBadges[rowId]) {
    truckBadges[rowId].setMap(null);
    delete truckBadges[rowId];
  }
  delete lastTruckPos[rowId];
  delete truckStatus[rowId];
  delete truckHeading[rowId];
  delete truckTrailer[rowId];
  removeTrailerLink(rowId);
  scheduleMapSync();
}

// v1.71: привязанный прицеп на карте — только если он дальше 1 км: квадратик + пунктир до тягача
const trailerLinks = {}; // rowId -> {marker, badge, line}
function removeTrailerLink(rowId) {
  const t = trailerLinks[rowId];
  if (!t) return;
  if (t.marker) t.marker.setMap(null);
  if (t.badge) t.badge.setMap(null);
  if (t.line) t.line.setMap(null);
  delete trailerLinks[rowId];
}
function updateTrailerLink(rowId, tLat, tLng, lt) {
  removeTrailerLink(rowId);
  if (!map || !lt || !lt.far || lt.lat == null || lt.lng == null) return;
  const pos = { lat: lt.lat, lng: lt.lng };
  const marker = new google.maps.Marker({ position: pos, map, icon: markerIcon(lt.status, true), title: lt.number, zIndex: 19 });
  const cls = `mk-badge ${lt.status === "driving" ? "mk-driving" : "mk-standing"} mk-trailer`;
  const badge = makeBadge(lt.lat, lt.lng, escapeHtml(lt.number), cls, 11, () => selectFromMap(rowId));
  const line = new google.maps.Polyline({
    path: [{ lat: tLat, lng: tLng }, pos], map, strokeOpacity: 0, zIndex: 5,
    icons: [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 0.8, strokeColor: "#7b4fc0", scale: 3 }, offset: "0", repeat: "12px" }],
  });
  trailerLinks[rowId] = { marker, badge, line };
  scheduleMapSync();     // v3.26: привязанный прицеп — только у выбранной строки
}

function centerMapOn(rowId) {
  const m = markers[rowId];
  if (m && map) {
    map.panTo(m.getPosition());
    map.setZoom(9);
  }
}

// Цвета флажка таргета: L — погрузка (синий), O — выгрузка (жёлто-горчичный),
// без отметки — зелёный, как было. На карте цвета насыщеннее, чем бледные кнопки
// в таблице, иначе маркер теряется на фоне.
const TARGET_COLORS = {
  "":  { fill: "#1D9E75", stroke: "#2E7D46", label: "#2E7D46" },
  "L": { fill: "#4A90D9", stroke: "#1F5A99", label: "#1F5A99" },
  "O": { fill: "#E0B000", stroke: "#7A5C00", label: "#7A5C00" },
  // v1.28: таргет из адресной базы с типом port / customs / misc (если L/O не отмечен)
  "port":    { fill: "#8A8F98", stroke: "#4B5058", label: "#4B5058" },
  "customs": { fill: "#8E5BD0", stroke: "#5B2E9A", label: "#5B2E9A" },
  "misc":    { fill: "#2AA7A0", stroke: "#18706B", label: "#18706B" },
};
// тип таргета из адресной базы по id строки (в памяти, для цвета флажка)
const targetTypeByRow = {};
function markerKind(row) {
  return row.lo || targetTypeByRow[row.id] || "";
}

function targetColors(lo) {
  return TARGET_COLORS[lo || ""] || TARGET_COLORS[""];
}

function flagIcon(lo) {
  const c = targetColors(lo);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="30">
    <line x1="4" y1="2" x2="4" y2="28" stroke="${c.stroke}" stroke-width="2.5"/>
    <path d="M4,3 L22,8 L4,13 Z" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1"/>
  </svg>`;
  return {
    url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
    scaledSize: new google.maps.Size(26, 30),
    anchor: new google.maps.Point(4, 28),
    labelOrigin: new google.maps.Point(13, -6),
  };
}

function targetLabel(label, lo) {
  return { text: label || "", fontSize: "12px", fontWeight: "600", color: targetColors(lo).label };
}

// v1.30: подпись таргета — белая плашка с рамкой цвета L/O над флажком
const targetBadges = {}; // rowId -> BadgeOverlay
// v1.74: "⬇️ OB-3280 [5]" — ⬇️ погрузка, ⬆️ выгрузка, ⏺️ другое; номер точки — кружок
// v1.77: + км — у ① от машины, у ②③… плечо от предыдущей точки ("+165 км")
function targetBadgeParts(label, lo, n, km, tgt) {
  const c = targetColors(lo);
  const tgtTxt = tgt ? `<span class="mk-tgt">${escapeHtml(tgt)}</span>` : "";   // v3.102: таргет точки — вторая строка
  const kmHtml = km ? ` <span class="tb-km">${escapeHtml(km)}</span>` : "";   // v1.78: без "·"
  const icon = lo === "L" ? "⬇️" : lo === "O" ? "⬆️" : "⏺️";
  const chip = n ? ` <span class="pn-chip" style="background:${c.stroke}">${n}</span>` : "";
  return {
    html: `<span style="color:${c.label}"><span class="tb-ic">${icon}</span> ${escapeHtml(label || "")}${chip}${kmHtml}</span>${tgtTxt}`,
    cls: "mk-tbadge",
    border: c.fill,
  };
}

function setTargetBadge(rowId, lat, lng, label, lo, n, km, tgt) {
  const t = targetBadgeParts(label, lo, n, km, tgt);
  if (targetBadges[rowId]) targetBadges[rowId].update(new google.maps.LatLng(lat, lng), t.html, t.cls);
  else targetBadges[rowId] = makeBadge(lat, lng, t.html, t.cls, 34, null);
  const b = targetBadges[rowId];
  b.setTop(isSelected(String(rowId).split("_")[0]));   // v3.144
  b.border = t.border;
  const applyBorder = () => { if (b.div) b.div.style.borderColor = t.border; };
  applyBorder();
  setTimeout(applyBorder, 0); // div создаётся в onAdd — после setMap
}

function updateTargetMarker(rowId, lat, lng, label, lo, n, km, tgt) {
  if (lat == null || lng == null) return;
  if (!map) return; // таргет-маркер не критичен при ранней загрузке, пропускаем
  const pos = { lat, lng };
  if (targetMarkers[rowId]) {
    targetMarkers[rowId].setPosition(pos);
    targetMarkers[rowId].setIcon(flagIcon(lo));
  } else {
    targetMarkers[rowId] = new google.maps.Marker({
      position: pos,
      map: map,
      icon: flagIcon(lo),
      title: `Таргет: ${label || ""}`,
    });
  }
  targetMarkers[rowId]._label = label;
  targetMarkers[rowId]._n = n;
  targetMarkers[rowId]._km = km;
  targetMarkers[rowId]._tgt = tgt;
  setTargetBadge(rowId, lat, lng, label, lo, n, km, tgt);
  applyTargetVisibility(rowId);
}

// Перекрасить уже стоящий флажок без пересчёта маршрута (после клика по L/O)
function recolorTargetMarker(rowId, label, lo) {
  const m = targetMarkers[rowId];
  if (!m) return;
  m.setIcon(flagIcon(lo));
  const p = m.getPosition();
  setTargetBadge(rowId, p.lat(), p.lng(), m._label || label, lo, m._n, m._km, m._tgt);
}

function removeTargetMarker(rowId) {
  removeExtraTargets(rowId);
  if (targetMarkers[rowId]) {
    targetMarkers[rowId].setMap(null);
    delete targetMarkers[rowId];
  }
  if (targetBadges[rowId]) {
    targetBadges[rowId].setMap(null);
    delete targetBadges[rowId];
  }
}

// v1.64: флажки 2-й, 3-й... точки строки — ключи "id_k" в тех же targetMarkers/targetBadges
function removeExtraTargets(rowId, fromK) {
  const pre = rowId + "_";
  Object.keys(targetMarkers).concat(Object.keys(targetBadges)).forEach((key) => {
    if (!String(key).startsWith(pre)) return;
    if (fromK != null && Number(String(key).slice(pre.length)) < fromK) return;
    if (targetMarkers[key]) { targetMarkers[key].setMap(null); delete targetMarkers[key]; }
    if (targetBadges[key]) { targetBadges[key].setMap(null); delete targetBadges[key]; }
  });
}
const STOP_NUM = ["", "①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩", "⑪", "⑫", "⑬", "⑭", "⑮", "⑯", "⑰", "⑱", "⑲", "⑳"];
const MAX_STOPS = 12;   // v1.74: точек в строке максимум (1 основная + 11 следующих)
// v1.74: номер точки — белая цифра в залитом кружке цвета L/O (вместо мелких ①②)
function numChip(n, lo) {
  return `<span class="pn-chip pn-${lo === "L" ? "L" : lo === "O" ? "O" : "x"}">${n}</span>`;
}
let routeExtraLines = [];

function drawRoute(rowId, keepView) {   // v3.84: keepView — перерисовать линию, не двигая карту
  const pos = rowPositions[rowId];
  selectedRowId = rowId;           // v1.75: для режима таргетов "Выбранная"
  markSelectedRow();               // v3.26: строка отмечена, её машинка — с подписью и вне кластера
  syncMapVisibility();

  if (routePolyline) {
    routePolyline.setMap(null);
    routePolyline = null;
  }
  routeExtraLines.forEach((l) => l.setMap(null));
  routeExtraLines = [];
  if (window.PrepMap && PrepMap.select(rowId, keepView)) return;   // v3.179: трип без машины — точки из адресной базы / GPS

  if (!pos || pos.targetLat == null || pos.targetLng == null) {
    if (!keepView) centerMapOn(rowId);
    return;
  }

  if (!pos.polyline) {
    // координаты таргета есть, а линии нет (например, Routes API не вернул её) — просто центрируем
    if (!keepView) centerMapOn(rowId);
    return;
  }

  const path = google.maps.geometry.encoding.decodePath(pos.polyline);
  routePolyline = new google.maps.Polyline({
    path: path,
    strokeColor: "#4285F4",
    strokeOpacity: 0.85,
    strokeWeight: 4,
    map: map,
  });

  const bounds = new google.maps.LatLngBounds();
  path.forEach((p) => bounds.extend(p));
  // v1.64: плечи к следующим точкам той же машины — тем же цветом, чуть бледнее
  (pos.extraPolys || []).forEach((enc) => {
    if (!enc) return;
    const p2 = google.maps.geometry.encoding.decodePath(enc);
    routeExtraLines.push(new google.maps.Polyline({ path: p2, strokeColor: "#4285F4", strokeOpacity: 0.55, strokeWeight: 4, map: map }));
    p2.forEach((p) => bounds.extend(p));
  });
  if (!keepView) map.fitBounds(bounds, 40);
}

// v3.84: смена коридора — линию выбранной строки приглушить на время расчёта, потом перерисовать (выбранную — без сдвига карты,
// невыбранную — выбрать и показать, как по клику). Панель карты сама не открывается; карты ещё нет — ничего не делаем.
function dimRoute(rowId) {
  if (!map || !isSelected(rowId)) return;
  if (routePolyline) routePolyline.setOptions({ strokeOpacity: 0.3 });
  routeExtraLines.forEach((l) => l.setOptions({ strokeOpacity: 0.2 }));
}
function refreshRoute(rowId) {
  if (!map) return;
  const id = Number(rowId);
  drawRoute(id, isSelected(id));
}
