/*
Fleet ETA Tracker — фронтенд
Версия: 1.57 (км до таргета на плашке трака на карте).
Ранее 1.56 (комментарий строки: жёлтый уголок, всплывающая заметка, правка).
Ранее 1.55 (сортировка по Delivery; ссылки в блокноте).
Ранее 1.54 (окна Delivery: 09-15, before 15, between 01 to 04…; "раньше окна").
Ранее 1.53 (сортировка Флота: как добавляли / L→O / O→L / руками).
Ранее 1.50 (Delivery/Примечание без пересчёта маршрута).
Ранее 1.48 (NoBan — кнопка в ETA; вернулась бледная заливка строк L/O).
Ранее 1.46 (плашка 56 — недельный лимит одиночки).
Ранее 1.45 (🚫 в ETA — полный запрет по пути).
Ранее 1.44 (меню ⋯ поверх страницы, у нижних строк — вверх).
Ранее 1.43 (Флот, вариант A: статус и ETA в одну строку, полоска L/O, меню ⋯, красный ETA при опоздании к Delivery).
Ранее 1.33 (ETA по тахографу во второй строке ETA, ⏸ в Статусе).
Ранее 1.31 (плашки страны в Статусе и кода региона в Таргете).
Ранее 1.30 (плашки машин и таргетов на карте, стрелка курса).
Ранее 1.28 (адресная база: подсказки points-list, L/O из Type, цвета port/customs/misc).
Ранее 1.23 (Таргет может быть номером другой машины — перецеп; подсказки номеров в Таргет).
Ранее 1.22 (подсветка всей строки по L/O, кроме ячейки Статус).
Ранее 1.21 (кнопка L/O перед Таргетом: погрузка / выгрузка — цвет кнопки,
цвет флажка таргета на карте и подсказка в поле Delivery; статус строго в две строки)

Хранение состояния: localStorage браузера (ключ "fleet-rows"), переживает
закрытие вкладки. Каждая строка: { id, unit, lo, target, delivery, note },
lo — "" | "L" (погрузка) | "O" (выгрузка). У старых строк поля lo нет — считается "".
Статус/км/ETA не хранятся — пересчитываются заново при каждом обновлении.
*/

const STORAGE_KEY = "fleet-rows";
let rows = [];
let unitsCache = [];
let lastCalcText = {}; // rowId -> {status, statusClass, dist, eta} — чтобы renderRows не стирал уже посчитанное

// --- Карта ---
let map = null;
let markers = {}; // rowId -> google.maps.Marker (машина)
let targetMarkers = {}; // rowId -> google.maps.Marker (таргет, зелёный флажок)
let pendingPositions = {}; // rowId -> {lat, lng, label, status} — на случай если карта ещё грузится
let rowPositions = {}; // rowId -> {unitLat, unitLng, targetLat, targetLng, polyline}
let routePolyline = null; // текущая нарисованная линия маршрута (одна за раз)

// v1.24: несколько вкладок могут ждать загрузки Google Maps — очередь вместо одного колбэка
// v1.80: масштаб интерфейса (body { zoom: .9 } на большом экране)
function uiZoom() {
  const z = parseFloat(getComputedStyle(document.body).zoom);
  return z > 0 ? z : 1;
}

// v3.34: одна ширина всех боковых панелей (🗺, 📓, ⏱): потянул одну — такими же стали остальные.
// --sidepw — ширина панелей (помнит браузер, "side-w"); --sidew (500) — резерв, на который сужается таблица, не меняется.
window.sidePanelW = (() => {
  const KEY = "side-w", DEF = 500, MIN = 380;
  const root = document.documentElement;
  let cur = DEF;
  const clamp = (w) => Math.max(MIN, Math.min(Math.round((window.innerWidth / uiZoom()) * 0.85), Math.round(w)));
  function set(w) {
    cur = clamp(w);
    root.style.setProperty("--sidepw", cur + "px");
    document.querySelectorAll(".w-label").forEach((l) => { l.textContent = cur + " px"; });
    document.querySelectorAll(".map-resize, .ec-resize, .nb-resize").forEach((h) => {
      h.title = `Ширина ${cur} px (по умолчанию ${DEF}, у всех панелей одна) — потянуть шире / уже; шире ${DEF} — наползает на таблицу`;
    });
    return cur;
  }
  function save() { try { localStorage.setItem(KEY, String(cur)); } catch (e) { /* ignore */ } }
  // тянуть за левый край: bodyCls — класс на body на время (прячет переходы, показывает px), onEnd — после
  function drag(e, bodyCls, onEnd) {
    e.preventDefault();
    document.body.classList.add(bodyCls);
    const z = uiZoom();
    const move = (ev) => set((window.innerWidth - ev.clientX) / z);
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      document.body.classList.remove(bodyCls);
      save();
      if (onEnd) onEnd();
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }
  try { cur = Number(localStorage.getItem(KEY)) || DEF; } catch (e) { /* ignore */ }
  set(cur);
  window.addEventListener("resize", () => set(cur));
  return { get: () => cur, set, save, drag, DEF };
})();

/* v3.32: левый край страницы не скачет при открытии боковой панели. Без панели страница по центру (большой экран)
   или от края (до 1500 px); перед открытием замеряем, где левый край, и держим его там (--side-ml, в px страницы
   с учётом зума). Пока панель открыта и меняется окно — двигаем пропорционально ширине окна. */
let sideMlFrac = null;
function sideMarginFix() {
  const b = document.body;
  if (!b.classList.contains("map-open") && !b.classList.contains("nb-open") && !b.classList.contains("calc-open")) {
    const left = b.getBoundingClientRect().left;
    sideMlFrac = window.innerWidth ? Math.max(0, left) / window.innerWidth : 0;
  }
  sideMarginApply();
}
function sideMarginApply() {
  if (sideMlFrac == null) return;
  const frac = window.innerWidth >= 1500 ? sideMlFrac : 0;   // v3.35: страница во всю ширину — отступ 0, без подстановки 2,5 %
  document.documentElement.style.setProperty("--side-ml", Math.round(frac * window.innerWidth / uiZoom()) + "px");
}
window.addEventListener("resize", sideMarginApply);

/* v3.31: боковые панели (🗺, 📓, ⏱) закрываются кликом в любом месте аппы, кроме строк трипов (клик по строке —
   маршрут на карте, данные машины в калькулятор), всплывашек из строки (комментарий, прицеп, корзина,
   ✓ завершённые), фильтров и сортировки над таблицей. Нажатие ловим до обработчиков (capture): всплывашка
   может закрыться раньше, чем мы посмотрим, где был клик. */
const SIDE_KEEP = [
  ".map-panel", ".nb-panel", ".ec-panel", ".map-tab", ".nb-tab", ".calc-tab",
  "#fleet-tbody tr", ".sort-bar",
  ".com-pop", ".com-ed", ".trl-ed", ".trl-ed-near", ".trash-pop", ".trash-btn", ".done-pop", ".done-btn",
  ".nb-modal-bg", ".tabs-more-wrap", ".fleet-toast", ".pac-container", ".cor-pop",
  "[data-tab]",   // v3.36: смена вкладки аппы панель не закрывает (карта вернётся при возврате во Флот)
].join(", ");
document.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  const t = e.target;
  if (!t || t.nodeType !== 1 || t === document.documentElement) return;   // полоса прокрутки страницы
  if (t.closest(SIDE_KEEP)) return;
  const fleet = document.getElementById("tab-fleet");
  if (window.fleetMapPanel && fleet && !fleet.hidden) window.fleetMapPanel.close();   // карта видна только во Флоте
  if (window.etaCalc) window.etaCalc.close();
  if (typeof Notebook !== "undefined" && Notebook.close) Notebook.close();
}, true);

window.whenGoogleMaps = function (fn) {
  if (window.googleMapsReady) fn();
  else (window._gmQueue = window._gmQueue || []).push(fn);
};

function initMap() {
  // v1.66: + / − справа сверху под ⛶; v1.67: «джойстик» Google (cameraControl) убран; v3.50: общий конфиг — maps-common.js
  map = MapsCommon.make(document.getElementById("map"), { cameraControl: false });

  Object.keys(pendingPositions).forEach((rowId) => {
    const p = pendingPositions[rowId];
    updateMarker(Number(rowId), p.lat, p.lng, p.label, p.status, p.heading, p.km, p.trailer);
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
function makeBadge(lat, lng, html, className, offsetY, onClick) {
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
      getPosition() { return this.pos; }
    };
  }
  const o = new BadgeOverlayClass(new google.maps.LatLng(lat, lng), html, className, offsetY, onClick);
  o.setMap(map);
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

function truckBadgeHtml(label, status, heading, km) {
  const arrow = status === "driving" && heading != null
    ? `<span class="mk-arrow" style="transform: rotate(${Math.round(heading)}deg)">↑</span>` : "";
  const kmTxt = km != null ? `<span class="mk-km">· ${fmtKm(km)}</span>` : "";
  return `${escapeHtml(label || "")}${arrow}${kmTxt}`;
}

function updateMarker(rowId, lat, lng, label, status, heading, km, trailer) {
  if (lat == null || lng == null) return;
  if (!map) {
    pendingPositions[rowId] = { lat, lng, label, status, heading, km, trailer };
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
  const html = truckBadgeHtml(label, status, heading, km);
  if (truckBadges[rowId]) truckBadges[rowId].update(new google.maps.LatLng(lat, lng), html, cls);
  else truckBadges[rowId] = makeBadge(lat, lng, html, cls, 14, () => selectFromMap(rowId));
  applyBadgeLook(rowId);
  scheduleMapSync();
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
  return !!(row && typeof rowPassesFilter === "function" && !rowPassesFilter(row));
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
}
window.fleetMapSync = syncMapVisibility;
let mapSyncTimer = null;
function scheduleMapSync() {
  if (mapSyncTimer) return;
  mapSyncTimer = setTimeout(() => { mapSyncTimer = null; syncMapVisibility(); }, 50);
}
// v3.26: выбранная строка — отметка в таблице
function markSelectedRow() {
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
function targetBadgeParts(label, lo, n, km) {
  const c = targetColors(lo);
  const kmHtml = km ? ` <span class="tb-km">${escapeHtml(km)}</span>` : "";   // v1.78: без "·"
  const icon = lo === "L" ? "⬇️" : lo === "O" ? "⬆️" : "⏺️";
  const chip = n ? ` <span class="pn-chip" style="background:${c.stroke}">${n}</span>` : "";
  return {
    html: `<span style="color:${c.label}"><span class="tb-ic">${icon}</span> ${escapeHtml(label || "")}${chip}${kmHtml}</span>`,
    cls: "mk-tbadge",
    border: c.fill,
  };
}

function setTargetBadge(rowId, lat, lng, label, lo, n, km) {
  const t = targetBadgeParts(label, lo, n, km);
  if (targetBadges[rowId]) targetBadges[rowId].update(new google.maps.LatLng(lat, lng), t.html, t.cls);
  else targetBadges[rowId] = makeBadge(lat, lng, t.html, t.cls, 34, null);
  const b = targetBadges[rowId];
  b.border = t.border;
  const applyBorder = () => { if (b.div) b.div.style.borderColor = t.border; };
  applyBorder();
  setTimeout(applyBorder, 0); // div создаётся в onAdd — после setMap
}

function updateTargetMarker(rowId, lat, lng, label, lo, n, km) {
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
  setTargetBadge(rowId, lat, lng, label, lo, n, km);
  applyTargetVisibility(rowId);
}

// Перекрасить уже стоящий флажок без пересчёта маршрута (после клика по L/O)
function recolorTargetMarker(rowId, label, lo) {
  const m = targetMarkers[rowId];
  if (!m) return;
  m.setIcon(flagIcon(lo));
  const p = m.getPosition();
  setTargetBadge(rowId, p.lat(), p.lng(), m._label || label, lo, m._n, m._km);
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

function drawRoute(rowId) {
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

  if (!pos || pos.targetLat == null || pos.targetLng == null) {
    centerMapOn(rowId);
    return;
  }

  if (!pos.polyline) {
    // координаты таргета есть, а линии нет (например, Routes API не вернул её) — просто центрируем
    centerMapOn(rowId);
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
  map.fitBounds(bounds, 40);
}

// v3.31: открыт ⏱ калькулятор — клик по строке передаёт ему км до первой непройденной точки, линию маршрута
// и данные тахографа (всё из последнего расчёта строки, без новых запросов)
// v3.48: клик по значку страны — калькулятор открывается сам (force), расчёт — от точки k (если кликнули у точки Таргета)
function ecFromRow(id, force, k) {
  if (!window.etaCalc) return;
  if (!window.etaCalc.isOpen()) {
    if (!force) return;
    window.etaCalc.open();
    if (!window.etaCalc.isOpen()) return;       // телефон — калькулятора нет
  }
  const row = rows.find((r) => r.id === id);
  if (!row) return;
  const c = lastCalcText[id] || {};
  const at = k != null ? k : (c.ecAt || 0);
  const pt = at === 0 ? row.target : ((row.extra || [])[at - 1] || {}).target;
  const pos = rowPositions[id];
  let km = c.ecKm != null ? c.ecKm : null;
  if (k != null && k !== (c.ecAt || 0)) {        // у другой точки — км от машины до неё по цепочке
    const ce = k >= 1 ? (c.extra || [])[k - 1] : null;
    km = ce && !ce.done && ce.dist_km != null ? Number(ce.dist_km) : null;
  }
  window.etaCalc.fromRow({
    unit: row.unit || "", point: ((STOP_NUM[at + 1] || "") + " " + String(pt || "").trim()).trim(),
    km, seed: c.ecSeed || null, polyline: (pos && pos.polyline) || null,
  });
}

// ---------- v3.32: коридор ИТ ↔ Бенелюкс / восток FR — плашка и меню выбора (Флот и From → To) ----------
const COR_TUNNEL = { "Монблан": 261, "Фрежюс": 255 };
function corridorChip(row, c) {
  const k = c && c.corridor;
  if (!k || !k.used) return "";
  const man = !!row.corridor;
  const tip = `Коридор в обход Швейцарии: ${k.used}${man ? " (выбран вручную)" : " (авто)"}` +
    (COR_TUNNEL[k.used] ? ` · туннель ~${COR_TUNNEL[k.used]} €` : "") + ". Клик — выбрать другой";
  const eur = COR_TUNNEL[k.used] ? ` · туннель ~${COR_TUNNEL[k.used]} €` : "";   // v3.45: цена — в самой полоске
  return `<button type="button" class="cor-b${man ? " cor-man" : ""}" title="${escapeHtml(tip)}">⛰ ${escapeHtml(k.used)}${eur}</button>`;
}
let corPop = null;
function closeCorridorMenu() { if (corPop) { corPop.remove(); corPop = null; } }
// info: {used, manual, names, leg, countries?}; current — ручной выбор или null; onPick(name | null)
function corridorMenu(anchor, info, current, onPick) {
  closeCorridorMenu();
  const pop = document.createElement("div");
  pop.className = "cor-pop";
  document.body.appendChild(pop);
  corPop = pop;
  let opts = (info.names || []).map((n) => ({ name: n, km: null, diff: null, tunnel_eur: COR_TUNNEL[n] || null }));
  let state = "load";
  const draw = () => {
    const row = (name, label, extra) => `<button type="button" class="cor-o${(current || null) === name ? " on" : ""}" data-n="${escapeHtml(name || "")}">` +
      `<span class="cor-n">${(current || null) === name ? "✓ " : ""}${label}</span>${extra}</button>`;
    pop.innerHTML = `<div class="cor-h">Коридор в обход Швейцарии</div>` +
      row(null, "авто", `<span class="cor-k">${current ? "по правилу" : "сейчас " + escapeHtml(info.used || "—")}</span>`) +
      opts.map((o) => row(o.name, escapeHtml(o.name),
        `<span class="cor-k">${o.km != null ? fmtKm(o.km) + (o.diff ? ` <i>+${Math.round(o.diff)}</i>` : "") : state === "load" ? "…" : "—"}</span>` +
        (o.tunnel_eur ? `<span class="cor-t">туннель +${o.tunnel_eur} €</span>` : ""))).join("") +
      `<div class="cor-f">${state === "load" ? "Считаю км через каждый коридор…" : state === "err" ? "Км не посчитать — выбор всё равно работает" : "км по дорогам от машины / точки до цели"}</div>`;
  };
  draw();
  const r = anchor.getBoundingClientRect(), z = uiZoom();
  pop.style.left = Math.round((r.left + window.scrollX) / z) + "px";
  pop.style.top = Math.round((r.bottom + window.scrollY + 4) / z) + "px";
  pop.addEventListener("click", (e) => {
    const b = e.target.closest(".cor-o");
    if (!b) return;
    e.stopPropagation();
    closeCorridorMenu();
    onPick(b.dataset.n || null);
  });
  fetch("/api/corridors", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ leg: info.leg, countries: info.countries || null }) })
    .then((res) => res.json())
    .then((d) => {
      if (corPop !== pop) return;
      if (d.error || !d.options) { state = "err"; draw(); return; }
      opts = d.options; state = "ok"; draw();
    })
    .catch(() => { if (corPop === pop) { state = "err"; draw(); } });
}
document.addEventListener("mousedown", (e) => { if (corPop && !e.target.closest(".cor-pop, .cor-b, .rt-cor-b")) closeCorridorMenu(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeCorridorMenu(); });

let rowIdCounter = 1;

function loadRows() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    rows = raw ? JSON.parse(raw) : [];
  } catch (e) {
    rows = [];
  }
  // Счётчик id должен продолжаться после максимального загруженного id,
  // иначе новая строка может получить id, совпадающий с уже существующей,
  // и тогда правки/удаление начинают путать строки.
  const maxId = rows.reduce((max, r) => (r.id > max ? r.id : max), 0);
  rowIdCounter = maxId + 1;

  if (rows.length === 0) {
    rows.push(emptyRow());
  }
}

function saveRows() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  } catch (e) {
    // localStorage недоступен — молча продолжаем без сохранения
  }
  if (window.fleetSync) window.fleetSync.schedule();   // v2.00: общий Флот на сервере
}

function emptyRow() {
  const r = { id: window.newRowId ? window.newRowId() : rowIdCounter++, unit: "", lo: "", target: "", delivery: "", note: "" };
  if (typeof fleetMe === "function" && fleetMe()) r.disp = fleetMe();   // v2.01: ответственный — кто создал
  return r;   // v2.00: уникальный id на всех
}

async function loadUnitsList() {
  try {
    const res = await fetch("/api/units");
    const data = await res.json();
    if (data.units) {
      unitsCache = data.units;
      const datalist = document.getElementById("units-list");
      datalist.innerHTML = "";
      unitsCache.forEach((u) => {
        const opt = document.createElement("option");
        opt.value = u.number;
        if (u.kind === "trailer") opt.label = "прицеп";
        datalist.appendChild(opt);
      });
      [["trailers-list", "trailer"], ["trucks-list", "truck"]].forEach(([dlId, kind]) => {
        const dl = document.getElementById(dlId);
        if (!dl) return;
        dl.innerHTML = "";
        unitsCache.filter((u) => u.kind === kind).forEach((u) => {
          const o = document.createElement("option");
          o.value = u.number;
          dl.appendChild(o);
        });
      });
      rebuildPointsList();
    }
  } catch (e) {
    console.error("Не удалось загрузить список машин", e);
  }
}

// --- v1.28: адресная база (Google-таблица) и общий список подсказок points-list ---
window.addressList = [];
const ADDR_TYPE_RU = { load: "погрузка", unload: "выгрузка", port: "порт", customs: "таможня", misc: "прочее" };

async function loadAddressList(refresh) {
  try {
    const res = await fetch("/api/addresses" + (refresh ? "?refresh=1" : ""));
    const data = await res.json();
    window.addressList = data.addresses || [];
    window.addressStatus = data;
    rebuildPointsList();
    if (window.onAddressStatus) window.onAddressStatus(data);
    return data;
  } catch (e) {
    console.error("Не удалось загрузить адресную базу", e);
    return null;
  }
}

