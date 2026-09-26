/*
Fleet ETA Tracker — фронтенд
Версия: 1.45 (🚫 в ETA — полный запрет по пути).
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
window.whenGoogleMaps = function (fn) {
  if (window.googleMapsReady) fn();
  else (window._gmQueue = window._gmQueue || []).push(fn);
};

function initMap() {
  map = new google.maps.Map(document.getElementById("map"), {
    center: { lat: 50.5, lng: 10.0 }, // примерно центр Европы
    zoom: 4,
  });

  Object.keys(pendingPositions).forEach((rowId) => {
    const p = pendingPositions[rowId];
    updateMarker(Number(rowId), p.lat, p.lng, p.label, p.status, p.heading);
  });
  pendingPositions = {};

  window.googleMapsReady = true;
  if (window.onGoogleMapsReady) window.onGoogleMapsReady();
  (window._gmQueue || []).forEach((fn) => fn());
  window._gmQueue = [];
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
        this.draw();
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

function truckBadgeHtml(label, status, heading) {
  const arrow = status === "driving" && heading != null
    ? `<span class="mk-arrow" style="transform: rotate(${Math.round(heading)}deg)">↑</span>` : "";
  return `${escapeHtml(label || "")}${arrow}`;
}

function updateMarker(rowId, lat, lng, label, status, heading) {
  if (lat == null || lng == null) return;
  if (!map) {
    pendingPositions[rowId] = { lat, lng, label, status, heading };
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
  const icon = markerIcon(status);
  if (markers[rowId]) {
    markers[rowId].setPosition(pos);
    markers[rowId].setIcon(icon);
    markers[rowId].setTitle(label || "");
  } else {
    markers[rowId] = new google.maps.Marker({ position: pos, map: map, icon: icon, title: label, zIndex: 20 });
    markers[rowId].addListener("click", () => { map.panTo(markers[rowId].getPosition()); map.setZoom(9); });
  }
  const cls = `mk-badge ${status === "driving" ? "mk-driving" : "mk-standing"}`;
  const html = truckBadgeHtml(label, status, heading);
  if (truckBadges[rowId]) truckBadges[rowId].update(new google.maps.LatLng(lat, lng), html, cls);
  else truckBadges[rowId] = makeBadge(lat, lng, html, cls, 11, () => { map.panTo(pos); map.setZoom(9); });
}

function markerIcon(status) {
  // v1.30: маленькая точка в позиции машины; номер — на плашке над ней
  const fill = status === "driving" ? "#1D9E75" : "#E24B4A"; // едет — зелёный, стоит — красный
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14">
    <circle cx="7" cy="7" r="5" fill="${fill}" stroke="white" stroke-width="2"/>
  </svg>`;
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
function targetBadgeParts(label, lo) {
  const c = targetColors(lo);
  const text = String(label || "").includes("→") ? label : `→ ${label || ""}`;
  return {
    html: `<span style="color:${c.label}">${escapeHtml(text)}</span>`,
    cls: "mk-tbadge",
    border: c.fill,
  };
}

function setTargetBadge(rowId, lat, lng, label, lo) {
  const t = targetBadgeParts(label, lo);
  if (targetBadges[rowId]) targetBadges[rowId].update(new google.maps.LatLng(lat, lng), t.html, t.cls);
  else targetBadges[rowId] = makeBadge(lat, lng, t.html, t.cls, 34, null);
  const b = targetBadges[rowId];
  const applyBorder = () => { if (b.div) b.div.style.borderColor = t.border; };
  applyBorder();
  setTimeout(applyBorder, 0); // div создаётся в onAdd — после setMap
}

function updateTargetMarker(rowId, lat, lng, label, lo) {
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
  setTargetBadge(rowId, lat, lng, label, lo);
}

// Перекрасить уже стоящий флажок без пересчёта маршрута (после клика по L/O)
function recolorTargetMarker(rowId, label, lo) {
  const m = targetMarkers[rowId];
  if (!m) return;
  m.setIcon(flagIcon(lo));
  const p = m.getPosition();
  setTargetBadge(rowId, p.lat(), p.lng(), m._label || label, lo);
}

function removeTargetMarker(rowId) {
  if (targetMarkers[rowId]) {
    targetMarkers[rowId].setMap(null);
    delete targetMarkers[rowId];
  }
  if (targetBadges[rowId]) {
    targetBadges[rowId].setMap(null);
    delete targetBadges[rowId];
  }
}

function drawRoute(rowId) {
  const pos = rowPositions[rowId];

  if (routePolyline) {
    routePolyline.setMap(null);
    routePolyline = null;
  }

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
  map.fitBounds(bounds, 40);
}

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
}

function emptyRow() {
  return { id: rowIdCounter++, unit: "", lo: "", target: "", delivery: "", note: "" };
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
        datalist.appendChild(opt);
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
    o.label = "машина";
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
  tr.classList.remove("lo-row-L", "lo-row-O");
  if (row.lo) tr.classList.add(`lo-row-${row.lo}`);
  recolorTargetMarker(row.id, row.unit, markerKind(row));
}

function renderRows() {
  const tbody = document.getElementById("fleet-tbody");
  tbody.innerHTML = "";
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    tr.dataset.id = row.id;
    if (row.lo) tr.classList.add(`lo-row-${row.lo}`);
    const cached = lastCalcText[row.id];
    const statusHtml = cached ? cached.status : "—";
    const statusClass = cached ? cached.statusClass : "muted";
    const distHtml = cached ? cached.dist : "—";
    const distMuted = cached ? "" : "muted";
    const etaHtml = cached ? cached.eta : "—";
    const etaMuted = cached ? "" : "muted";
    tr.innerHTML = `
      <td><input list="units-list" class="unit-input" name="unit-${row.id}" autocomplete="off" value="${escapeHtml(row.unit)}" placeholder="номер" /></td>
      <td class="status-cell ${statusClass}">${statusHtml}</td>
      <td>
        <div class="target-wrap">
          <button class="lo-btn ${loClass(row.lo)}" title="${loTitle(row.lo)}">${loText(row.lo)}</button>
          ${cached && cached.targetBadge ? cached.targetBadge : '<span class="cc-badge target-cc" hidden></span>'}
          <input list="points-list" class="target-input" name="target-${row.id}" autocomplete="off" value="${escapeHtml(row.target)}" title="${escapeHtml(row.target)}" placeholder="ГПС, город, код или машина" />
        </div>
      </td>
      <td><input class="delivery-input" name="delivery-${row.id}" autocomplete="off" value="${escapeHtml(row.delivery)}" title="${escapeHtml(row.delivery)}" placeholder="${deliveryPlaceholder(row.lo)}" /></td>
      <td class="dist-cell ${distMuted}" style="text-align:right">${distHtml}</td>
      <td class="eta-cell ${etaMuted}${cached && cached.late ? " eta-late" : ""}" title="${escapeHtml(cached && cached.etaTip ? cached.etaTip : "")}">${etaHtml}</td>
      <td><input class="note-input" name="note-${row.id}" autocomplete="off" value="${escapeHtml(row.note)}" title="${escapeHtml(row.note)}" placeholder="примечание" /></td>
      <td class="row-actions">
        <button class="refresh-row-btn" title="Обновить строку">↻</button>
        <span class="row-menu-wrap">
          <button class="more-btn" title="Ещё">⋯</button>
          <span class="row-menu" hidden>
            <button class="add-btn">+ строка ниже</button>
            <button class="del-btn">✕ удалить строку</button>
          </span>
        </span>
      </td>
    `;
    tbody.appendChild(tr);
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
  if (lo === "O") return "окно доставки";
  return "дата, время";
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
    tr.querySelector(".target-input").addEventListener("change", (e) => {
      updateRowField(id, "target", e.target.value);
    });
    tr.querySelector(".delivery-input").addEventListener("change", (e) => {
      e.target.title = e.target.value;
      updateRowField(id, "delivery", e.target.value);
    });
    tr.querySelector(".note-input").addEventListener("change", (e) => {
      e.target.title = e.target.value;
      updateRowField(id, "note", e.target.value);
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
      menu.style.top = (up ? r.top - 4 - h : r.bottom + 4) + "px";
      menu.style.left = Math.max(8, r.right - w) + "px";
    });

    tr.querySelector(".add-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = rows.findIndex((r) => r.id === id);
      rows.splice(idx + 1, 0, emptyRow());
      saveRows();
      renderRows();
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
      if (e.target.tagName === "INPUT" || e.target.tagName === "BUTTON") return;
      drawRoute(id);
    });
  });
}

function closeRowMenus() {
  document.querySelectorAll("#fleet-tbody .row-menu").forEach((m) => { m.hidden = true; });
}
document.addEventListener("click", closeRowMenus);
let rowMenuOpenedAt = 0;
window.addEventListener("scroll", () => { if (Date.now() - rowMenuOpenedAt > 300) closeRowMenus(); }, true);
window.addEventListener("resize", closeRowMenus);

// v1.43: Delivery (свободный текст) -> Date для сравнения с ETA.
// Понимает "28/09 06.00", "29/09 at 01.30", "27/09 09am", "*Date: 29/09 06.00*", "29/09"
// (без времени — конец дня). Не распознано — null (без подсветки).
function parseDelivery(txt) {
  const d = String(txt || "").match(/(\d{1,2})[\/.](\d{1,2})(?:[\/.]\d{2,4})?(.*)$/);
  if (!d) return null;
  const day = +d[1], mon = +d[2];
  if (day < 1 || day > 31 || mon < 1 || mon > 12) return null;
  let hh = 23, mm = 59;
  const rest = d[3] || "";
  const t = rest.match(/(\d{1,2})[.:](\d{2})/);
  const ap = rest.match(/(\d{1,2})\s*(am|pm)/i);
  if (t) { hh = +t[1]; mm = +t[2]; }
  else if (ap) { hh = (+ap[1] % 12) + (ap[2].toLowerCase() === "pm" ? 12 : 0); mm = 0; }
  return mkDate(day, mon, hh, mm);
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

function updateRowField(id, field, value) {
  const row = rows.find((r) => r.id === id);
  if (row) {
    row[field] = value;
    saveRows();
    calcRow(id);
  }
}

async function calcRow(id) {
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
      body: JSON.stringify({ unit: row.unit, target: row.target }),
    });
    const data = await res.json();

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
    const statusLine1 = ccBadge + icon + escapeHtml(data.duration_str);
    // v1.33: ⏸ — впереди обязательный отдых по тахографу или водитель сейчас отдыхает
    const tachoTip = (data.tacho_summary || []).join("\n");
    const speedTxt = data.status === "driving" && data.speed != null
      ? escapeHtml(`${Math.round(data.speed)} км/ч`) : "";
    const extra = speedTxt ? `<span class="st-speed"> · ${speedTxt}</span>` : "";
    const pauseIc = (data.tacho_rest_ahead || data.tacho_resting_now)
      ? `<span class="tacho-pause" title="${escapeHtml(tachoTip)}"></span>` : "";
    const statusHtml = `<div class="status-line" title="${escapeHtml(data.status_ru + " " + data.duration_str + (tachoTip ? "\n" + tachoTip : ""))}">${statusLine1}${extra}${pauseIc}</div>`;
    const statusClass = data.status === "driving" ? "status-driving" : "status-standing";

    statusCell.innerHTML = statusHtml;
    statusCell.className = `status-cell ${statusClass}`;

    let distText = "—";
    let etaText = "—";
    let etaTip = "";
    let late = false;
    if (data.dist_km != null) {
      distText = data.dist_km.toFixed(1);
      distCell.textContent = distText;
      distCell.classList.remove("muted");
      // v1.33: две строки — простой ETA и ⏱ по тахографу; подробности в подсказке
      const tip = ["Простой ETA: км ÷ 70, без остановок"]
        .concat(data.eta_tacho ? ["⏱ По тахографу: " + data.eta_tacho].concat(data.tacho_summary || []) : [])
        .concat(data.tacho_error ? ["Тахограф: " + data.tacho_error] : []);
      // v1.43: одна строка — ⏱ по тахографу крупно, простой мелко серым
      etaText = data.eta_tacho
        ? `<span class="eta-tacho">⏱ ${escapeHtml(data.eta_tacho)}</span><span class="eta-simple">${escapeHtml(data.eta_local)}</span>`
        : `<span class="eta-tacho eta-only">${escapeHtml(data.eta_local)}</span>`;
      // v1.45: 🚫 — вождение попадает под полный запрет (только предупреждение)
      const bansR = data.bans_route || [];
      if (bansR.length) {
        etaText = `<span class="ban-mark" title="${escapeHtml("Запрет по пути:\n" + bansR.join("\n"))}">🚫</span>` + etaText;
        tip.push("🚫 Запрет по пути (ETA не сдвинут):", ...bansR);
      }
      etaCell.innerHTML = etaText;
      const delD = parseDelivery(row.delivery);
      const etaD = parseEta(data.eta_tacho || data.eta_local);
      late = !!(delD && etaD && etaD > delD);
      etaCell.classList.toggle("eta-late", late);
      if (late) tip.unshift("Позже Delivery (" + row.delivery + ")");
      etaTip = tip.join("\n");
      etaCell.title = etaTip;
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
    const targetBadge = data.target_badge
      ? `<span class="target-cc-wrap target-cc"><span class="cc-badge" title="${escapeHtml(data.target_code_hint || data.target_badge)}">${escapeHtml(data.target_badge)}</span>${dovoz}</span>`
      : '<span class="cc-badge target-cc" hidden></span>';
    const oldTb = tr.querySelector(".target-cc");
    if (oldTb) oldTb.outerHTML = targetBadge;

    lastCalcText[id] = { status: statusHtml, statusClass: statusClass, dist: distText, eta: etaText, etaTip, targetBadge, late };

    if (data.unit_lat != null && data.unit_lng != null) {
      // ошибка отрисовки на карте не должна ломать строку таблицы
      try { updateMarker(id, data.unit_lat, data.unit_lng, data.number, data.status, data.direction); }
      catch (err) { console.error("updateMarker", err); }
      rowPositions[id] = {
        unitLat: data.unit_lat,
        unitLng: data.unit_lng,
        targetLat: data.target_lat != null ? data.target_lat : null,
        targetLng: data.target_lng != null ? data.target_lng : null,
        polyline: data.route_polyline || null,
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

      if (data.target_is_truck && truckInTable(data.target_unit)) {
        // перецеп: цель — машина, которая и так есть в таблице и видна своим маркером
        removeTargetMarker(id);
      } else if (data.target_lat != null && data.target_lng != null) {
        // если машина-цель не в таблице — флажок в её позиции, подпись "→ номер"
        const label = data.target_is_truck ? `${row.unit} → ${data.target_unit}` : row.unit;
        updateTargetMarker(id, data.target_lat, data.target_lng, label, markerKind(row));
      } else {
        removeTargetMarker(id);
      }
    }
  } catch (e) {
    console.error("calcRow", e);
    statusCell.textContent = "Ошибка запроса";
  }
}

function calcAllRows() {
  rows.forEach((r) => {
    if (r.unit) calcRow(r.id);
  });
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
calcAllRows();