// Подсказки для Таргет / From → To / Локатора: машины + склады из базы
function rebuildPointsList() {
  const dl = document.getElementById("points-list");
  if (!dl) return;
  dl.innerHTML = "";
  (unitsCache || []).forEach((u) => {
    const o = document.createElement("option");
    o.value = u.number;
    o.label = u.kind === "trailer" ? "прицеп" : "машина";
    dl.appendChild(o);
  });
  (window.addressList || []).forEach((a) => {
    const extra = [a.supplier, ADDR_TYPE_RU[a.type] || a.type, a.city, a.country].filter(Boolean).join(" · ");
    [a.name, a.alias].filter(Boolean).forEach((v) => {
      const o = document.createElement("option");
      o.value = v;
      o.label = extra;
      dl.appendChild(o);
    });
  });
}

function addressTooltip(a) {
  if (!a) return "";
  return [a.name, a.open && `Open: ${a.open}`, a.notes && `Notes: ${a.notes}`].filter(Boolean).join("\n");
}

// Обновить всё, что зависит от L/O в строке таблицы
function applyLoToRow(tr, row) {
  const btn = tr.querySelector(".lo-btn");
  btn.className = `lo-btn ${loClass(row.lo)}`;
  btn.textContent = loText(row.lo);
  btn.title = loTitle(row.lo);
  tr.querySelector(".delivery-input").placeholder = deliveryPlaceholder(row.lo);
  stripeRow(tr, row);   // v3.10: по первой непройденной точке
  recolorTargetMarker(row.id, row.unit, markerKind(row));
  const chip = row.extra && row.extra.length ? tr.querySelector(".target-wrap:not(.x-stop) .stop-n") : null;
  if (chip) chip.innerHTML = numChip(1, row.lo);
}

// ---------- v1.53: сортировка Флота ----------
// LO / OL — погрузки/выгрузки первыми, внутри по срочности;
// manual — руками (перетаскивание ⠿, на телефоне ↑/↓ в меню ⋯; новые строки — в конец). Строки без L/O — в конце.
// v3.29: режима «как добавляли» больше нет — сохранённый (и умолчание) стал «руками» с порядком добавления.
// Пересортировка только при загрузке, "Обновить всё" и смене режима — не при автообновлении.
const SORT_MODES = ["LO", "OL", "manual"];
let sortMode = "manual";
let manualOrder = [];
try {
  const saved = localStorage.getItem("fleetSort");
  if (SORT_MODES.includes(saved)) {
    sortMode = saved;
    manualOrder = JSON.parse(localStorage.getItem("fleetManualOrder") || "[]");
  } else {
    // было «как добавляли» или ничего: старый ручной порядок не берём — таблица не сдвинется
    localStorage.setItem("fleetSort", "manual");
    localStorage.setItem("fleetManualOrder", "[]");
  }
} catch (e) { /* без localStorage — порядок по умолчанию */ }
let displayOrder = null;   // зафиксированный порядок id между пересортировками

function saveSortState() {
  try {
    localStorage.setItem("fleetSort", sortMode);
    localStorage.setItem("fleetManualOrder", JSON.stringify(manualOrder));
  } catch (e) { /* ignore */ }
}

// v3.10: ключ сортировки — TimeSlot первой непройденной точки (начало окна, иначе срок);
// без TimeSlot — null (такие строки в конце своей группы, в порядке добавления).
// Опаздывающие наверх не поднимаем.
function slotKey(row) {
  const k = firstOpenIdx(row);
  const p = k >= 0 ? pointOf(row, k) : null;
  const w = p ? parseDeliveryWindow(p.delivery) : null;
  const t = w ? (w.start || w.end) : null;
  return t ? t.getTime() : null;
}

function computeOrder() {
  if (sortMode === "manual") {
    const pos = new Map(manualOrder.map((id, i) => [id, i]));
    const known = rows.filter((r) => pos.has(r.id)).sort((a, b) => pos.get(a.id) - pos.get(b.id));
    const rest = rows.filter((r) => !pos.has(r.id));
    manualOrder = known.concat(rest).map((r) => r.id);
    saveSortState();
    return manualOrder.slice();
  }
  if (sortMode === "LO" || sortMode === "OL") {
    const rank = sortMode === "LO" ? { L: 0, O: 1 } : { O: 0, L: 1 };
    const idx = new Map(rows.map((r, i) => [r.id, i]));
    return rows.slice().sort((a, b) => {
      const la = rowLoKind(a), lb = rowLoKind(b);
      const ra = la in rank ? rank[la] : 2, rb = lb in rank ? rank[lb] : 2;
      if (ra !== rb) return ra - rb;
      if (ra === 2) return idx.get(a.id) - idx.get(b.id);
      const ka = slotKey(a), kb = slotKey(b);
      if (ka != null && kb != null && ka !== kb) return ka - kb;
      if ((ka == null) !== (kb == null)) return ka == null ? 1 : -1;
      return idx.get(a.id) - idx.get(b.id);
    }).map((r) => r.id);
  }
  return rows.map((r) => r.id);
}

function resort() {
  displayOrder = computeOrder();
  renderRows();
}

function orderedRows() {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out = [];
  const seen = new Set();
  (displayOrder || rows.map((r) => r.id)).forEach((id) => {
    if (byId.has(id)) { out.push(byId.get(id)); seen.add(id); }
  });
  rows.forEach((r) => { if (!seen.has(r.id)) out.push(r); });   // новые строки — в конец
  return out;
}

// ---------- v1.78: фильтр L/O во Флоте ----------
// v3.10: строка — по L/O первой НЕПРОЙДЕННОЙ точки; если у неё нет отметки — по следующей;
// иначе только в "Все". Пустые строки (без машины) видны всегда. v3.26: и на карте — спрятанные строки без машинок и целей.
// Тот же признак — полоска строки и сортировка L → O / O → L.
let loFilter = "all";
try { loFilter = localStorage.getItem("fleet-lo-filter") || "all"; } catch (e) {}
if (!["all", "L", "O"].includes(loFilter)) loFilter = "all";
// точка k: 0 — основная (row.lo / row.delivery), k ≥ 1 — row.extra[k - 1]
function pointOf(row, k) {
  return k === 0 ? { lo: row.lo, delivery: row.delivery } : (row.extra && row.extra[k - 1]) || null;
}
// индекс первой непройденной точки (ручные отметки row.done важнее авто), -1 — все пройдены
function firstOpenIdx(row) {
  const n = 1 + (row.extra ? row.extra.length : 0);
  const c = lastCalcText[row.id];
  const fl = c && c.doneFlags;
  const man = row.done || {};
  for (let k = 0; k < n; k++) {
    const d = man[k] === true ? true : man[k] === false ? false : !!(fl && fl[k] && fl[k].done);
    if (!d) return k;
  }
  return -1;
}
function rowLoKind(row) {
  const k = firstOpenIdx(row);
  if (k < 0) return "";
  const isLo = (p) => p && (p.lo === "L" || p.lo === "O");
  const p = pointOf(row, k);
  if (isLo(p)) return p.lo;
  const q = pointOf(row, k + 1);
  return isLo(q) ? q.lo : "";
}
function stripeRow(tr, row) {
  tr.classList.remove("lo-row-L", "lo-row-O");
  const kind = rowLoKind(row);
  if (kind) tr.classList.add(`lo-row-${kind}`);
}
function rowPassesFilter(row) {
  if (!row.unit) return true;
  if (!rowPassesOwn(row)) return false;   // v2.01 / v3.11
  if (loFilter === "all") return true;
  return rowLoKind(row) === loFilter;
}

// ---------- v2.01: диспетчер строки + фильтр "Мои / Все" ----------
// disp — e-mail ответственного; у новой строки — кто создал; у старых без disp — создатель (мета сервера).
let ownFilter = "all";
try { ownFilter = localStorage.getItem("fleet-own-filter") || "all"; } catch (e) {}
if (!["all", "mine"].includes(ownFilter) && !String(ownFilter).includes("@")) ownFilter = "all";
// v3.11: фильтр диспетчера — "all" | "mine" | e-mail. Строки без диспетчера — только в "все".
// v3.25: кнопки «Все · VL · VJ …» вместо «все · мои · ▾ дисп»; старое "mine" — своя кнопка (resolveMine).
// Тот же фильтр — для карты: v3.26 — чужие машинки спрятаны (раньше бледные).
function rowPassesOwn(row) {
  if (ownFilter === "all") return true;
  const d = rowDisp(row);
  if (ownFilter === "mine") return !fleetMe() || !meInSheet() || d === fleetMe();   // v3.15: нет в листе — «мои» = все
  return d === ownFilter;
}
function fleetMe() {
  const u = window.fleetSync && window.fleetSync.mode === "server" ? window.fleetSync.user : "";
  return u && u !== "local" ? String(u).toLowerCase() : "";
}
function rowDisp(row) {
  if (row.disp) return String(row.disp).toLowerCase();
  const m = window.fleetSync && window.fleetSync.meta[String(row.id)];
  return m && m.created_by && m.created_by !== "local" ? String(m.created_by).toLowerCase() : "";
}
const dispShort = (u) => String(u || "").split("@")[0].split(".")[0].slice(0, 12);
function knownDispatchers() {
  const set = new Set(DISP_LIST.map((d) => d.email));   // v3.11: все из листа, даже кто ещё не заходил
  if (fleetMe()) set.add(fleetMe());
  rows.forEach((r) => { const d = rowDisp(r); if (d) set.add(d); });
  const meta = (window.fleetSync && window.fleetSync.meta) || {};
  Object.values(meta).forEach((m) => {
    [m.created_by, m.updated_by].forEach((u) => { if (u && u !== "local") set.add(String(u).toLowerCase()); });
  });
  const order = new Map(DISP_LIST.map((d, i) => [d.email, i]));
  return Array.from(set).sort((a, b) => (order.has(a) ? order.get(a) : 99) - (order.has(b) ? order.get(b) : 99) || (a < b ? -1 : 1));
}
// v3.09: инициалы и цвет диспетчера (первая клетка строки); ключ — имя из e-mail до точки/@
// v3.11: диспетчеры — из листа «Диспетчеры» (/api/dispatchers); до загрузки — список по умолчанию
let DISP_LIST = [
  { email: "vladimirs.head@gmail.com", tag: "VL", color: "#ebebeb" }, { email: "vadims@gmail.com", tag: "VJ", color: "#fde6cc" },
  { email: "janis@gmail.com", tag: "JZ", color: "#eceefc" }, { email: "jekaterina@gmail.com", tag: "JB", color: "#dcf1e0" },
  { email: "antons@gmail.com", tag: "AA", color: "#ffffff" }, { email: "ladins@gmail.com", tag: "VV", color: "#e8dcf7" },
];
function dispEntry(u) {
  const e = String(u || "").toLowerCase();
  if (!e) return null;
  const k = dispShort(e).toLowerCase();
  return DISP_LIST.find((d) => d.email === e) || DISP_LIST.find((d) => dispShort(d.email).toLowerCase() === k) || null;
}
function dispTag(u) { const d = dispEntry(u); return d ? d.tag : ""; }
// v3.15: вошедший есть в листе «Диспетчеры» (точное совпадение e-mail; до загрузки листа — считаем, что есть)
let DISP_LOADED = false;
function meInSheet() {
  const me = fleetMe();
  return !me || !DISP_LOADED || DISP_LIST.some((d) => String(d.email).toLowerCase() === me);
}
// v3.15: фон аппы — бледно в цвет вошедшего диспетчера; нет в листе — «мои» скрыт, подсказка под заголовком
function mixHex(hex, base, k) {
  const p = (h) => (String(h).match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i) || []).slice(1).map((x) => parseInt(x, 16));
  const a = p(hex), b = p(base);
  if (a.length !== 3 || b.length !== 3) return "";
  return "#" + a.map((x, i) => Math.round(x * k + b[i] * (1 - k)).toString(16).padStart(2, "0")).join("");
}
function applyMyDispLook() {
  const me = fleetMe();
  const mine = me ? DISP_LIST.find((d) => String(d.email).toLowerCase() === me) : null;
  // v3.18: фон приложения в цвет диспетчера убран — цвет только на плашке диспетчера в строке
  const missing = !meInSheet();
  document.body.classList.toggle("no-disp", missing);
  const hint = document.getElementById("disp-hint");
  if (hint) {
    hint.hidden = !missing;
    hint.textContent = missing ? `Тебя нет в листе «Диспетчеры» (${me}) — нет инициалов и цвета, своей кнопки в фильтре нет. Попроси админа добавить.` : "";
  }
}
function canAssign() { return !fleetMe() || !!(window.fleetSync && window.fleetSync.canAssign); }
// цвет рамки — тот же оттенок темнее; белый -> серый
function shadeHex(hex, k) {
  const m = String(hex || "").match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return "";
  return "#" + m.slice(1).map((x) => Math.round(parseInt(x, 16) * (1 - k)).toString(16).padStart(2, "0")).join("");
}
function applyDispColors() {
  let st = document.getElementById("disp-colors");
  if (!st) { st = document.createElement("style"); st.id = "disp-colors"; document.head.appendChild(st); }
  st.textContent = DISP_LIST.filter((d) => d.color).map((d) =>
    // v3.18: цвет из листа «Диспетчеры» — только плашка диспетчера (👤 VL), клетка строки без заливки
    `#fleet-tbody td.unit-cell[data-dc="${d.tag}"] .disp-lbl, #fleet-tbody td.unit-cell[data-dc="${d.tag}"] .disp-sel { background: ${d.color}; border-color: ${shadeHex(d.color, 0.18) || "#ccc"}; }`).join("\n");
}
// v3.25: кнопки диспетчеров в фильтре — из листа «Диспетчеры» (порядок листа), каждая в цвет диспетчера
function fillDispSelects() {
  document.querySelectorAll(".own-btns").forEach((box) => {
    box.innerHTML = DISP_LIST.map((d) => {
      const c = d.color || "#ffffff";
      const me = String(d.email).toLowerCase() === fleetMe();
      return `<button type="button" class="own-d" data-own="${escapeHtml(String(d.email).toLowerCase())}"`
        + ` style="--dc:${escapeHtml(c)};--dcb:${escapeHtml(shadeHex(c, 0.25) || "#bbb")}"`
        + ` title="Строки ${escapeHtml(d.tag)}${me ? " (мои)" : ""} — и его машины на карте">${escapeHtml(d.tag)}</button>`;
    }).join("");
  });
  if (window.fleetMarkBar) window.fleetMarkBar();
}
// v3.25: старое значение фильтра «мои» → своя кнопка (нет в листе — «Все»), как только известно, кто вошёл
function resolveMine() {
  if (ownFilter !== "mine" || !fleetMe() || !DISP_LOADED) return;
  ownFilter = meInSheet() ? fleetMe() : "all";
  try { localStorage.setItem("fleet-own-filter", ownFilter); } catch (e) {}
}
function loadDispatchers() {
  fetch("/api/dispatchers").then((r) => r.json()).then((d) => {
    if (!d || !d.ok) return;
    if (d.dispatchers && d.dispatchers.length) DISP_LIST = d.dispatchers;
    DISP_LOADED = true;
    if (window.fleetSync) window.fleetSync.canAssign = !!d.can_assign;
    applyDispColors();
    applyMyDispLook();
    fillDispSelects();
    renderRows();
    refreshBadgeLooks();
  }).catch(() => {});
}
function dispLabel(u) { return dispTag(u) || dispShort(u); }
function dispHtml(row) {
  if (!fleetMe()) return "";
  const d = rowDisp(row);
  const opts = knownDispatchers();
  if (d && !opts.includes(d)) opts.push(d);
  // v3.11: назначать диспетчера строки — только назначающий; остальным — просто метка
  if (!canAssign()) return d ? `<span class="disp-lbl${d !== fleetMe() ? " other" : ""}" title="Диспетчер строки (назначает админ)">🎧 ${escapeHtml(dispLabel(d))}</span>` : "";
  return `<select class="disp-sel${d && d !== fleetMe() ? " other" : ""}${d ? "" : " none"}" title="Диспетчер (ответственный за строку)">`
    + `<option value=""${d ? "" : " selected"}>🎧 —</option>`
    + opts.map((u) => `<option value="${escapeHtml(u)}"${u === d ? " selected" : ""}>🎧 ${escapeHtml(dispLabel(u))}</option>`).join("")
    + "</select>";
}

// v3.15: соло / экипаж. Авто — по второму слоту тахографа (+ история трака за неделю),
// клик по кругу: авто → 👤 соло вручную → 👥 экипаж вручную → авто.
// У одиночки справа — остаток вождения на неделю целыми часами (вниз).
function crewOf(data) {
  return data.crew ? { crew: data.crew, src: data.crew_src, wl: data.week_left_sec, lim: data.week_limit,
                       driven: data.week_driven_sec, next: data.week_next_sec, hmax: data.crew_hist_max_h,
                       short: data.week_short_last || null, names: data.crew_names || null,
                       nocard: !!data.crew_nocard, nosub: !!data.crew_nosub } : null;
}
function crewHtml(row, cached) {
  const c = cached && cached.crew;
  const crew = row.crew || (c && c.crew);
  if (!crew) return '<button class="crew-b" hidden></button>';
  const man = !!row.crew;
  const hm = (sec) => `${Math.floor(sec / 3600)}:${String(Math.floor((sec % 3600) / 60)).padStart(2, "0")}`;
  const tip = [];
  let txt = crew === "team" ? "👥" : "👤", cls = "";
  // v3.29: Mapon не видит карт водителя — значок бледный, соло / экипаж по истории недели
  const nocard = !!(c && c.nocard);
  if (nocard) {
    cls += " crew-nocard";
    tip.push(c.nosub ? "⚠ Нет подписки Mapon на тахограф (Tachograph remote download) — данных тахографа не будет"
      : "⚠ Mapon не видит карт водителя — тахографа нет");
  }
  if (crew === "team") {
    tip.push(man ? "Экипаж — поставлено вручную" :
      c && c.src === "hist" ? `Экипаж — по истории: трак ехал ${c.hmax} ч за сутки` + (nocard ? "" : " (карта второго сейчас не вставлена)") :
      "Экипаж — две карты в тахографе");
  } else {
    tip.push(man ? "Одиночка — поставлено вручную" : (nocard ? "Одиночка — по истории недели" : "Одиночка — одна карта в тахографе") +
      (c && c.hmax ? `, за неделю максимум ${c.hmax} ч езды в сутки` : ""));
    if (c && c.crew === "solo" && c.wl != null) {
      txt += " " + Math.floor(c.wl / 3600);
      cls = c.wl < 4.5 * 3600 ? " crew-red" : c.wl < 9 * 3600 ? " crew-warn" : "";
      tip.push(`Осталось вождения на неделю: ${hm(c.wl)} (режет лимит ${c.lim || "56 ч"})`);
      if (c.short) {   // v3.16: до последней точки не хватает — только предупреждение
        txt += " ⚠";
        cls = " crew-red";
        tip.push(`⚠ До последней точки не хватит: нужно ${hm(c.short.need)}, осталось ${hm(c.short.left)}, не хватает ${hm(c.short.short)}`,
          "Стоп по недельному лимиту в ETA учтён только до первой точки");
      }
      if (c.driven != null) tip.push(`Наезжено на этой неделе: ${hm(c.driven)}`);
      if (c.next != null) tip.push(`С понедельника доступно: ${hm(c.next)}`);
      tip.push("Неделя тахографа — с пн 00:00 UTC");
    } else if (c && c.crew === "team") {
      tip.push("Остаток недели не показан: по тахографу это экипаж");
    }
  }
  // v3.18: имена водителей — первой строкой подсказки
  const nm = c && c.names && c.names.length ? c.names : null;
  tip.unshift((crew === "team" ? "Экипаж: " : "Соло: ") + (nm ? (crew === "team" ? nm.join(", ") : nm[0]) : "имя не указано в Mapon"));
  tip.push(man ? "Клик — " + (row.crew === "solo" ? "экипаж вручную" : "снова авто") : "Клик — поставить вручную: одиночка");
  return `<button class="crew-b${man ? " crew-man" : ""}${cls}" title="${escapeHtml(tip.join("\n"))}">${txt}</button>`;
}

function renderRows() {
  const tbody = document.getElementById("fleet-tbody");
  tbody.innerHTML = "";
  document.body.classList.toggle("sort-manual", sortMode === "manual");
  orderedRows().forEach((row) => {
    const tr = document.createElement("tr");
    tr.dataset.id = row.id;
    if (!rowPassesFilter(row)) tr.classList.add("lo-filtered");
    stripeRow(tr, row);
    const multi = !!(row.extra && row.extra.length);
    if (multi) tr.classList.add("multi");
    const cached = lastCalcText[row.id];
    const statusHtml = cached ? cached.status : "—";
    const statusClass = cached ? cached.statusClass : "muted";
    const distHtml = cached ? distCellHtml(row, cached) : "—";
    const distMuted = cached ? "" : "muted";
    const composedEta = cached && cached.etaCore ? composeEta(row, cached) : null;
    // v1.80: строка без основного ETA (① пройдена) — всё равно рисуем ETA следующих точек
    const etaHtml = composedEta ? etaCellHtml(row, cached, composedEta)
      : (cached && cached.extra && cached.extra.length ? etaCellHtml(row, cached, null) : (cached ? cached.eta : "—"));
    const etaMuted = cached ? "" : "muted";
    tr.innerHTML = `
      <td class="unit-cell"${dispTag(rowDisp(row)) ? ` data-dc="${dispTag(rowDisp(row))}"` : ""}><span class="drag-h" draggable="true" title="Перетащить строку">⠿</span><input list="units-list" class="unit-input" name="unit-${row.id}" autocomplete="off" value="${escapeHtml(row.unit)}" title="${escapeHtml(window.fleetMetaTitle ? window.fleetMetaTitle(row.id) : "")}" placeholder="номер" />${dispHtml(row)}</td>
      <td class="status-cell ${statusClass}">${statusHtml}</td>
      <td>
        <div class="target-wrap${hideK(row, 0) ? " fold-hide" : ""}">
          <span class="lead">${!folded(row) || foldVisible(row)[0] === 0 ? foldBtnHtml(row, cached) : ""}</span><span class="stop-n">${multi ? numChip(1, row.lo) : ""}</span>
          <button class="lo-btn ${loClass(row.lo)}" title="${loTitle(row.lo)}">${loText(row.lo)}</button>
          ${cached && cached.targetBadge ? cached.targetBadge : '<span class="cc-badge target-cc" hidden></span>'}
          <input list="points-list" class="target-input" name="target-${row.id}" autocomplete="off" value="${escapeHtml(row.target)}" title="${escapeHtml(row.target)}" placeholder="ГПС, город, код или машина" />
          ${multi ? '<button class="stop-x" data-k="0" title="Убрать эту точку">×</button>' + addStopHtml(row, 0) : '<span class="stop-x-sp"></span><button class="add-stop" data-k="0" title="Добавить ещё таргет (следующая выгрузка / погрузка)">+</button>'}
        </div>
        ${extraTargetsHtml(row, cached)}
      </td>
      <td class="delivery-td"><input class="delivery-input${hideK(row, 0) ? " fold-hide" : ""}" name="delivery-${row.id}" autocomplete="off" value="${escapeHtml(row.delivery)}" title="${escapeHtml(row.delivery)}" placeholder="${deliveryPlaceholder(row.lo)}" />${(row.extra || []).map((x, i) =>
        `<input class="xd-input${hideK(row, i + 1) ? " fold-hide" : ""}" data-k="${i + 1}" name="delivery-${row.id}-${i + 1}" autocomplete="off" value="${escapeHtml(x.delivery)}" title="${escapeHtml(x.delivery)}" placeholder="${deliveryPlaceholder(x.lo)}" />`).join("")}</td>
      <td class="dist-cell ${distMuted}">${distHtml}</td>
      <td class="eta-cell ${etaMuted}${cached && cached.late ? " eta-late" : ""}" title="${escapeHtml(composedEta ? composedEta.title : (cached && cached.etaTip ? cached.etaTip : ""))}">${etaHtml}</td>
      <td class="note-cell"><div class="note-wrap"><input class="note-input" name="note-${row.id}" autocomplete="off" value="${escapeHtml(row.note)}" title="${escapeHtml(row.note)}" placeholder="примечание" />${comBtnHtml(row.com, 0)}</div>${(row.extra || []).map((x, i) =>
        `<div class="note-wrap xn-wrap${hideNoteK(row, i + 1) ? " fold-hide" : ""}"><input class="xn-input" data-k="${i + 1}" name="note-${row.id}-${i + 1}" autocomplete="off" value="${escapeHtml(x.note || "")}" title="${escapeHtml(x.note || "")}" placeholder="примечание к ${i + 2}" />${comBtnHtml(x.com, i + 1)}</div>`).join("")}</td>
      <td class="cl-cell"><input class="cl-input" name="client-${row.id}" autocomplete="off" value="${escapeHtml(row.client || "")}" title="${escapeHtml(row.client || "")}" placeholder="client" /></td>
      <td class="ref-cell"><input class="ref-input" name="ref-${row.id}" autocomplete="off" value="${escapeHtml(row.ref || "")}" title="${escapeHtml(row.ref || "")}" placeholder="ref" /></td>
      <td class="row-actions">
        <button class="refresh-row-btn" title="Обновить строку">↻</button>
        <span class="wide-acts">
          <button class="refresh-row-btn-w" title="Обновить строку">↻</button>
          <button class="add-btn-w" title="Добавить строку ниже">+</button>
          <button class="trl-btn-w" title="Сцепка: у тягача — привязать прицеп, у прицепа — привязать к тягачу">🔗</button>
          <span class="acts-br"></span>
          <button class="del-btn-w" title="Удалить строку (два клика)">🗑</button>
          <button class="mv-up-w manual-inline" title="Выше">↑</button>
          <button class="mv-down-w manual-inline" title="Ниже">↓</button>
          <span class="drag-h drag-h-w" draggable="true" title="Перетащить строку">⠿</span>
        </span>
        <span class="row-menu-wrap">
          <button class="more-btn" title="Ещё">⋯</button>
          <span class="row-menu" hidden>
            <button class="mv-up manual-only">↑ выше</button>
            <button class="mv-down manual-only">↓ ниже</button>
            <button class="add-btn">+ строка ниже</button>
            <button class="trl-btn">🔗 сцепка…</button>
            <button class="x10-btn" title="Соло: сегодня 10 ч вождения вместо 9 (продление) — ETA с учётом">${row.x10 ? "✓ " : ""}+1 ч сегодня (10-й час)</button>
            <button class="cmpl-menu-btn"${window.fleetCanComplete && window.fleetCanComplete(row) ? "" : " hidden"}>✓ завершить трип</button>
            <button class="del-btn">✕ удалить строку</button>
          </span>
        </span>
        <button class="cmpl-btn" hidden title="Все точки пройдены — завершить трип (уйдёт в «Завершённые», оттуда можно вернуть)">✓ Завершить?</button>
      </td>
    `;
    if (blinkRows.has(row.id)) tr.classList.add("row-blink");
    applyFuelBlink(tr, row.id);
    applyReeferBlink(tr, row.id);   // v3.34
    // v2.02: 🔒 строку сейчас правит другой — только смотреть; 🗑 — только создатель / диспетчер
    const lockBy = window.fleetLockedBy ? window.fleetLockedBy(row.id) : "";
    if (lockBy) {
      tr.classList.add("row-locked");
      tr.querySelectorAll("input, select, button").forEach((el) => { if (!el.classList.contains("refresh-row-btn") && !el.classList.contains("refresh-row-btn-w")) el.disabled = true; });
      const ch = document.createElement("span");
      ch.className = "lock-chip";
      ch.textContent = "🔒 " + dispShort(lockBy);
      ch.title = `Строку сейчас правит ${lockBy}. Блокировка снимается, когда он выйдет из строки (или через минуту).`;
      tr.querySelector("td").appendChild(ch);
    }
    if (window.fleetCanDelete && !window.fleetCanDelete(row)) tr.classList.add("no-del");
    tbody.appendChild(tr);
    markForeign(tr, row);   // v3.20: чужие правки — красным до клика хозяина трипа
    markDeliveryInput(tr, row);
    applyDoneClasses(tr, row, lastCalcText[row.id]);
  });
  attachRowHandlers();
}

// Есть ли машина с таким номером в таблице (для перецепа: тогда флажок не нужен)
function truckInTable(number) {
  const norm = (s) => String(s || "").toUpperCase().replace(/[\s\-]/g, "");
  const n = norm(number);
  return !!n && rows.some((r) => norm(r.unit) === n);
}

// --- L/O: погрузка / выгрузка ---
const LO_CYCLE = { "": "L", "L": "O", "O": "" }; // пусто → L → O → пусто

function loText(lo)  { return lo === "L" ? "L" : lo === "O" ? "O" : "L/O"; }
function loClass(lo) { return lo === "L" ? "lo-L" : lo === "O" ? "lo-O" : ""; }
function loTitle(lo) {
  if (lo === "L") return "Погрузка (клик — сменить на выгрузку)";
  if (lo === "O") return "Выгрузка (клик — снять отметку)";
  return "Отметить таргет как погрузку (L) или выгрузку (O)";
}
function deliveryPlaceholder(lo) {
  if (lo === "L") return "окно погрузки";
  if (lo === "O") return "окно выгрузки";
  return "дата, время / окно";
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function attachRowHandlers() {
  document.querySelectorAll("#fleet-tbody tr").forEach((tr) => {
    const id = Number(tr.dataset.id);

    tr.querySelector(".unit-input").addEventListener("change", (e) => {
      updateRowField(id, "unit", e.target.value);
    });
    const dsel = tr.querySelector(".disp-sel");
    if (dsel) dsel.addEventListener("change", (e) => {   // v2.01
      setRowField(id, "disp", e.target.value);
      renderRows();
      refreshBadgeLooks();
    });
    tr.querySelector(".target-input").addEventListener("change", (e) => {
      updateRowField(id, "target", e.target.value);
    });
    // v1.50: Delivery и Примечание не пересчитывают маршрут (экономия запросов к Google)
    tr.querySelector(".delivery-input").addEventListener("change", (e) => {
      e.target.title = e.target.value;
      setRowField(id, "delivery", e.target.value);
      recheckLate(id);
      markDeliveryInput(tr, rows.find((r) => r.id === id));
    });
    tr.querySelector(".note-input").addEventListener("change", (e) => {
      e.target.title = e.target.value;
      setRowField(id, "note", e.target.value);
    });
    // v3.35: Client / Reference — простые текстовые поля трипа (задел под v5)
    [["cl-input", "client"], ["ref-input", "ref"]].forEach(([cls, f]) => {
      tr.querySelector("." + cls).addEventListener("change", (e) => {
        e.target.title = e.target.value;
        setRowField(id, f, e.target.value.trim());
      });
    });

    tr.querySelector(".lo-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      const row = rows.find((r) => r.id === id);
      if (!row) return;
      row.lo = LO_CYCLE[row.lo || ""];
      saveRows();
      applyLoToRow(tr, row);
    });

    tr.querySelector(".refresh-row-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      calcRow(id);
    });

    tr.querySelector(".more-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      const menu = tr.querySelector(".row-menu");
      const open = menu.hidden;
      closeRowMenus();
      if (!open) return;
      // v1.44: меню поверх страницы (position: fixed), у нижнего края — вверх
      menu.hidden = false;
      rowMenuOpenedAt = Date.now();
      const r = e.currentTarget.getBoundingClientRect();
      const h = menu.offsetHeight, w = menu.offsetWidth;
      const up = r.bottom + 4 + h > window.innerHeight;
      const z = uiZoom();   // v1.80: страница в масштабе 90% — координаты окна делим на масштаб
      menu.style.top = (up ? r.top - 4 - h * z : r.bottom + 4) / z + "px";
      menu.style.left = Math.max(8, r.right - w * z) / z + "px";
    });

    // v3.22: «✓ Завершён» — кнопка у строки, где все точки пройдены, и пункт меню ⋯ (хозяин и назначающие)
    tr.querySelector(".cmpl-btn").addEventListener("click", (e) => { e.stopPropagation(); completeTrip(id); });
    tr.querySelector(".cmpl-menu-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      closeRowMenus();
      const c = lastCalcText[id];
      if (!(c && c.allDone) && !confirm("Не все точки трипа пройдены. Всё равно завершить?")) return;
      completeTrip(id);
    });
    tr.querySelector(".add-btn-w").addEventListener("click", (e) => { e.stopPropagation(); tr.querySelector(".add-btn").click(); });
    tr.querySelector(".refresh-row-btn-w").addEventListener("click", (e) => { e.stopPropagation(); tr.querySelector(".refresh-row-btn").click(); });   // v3.35
    tr.querySelector(".mv-up-w").addEventListener("click", (e) => { e.stopPropagation(); moveManual(id, -1); });
    tr.querySelector(".mv-down-w").addEventListener("click", (e) => { e.stopPropagation(); moveManual(id, 1); });
    // v1.66: удаление в два клика — первый "взводит", уход мыши сбрасывает
    // v3.37: при «взводе» размер кнопки не меняется (было «удалить?» — кнопка шире, в узкой колонке уезжала
    // на новый ряд из-под мыши, взвод тут же сбрасывался) — та же 🗑 на красном, подсказка в title
    const delW = tr.querySelector(".del-btn-w");
    const delTitle = delW.title;
    delW.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!delW.classList.contains("armed")) {
        delW.classList.add("armed");
        delW.title = "Ещё клик — удалить";
        return;
      }
      tr.querySelector(".del-btn").click();
    });
    delW.addEventListener("mouseleave", () => { delW.classList.remove("armed"); delW.title = delTitle; });

    tr.querySelector(".add-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = rows.findIndex((r) => r.id === id);
      const nr = emptyRow();
      rows.splice(idx + 1, 0, nr);
      if (displayOrder) {
        const di = displayOrder.indexOf(id);
        displayOrder.splice(di + 1, 0, nr.id);
      }
      if (sortMode === "manual") {
        const mi = manualOrder.indexOf(id);
        manualOrder.splice(mi + 1, 0, nr.id);
        saveSortState();
      }
      saveRows();
      renderRows();
    });

    tr.querySelectorAll(".com-ic").forEach((b) => b.addEventListener("click", (e) => {   // v3.11: и у точек
      e.stopPropagation();
      closeRowMenus();
      openComEditor(id, e.currentTarget, Number(b.dataset.k || 0));
    }));

    // v1.64: несколько таргетов в строке
    tr.querySelectorAll(".add-stop").forEach((b) => b.addEventListener("click", (e) => {
      e.stopPropagation();
      const row = rows.find((r) => r.id === id);
      if (!row) return;
      if ((row.extra || []).length + 1 >= MAX_STOPS) return;   // v1.74: максимум 12 точек
      // v3.13: вставка после точки k (0 — ①); точки ниже сдвигаются со своими полями
      const ex = row.extra || [];
      const k = Math.min(Number(b.dataset.k || ex.length), ex.length);
      ex.splice(k, 0, { lo: "", target: "", delivery: "", note: "" });
      row.extra = ex;
      if (row.done) {   // ручные ✓ — по новым номерам
        const nd = {};
        Object.keys(row.done).forEach((j) => { nd[Number(j) > k ? Number(j) + 1 : Number(j)] = row.done[j]; });
        row.done = nd;
      }
      row.open = true;
      delete lastCalcText[id];
      saveRows();
      renderRows();
      const inp = document.querySelector(`#fleet-tbody tr[data-id="${id}"] .xt-input[data-k="${k + 1}"]`);
      if (inp) inp.focus();
      if (k + 1 < row.extra.length) calcRow(id);   // вставили в середину — нумерация на сервере сдвинулась
    }));
    tr.querySelectorAll(".fold-t, .fold-more").forEach((b) => b.addEventListener("click", (e) => {
      e.stopPropagation();
      const row = rows.find((r) => r.id === id);
      if (!row) return;
      row.open = !row.open;
      saveRows();
      renderRows();
    }));
    tr.querySelectorAll(".stop-x").forEach((b) => b.addEventListener("click", (e) => {
      e.stopPropagation();
      removeStop(id, Number(b.dataset.k));
    }));
    tr.querySelectorAll(".xt-input").forEach((inp) => inp.addEventListener("change", (e) => {
      const row = rows.find((r) => r.id === id);
      const x = row && row.extra && row.extra[Number(inp.dataset.k) - 1];
      if (!x) return;
      x.target = e.target.value;
      e.target.title = e.target.value;
      if (row.done) delete row.done[Number(inp.dataset.k)];   // v1.79: новая точка — ✓ заново
      saveRows();
      calcRow(id);
    }));
    tr.querySelectorAll(".xn-input").forEach((inp) => inp.addEventListener("change", (e) => {
      const row = rows.find((r) => r.id === id);
      const x = row && row.extra && row.extra[Number(inp.dataset.k) - 1];
      if (!x) return;
      x.note = e.target.value;
      e.target.title = e.target.value;
      saveRows();
    }));
    tr.querySelectorAll(".xd-input").forEach((inp) => inp.addEventListener("change", (e) => {
      const row = rows.find((r) => r.id === id);
      const x = row && row.extra && row.extra[Number(inp.dataset.k) - 1];
      if (!x) return;
      x.delivery = e.target.value;
      e.target.title = e.target.value;
      saveRows();
      recheckLate(id);   // v3.10: красный ETA у этой точки — без пересчёта маршрута
    }));
    tr.querySelectorAll(".xlo-btn").forEach((b) => b.addEventListener("click", (e) => {
      e.stopPropagation();
      const row = rows.find((r) => r.id === id);
      const k = Number(b.dataset.k);
      const x = row && row.extra && row.extra[k - 1];
      if (!x) return;
      x.lo = LO_CYCLE[x.lo || ""];
      saveRows();
      b.className = `lo-btn xlo-btn ${loClass(x.lo)}`;
      b.textContent = loText(x.lo);
      b.title = loTitle(x.lo);
      const d = tr.querySelector(`.xd-input[data-k="${k}"]`);
      if (d) d.placeholder = deliveryPlaceholder(x.lo);
      recolorTargetMarker(id + "_" + k, row.unit, x.lo);
      const chip = tr.querySelector(`.x-stop[data-k="${k}"] .stop-n`);
      if (chip) chip.innerHTML = numChip(k + 1, x.lo);
      stripeRow(tr, row);
    }));
    tr.querySelector(".trl-btn-w").addEventListener("click", (e) => {
      e.stopPropagation();
      openTrailerEditor(id, e.currentTarget);
    });
    tr.querySelector(".trl-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      closeRowMenus();
      openTrailerEditor(id, tr.querySelector(".more-btn"));
    });
    tr.querySelector(".mv-up").addEventListener("click", (e) => { e.stopPropagation(); moveManual(id, -1); });
    tr.querySelector(".mv-down").addEventListener("click", (e) => { e.stopPropagation(); moveManual(id, 1); });

    // v3.39: 10-й час — отметка у строки (соло, первый день), ETA пересчитывается
    tr.querySelector(".x10-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      closeRowMenus();
      const row = rows.find((r) => r.id === id);
      if (!row) return;
      if (row.x10) delete row.x10; else row.x10 = true;
      saveRows();
      renderRows();
      calcRow(id);
    });

    tr.querySelector(".del-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      rows = rows.filter((r) => r.id !== id);
      removeMarker(id);
      removeTargetMarker(id);
      delete rowPositions[id];
      delete lastCalcText[id];
      if (rows.length === 0) rows.push(emptyRow());
      saveRows();
      renderRows();
    });

    tr.addEventListener("click", (e) => {
      if (blinkRows.delete(id)) tr.classList.remove("row-blink");   // v1.59: клик — "увидел"
      fuelSeenClick(tr, id);                                          // v3.30: мало топлива — тоже
      reeferSeenClick(tr, id);                                        // v3.34: тревога рефа — тоже
      if (e.target.tagName === "INPUT" || e.target.tagName === "BUTTON") return;
      if (e.target.closest && e.target.closest(".com-tri")) return;
      const chip = e.target.closest && e.target.closest(".stop-n");
      if (chip && chip.querySelector(".pn-chip")) {                 // v1.79: ✓ пройдена / нет
        const w = chip.closest(".target-wrap");
        toggleDone(id, w.classList.contains("x-stop") ? Number(w.dataset.k) : 0);
        return;
      }
      const cc = e.target.closest && e.target.closest(".cc-badge");
      if (cc && !cc.hidden) {                                         // v3.48: значок страны — открыть ⏱ с данными строки
        const w = cc.closest(".x-stop");                              // у точки ②③… — расчёт до неё
        ecFromRow(id, true, w ? Number(w.dataset.k) : null);
        return;
      }
      drawRoute(id);
      ecFromRow(id);                                                  // v3.31: открыт ⏱ — данные машины в калькулятор
    });
  });
}


// ---------- v1.64: несколько таргетов в строке (2-я, 3-я выгрузка ...) ----------
// row.extra = [{lo, target, delivery}] — точки после основной (row.lo/target/delivery).
// Сортировка и "опаздывает" — только по первой точке; NoBan — один на машину.
const COM_SVG = (has) => has
  ? '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg>'
  : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg>';

function extraTargetsHtml(row, cached) {
  const ex = row.extra || [];
  return ex.map((x, i) => {
    const k = i + 1;
    const ce = cached && cached.extra && cached.extra[i];
    const badge = ce && ce.badge
      ? `<span class="cc-badge x-cc" title="${escapeHtml(ce.badgeHint || ce.badge)}">${escapeHtml(ce.badge)}</span>`
      : '<span class="cc-badge x-cc" hidden></span>';   // v3.22: пустое место той же ширины — поля ровные
    const last = k === ex.length;
    const hide = hideK(row, k) ? " fold-hide" : "";
    const fv = folded(row) ? foldVisible(row) : null;
    return `<div class="target-wrap x-stop${hide}" data-k="${k}">
      <span class="lead">${fv && fv[0] === k ? foldBtnHtml(row, cached) : ""}</span><span class="stop-n">${numChip(k + 1, x.lo)}</span>
      <button class="lo-btn xlo-btn ${loClass(x.lo)}" data-k="${k}" title="${loTitle(x.lo)}">${loText(x.lo)}</button>
      ${badge}
      <input list="points-list" class="xt-input" data-k="${k}" name="target-${row.id}-${k}" autocomplete="off" value="${escapeHtml(x.target)}" title="${escapeHtml(ce && ce.error ? ce.error : x.target)}" placeholder="следующая точка" />
      <button class="stop-x" data-k="${k}" title="Убрать эту точку">×</button>
      ${fv && fv[1] === k
        ? `<button class="fold-more${hiddenHasCom(row) ? " has-com" : ""}" title="${escapeHtml(foldTitle(row, cached))}">${foldMoreLabel(row)}</button>`
        : addStopHtml(row, k)}
    </div>`;
  }).join("");
}

// v3.13: «+» у каждой точки — вставить новую точку сразу после неё (у последней — в конец)
function addStopHtml(row, k) {
  const n = 1 + (row.extra ? row.extra.length : 0);
  if (n >= MAX_STOPS) return `<span class="add-stop-sp" title="Максимум ${MAX_STOPS} точек"></span>`;
  const last = k === n - 1;
  return `<button class="add-stop${last ? "" : " add-mid"}" data-k="${k}" title="${last ? "Добавить ещё таргет" : `Вставить точку после ${STOP_NUM[k + 1]}`}">+</button>`;
}

// v1.66: 3 и больше точек — по умолчанию свёрнуто: видны ① ②, дальше сводка
function foldable(row) { return !!(row.extra && row.extra.length >= 2); }
function folded(row) { return foldable(row) && !row.open; }
// v3.11: свёрнутая строка — видны две точки: первая непройденная и следующая за ней
// (все пройдены — две последние). k: 0 — ①, k ≥ 1 — extra[k - 1].
function foldVisible(row) {
  const n = 1 + (row.extra ? row.extra.length : 0);
  let a = firstOpenIdx(row);
  if (a < 0) a = n - 1;
  let b = a + 1;
  if (b > n - 1) { b = a; a = Math.max(0, a - 1); }
  return [a, b];
}
function hideK(row, k) {
  if (!folded(row)) return false;
  const v = foldVisible(row);
  return k !== v[0] && k !== v[1];
}
// своё примечание первой видимой точки при скрытой ① не показываем: первая строка колонки — общее примечание
function hideNoteK(row, k) {
  if (hideK(row, k)) return true;
  return folded(row) && k > 0 && foldVisible(row)[0] === k;
}
let renderT = null;
function scheduleRender() {
  clearTimeout(renderT);
  renderT = setTimeout(() => { renderRows(); refreshBadgeLooks(); }, 80);
}
function foldBtnHtml(row, cached) {
  return foldable(row) ? `<button class="fold-t" title="${row.open ? "Свернуть точки" : escapeHtml(foldTitle(row, cached))}">${row.open ? "▾" : "▸"}</button>` : "";
}
// подпись свёрнутых точек: ✓N — пройденные спрятаны, +M — дальние
function foldMoreLabel(row) {
  const n = 1 + row.extra.length;
  const v = foldVisible(row);
  const before = v[0], after = n - 1 - v[1];
  // v3.22: в квадрат 22 px, как «+»: при обеих частях — в две строки (✓N сверху, +M снизу)
  if (before && after) return `<span class="fm2">✓${before}<br>+${after}</span>`;
  return before ? `✓${before}` : after ? `+${after}` : "";
}
function hiddenHasCom(row) {
  return (row.extra || []).some((x, i) => x.com && hideK(row, i + 1));
}
function plTochek(n) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "точка";
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "точки";
  return "точек";
}
// v1.74: подсказка к ▸ / "+N" — все скрытые точки: номер, название, ETA, примечание
function foldTitle(row, cached) {
  // v3.11: все точки строки; пройденные — ✓, 💬 — у точки есть комментарий
  const lines = ["Все точки — клик, чтобы раскрыть"];
  const fl = (cached && cached.doneFlags) || [];
  const man = row.done || {};
  const isDone = (k) => (man[k] === true ? true : man[k] === false ? false : !!(fl[k] && fl[k].done));
  const pts = [{ x: { target: row.target, note: "", com: "" }, ce: null }]
    .concat((row.extra || []).map((x, i) => ({ x, ce: cached && cached.extra && cached.extra[i] })));
  pts.forEach((p, k) => {
    const e = p.ce && (p.ce.eta_tacho || p.ce.eta_local);
    lines.push(`${isDone(k) ? "✓" : " "} ${STOP_NUM[k + 1]} ${(p.ce && p.ce.badge ? p.ce.badge + " " : "") + (p.x.target || "—")}`
      + `${!isDone(k) && e ? " — " + e : ""}${p.x.note ? " · «" + p.x.note + "»" : ""}${p.x.com ? " 💬" : ""}`);
  });
  return lines.join("\n");
}

function distCellHtml(row, c) {
  if (!row.extra || !row.extra.length) return c.dist;   // v3.45: плашка коридора — полоской между строками (applyCorStrip)
  const lines = [`<div class="sl${hideK(row, 0) ? " fold-hide" : ""}">${c.dist}</div>`];
  // v3.45: общее расстояние от ① до последней точки — второй строкой в подсказках ②③…
  const totalLegs = row.extra.reduce((s, _, i) => { const e = c.extra && c.extra[i]; return s + (e && e.leg_km != null ? e.leg_km : 0); }, 0);
  const totalTip = totalLegs > 0 ? `\nОбщее расстояние от ① до последней точки: ${Math.round(totalLegs)} км` : "";
  row.extra.forEach((x, i) => {
    const ce = c.extra && c.extra[i];
    // v1.65: у 2-й и следующих точек — плечо от предыдущей точки, сумма только в подсказке
    const txt = ce && ce.done ? '<span class="done-km">✓</span>' : ce && ce.leg_km != null ? String(Math.round(ce.leg_km)) : "—";   // v3.35: без десятых
    const tip = ce && ce.leg_km != null ? `${Math.round(ce.leg_km)} км от точки ${STOP_NUM[i + 1]} (от машины всего ${Math.round(ce.dist_km)})${totalTip}` : (ce && ce.error) || "";   // v3.45: км до целого
    lines.push(`<div class="sl${hideK(row, i + 1) ? " fold-hide" : ""}" title="${escapeHtml(tip)}">${txt}</div>`);
  });
  return lines.join("");
}

function etaCellHtml(row, c, composed) {
  // v1.82: ① пройдена — кнопка NB/🚫 на строке первой непройденной точки (c.nbAt — её индекс в extra)
  const nbAt = c.nbAt != null ? c.nbAt : null;
  const first = composed && nbAt == null ? composed.html : (c.eta || "—");
  if (!row.extra || !row.extra.length) return first;
  const lines = [`<div class="sl${hideK(row, 0) ? " fold-hide" : ""}">${first}</div>`];
  row.extra.forEach((x, i) => {
    const ce = c.extra && c.extra[i];
    let inner = '<span class="eta-x-t">—</span>';
    let tip = "";
    // v3.10: опоздание к TimeSlot любой непройденной точки — красным
    const chk = ce && !ce.done && !ce.error ? slotCheck(x.delivery, ce.eta_tacho || ce.eta_local) : { late: false, lines: [] };
    const lateCls = chk.late ? " sl-late" : "";
    if (ce && ce.done) {
      inner = doneEtaHtml(ce);
      tip = ce.done_by != null ? `Точка пройдена: пройдена следующая ${STOP_NUM[ce.done_by + 1]}`
        : ce.done_auto ? `Точка пройдена: трак стоял ${ce.done_zone ? "в зоне «" + ce.done_zone + "»" : "здесь"}, уехал ${ce.done_at}`
        : "Отмечена пройденной вручную";
    } else if (ce && ce.error) {
      inner = `<span class="eta-x-err">${escapeHtml(ce.error)}</span>`;
      tip = ce.error;
    } else if (ce && (ce.eta_tacho || ce.eta_local)) {
      const wk = ce.tacho_weeklimit ? '<span class="wk-mark" title="Недельный лимит вождения кончится по пути">56</span>' : "";
      inner = `${wk}<span class="eta-x-t">⏱ ${escapeHtml(ce.eta_tacho || ce.eta_local)}</span>`;
      tip = [`Точка ${STOP_NUM[i + 2]}: ${x.target}`,
             `${ce.leg_km.toFixed(1)} км от точки ${STOP_NUM[i + 1]}, всего ${ce.dist_km.toFixed(1)} км`,
             `+30 мин на каждой точке до неё`,
             ce.eta_tacho ? `⏱ По тахографу: ${ce.eta_tacho}` : "",
             `Простой ETA: ${ce.eta_local}`].filter(Boolean).join("\n");
    }
    if (chk.lines.length) tip = chk.lines.join("\n") + (tip ? "\n" + tip : "");
    if (nbAt === i && composed) {
      const t = (chk.lines.length ? chk.lines.join("\n") + "\n" : "") + (composed.title || tip);
      lines.push(`<div class="sl${lateCls}${hideK(row, i + 1) ? " fold-hide" : ""}" title="${escapeHtml(t)}">${composed.html}</div>`);
      return;
    }
    lines.push(`<div class="sl${lateCls}${hideK(row, i + 1) ? " fold-hide" : ""}" title="${escapeHtml(tip)}"><span class="eta-nb-sp"></span>${inner}</div>`);
  });
  return lines.join("");
}

function removeStop(id, k) {
  const row = rows.find((r) => r.id === id);
  if (!row || !row.extra || !row.extra.length) return;
  // v3.11: у точки свой комментарий — спросить
  const own = k > 0 ? row.extra[k - 1] : null;
  if (own && own.com && !confirm(`У точки ${STOP_NUM[k + 1]} есть комментарий — удалить вместе с ним?`)) return;
  delete row.done;   // v1.79: номера точек сдвигаются — ручные ✓ сбрасываем
  if (k === 0) {
    const nx = row.extra.shift();
    row.lo = nx.lo || "";
    row.target = nx.target || "";
    row.delivery = nx.delivery || "";
    // v3.11: своё примечание и комментарий ② не теряются — дописываются в общие
    const nNote = String(nx.note || "").trim();
    if (nNote) row.note = row.note && row.note.trim() ? `${row.note.trim()} · ${nNote}` : nNote;
    const nCom = String(nx.com || "").trim();
    if (nCom) row.com = row.com && row.com.trim() ? `${row.com.replace(/\s+$/, "")}\n— бывш. ②: ${nCom}` : nCom;
  } else {
    row.extra.splice(k - 1, 1);
  }
  if (!row.extra.length) delete row.extra;
  removeTargetMarker(id);
  delete lastCalcText[id];
  saveRows();
  renderRows();
  calcRow(id);
}

// v1.59: строки, которые стали опаздывать при обновлении, мигают до клика
const blinkRows = new Set();
// v3.30: мало топлива (реф < 40 л, тягач < 100 л) — строка мигает янтарным до клика; «увидел» помним
// в браузере (у каждого диспетчера свой клик), пока топливо не поднимется выше порога
let fuelSeen = {};
try { fuelSeen = JSON.parse(localStorage.getItem("fleet-fuel-seen") || "{}") || {}; } catch (e) { fuelSeen = {}; }
function saveFuelSeen() {
  try { localStorage.setItem("fleet-fuel-seen", JSON.stringify(fuelSeen)); } catch (e) { /* ignore */ }
}
function fuelLowOf(data) {
  const lines = [];
  if (data.truck_fuel && data.truck_fuel.low) lines.push(`⛽ Тягач: ${data.truck_fuel.l} л — мало (< 100 л)`);
  const rf = data.is_trailer ? data.reefer : data.linked_trailer && data.linked_trailer.reefer;
  if (rf && rf.fuel_low) lines.push(`⛽ Реф: ${Math.round(rf.fuel_l)} л — мало (< 40 л)`);
  return lines.length ? lines : null;
}
function applyFuelBlink(tr, id) {
  if (!tr) return;
  const c = lastCalcText[id];
  if (!c) return;
  const low = c.fuelLow;
  if (!low && fuelSeen[id]) { delete fuelSeen[id]; saveFuelSeen(); }   // заправились — в следующий раз снова мигать
  const on = !!low && !fuelSeen[id];
  tr.classList.toggle("row-blink-fuel", on);
  alertTitle(tr, id);
}
function fuelSeenClick(tr, id) {
  if (!tr.classList.contains("row-blink-fuel")) return;
  tr.classList.remove("row-blink-fuel");
  fuelSeen[id] = true;
  saveFuelSeen();
  alertTitle(tr, id);
}

// v3.34: тревоги рефа — строка мигает синим до клика «увидел»; снова — после возврата в норму и новой беды.
// (1) температура ушла от уставки дальше порога (заморозка 5°, охлаждёнка 3° — порог даёт сервер) дольше 30 мин;
// (2) реф выключен, а прицеп гружён (вес с CAN тягача; вес не решает — отметки L / O и ✓ точек) — тоже 30 мин;
// (3) данные рефа не обновлялись ≥ 2 ч, а машина едет — сразу. Задержку и «увидел» помнит браузер.
const RF_DELAY_MS = 30 * 60e3;
let rfState = {};   // id -> { first: {temp, off, stale: мс}, seen: bool }
try { rfState = JSON.parse(localStorage.getItem("fleet-reefer-alert") || "{}") || {}; } catch (e) { rfState = {}; }
function saveRfState() {
  try { localStorage.setItem("fleet-reefer-alert", JSON.stringify(rfState)); } catch (e) { /* ignore */ }
}
// гружён по отметкам L / O: пройдена L и после неё есть непройденная O; нет отметок — null (не знаем)
function loadedByLO(row, data) {
  if (!row) return null;
  const lo = [row.lo || ""].concat((row.extra || []).map((x) => (x && x.lo) || ""));
  if (!lo.some((v) => v === "L" || v === "O")) return null;
  const done = (data.points_done || []).map((x) => !!(x && x.done));
  let lastL = -1;
  lo.forEach((v, i) => { if (v === "L" && done[i]) lastL = i; });
  if (lastL < 0) return false;
  return lo.some((v, i) => i > lastL && v === "O" && !done[i]);
}
const tn = (kg) => (kg / 1000).toFixed(1).replace(".", ",") + " т";
function reeferLoaded(row, data) {
  const w = data.truck_weight;
  if (w && w.state === "loaded") return { v: true, why: `вес состава ${tn(w.comb)}` + (w.trl != null ? `, на оси прицепа ${tn(w.trl)}` : "") };
  if (w && w.state === "notrailer") return { v: false };
  const lo = loadedByLO(row, data);
  return { v: lo, why: lo ? "по отметкам L / O" : "" };
}
// условия тревоги сейчас (без задержки): [{k: temp | off | stale, text}]
function reeferAlertsOf(data, row) {
  const rf = data.is_trailer ? data.reefer : data.linked_trailer && data.linked_trailer.reefer;
  const comps = (rf && rf.compartments) || [];
  if (!comps.length) return [];
  const out = [];
  const bad = comps.filter((c) => c.on && c.dev != null && !c.stale && Math.abs(c.dev) > (c.lim || 3));
  if (bad.length) out.push({ k: "temp", text: "❄ Температура ушла: " + bad.map((c) =>
    `отсек ${c.n} — возврат ${fmtT(c.ret)} при уставке ${fmtT(c.set)} (${c.dev > 0 ? "+" : ""}${c.dev}°, допуск ${c.lim || 3}°)`).join("; ") });
  if (!comps.some((c) => c.on) && !comps.some((c) => c.stale)) {
    const ld = reeferLoaded(row, data);
    if (ld.v) out.push({ k: "off", text: `❄ Реф выключен, а прицеп гружён (${ld.why})` });
  }
  if (data.status === "driving" && comps.some((c) => c.stale)) {
    const at = comps.map((c) => c.at).filter(Boolean)[0];
    out.push({ k: "stale", text: "❄ Данные рефа не обновлялись больше 2 ч" + (at ? ` (последние — ${at})` : "") + ", а машина едет" });
  }
  return out;
}
// включённые сейчас тревоги (задержка выдержана) -> строки подсказки или null
function reeferActive(id) {
  const c = lastCalcText[id];
  const st = rfState[id];
  if (!c || !c.rfAlerts || !st) return null;
  const now = Date.now();
  const on = c.rfAlerts.filter((a) => a.k === "stale" || (st.first[a.k] && now - st.first[a.k] >= RF_DELAY_MS));
  return on.length ? on.map((a) => a.text) : null;
}
function applyReeferBlink(tr, id) {
  if (!tr) return;
  const c = lastCalcText[id];
  if (!c || !c.rfAlerts) return;
  const now = Date.now();
  const st = rfState[id] || (rfState[id] = { first: {}, seen: false });
  const ks = c.rfAlerts.map((a) => a.k);
  Object.keys(st.first).forEach((k) => { if (!ks.includes(k)) delete st.first[k]; });
  ks.forEach((k) => { if (!st.first[k]) st.first[k] = now; });
  const act = reeferActive(id);
  if (!act) st.seen = false;          // всё в норме — следующая беда снова мигнёт
  if (!ks.length && !st.seen) delete rfState[id];
  saveRfState();
  tr.classList.toggle("row-blink-rf", !!act && !st.seen);
  alertTitle(tr, id);
}
function reeferSeenClick(tr, id) {
  if (!tr.classList.contains("row-blink-rf")) return;
  tr.classList.remove("row-blink-rf");
  if (rfState[id]) { rfState[id].seen = true; saveRfState(); }
  alertTitle(tr, id);
}
// задержка 30 мин выдерживается и без пересчёта строки (автообновление может быть выключено)
setInterval(() => {
  document.querySelectorAll("#fleet-tbody tr[data-id]").forEach((tr) => {
    const id = Number(tr.dataset.id);
    if (rfState[id] && lastCalcText[id]) applyReeferBlink(tr, id);
  });
}, 60e3);
// подсказка строки, пока она мигает топливом / рефом
function alertTitle(tr, id) {
  const c = lastCalcText[id] || {};
  const lines = [];
  if (tr.classList.contains("row-blink-rf")) lines.push(...(reeferActive(id) || []));
  if (tr.classList.contains("row-blink-fuel")) lines.push(...(c.fuelLow || []));
  if (lines.length) tr.title = lines.join("\n") + "\nКлик по строке — «увидел»";
  else if (tr.title && (tr.title.indexOf("⛽") === 0 || tr.title.indexOf("❄") === 0)) tr.title = "";
}

// v1.59: Delivery с датой сильно в прошлом (опечатка "27.06" вместо "27.09") — жёлтым
function markDeliveryInput(tr, row) {
  const inp = tr && tr.querySelector(".delivery-input");
  if (!inp || !row) return;
  const w = parseDeliveryWindow(row.delivery);
  const ref = w ? (w.end || w.start) : null;
  // v3.13: точка ① уже пройдена (✓ авто или вручную) — дата в прошлом нормальна
  const c = lastCalcText[row.id];
  const passed = (row.done && row.done[0] === true) || !!(c && c.doneFlags && c.doneFlags[0] && c.doneFlags[0].done);
  const bad = !passed && !!(ref && Date.now() - ref.getTime() > 2 * 86400000);
  inp.classList.toggle("del-suspect", bad);
  inp.title = bad ? `${row.delivery}\n⚠ Дата в прошлом — проверь (опечатка?)` : (row.delivery || "");
}

// v1.48: NoBan — кнопка в начале ETA. 🚫 (розовая) — полный запрет по пути, клик → NoBan;
// NB (зелёная) — NoBan включён, запреты не показываем; ⊘ (бледная) — запретов нет.
function composeEta(row, c) {
  const bans = c.bansR || [];
  const near = c.nearR || [];
  let btn;
  // v3.13: клик по кнопке — по кругу: авто → NB (груз без запретов) → 🚫 вручную (запрет на всю строку) → авто
  if (row.fban) {
    btn = `<button class="eta-nb nb-force" title="Запрет поставлен вручную — груз под запретом на всём маршруте. Клик — снова по фиду">🚫</button>`;
  } else if (row.noban) {
    btn = `<button class="eta-nb nb-on" title="NoBan включён — запреты по пути не показываются. Клик — поставить запрет вручную">NB</button>`;
  } else if (bans.length) {
    btn = `<button class="eta-nb nb-ban" title="${escapeHtml("Запрет по пути:\n" + bans.join("\n") + "\nКлик — NoBan (груз без запретов)")}">🚫</button>`;
  } else if (near.length) {   // v3.12: запрета по расчёту нет, но выезд из страны меньше чем за 2 ч до его начала
    btn = `<button class="eta-nb nb-near" title="${escapeHtml("Впритык к запрету:\n" + near.join("\n") + "\nКлик — NoBan")}">⚠</button>`;
  } else {
    btn = `<button class="eta-nb" title="Запретов по пути нет. Клик — NoBan, ещё клик — запрет вручную">⊘</button>`;
  }
  const tip = (c.tipLines || []).slice();
  if (row.fban) tip.push("🚫 Запрет поставлен вручную (груз не освобождён, ETA не сдвинут)");
  if (bans.length) {
    tip.push(row.noban && !row.fban ? "NoBan — запреты по пути скрыты:" : "🚫 Запрет по пути (ETA не сдвинут):", ...bans);
  } else if (row.noban && !row.fban) {
    tip.push("NoBan включён");
  }
  if (!bans.length && near.length) tip.push("⚠ Впритык к запрету (ETA не сдвинут):", ...near);
  tip.push(...(c.banInfo || []));
  return { html: btn + (c.etaCore || ""), title: tip.join("\n") };
}

// v3.12: «впритык» по всем плечам маршрута
function banNearLines(data) {
  const out = (data.bans_near || []).slice();
  (data.extra || []).forEach((x, i) => (x.bans_near || []).forEach((b) => out.push(`${STOP_NUM[i + 1]}→${STOP_NUM[i + 2]} ${b}`)));
  return out;
}
// v3.12: по каким странам и когда едет трак + состояние фида запретов
function banInfoLines(data) {
  const out = [];
  if (data.bans_times) out.push("По странам: " + data.bans_times);
  const st = data.bans_status;
  if (st === "ok") out.push("Фид запретов: загружен");
  else if (st === "loading") out.push("Фид запретов ещё грузится — проверка неполная, обнови строку позже");
  else if (st) out.push("Фид запретов: " + st);
  return out;
}

document.getElementById("fleet-tbody").addEventListener("click", (e) => {
  const b = e.target.closest(".eta-nb");
  if (!b) return;
  e.stopPropagation();
  const tr = b.closest("tr");
  const id = Number(tr.dataset.id);
  const row = rows.find((r) => r.id === id);
  const c = lastCalcText[id];
  if (!row) return;
  // v3.13: авто → NB → запрет вручную → авто
  if (row.fban) { delete row.fban; delete row.noban; }
  else if (row.noban) { delete row.noban; row.fban = true; }
  else row.noban = true;
  saveRows();
  if (c && c.etaCore) {
    const composed = composeEta(row, c);
    const cell = tr.querySelector(".eta-cell");
    cell.innerHTML = etaCellHtml(row, c, composed);
    cell.title = composed.title;
    if (c.nbAt == null) c.eta = composed.html;
    c.etaTip = composed.title;
  }
});

// ---------- v1.56: комментарий строки (как заметка в Google Таблицах) ----------
// Жёлтый уголок у Примечания; наведение — всплывает текст; клик по уголку/окошку или
// ⋯ → "📝 Комментарий" — правка. Клик мимо / "Готово" — сохранить, Esc — отмена.
let comPop = null, comEd = null, comHideT = null;

// v3.11: комментарий точки — k = 0 общий (строка), k ≥ 1 — своя точка extra[k - 1]
// ---------- v3.20: чужая правка — красная рамка «кто и когда» до клика хозяина трипа ----------
function chgSel(key) {
  const m = key.match(/^x(\d+)\.(\w+)$/);
  if (m) {
    const k = m[1];
    return { target: `.xt-input[data-k="${k}"]`, lo: `.xlo-btn[data-k="${k}"]`, delivery: `.xd-input[data-k="${k}"]`,
             note: `.xn-input[data-k="${k}"]`, com: `.com-ic[data-k="${k}"]` }[m[2]] || null;
  }
  return { unit: ".unit-input", target: ".target-input", lo: ".target-wrap:not(.x-stop) .lo-btn:not(.xlo-btn)",
           delivery: ".delivery-input", note: ".note-input", com: '.com-ic[data-k="0"]', disp: ".disp-sel, .disp-lbl",
           client: ".cl-input", ref: ".ref-input",
           crew: ".crew-b" }[key] || null;
}
const CHG_NAMES = { unit: "машина", target: "таргет ①", lo: "L/O ①", delivery: "TimeSlot ①", note: "примечание", client: "Client", ref: "Reference",
  com: "комментарий", trailer: "прицеп", crew: "соло/экипаж", disp: "диспетчер", done: "✓ пройдено",
  fban: "запрет вручную", noban: "запреты", extra: "точки" };
function chgName(key) {
  const m = key.match(/^x(\d+)\.(\w+)$/);
  if (!m) return CHG_NAMES[key] || key;
  const sub = { target: "таргет", lo: "L/O", delivery: "TimeSlot", note: "примечание", com: "комментарий" }[m[2]] || m[2];
  return `${sub} ${STOP_NUM[Number(m[1]) + 1] || m[1]}`;
}
function chgWhen(ms) {
  const d = new Date(ms || 0);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function chgWho(c) { return (c && c.by ? dispLabel(String(c.by).toLowerCase()) : "?") + " " + chgWhen(c && c.at); }
function isTripOwner(row) { const me = fleetMe(); return !!me && me === rowDisp(row); }
function clearChg(row, keys) {
  if (!row.chg) return;
  keys.forEach((k) => { delete row.chg[k]; });
  if (!Object.keys(row.chg).length) delete row.chg;
  saveRows();
}
function markForeign(tr, row) {
  const chg = row.chg;
  if (!chg || typeof chg !== "object") return;
  const keys = Object.keys(chg);
  if (!keys.length) return;
  const owner = isTripOwner(row);
  keys.forEach((k) => {
    const sel = chgSel(k);
    if (!sel) return;
    tr.querySelectorAll(sel).forEach((el) => {
      el.classList.add("chg-mark");
      el.dataset.chgKey = k;
      el.title = `✎ Изменил ${chgWho(chg[k])}` + (owner ? " — клик снимет отметку" : "") + (el.title ? "\n" + el.title : "");
    });
  });
  // плашка в клетке машины: все чужие правки списком (и те, что не видны — прицеп, ✓, свёрнутые точки)
  const cell = tr.querySelector(".unit-cell");
  if (cell) {
    const who = Array.from(new Set(keys.map((k) => dispLabel(String((chg[k] || {}).by || "").toLowerCase())))).join(", ");
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chg-badge";
    b.textContent = "✎ " + who;
    b.title = "Чужие правки в трипе:\n" + keys.map((k) => `• ${chgName(k)} — ${chgWho(chg[k])}`).join("\n")
      + (owner ? "\n\nКлик — снять все отметки" : "\n\nСнять отметки может хозяин трипа");
    if (owner) b.addEventListener("click", (e) => { e.stopPropagation(); clearChg(row, keys); renderRows(); });
    cell.appendChild(b);
  }
  if (!owner) return;
  tr.querySelectorAll(".chg-mark").forEach((el) => {
    el.addEventListener("mousedown", () => {
      const k = el.dataset.chgKey;
      tr.querySelectorAll(`.chg-mark[data-chg-key="${k}"]`).forEach((x) => x.classList.remove("chg-mark"));
      clearChg(row, [k]);
      const rest = row.chg ? Object.keys(row.chg).length : 0;
      const bd = tr.querySelector(".chg-badge");
      if (bd && !rest) bd.remove();
    }, { once: true });
  });
}

function comBtnHtml(com, k) {
  return `${com ? `<span class="com-tri" data-k="${k}" title="Комментарий"></span>` : ""}`
    + `<button class="com-ic${com ? " has" : ""}" data-k="${k}" title="${com ? "Комментарий — клик, чтобы изменить" : (k ? "Добавить комментарий к точке " + STOP_NUM[k + 1] : "Добавить комментарий")}">${COM_SVG(!!com)}</button>`;
}
function comOf(row, k) {
  if (!k) return row.com || "";
  const x = row.extra && row.extra[k - 1];
  return (x && x.com) || "";
}
function comHead(row, k) {
  return escapeHtml(row.unit || "строка") + (k ? " · " + STOP_NUM[k + 1] : "");
}

function placeFloat(el, anchor, dx) {
  const a = anchor.getBoundingClientRect();
  const w = el.offsetWidth, h = el.offsetHeight;
  const z = uiZoom();
  const W = w * z, H = h * z;
  el.style.left = Math.max(8, Math.min(window.innerWidth - W - 8, a.right - W + (dx || 0))) / z + "px";
  el.style.top = (a.bottom + 6 + H < window.innerHeight ? a.bottom + 6 : Math.max(8, a.top - 6 - H)) / z + "px";
}

function hideComPop() {
  if (comPop) { comPop.remove(); comPop = null; }
}

function showComPop(tri) {
  if (comEd) return;
  clearTimeout(comHideT);
  hideComPop();
  const tr = tri.closest("tr");
  const row = rows.find((r) => r.id === Number(tr.dataset.id));
  const k = Number(tri.dataset.k || 0);
  if (!row || !comOf(row, k)) return;
  comPop = document.createElement("div");
  comPop.className = "com-pop";
  comPop.innerHTML = `<div class="com-hd">${comHead(row, k)} · комментарий — клик, чтобы изменить</div>${escapeHtml(comOf(row, k))}`;
  document.body.appendChild(comPop);
  placeFloat(comPop, tri, 6);
  comPop.addEventListener("mouseenter", () => clearTimeout(comHideT));
  comPop.addEventListener("mouseleave", () => { comHideT = setTimeout(hideComPop, 250); });
  // v3.18: клик по полосе прокрутки — просто прокрутка, редактор не открываем
  const onBar = (e) => e.offsetX > comPop.clientWidth || e.offsetY > comPop.clientHeight;
  comPop.addEventListener("mousedown", (e) => { if (onBar(e)) e.stopPropagation(); });
  comPop.addEventListener("click", (e) => { e.stopPropagation(); if (onBar(e)) return; openComEditor(row.id, tri, k); });
}

function closeComEditor(save) {
  if (!comEd) return;
  const id = Number(comEd.dataset.id);
  const k = Number(comEd.dataset.k || 0);
  const val = comEd.querySelector("textarea").value.replace(/\s+$/, "");
  comEd.remove();
  comEd = null;
  if (save) {
    const row = rows.find((r) => r.id === id);
    if (row && comOf(row, k) !== val) {
      if (!k) row.com = val;
      else if (row.extra && row.extra[k - 1]) {
        if (val) row.extra[k - 1].com = val; else delete row.extra[k - 1].com;
      }
      saveRows();
      renderRows();
    }
  }
}

function openComEditor(id, anchor, k) {
  hideComPop();
  closeComEditor(true);
  const row = rows.find((r) => r.id === id);
  if (!row) return;
  k = Number(k || 0);
  if (k && !(row.extra && row.extra[k - 1])) return;
  comEd = document.createElement("div");
  comEd.className = "com-ed";
  comEd.dataset.id = id;
  comEd.dataset.k = k;
  comEd.innerHTML = `<div class="com-ed-hd">${comHead(row, k)} <span>· ${k ? "комментарий к точке" : "комментарий"}</span></div>
    <textarea placeholder="${k ? "Адрес, контакты, окно, особенности точки…" : "Инструкция водителю, рефы, адрес, контакты…"}">${escapeHtml(comOf(row, k))}</textarea>
    <div class="com-ed-row">
      <button type="button" data-a="copy">Скопировать</button>
      <button type="button" data-a="del" class="com-del">Удалить</button>
      <span class="com-sp"></span><span class="com-hint">Esc — отмена</span>
      <button type="button" data-a="ok" class="com-ok">Готово</button>
    </div>`;
  document.body.appendChild(comEd);
  placeFloat(comEd, anchor);
  const ta = comEd.querySelector("textarea");
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
  comEd.addEventListener("click", (e) => {
    e.stopPropagation();
    const a = e.target.dataset && e.target.dataset.a;
    if (a === "copy") {
      try {
        navigator.clipboard.writeText(ta.value).catch(() => ta.select());
      } catch (err) { ta.select(); }
      e.target.textContent = "Скопировано ✓";
      setTimeout(() => { if (e.target) e.target.textContent = "Скопировать"; }, 1200);
    } else if (a === "del") {
      ta.value = "";
      closeComEditor(true);
    } else if (a === "ok") {
      closeComEditor(true);
    }
  });
}

(function () {
  const tbody = document.getElementById("fleet-tbody");
  tbody.addEventListener("mouseover", (e) => {
    const t = e.target.closest && e.target.closest(".com-tri, .com-ic.has");
    if (t) showComPop(t);
  });
  tbody.addEventListener("mouseout", (e) => {
    if (e.target.closest && e.target.closest(".com-tri, .com-ic.has")) comHideT = setTimeout(hideComPop, 250);
  });
  tbody.addEventListener("click", (e) => {
    const t = e.target.closest && e.target.closest(".com-tri");
    if (!t) return;
    e.stopPropagation();
    openComEditor(Number(t.closest("tr").dataset.id), t, Number(t.dataset.k || 0));
  });
  document.addEventListener("mousedown", (e) => {
    if (comEd && !comEd.contains(e.target)) closeComEditor(true);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && comEd) closeComEditor(false);
  });
  // v3.19: прокрутка внутри попапа/редактора комментария его не закрывает
  window.addEventListener("scroll", (e) => {
    const t = e.target;
    if (t && t.nodeType === 1 && t.closest && t.closest(".com-pop, .com-ed")) return;
    hideComPop();
  }, true);
})();

// ---------- v1.71: привязка прицепа к тягачу ----------
const normNo = (s) => String(s || "").toUpperCase().replace(/[\s\-]/g, "");
function isTrailerNo(n) {
  return (unitsCache || []).some((u) => u.kind === "trailer" && normNo(u.number) === normNo(n));
}
function findUnitNo(n, kind) {
  const u = (unitsCache || []).find((x) => x.kind === kind && normNo(x.number) === normNo(n));
  return u ? u.number : null;
}
// v3.22: завершить трип — сервер кладёт его в архив «Завершённые», во Флоте строка исчезает
async function completeTrip(id) {
  if (!window.fleetComplete) return;
  const ok = await window.fleetComplete(id);
  if (ok) renderRows();
}
function dropRow(id) {
  rows = rows.filter((r) => r.id !== id);
  removeMarker(id);
  removeTargetMarker(id);
  removeExtraTargets(id);
  delete rowPositions[id];
  delete lastCalcText[id];
  if (displayOrder) displayOrder = displayOrder.filter((x) => x !== id);
  if (sortMode === "manual") { manualOrder = manualOrder.filter((x) => x !== id); saveSortState(); }
}
function insertRowAfter(id, nr) {
  const idx = rows.findIndex((r) => r.id === id);
  rows.splice(idx + 1, 0, nr);
  if (displayOrder) { const di = displayOrder.indexOf(id); displayOrder.splice(di + 1, 0, nr.id); }
  if (sortMode === "manual") { const mi = manualOrder.indexOf(id); manualOrder.splice(mi + 1, 0, nr.id); saveSortState(); }
}
// тягачу truckId привязать прицеп trailerNo; строка этого прицепа во Флоте (если есть) уходит
function linkTrailer(truckId, trailerNo) {
  const truck = rows.find((r) => r.id === truckId);
  if (!truck) return;
  truck.trailer = String(trailerNo || "").trim();
  rows.filter((r) => r.id !== truckId && normNo(r.unit) === normNo(truck.trailer)).forEach((r) => {
    // v1.72: у тягача таргета нет, а у строки прицепа есть — переносим таргет, Delivery, примечание
    if (!truck.target && r.target) {
      ["lo", "target", "delivery", "extra", "open"].forEach((k) => { if (r[k] !== undefined) truck[k] = r[k]; });
    }
    if (!truck.note && r.note) truck.note = r.note;
    if (!truck.com && r.com) truck.com = r.com;
    dropRow(r.id);
  });
  saveRows();
  renderRows();
  calcRow(truckId);
}
// строку прицепа trailerRowId — к тягачу truckNo: есть строка тягача — туда, нет — строка становится тягачом
function linkTrailerRowToTruck(trailerRowId, truckNo) {
  const tRow = rows.find((r) => r.id === trailerRowId);
  if (!tRow) return;
  const truck = rows.find((r) => r.id !== trailerRowId && normNo(r.unit) === normNo(truckNo));
  if (truck) return linkTrailer(truck.id, tRow.unit);
  tRow.trailer = tRow.unit;
  tRow.unit = truckNo;
  delete lastCalcText[trailerRowId];
  removeMarker(trailerRowId);
  saveRows();
  renderRows();
  calcRow(trailerRowId);
}
function unlinkTrailer(truckId) {
  const truck = rows.find((r) => r.id === truckId);
  if (!truck || !truck.trailer) return;
  const no = truck.trailer;
  truck.trailer = "";
  removeTrailerLink(truckId);
  let nr = null;
  if (!rows.some((r) => normNo(r.unit) === normNo(no))) {
    nr = emptyRow();
    nr.unit = no;
    insertRowAfter(truckId, nr);
  }
  saveRows();
  renderRows();
  calcRow(truckId);
  if (nr) calcRow(nr.id);
}
let trlEd = null;
function closeTrailerEditor() { if (trlEd) { trlEd.remove(); trlEd = null; } }
// v1.72: в строке тягача — выбираем прицеп; в строке прицепа — выбираем тягач (строка уходит к нему)
function openTrailerEditor(id, anchor) {
  closeTrailerEditor();
  const row = rows.find((r) => r.id === id);
  if (!row) return;
  const forTrailer = isTrailerNo(row.unit);
  const kind = forTrailer ? "truck" : "trailer";
  trlEd = document.createElement("div");
  trlEd.className = "trl-ed";
  trlEd.innerHTML = `<div class="trl-ed-t">${forTrailer ? "Тягач для прицепа" : "Прицеп для"} ${escapeHtml(row.unit || "строки")}</div>
    <input list="${forTrailer ? "trucks-list" : "trailers-list"}" class="trl-ed-in" autocomplete="off" placeholder="${forTrailer ? "номер тягача" : "номер прицепа"}" value="${escapeHtml(forTrailer ? "" : row.trailer || "")}">
    <div class="trl-ed-err" hidden></div>
    <div class="trl-ed-b"><button class="trl-ed-ok">Привязать</button><button class="trl-ed-cancel">Отмена</button></div>`;
  document.body.appendChild(trlEd);
  const r = anchor.getBoundingClientRect();
  const z = uiZoom();
  trlEd.style.top = Math.min(window.innerHeight - trlEd.offsetHeight * z - 8, r.bottom + 4) / z + "px";
  trlEd.style.left = Math.max(8, r.right - trlEd.offsetWidth * z) / z + "px";
  const inp = trlEd.querySelector(".trl-ed-in");
  const err = trlEd.querySelector(".trl-ed-err");
  // v1.72: ближайший по GPS — сразу в поле, ещё два — кнопками под полем
  const near = document.createElement("div");
  near.className = "trl-ed-near";
  near.textContent = "ищу ближайший…";
  inp.after(near);
  const edNow = trlEd;
  if (row.unit) fetch(`/api/nearest-units?unit=${encodeURIComponent(row.unit)}&kind=${kind}`)
    .then((r) => r.json())
    .then((d) => {
      if (trlEd !== edNow) return;
      const items = (d && d.items) || [];
      if (!items.length) { near.textContent = d && d.error ? d.error : "рядом никого не нашёл"; return; }
      if (!inp.value.trim() || inp.dataset.auto) {
        inp.value = items[0].number;
        inp.dataset.auto = "1";
        inp.select();
      }
      const km = (x) => (x.km < 1 ? Math.round(x.km * 1000) + " м" : fmtKm(x.km));
      near.innerHTML = "ближайшие: " + items.map((x) =>
        `<button class="trl-ed-pick" data-n="${escapeHtml(x.number)}" title="${x.state === "driving" ? "едет" : "стоит"}">${escapeHtml(x.number)} · ${escapeHtml(km(x))}</button>`).join(" ");
      near.querySelectorAll(".trl-ed-pick").forEach((b) => b.addEventListener("click", () => {
        inp.value = b.dataset.n;
        inp.dataset.auto = "";
        inp.focus();
      }));
    })
    .catch(() => { if (trlEd === edNow) near.textContent = ""; });
  else near.textContent = "";
  inp.addEventListener("input", () => { inp.dataset.auto = ""; });
  const ok = () => {
    const v = inp.value.trim();
    if (!v) {
      closeTrailerEditor();
      if (!forTrailer && row.trailer) unlinkTrailer(id);
      return;
    }
    const hit = findUnitNo(v, kind);
    if ((unitsCache || []).length && !hit) {
      err.textContent = forTrailer ? "Такого тягача нет в группе машин" : "Такого прицепа нет в Mapon";
      err.hidden = false;
      return;
    }
    closeTrailerEditor();
    if (forTrailer) linkTrailerRowToTruck(id, hit || v);
    else linkTrailer(id, hit || v);
  };
  trlEd.querySelector(".trl-ed-ok").addEventListener("click", ok);
  trlEd.querySelector(".trl-ed-cancel").addEventListener("click", closeTrailerEditor);
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") ok();
    if (e.key === "Escape") closeTrailerEditor();
  });
  trlEd.addEventListener("mousedown", (e) => e.stopPropagation());
  inp.focus();
  inp.select();
}
document.addEventListener("mousedown", () => closeTrailerEditor());
(function () {
  document.getElementById("fleet-tbody").addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest(".hitch-link, .trl-unlink");
    if (!b) return;
    e.stopPropagation();
    const id = Number(b.closest("tr").dataset.id);
    if (b.classList.contains("trl-unlink")) return unlinkTrailer(id);
    if (b.dataset.truck) return linkTrailerRowToTruck(id, b.dataset.truck);
    if (b.dataset.trailer) return linkTrailer(id, b.dataset.trailer);
  });
})();

function closeRowMenus() {
  document.querySelectorAll("#fleet-tbody .row-menu").forEach((m) => { m.hidden = true; });
}
document.addEventListener("click", closeRowMenus);
let rowMenuOpenedAt = 0;
window.addEventListener("scroll", () => { if (Date.now() - rowMenuOpenedAt > 300) closeRowMenus(); }, true);
window.addEventListener("resize", closeRowMenus);

// v1.54: Delivery (свободный текст) -> окно {start, end} для сравнения с ETA.
// Дата: "28/09", "29.09.2026", "2026-09-27". Время:
//   окно  "09-15", "09:00-15:00", "09.00–15.00", "9-15h", "between 01 to 04 AM", "22-04" (через полночь)
//   срок  "before 15:00", "до 15", "DO 19.00", одиночное "06.00", "09am", "01.30", "17"
//   начало "after 10", "from 10", "с 10", "после 10" (конца нет)
// Только время без даты ("22.00", "09-15", "до 15") — сегодня (v1.68).
// Без времени — срок до конца дня. Не распознано — null (без подсветки).
const DT_T = "(\\d{1,2})(?:[:.](\\d{2}))?\\s*(am|pm|h)?";
function hmOf(h, m, ap, apFallback) {
  let hh = +h, mm = m ? +m : 0;
  const a = ap || apFallback;
  if (a === "pm" && hh < 12) hh += 12;
  if (a === "am" && hh === 12) hh = 0;
  if (hh > 24 || mm > 59) return null;
  return hh * 60 + mm;
}
function parseDeliveryWindow(txt) {
  const s = String(txt || "");
  // v3.10: окно «с–по» через даты: "03.10 22:00 – 04.10 06:00", "с 03/10 22 по 04/10 06"
  const DD = "(\\d{1,2})[\\/.](\\d{1,2})(?:[\\/.]\\d{2,4})?\\s+";
  const two = s.toLowerCase().match(new RegExp(DD + DT_T + "\\s*(?:-|–|—|to|till|until|до|по)\\s*" + DD + DT_T));
  if (two) {
    const a = hmOf(two[3], two[4], two[5], two[10]);
    const b = hmOf(two[8], two[9], two[10]);
    const okD = (d, m) => d >= 1 && d <= 31 && m >= 1 && m <= 12;
    if (a != null && b != null && okD(+two[1], +two[2]) && okD(+two[6], +two[7])) {
      const start = mkDate(+two[1], +two[2], Math.floor(a / 60), a % 60);
      const end = mkDate(+two[6], +two[7], Math.floor(b / 60), b % 60);
      if (end > start) return { start, end };
    }
  }
  let day, mon, rest;
  const iso = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})(.*)$/);
  const d = iso ? null : s.match(/(\d{1,2})[\/.](\d{1,2})(?:[\/.]\d{2,4})?(.*)$/);
  if (iso) { day = +iso[3]; mon = +iso[2]; rest = iso[4] || ""; }
  else if (d) { day = +d[1]; mon = +d[2]; rest = d[3] || ""; }
  // v1.68: только время ("22.00", "22:00", "09-15", "до 15", "after 10") — значит сегодня.
  // "22.00" похоже на дату 22/00 — если такая дата невалидна или далеко от сегодня
  // (раньше чем 2 дня назад / позже чем через 60 дней), читаем как время сегодня.
  const dateOk = day >= 1 && day <= 31 && mon >= 1 && mon <= 12 && (() => {
    const dd = mkDate(day, mon, 12, 0).getTime() - Date.now();
    return dd > -2 * 86400000 && dd < 60 * 86400000;
  })();
  const explicitDate = iso || /\d{1,2}\/\d{1,2}|\d{1,2}\.\d{1,2}\.\d{2,4}/.test(s);
  if (!dateOk && !explicitDate) {
    if (!/\d/.test(s)) return null;
    const now = new Date();
    day = now.getDate(); mon = now.getMonth() + 1; rest = s;
  }
  if (day < 1 || day > 31 || mon < 1 || mon > 12) return null;
  rest = rest.toLowerCase();
  const at = (min) => mkDate(day, mon, Math.floor(min / 60), min % 60);
  const range = rest.match(new RegExp(DT_T + "\\s*(?:-|–|—|to|till|until|and|до|по)\\s*" + DT_T));
  if (range) {
    const a = hmOf(range[1], range[2], range[3], range[6]);
    const b = hmOf(range[4], range[5], range[6]);
    if (a != null && b != null) {
      const start = at(a);
      let end = at(b);
      if (b <= a) end = new Date(end.getTime() + 86400000);   // окно через полночь
      return { start, end };
    }
  }
  const before = rest.match(new RegExp("(?:before|until|till|not later than|latest|до|do)\\s*" + DT_T));
  if (before) {
    const b = hmOf(before[1], before[2], before[3]);
    if (b != null) return { start: null, end: at(b) };
  }
  const after = rest.match(new RegExp("(?:after|from|после|от|с)\\s*" + DT_T));
  if (after) {
    const a = hmOf(after[1], after[2], after[3]);
    if (a != null) return { start: at(a), end: null };
  }
  const single = rest.match(new RegExp("(?:^|[^\\d])" + DT_T + "(?![\\d])"));
  if (single) {
    const t = hmOf(single[1], single[2], single[3]);
    if (t != null) return { start: null, end: at(t) };
  }
  return { start: null, end: at(23 * 60 + 59) };
}
// срок доставки (конец окна) — для совместимости
function parseDelivery(txt) {
  const w = parseDeliveryWindow(txt);
  return w ? w.end : null;
}
// v1.54: строки подсказки и флаг опоздания по окну Delivery
function deliveryCheck(row, etaStr) {
  const w = parseDeliveryWindow(row.delivery);
  const etaD = parseEta(etaStr);
  const out = { late: false, lines: [] };
  if (!w || !etaD) return out;
  // v1.59: дата Delivery сильно в прошлом — скорее опечатка, не красим, а предупреждаем
  const ref = w.end || w.start;
  if (ref && Date.now() - ref.getTime() > 2 * 86400000) {
    out.lines.push("⚠ Дата TimeSlot в прошлом — проверь (опечатка?)");
    return out;
  }
  const hm = (d) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (w.end && etaD > w.end) {
    out.late = true;
    out.lines.push(`Позже TimeSlot (${row.delivery}) — ${w.start ? "окно до" : "срок"} ${hm(w.end)}`);
  } else if (w.start && etaD < w.start) {
    out.lines.push(`⏳ Раньше окна TimeSlot — с ${hm(w.start)}, будет ждать`);
  }
  return out;
}
// v3.10: проверка по тексту TimeSlot (любая точка)
function slotCheck(txt, etaStr) { return deliveryCheck({ delivery: txt }, etaStr); }
// опаздывает ли хоть одна непройденная следующая точка (② и дальше)
function extrasLate(row, extra) {
  return (row.extra || []).some((x, i) => {
    const ce = extra && extra[i];
    return !!(ce && !ce.done && !ce.error && slotCheck(x.delivery, ce.eta_tacho || ce.eta_local).late);
  });
}
// "dd/mm HH:MM" (ETA с сервера) -> Date
function parseEta(txt) {
  const d = String(txt || "").match(/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/);
  return d ? mkDate(+d[1], +d[2], +d[3], +d[4]) : null;
}
function mkDate(day, mon, hh, mm) {
  const now = new Date();
  let y = now.getFullYear();
  if (mon - (now.getMonth() + 1) > 6) y -= 1;       // декабрь при январе
  else if ((now.getMonth() + 1) - mon > 6) y += 1;  // январь при декабре
  return new Date(y, mon - 1, day, hh, mm);
}

function setRowField(id, field, value) {
  const row = rows.find((r) => r.id === id);
  if (row) { row[field] = value; saveRows(); }
}

// v1.50: после правки Delivery — только перепроверить "позже Delivery" по уже посчитанному ETA
function recheckLate(id) {
  const row = rows.find((r) => r.id === id);
  const c = lastCalcText[id];
  const tr = document.querySelector(`#fleet-tbody tr[data-id="${id}"]`);
  if (!row || !c || !c.etaCore || !tr) return;
  // v3.10: ① пройдена — её TimeSlot не проверяем; следующие точки проверяет etaCellHtml
  const firstDone = c.nbAt != null || !!(c.doneFlags && c.doneFlags[0] && c.doneFlags[0].done);
  const chk = firstDone ? { late: false, lines: [] } : deliveryCheck(row, c.etaStr);
  c.late = chk.late;
  c.anyLate = c.late || extrasLate(row, c.extra);
  c.tipLines = (c.tipLines || []).filter((l) => !l.startsWith("Позже TimeSlot") && !l.startsWith("⏳ Раньше окна") && !l.startsWith("⚠ Дата TimeSlot"));
  c.tipLines.unshift(...chk.lines);
  const composed = composeEta(row, c);
  const cell = tr.querySelector(".eta-cell");
  cell.classList.toggle("eta-late", c.late);
  cell.innerHTML = etaCellHtml(row, c, composed);
  cell.title = composed.title;
  c.eta = composed.html;
  c.etaTip = composed.title;
}

function updateRowField(id, field, value) {
  const row = rows.find((r) => r.id === id);
  if (row) {
    row[field] = value;
    if (field === "target" && row.done) delete row.done[0];   // v1.79
    if (field === "unit") delete row.done;
    saveRows();
    calcRow(id);
  }
}

// v3.13: why — зачем считаем (edit / all / auto / sync), для разбивки запросов к Google
async function calcRow(id, why) {
  const row = rows.find((r) => r.id === id);
  if (!row || !row.unit) return;

  const tr = document.querySelector(`#fleet-tbody tr[data-id="${id}"]`);
  if (!tr) return;

  const statusCell = tr.querySelector(".status-cell");
  const distCell = tr.querySelector(".dist-cell");
  const etaCell = tr.querySelector(".eta-cell");

  statusCell.textContent = "…";
  statusCell.className = "status-cell muted";

  try {
    const res = await fetch("/api/calc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign(
        { unit: row.unit, target: row.target },
        row.extra && row.extra.length ? { extra: row.extra.map((x) => x.target || "") } : {},
        row.trailer ? { trailer: row.trailer } : {},
        row.crew ? { crew: row.crew } : {},
        row.x10 ? { x10: true } : {},                                    // v3.39: 10-й час сегодня
        row.corridor ? { corridor: row.corridor } : {},                 // v3.32: коридор выбрал диспетчер
        { done: doneManualArray(row), done_seen: doneSeenArray(row), why: why || "edit" })),
    });
    const data = await res.json();
    if (!data.error) { keepDoneSeen(row, data); remapDone(data); }

    if (data.error) {
      statusCell.textContent = data.error;
      statusCell.className = "status-cell";
      distCell.textContent = "—";
      etaCell.textContent = "—";
      delete lastCalcText[id];
      return;
    }

    // v1.31: плашка страны, где машина сейчас
    const ccBadge = data.unit_country
      ? `<span class="cc-badge" title="${escapeHtml(data.unit_code_hint || data.unit_country)}">${escapeHtml(data.unit_country)}</span>`
      : "";
    // v1.43: одна строка — страна, ■/▶, время, скорость, ⏸
    const icon = data.status === "driving"
      ? '<span class="st-ic st-go">▶</span>' : '<span class="st-ic st-stop">■</span>';
    let statusLine1 = ccBadge + icon + escapeHtml(data.duration_str);   // v3.37: 👤 / 👥 — после страны (ниже)
    // v1.33: ⏸ — впереди обязательный отдых по тахографу или водитель сейчас отдыхает
    const tachoTip = (data.tacho_summary || []).join("\n");
    const speedTxt = data.status === "driving" && data.speed != null
      ? escapeHtml(`${Math.round(data.speed)} км/ч`) : "";
    const extra = speedTxt ? `<span class="st-speed"> · ${speedTxt}</span>` : "";
    const pauseIc = (data.tacho_rest_ahead || data.tacho_resting_now)
      ? `<span class="tacho-pause" title="${escapeHtml(tachoTip)}"></span>` : "";
    // v1.59: трак на объекте таргета (полигон Mapon или радиус 300 м)
    // v1.81: на какой точке стоит (первая непройденная) — номер в плашке, подсветка её строки
    const otIdx = data.on_target ? ((data.active_idx && data.active_idx.length) ? data.active_idx[0] : 0) : null;
    const otMulti = otIdx != null && row.extra && row.extra.length;
    const otLo = otIdx ? ((row.extra[otIdx - 1] || {}).lo) : row.lo;
    const ot = data.on_target
      ? `<span class="ot-pill" title="${escapeHtml(data.on_target.how === "object" ? "На объекте Mapon: " + data.on_target.name : "В радиусе 300 м от таргета")}">📍 на объекте${otMulti ? " " + numChip(otIdx + 1, otLo) : ""}</span>` : "";
    // v1.70: прицеп — рефка; сцепка тягач ↔ прицеп (угадана по координатам)
    const trTag = data.is_trailer ? '<span class="trl-tag" title="Прицеп">П</span>' : "";
    const reeferHtml = data.is_trailer ? reeferPillHtml(data) : "";
    // у прицепа — вторая строка (рефка + кнопка "к тягачу"); у тягача с привязанным прицепом —
    // вторая строка с прицепом; без привязки — кнопка 🔗? в первой строке (v1.71)
    let hitchHtml = "", line2 = "";
    // v3.16: 👤/👥 — в начале второй строки статуса, слева от прицепа
    // v3.37: 👤 / 👥 — в первой строке, между страной и ▶ (Блокнот «Головы»)
    const crewB = data.is_trailer ? "" : crewHtml(row, { crew: crewOf(data) });
    const x10B = !data.is_trailer && row.x10 ? '<span class="x10-chip" title="10-й час сегодня (отметка в ⋯) — ETA с учётом">+1ч</span>' : "";
    statusLine1 = ccBadge + crewB + x10B + icon + escapeHtml(data.duration_str);
    const tfHtml = data.is_trailer ? "" : truckFuelHtml(data);   // v3.30: ⛽ тягача — только когда мало
    if (data.is_trailer) {
      hitchHtml = hitchPillHtml(data, false);
      if (reeferHtml || hitchHtml) line2 = `<div class="status-line2">${reeferHtml}${hitchHtml}</div>`;
    } else if (row.trailer) {
      line2 = `<div class="status-line2">${tfHtml}${linkedTrailerHtml(row.trailer, data.linked_trailer)}</div>`;
    } else {
      // v3.37: непривязанный прицеп (🔗 угадан) — во второй строке, где и привязанный
      const hp = hitchPillHtml(data, true);
      if (hp || tfHtml) line2 = `<div class="status-line2">${tfHtml}${hp}</div>`;
    }
    const statusHtml = `<div class="status-line" title="${escapeHtml(data.status_ru + " " + data.duration_str + (data.on_target ? "\nна объекте" + (data.on_target.name ? ": " + data.on_target.name : "") : "") + (tachoTip ? "\n" + tachoTip : ""))}">${trTag}${statusLine1}${extra}${pauseIc}${ot}${data.is_trailer ? "" : hitchHtml}</div>${line2}`;
    const statusClass = data.status === "driving" ? "status-driving" : "status-standing";

    statusCell.innerHTML = statusHtml;
    statusCell.className = `status-cell ${statusClass}`;

    let distText = "—";
    let etaText = "—";
    let etaTip = "";
    let late = false, anyLate = false;
    let etaCore = null, bansR = [], tipLines = [];
    let nearR = [], banInfo = [];   // v3.12: «впритык» и подробности проверки запретов
    if (data.dist_km != null && !data.first_done) {
      distText = String(Math.round(data.dist_km));   // v3.35: без десятых
      distCell.classList.remove("muted");
      // v1.33: две строки — простой ETA и ⏱ по тахографу; подробности в подсказке
      const tip = ["Простой ETA: км ÷ 70, без остановок"]
        .concat(data.eta_tacho ? ["⏱ По тахографу: " + data.eta_tacho].concat(data.tacho_summary || []) : [])
        .concat(data.tacho_error ? ["Тахограф: " + data.tacho_error] : [])
        .concat(data.route_countries && data.route_countries.length > 1 ? ["Страны: " + data.route_countries.join(" → ")] : []);
      // v1.43: одна строка — ⏱ по тахографу крупно, простой мелко серым
      etaText = data.eta_tacho
        ? `<span class="eta-tacho">⏱ ${escapeHtml(data.eta_tacho)}</span>`   // v3.18: серое простое ETA — только в подсказке
        : `<span class="eta-tacho eta-only">${escapeHtml(data.eta_local)}</span>`;
      // v1.46: "56" — одиночка упирается в недельный лимит вождения, стоп до пн 00:00 UTC
      if (data.tacho_weeklimit) {
        etaText = `<span class="wk-mark" title="Недельный лимит вождения кончится по пути — стоп до пн 00:00 UTC (02:00 CEST), учтено в ⏱ ETA">56</span>` + etaText;
      }
      etaCore = etaText;
      bansR = (data.bans_route || []).slice();
      (data.extra || []).forEach((x, i) => (x.bans_route || []).forEach((b) => bansR.push(`${STOP_NUM[i + 1]}→${STOP_NUM[i + 2]} ${b}`)));
      nearR = banNearLines(data);
      banInfo = banInfoLines(data);
      const chk = deliveryCheck(row, data.eta_tacho || data.eta_local);
      late = chk.late;
      anyLate = late || extrasLate(row, extraCalc(data));
      // v1.59: стала опаздывать с прошлого расчёта — мигать до клика (v3.10: любая точка)
      const prevC = lastCalcText[id];
      if (prevC && prevC.etaCore && prevC.anyLate === false && anyLate) {
        blinkRows.add(id);
        tr.classList.add("row-blink");
      }
      etaCell.classList.toggle("eta-late", late);
      tip.unshift(...chk.lines);
      tipLines = tip;
      // v1.48: кнопка NoBan / 🚫 в начале ETA
      const composed = composeEta(row, { etaCore, bansR, tipLines, nearR, banInfo });
      etaText = composed.html;
      etaTip = composed.title;
      const cx = { dist: distText, eta: etaText, extra: extraCalc(data) };
      distCell.innerHTML = distCellHtml(row, cx);
      etaCell.innerHTML = etaCellHtml(row, cx, composed);
      etaCell.title = etaTip;
      etaCell.classList.remove("muted");
    } else if (data.first_done || data.all_done || (data.extra && data.extra.length)) {
      // v1.79: ① пройдена (или все точки) — ✓ вместо км/ETA, следующие точки как обычно
      distText = data.first_done ? '<span class="done-km">✓</span>' : "—";
      etaText = data.first_done ? '<span class="eta-nb-sp"></span>' + doneEtaHtml(data.first_done) : "—";   // v1.81: ровно с остальными
      const cx = { dist: distText, eta: etaText, extra: extraCalc(data) };
      // v1.82: запреты по пути — кнопка NB/🚫 у первой непройденной точки
      let composed = null;
      const act0 = data.active_idx && data.active_idx.length ? data.active_idx[0] : null;
      if (data.first_done && act0 != null && data.target_lat != null) {
        const et = data.eta_tacho || data.eta_local;
        const wk = data.tacho_weeklimit ? '<span class="wk-mark" title="Недельный лимит вождения кончится по пути">56</span>' : "";
        etaCore = `${wk}<span class="eta-x-t">⏱ ${escapeHtml(et || "—")}</span>`;
        bansR = (data.bans_route || []).slice();
        (data.extra || []).forEach((x, i) => (x.bans_route || []).forEach((b) => bansR.push(`${STOP_NUM[i + 1]}→${STOP_NUM[i + 2]} ${b}`)));
        nearR = banNearLines(data);
        banInfo = banInfoLines(data);
        tipLines = ["Простой ETA: " + (data.eta_local || "—")].concat(data.eta_tacho ? ["⏱ По тахографу: " + data.eta_tacho] : [])
          .concat(data.route_countries && data.route_countries.length > 1 ? ["Страны: " + data.route_countries.join(" → ")] : []);
        Object.assign(cx, { etaCore, bansR, tipLines, nearR, banInfo, nbAt: act0 - 1 });
        composed = composeEta(row, cx);
      }
      anyLate = extrasLate(row, cx.extra);
      const prevC = lastCalcText[id];
      if (prevC && prevC.etaCore && prevC.anyLate === false && anyLate) {
        blinkRows.add(id);
        tr.classList.add("row-blink");
      }
      distCell.innerHTML = distCellHtml(row, cx);
      etaCell.innerHTML = etaCellHtml(row, cx, composed);
      etaCell.title = composed ? composed.title : "";
      etaCell.classList.remove("eta-late");
      distCell.classList.remove("muted");
      etaCell.classList.remove("muted");
    } else {
      distCell.textContent = "—";
      etaCell.textContent = "—";
    }

    // v1.36: страны машины и таргета — для подсветки во вкладке "Запреты"
    window.fleetCountries = window.fleetCountries || {};
    window.fleetCountries[id] = [data.unit_country, (data.target_badge || "").slice(0, 2)].filter(Boolean);

    // v1.31: плашка кода региона таргета (между L/O и полем)
    // v1.40: "+довоз FI/EE" — основная машина везёт до Базы
    const dovoz = data.target_dovoz
      ? `<span class="dovoz-badge" title="Основная машина везёт до Базы, дальше довоз (${escapeHtml(data.target_dovoz)})">+довоз ${escapeHtml(data.target_dovoz)}</span>`
      : "";
    if (data.first_done) {                     // v1.80: у пройденной ① — её код (ESxx)
      data.target_badge = data.first_done.badge; data.target_code_hint = data.first_done.badge_hint; data.target_dovoz = null;
    }
    const targetBadge = data.target_badge
      ? `<span class="target-cc-wrap target-cc"><span class="cc-badge" title="${escapeHtml(data.target_code_hint || data.target_badge)}">${escapeHtml(data.target_badge)}</span>${dovoz}</span>`
      : '<span class="cc-badge target-cc" hidden></span>';
    const oldTb = tr.querySelector(".target-cc");
    if (oldTb) oldTb.outerHTML = targetBadge;

    const fv0 = folded(row) ? foldVisible(row).join() : "";   // v3.11: окно свёрнутых точек до расчёта
    lastCalcText[id] = { status: statusHtml, statusClass: statusClass, dist: distText, eta: etaText, etaTip, targetBadge, late, anyLate, etaCore, bansR, tipLines, nearR, banInfo,
                         etaStr: data.eta_tacho || data.eta_local, extra: extraCalc(data),
                         crew: crewOf(data),
                         doneFlags: (data.points_done || []).map((x) => ({ done: !!x.done, auto: !!x.auto, at: x.at || null, manual: x.manual,
                           by: x.by != null ? x.by : null, zone: x.zone || null })),
                         allDone: !!data.all_done, hereIdx: otMulti ? otIdx : null, fuelLow: fuelLowOf(data),
                         rfAlerts: reeferAlertsOf(data, row),      // v3.34: тревоги рефа (без задержки)
                         // v3.31: для ⏱ калькулятора — км до первой непройденной точки, её номер, данные тахографа
                         ecKm: data.all_done ? null : (data.dist_km != null ? Number(data.dist_km) : null),
                         ecAt: data.active_idx && data.active_idx.length ? data.active_idx[0] : 0,
                         ecSeed: data.calc_seed || null,
                         corridor: data.corridor || null,          // v3.32: плашка коридора ИТ ↔ Бенелюкс
                         nbAt: data.first_done && data.active_idx && data.active_idx.length ? data.active_idx[0] - 1 : null };
    applyDoneClasses(tr, row, lastCalcText[id]);
    applyFuelBlink(tr, id);
    applyReeferBlink(tr, id);
    const cb = tr.querySelector(".crew-b");     // v3.15: 👤/👥
    if (cb) cb.outerHTML = crewHtml(row, lastCalcText[id]);
    markDeliveryInput(tr, row);   // v3.13: у пройденной ① «дата в прошлом» не показываем
    stripeRow(tr, row);   // v3.10: пройденные точки меняют L/O строки
    // v3.11: пройденные точки сдвинули окно свёрнутой строки — перерисовать
    if (fv0 && foldVisible(row).join() !== fv0) scheduleRender();
    // v1.64: плашки кодов у следующих точек
    (lastCalcText[id].extra || []).forEach((ce, i) => {
      const w = tr.querySelector(`.x-stop[data-k="${i + 1}"]`);
      if (!w) return;
      const old = w.querySelector(".x-cc");
      if (old) old.remove();
      w.querySelector(".xlo-btn").insertAdjacentHTML("afterend", ce.badge
        ? `<span class="cc-badge x-cc" title="${escapeHtml(ce.badgeHint || ce.badge)}">${escapeHtml(ce.badge)}</span>`
        : '<span class="cc-badge x-cc" hidden></span>');   // v3.22: пустое место той же ширины
      const inp = w.querySelector(".xt-input");
      if (inp) inp.title = ce.error || (row.extra[i] && row.extra[i].target) || "";
      if (ce.address && row.extra[i] && !row.extra[i].lo && (ce.address.type === "load" || ce.address.type === "unload")) {
        row.extra[i].lo = ce.address.type === "load" ? "L" : "O";
        saveRows();
        const b = w.querySelector(".xlo-btn");
        b.className = `lo-btn xlo-btn ${loClass(row.extra[i].lo)}`;
        b.textContent = loText(row.extra[i].lo);
        stripeRow(tr, row);
      }
    });

    if (data.unit_lat != null && data.unit_lng != null) {
      // ошибка отрисовки на карте не должна ломать строку таблицы
      try { updateMarker(id, data.unit_lat, data.unit_lng, data.number, data.status, data.direction, data.dist_km, data.is_trailer); }
      catch (err) { console.error("updateMarker", err); }
      try { updateTrailerLink(id, data.unit_lat, data.unit_lng, row.trailer ? data.linked_trailer : null); }
      catch (err) { console.error("updateTrailerLink", err); }
      rowPositions[id] = {
        unitLat: data.unit_lat,
        unitLng: data.unit_lng,
        targetLat: data.target_lat != null ? data.target_lat : null,
        targetLng: data.target_lng != null ? data.target_lng : null,
        polyline: data.route_polyline || null,
        extraPolys: (data.extra || []).map((x) => x.polyline || null),
      };

      // v1.28: таргет из адресной базы — L/O из Type (только если отметка пустая),
      // цвет флажка для port/customs/misc, Open/Notes — подсказкой на поле
      const tInput = tr ? tr.querySelector(".target-input") : null;
      if (data.target_address) {
        const t = data.target_address.type;
        targetTypeByRow[id] = ["port", "customs", "misc"].includes(t) ? t : "";
        if (!row.lo && (t === "load" || t === "unload")) {
          row.lo = t === "load" ? "L" : "O";
          saveRows();
          if (tr) applyLoToRow(tr, row);
        }
        if (tInput) tInput.title = addressTooltip(data.target_address);
      } else {
        delete targetTypeByRow[id];
        if (tInput) tInput.title = row.target || "";
      }

      if (data.first_done) {
        removeTargetMarker(id);            // v1.79: ① пройдена — флажка нет
      } else if (data.target_is_truck && truckInTable(data.target_unit)) {
        // перецеп: цель — машина, которая и так есть в таблице и видна своим маркером
        removeTargetMarker(id);
      } else if (data.target_lat != null && data.target_lng != null) {
        // если машина-цель не в таблице — флажок в её позиции, подпись "→ номер"
        const multi = row.extra && row.extra.length;
        const label = data.target_is_truck ? `${row.unit} → ${data.target_unit}` : row.unit;
        updateTargetMarker(id, data.target_lat, data.target_lng, label, markerKind(row), multi ? 1 : null,
          data.dist_km != null ? fmtKm(data.dist_km) : "");
      } else {
        removeTargetMarker(id);
      }
      // v1.64: флажки следующих точек
      removeExtraTargets(id);
      (data.extra || []).forEach((x, i) => {
        if (x.lat == null || x.lng == null) return;
        const ex = (row.extra || [])[i] || {};
        const kind = ex.lo || (x.target_address && ["port", "customs", "misc"].includes(x.target_address.type) ? x.target_address.type : "");
        updateTargetMarker(id + "_" + (i + 1), x.lat, x.lng, row.unit, kind, i + 2,
          x.leg_km != null ? fmtKm(x.leg_km) : "");   // v1.78: без "+"
      });
    }
  } catch (e) {
    console.error("calcRow", e);
    statusCell.textContent = "Ошибка запроса";
  }
}

// v1.70: рефка прицепа — "❄ 8.9° / 4.5°" (возврат по отсекам), подробности в подсказке
function fmtT(v) { return v == null ? "—" : `${Number(v).toFixed(1).replace(/\.0$/, "")}°`; }
// v3.30: ⛽ тягача — только когда меньше 100 л
function truckFuelHtml(data) {
  const f = data.truck_fuel;
  if (!f || !f.low) return "";
  const tip = [`Топливо тягача: ${f.l} л — мало (< 100 л)`].concat(f.parts && f.parts.length > 1 ? [`баки: ${f.parts.join(" + ")} л`] : []);
  return `<span class="tf-pill" title="${escapeHtml(tip.join("\n"))}">⛽${f.l}</span>`;
}
function reeferPillHtml(data) {
  const r = data.reefer;
  if (!r) return data.reefer_error ? `<span class="rf-pill rf-na" title="${escapeHtml("Рефка: " + data.reefer_error)}">❄ ?</span>` : "";
  const comps = r.compartments || [];
  const on = comps.filter((c) => c.on);
  const lines = [`Реф${r.type ? " " + r.type : ""}`];
  comps.forEach((c) => {
    lines.push(`Отсек ${c.n}: ${c.on ? "вкл" : "выкл"}` + (c.on
      ? ` · уставка ${fmtT(c.set)} · возврат ${fmtT(c.ret)} · подача ${fmtT(c.sup)}` + (c.dev != null ? ` (${c.dev > 0 ? "+" : ""}${c.dev}°)` : "") : "")
      + (c.at ? ` · ${c.at}` : "") + (c.stale ? " · данные старые" : ""));
  });
  if (r.fuel_l != null) lines.push(`Топливо рефа: ${Math.round(r.fuel_l)} л` + (r.fuel_low ? " — мало (< 40 л)" : ""));
  const txt = on.length ? "❄ " + on.map((c) => fmtT(c.ret)).join(" / ") : (comps.length ? "❄ выкл" : "");
  const fuel = r.fuel_l != null ? `<span class="rf-fuel${r.fuel_low ? " rf-fuel-low" : ""}">⛽${Math.round(r.fuel_l)}</span>` : "";
  if (!txt && !fuel) return "";
  const cls = r.warn || r.fuel_low ? "rf-warn" : on.length ? "rf-on" : "rf-off";
  return `<span class="rf-pill ${cls}" title="${escapeHtml(lines.join("\n"))}">${escapeHtml(txt)}${fuel}</span>`;
}
function hitchPillHtml(data, compact) {
  const h = data.hitch;
  if (!h || !h.number) return "";
  const who = data.is_trailer ? "Тягач" : "Прицеп";
  const tip = `${who} ${h.number} — ${h.sure ? "едут вместе" : "стоят рядом (" + Math.round(h.km * 1000) + " м), вероятно сцепка"}\nMapon их не связывает — угадано по координатам`;
  // v1.71: клик — привязать (у тягача: этот прицеп к нему; у прицепа: к этому тягачу)
  if (compact) return `<button class="hitch-ic hitch-link${h.sure ? "" : " hitch-maybe"}" data-trailer="${escapeHtml(h.number)}" title="${escapeHtml(tip + "\nКлик — привязать прицеп к этой машине")}">🔗?</button>`;
  return `<button class="hitch-pill hitch-link${h.sure ? "" : " hitch-maybe"}" data-truck="${escapeHtml(h.number)}" title="${escapeHtml(tip + "\nКлик — привязать к тягачу")}">🔗 к ${escapeHtml(h.number)}${h.sure ? "" : "?"}</button>`;
}
// v1.71: привязанный прицеп во второй строке Статуса тягача
function linkedTrailerHtml(number, lt) {
  const un = `<button class="trl-unlink" title="Отвязать прицеп (вернётся отдельной строкой)">×</button>`;
  if (!lt) return `<span class="hitch-pill">🔗 ${escapeHtml(number)}</span>${un}`;
  if (lt.error) return `<span class="hitch-pill rf-warn" title="${escapeHtml(lt.error)}">🔗 ${escapeHtml(number)} ?</span>${un}`;
  const far = lt.far ? `<span class="trl-far" title="Прицеп в ${escapeHtml(fmtKm(lt.km))} от тягача — перецепили?">⚠ ${escapeHtml(fmtKm(lt.km))}</span>` : "";
  return `<span class="hitch-pill" title="Привязанный прицеп${lt.km != null ? " · " + fmtKm(lt.km) + " от тягача" : ""}">🔗 ${escapeHtml(lt.number)}</span>${un}${far}${reeferPillHtml(lt)}`;
}

// v1.64: ответ сервера по следующим точкам -> то, что держим в lastCalcText
// ---------- v1.79: пройденные точки ✓ ----------
// row.done = {индекс точки: true|false} — ручные отметки (0 — точка ①); нет ключа — авто по Mapon
// v3.17: авто-✓ запоминаем в строке (по тексту точки) — иначе через 2–4 суток стоянка уходит
// из истории Mapon и точка снова «не пройдена»
function doneSeenArray(row) {
  const m = row.doneSeen || {};
  return [row.target || ""].concat((row.extra || []).map((x) => x.target || "")).map((t) => (t && m[t]) || null);
}
function keepDoneSeen(row, data) {
  const pts = [row.target || ""].concat((row.extra || []).map((x) => x.target || ""));
  const old = row.doneSeen || {};
  const next = {};
  (data.points_done || []).forEach((x, i) => {
    const t = pts[i];
    if (!t) return;
    if (x && x.done && x.auto && x.at) next[t] = x.at;
    else if (old[t] && !(x && x.manual === false)) next[t] = old[t];
  });
  if (JSON.stringify(next) !== JSON.stringify(old)) {
    if (Object.keys(next).length) row.doneSeen = next; else delete row.doneSeen;
    saveRows();
  }
}
function doneManualArray(row) {
  const n = 1 + (row.extra ? row.extra.length : 0);
  const d = row.done || {};
  return Array.from({ length: n }, (_, i) => (d[i] === true || d[i] === false ? d[i] : null));
}
function doneEtaHtml(x) {
  const at = x.done_at || x.at;
  const auto = x.done_auto != null ? x.done_auto : x.auto;
  const by = x.done_by != null ? x.done_by : x.by;
  // v3.29: ✓ по следующей точке — бледный, без времени
  if (by != null) {
    return `<span class="done-eta done-by" title="Пройдена следующая точка ${STOP_NUM[by + 1]} — значит, и эта">✓ по ${STOP_NUM[by + 1]}</span>`;
  }
  const zone = x.done_zone || x.zone;
  const tip = auto ? (zone ? `Трак стоял в зоне Mapon «${zone}» и уехал` : "Трак стоял на точке и уехал") : "Отмечено вручную";
  return `<span class="done-eta" title="${escapeHtml(tip)}">✓ ${escapeHtml(auto && at ? at : "пройдена")}</span>`;
}
// ответ сервера (① и extra — только непройденные) -> по исходным номерам точек
function remapDone(data) {
  const dn = data.points_done;
  if (!dn) return data;
  const act = data.active_idx || [];
  const doneItem = (i) => ({ done: true, done_at: dn[i].at, done_auto: dn[i].auto,
    done_by: dn[i].by != null ? dn[i].by : null, done_zone: dn[i].zone || null,
    badge: dn[i].badge || null, badge_hint: dn[i].badge_hint || null });
  const main = data.target_lat != null ? {
    dist_km: data.dist_km, leg_km: data.dist_km, eta_local: data.eta_local, eta_tacho: data.eta_tacho,
    tacho_weeklimit: data.tacho_weeklimit, badge: data.target_badge, badge_hint: data.target_code_hint,
    lat: data.target_lat, lng: data.target_lng, polyline: null, bans_route: null, from_truck: true,
    target_address: data.target_address,
  } : { error: "нет координат" };
  const activeItems = [main].concat(data.extra || []);
  const byIdx = {};
  act.forEach((idx, j) => { byIdx[idx] = activeItems[j]; });
  data.first_done = dn[0] && dn[0].done ? doneItem(0) : null;
  if (dn.length > 1) {
    data.extra = dn.slice(1).map((x, k) => (x.done ? doneItem(k + 1) : (byIdx[k + 1] || { empty: true })));
  }
  return data;
}
function applyDoneClasses(tr, row, c) {
  if (!tr) return;
  const flags = (c && c.doneFlags) || [];
  tr.classList.toggle("row-done", !!(c && c.allDone));
  // v3.22: все точки пройдены — строка серая и ждёт подтверждения хозяина / назначающего
  const cb = tr.querySelector(".cmpl-btn");
  if (cb) cb.hidden = !(c && c.allDone && window.fleetCanComplete && window.fleetCanComplete(row));
  // v1.81: трак на объекте точки k — её строка бледно-зелёная во всех колонках
  tr.querySelectorAll(".pt-here").forEach((el) => el.classList.remove("pt-here"));
  const h = c && c.hereIdx != null ? c.hereIdx : null;
  if (h != null) {
    const pick = (sel) => tr.querySelector(sel);
    [h === 0 ? pick(".target-wrap:not(.x-stop)") : pick(`.x-stop[data-k="${h}"]`),
     h === 0 ? pick(".delivery-input") : pick(`.xd-input[data-k="${h}"]`),
     tr.querySelectorAll(".dist-cell .sl")[h],
     tr.querySelectorAll(".eta-cell .sl")[h],
     h === 0 ? pick(".note-wrap:not(.xn-wrap)") : pick(`.xn-input[data-k="${h}"]`) && pick(`.xn-input[data-k="${h}"]`).closest(".xn-wrap"),
    ].forEach((el) => { if (el) el.classList.add("pt-here"); });
  }
  tr.querySelectorAll("#fleet-tbody .target-wrap, .target-wrap").forEach((w) => {
    const k = w.classList.contains("x-stop") ? Number(w.dataset.k) : 0;
    const f = flags[k];
    w.classList.toggle("pt-done", !!(f && f.done));
    const chip = w.querySelector(".stop-n");
    if (chip) {
      const m = row.done && (row.done[k] === true || row.done[k] === false) ? row.done[k] : null;
      chip.title = (f && f.done ? (f.by != null ? `Пройдена (по следующей точке ${STOP_NUM[f.by + 1]})`
        : f.auto ? `Пройдена (авто: стоял ${f.zone ? "в зоне «" + f.zone + "»" : "здесь"}, уехал ${f.at})` : "Пройдена (вручную)")
        : (m === false ? "Не пройдена (вручную)" : "Не пройдена"))
        + "\nКлик — " + (m == null ? (f && f.done ? "отметить непройденной" : "отметить пройденной") : "вернуть автоопределение");
      chip.classList.add("stop-n-click");
      chip.classList.toggle("stop-n-manual", m != null);
    }
  });
  applyCorStrip(tr, row, c);   // v3.45
}

// v3.45: плашка коридора — полоска между строками точек того плеча, где действует обход Швейцарии.
// Номер точки, к которой ведёт плечо, отдаёт сервер (corridor.to); ① — полоска над первой строкой.
// Свёрнутый трип — у ближайшей видимой точки. Во всех колонках к строке добавляется отступ (cor-g), полоска рисуется в Таргете.
function corGapIdx(row, c) {
  const to = c && c.corridor ? c.corridor.to : null;
  if (to == null) return -1;
  let i = Math.min(to, row.extra ? row.extra.length : 0);
  if (folded(row)) {
    const fv = foldVisible(row);
    i = i < fv[0] ? fv[0] : (i > fv[1] ? fv[1] : i);
  }
  return i;
}
function applyCorStrip(tr, row, c) {
  tr.querySelectorAll(".cor-strip, .cor-sp").forEach((e) => e.remove());
  tr.querySelectorAll(".cor-g").forEach((e) => e.classList.remove("cor-g"));
  if (window.matchMedia("(max-width: 767px)").matches) return;   // телефон — карточки, без полоски
  const i = corGapIdx(row, c);
  const chip = i < 0 ? "" : corridorChip(row, c);
  if (!chip) return;
  const strip = `<div class="cor-strip">${chip}</div>`;
  if (i === 0) {
    // над первой строкой — пустая полоса сверху у каждой ячейки, в Таргете в ней полоска
    tr.querySelectorAll(":scope > td").forEach((td) => td.insertAdjacentHTML("afterbegin", '<div class="cor-sp"></div>'));
    const tw = tr.querySelector(".target-wrap:not(.x-stop)");
    const sp = tw && tw.closest("td").querySelector(".cor-sp");
    if (sp) { sp.innerHTML = strip; corStripAlign(sp.querySelector(".cor-strip"), tw); }
    return;
  }
  const xn = tr.querySelector(`.xn-input[data-k="${i}"]`);
  [tr.querySelector(`.x-stop[data-k="${i}"]`), tr.querySelector(`.xd-input[data-k="${i}"]`),
   tr.querySelectorAll(".dist-cell .sl")[i], tr.querySelectorAll(".eta-cell .sl")[i], xn && xn.closest(".xn-wrap"),
  ].forEach((el) => { if (el) el.classList.add("cor-g"); });
  const tw = tr.querySelector(`.x-stop[data-k="${i}"]`);
  if (tw) { tw.insertAdjacentHTML("afterbegin", strip); corStripAlign(tw.querySelector(".cor-strip"), tw); }
}
// плашка коридора — по левому краю поля ввода точки
function corStripAlign(el, tw) {
  const inp = tw && tw.querySelector("input");
  if (!el || !inp) return;
  requestAnimationFrame(() => {
    const r = el.getBoundingClientRect(), k = el.offsetWidth ? r.width / el.offsetWidth : 1;
    const pad = (inp.getBoundingClientRect().left - r.left) / (k || 1);
    if (pad > 0) el.style.paddingLeft = pad + "px";
  });
}
function toggleDone(id, k) {
  const row = rows.find((r) => r.id === id);
  if (!row) return;
  const c = lastCalcText[id];
  const f = c && c.doneFlags && c.doneFlags[k];
  row.done = row.done || {};
  if (row.done[k] === true || row.done[k] === false) delete row.done[k];
  else row.done[k] = !(f && f.done);
  saveRows();
  calcRow(id);
}

function extraCalc(data) {
  return (data.extra || []).map((x) => ({
    error: x.error || null,
    done: !!x.done, done_at: x.done_at || null, done_auto: !!x.done_auto, from_truck: !!x.from_truck,
    done_by: x.done_by != null ? x.done_by : null, done_zone: x.done_zone || null,
    dist_km: x.dist_km, leg_km: x.leg_km,
    eta_tacho: x.eta_tacho || null, eta_local: x.eta_local || null,
    tacho_weeklimit: !!x.tacho_weeklimit,
    badge: x.badge || null, badgeHint: x.badge_hint || null,
    address: x.target_address || null,
  }));
}

function calcAllRows(opts) {
  // v3.20: ход обновления на кнопке ↻ — «12/30»
  const todo = rows.filter((r) => r.unit);
  const btns = document.querySelectorAll(".bar-refresh");   // v3.43: верхняя и нижняя панель
  let left = todo.length;
  const show = () => {
    btns.forEach((btn) => {
      btn.textContent = left > 0 ? `↻ ${todo.length - left}/${todo.length}` : "↻";
      btn.classList.toggle("busy", left > 0);
    });
  };
  show();
  const jobs = todo.map((r) => Promise.resolve(calcRow(r.id, opts && opts.auto ? "auto" : "all"))
    .finally(() => { left -= 1; show(); }));
  // v1.53: после "Обновить всё" (и загрузки) — пересортировать по выбранному режиму;
  // v1.59: автообновление строки не переставляет
  const resortAfter = !(opts && opts.auto);
  return Promise.allSettled(jobs).then(() => { if (resortAfter) resort(); });
}

// ---------- v1.59: автообновление Флота; v1.64: период на выбор — выкл / 15 / 30 / 60 мин ----------
let autoRefreshMin = 15;
try {
  const v = localStorage.getItem("fleetAutoMin");
  if (v != null) autoRefreshMin = Number(v) || 0;
  else if (localStorage.getItem("fleetAuto") === "0") autoRefreshMin = 0;   // была снята галочка
} catch (e) { /* ignore */ }
let lastAutoAt = Date.now();
setInterval(() => {
  if (!autoRefreshMin || document.hidden) return;
  if (document.querySelector(".com-ed")) return;                 // не мешать правке комментария
  const a = document.activeElement;
  if (a && a.closest && a.closest("#fleet-tbody") && a.tagName === "INPUT") return;   // идёт ввод
  if (Date.now() - lastAutoAt < autoRefreshMin * 60000 - 5000) return;
  lastAutoAt = Date.now();
  calcAllRows({ auto: true });
}, 30 * 1000);
(function () {
  const sel = document.getElementById("auto-refresh");
  if (!sel) return;
  sel.value = String(autoRefreshMin);
  if (sel.value !== String(autoRefreshMin)) { autoRefreshMin = 15; sel.value = "15"; }
  sel.addEventListener("change", () => {
    autoRefreshMin = Number(sel.value) || 0;
    lastAutoAt = Date.now();
    try { localStorage.setItem("fleetAutoMin", String(autoRefreshMin)); } catch (e) { /* ignore */ }
  });
})();

function moveManual(id, dir) {
  if (sortMode !== "manual") return;
  const i = manualOrder.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= manualOrder.length) return;
  [manualOrder[i], manualOrder[j]] = [manualOrder[j], manualOrder[i]];
  saveSortState();
  displayOrder = manualOrder.slice();
  renderRows();
}

// перетаскивание строк за ⠿ (режим "руками")
(function () {
  const tbody = document.getElementById("fleet-tbody");
  let dragId = null;
  tbody.addEventListener("dragstart", (e) => {
    const h = e.target.closest && e.target.closest(".drag-h");
    if (!h || sortMode !== "manual") { e.preventDefault(); return; }
    dragId = Number(h.closest("tr").dataset.id);
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", String(dragId)); } catch (err) { /* ignore */ }
  });
  tbody.addEventListener("dragover", (e) => {
    if (dragId == null) return;
    const tr = e.target.closest("tr");
    if (!tr) return;
    e.preventDefault();
    tbody.querySelectorAll(".drop-before,.drop-after").forEach((x) => x.classList.remove("drop-before", "drop-after"));
    const r = tr.getBoundingClientRect();
    tr.classList.add(e.clientY < r.top + r.height / 2 ? "drop-before" : "drop-after");
  });
  tbody.addEventListener("drop", (e) => {
    if (dragId == null) return;
    e.preventDefault();
    const tr = e.target.closest("tr");
    tbody.querySelectorAll(".drop-before,.drop-after").forEach((x) => x.classList.remove("drop-before", "drop-after"));
    if (tr) {
      const targetId = Number(tr.dataset.id);
      if (targetId !== dragId) {
        const r = tr.getBoundingClientRect();
        const after = e.clientY >= r.top + r.height / 2;
        manualOrder = manualOrder.filter((x) => x !== dragId);
        let ti = manualOrder.indexOf(targetId);
        manualOrder.splice(after ? ti + 1 : ti, 0, dragId);
        saveSortState();
        displayOrder = manualOrder.slice();
        renderRows();
      }
    }
    dragId = null;
  });
  tbody.addEventListener("dragend", () => {
    dragId = null;
    tbody.querySelectorAll(".drop-before,.drop-after").forEach((x) => x.classList.remove("drop-before", "drop-after"));
  });
})();

// переключатель режима сортировки
// v3.09: панель продублирована под таблицей (#sort-bar-bottom), обе синхронны
// v3.11: «свернуть / развернуть все» переехала в шапку колонки «Таргет»
(function () {
  const top = document.getElementById("sort-bar");
  if (!top) return;
  const bottom = document.createElement("div");
  bottom.id = "sort-bar-bottom";
  bottom.className = "sort-bar sort-bar-bottom";
  // v3.43: нижняя панель — точная копия верхней (три зоны); id снимаем, кнопки «+ строка» / ↻ и автообновление — через верхние
  top.querySelectorAll(".sb-l, .sb-c, .sb-r").forEach((zone) => bottom.appendChild(zone.cloneNode(true)));
  bottom.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
  const m = bottom.querySelector(".m-edit-btn");
  if (m) m.remove();   // «✎ правка» — только на телефоне, у верхней панели
  const topAdd = top.querySelector(".bar-add"), topRef = top.querySelector(".bar-refresh");
  const botAdd = bottom.querySelector(".bar-add"), botRef = bottom.querySelector(".bar-refresh");
  if (botAdd) botAdd.addEventListener("click", () => topAdd.click());
  if (botRef) botRef.addEventListener("click", () => topRef.click());
  const topSel = top.querySelector("select"), botSel = bottom.querySelector("select");
  if (topSel && botSel) {
    botSel.value = topSel.value;
    botSel.addEventListener("change", () => { topSel.value = botSel.value; topSel.dispatchEvent(new Event("change")); });
    topSel.addEventListener("change", () => { botSel.value = topSel.value; });
  }
  const table = document.getElementById("fleet-table");
  if (table) table.after(bottom);
  const bars = [top, bottom];
  // v3.11: «свернуть / развернуть все» — значок ▸/▾ в шапке колонки «Таргет», над построчными ▸
  const fb = document.getElementById("fold-all-btn");
  const anyOpen = () => rows.some((r) => foldable(r) && r.open);
  const mark = () => {
    bars.forEach((bar) => {
      bar.querySelectorAll("button[data-sort]").forEach((b) => b.classList.toggle("on", b.dataset.sort === sortMode));
      bar.querySelectorAll("button[data-flt]").forEach((b) => b.classList.toggle("on", b.dataset.flt === loFilter));
      resolveMine();
      bar.querySelectorAll("button[data-own]").forEach((b) => b.classList.toggle("on",
        b.dataset.own === ownFilter || (ownFilter === "mine" && b.dataset.own === fleetMe())));
      bar.classList.toggle("has-own", !!fleetMe());
    });
    if (fb) {
      const has = rows.some((r) => foldable(r));
      fb.disabled = !has;   // без строк с 3+ точками — бледный
      fb.textContent = has && anyOpen() ? "▾" : "▸";
      fb.title = !has ? "Свернуть / развернуть все: сворачиваются строки с 3 и более точками — сейчас таких нет"
        : anyOpen() ? "Свернуть точки во всех строках" : "Развернуть точки во всех строках";
    }
  };
  window.fleetMarkBar = mark;
  if (fb) fb.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = !anyOpen();
    rows.forEach((r) => { if (foldable(r)) r.open = open; });
    saveRows();
    renderRows();
    mark();
  });
  const onClick = (e) => {
    const o = e.target.closest("button[data-own]");
    if (o) {
      setOwnFilter(o.dataset.own);
      return;
    }
    const f = e.target.closest("button[data-flt]");
    if (f) {
      loFilter = f.dataset.flt;
      try { localStorage.setItem("fleet-lo-filter", loFilter); } catch (err) {}
      mark();
      renderRows();
      return;
    }
    const b = e.target.closest("button[data-sort]");
    if (!b) return;
    if (b.dataset.sort === "manual" && sortMode !== "manual") {
      // руками — стартуем с того порядка, что сейчас на экране
      manualOrder = orderedRows().map((r) => r.id);
    }
    sortMode = b.dataset.sort;
    saveSortState();
    mark();
    resort();
  };
  bars.forEach((bar) => bar.addEventListener("click", onClick));
  // v3.11: выбор одного диспетчера
  const setOwnFilter = (v) => {
    ownFilter = v || "all";
    try { localStorage.setItem("fleet-own-filter", ownFilter); } catch (err) {}
    mark();
    renderRows();
    refreshBadgeLooks();
  };
  fillDispSelects();
  // после каждой перерисовки строк — обновить подпись «свернуть / развернуть все»
  const origRender = renderRows;
  renderRows = function () { origRender.apply(this, arguments); mark(); emptyOwnRow(); applyMyDispLook(); markSelectedRow(); scheduleMapSync(); };
  mark();
})();

// v3.15: фильтр «мои» / диспетчер, а строк с машинами у него нет — подсказка вместо пустой таблицы
function emptyOwnRow() {
  const tbody = document.getElementById("fleet-tbody");
  const old = tbody.querySelector("tr.own-empty");
  if (old) old.remove();
  if (ownFilter === "all" || (ownFilter === "mine" && (!fleetMe() || !meInSheet()))) return;
  if (rows.some((r) => r.unit && rowPassesOwn(r))) return;
  const who = ownFilter === "mine" ? "У тебя пока нет рейсов" : `У ${escapeHtml(dispTag(ownFilter) || dispShort(ownFilter))} пока нет рейсов`;
  const tr = document.createElement("tr");
  tr.className = "own-empty";
  tr.innerHTML = `<td colspan="20">${who} · <button type="button" class="own-empty-all">показать все</button>`
    + ` <button type="button" class="own-empty-add">+ Добавить строку</button></td>`;
  tbody.prepend(tr);
  tr.querySelector(".own-empty-all").addEventListener("click", () => {
    const b = document.querySelector('.own-flt button[data-own="all"]');
    if (b) b.click();
  });
  tr.querySelector(".own-empty-add").addEventListener("click", () => document.getElementById("add-row-btn").click());
}

document.getElementById("add-row-btn").addEventListener("click", () => {
  rows.push(emptyRow());
  saveRows();
  renderRows();
});

document.getElementById("refresh-btn").addEventListener("click", calcAllRows);

// --- Переключение вкладок (Флот / Карты стран / From → To) ---
let routeTabShown = false;
document.querySelectorAll(".main-tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".main-tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    const target = btn.dataset.tab;
    document.querySelectorAll(".tab-panel").forEach((panel) => {
      panel.hidden = panel.id !== `tab-${target}`;
    });

    if (target === "route" && !routeTabShown) {
      routeTabShown = true;
      if (window.googleMapsReady && window.initRouteTab) {
        window.initRouteTab();
      } else {
        window.onGoogleMapsReady = () => { if (window.initRouteTab) window.initRouteTab(); };
      }
    } else if (target === "route" && window.google && window.routeMap) {
      google.maps.event.trigger(window.routeMap, "resize");
      if (window.UnitsLayer) window.UnitsLayer.refreshOnShow();   // v3.38: свежие позиции машин
    }
  });
});

loadRows();
renderRows();
loadUnitsList();
loadAddressList(false);
// v1.37: маленькая ↻ в заголовке таблицы = "Обновить всё"
(function () {
  const top = document.getElementById("refresh-btn-top");
  const main = document.getElementById("refresh-btn");
  if (top && main) top.addEventListener("click", () => main.click());
})();
// v2.00: общий Флот — сначала загрузка с сервера (там же calcAllRows), без сервера — как раньше
if (window.fleetSync) window.fleetSync.start(); else calcAllRows();

// v3.11: диспетчеры из листа
applyDispColors();
loadDispatchers();

// v3.32: плашка коридора — меню выбора; выбор хранится в трипе (общий Флот), строка пересчитывается
document.getElementById("fleet-tbody").addEventListener("click", (e) => {
  const b = e.target.closest(".cor-b");
  if (!b) return;
  e.stopPropagation();
  const id = Number(b.closest("tr").dataset.id);
  const row = rows.find((r) => r.id === id);
  const c = lastCalcText[id];
  if (!row || !c || !c.corridor) return;
  corridorMenu(b, c.corridor, row.corridor || null, (name) => {
    if (name) row.corridor = name; else delete row.corridor;
    saveRows();
    calcRow(id, "edit");
  });
});

// v3.15: 👤/👥 — авто → соло вручную → экипаж вручную → авто; пересчёт строки (тахо-ETA меняется)
document.getElementById("fleet-tbody").addEventListener("click", (e) => {
  const b = e.target.closest(".crew-b");
  if (!b) return;
  e.stopPropagation();
  const id = Number(b.closest("tr").dataset.id);
  const row = rows.find((r) => r.id === id);
  if (!row) return;
  if (!row.crew) row.crew = "solo";
  else if (row.crew === "solo") row.crew = "team";
  else delete row.crew;
  saveRows();
  b.outerHTML = crewHtml(row, lastCalcText[id]);
  calcRow(id, "edit");
});
