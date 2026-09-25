/*
Fleet ETA Tracker — фронтенд
Версия: 1.23 (Таргет может быть номером другой машины — перецеп; подсказки номеров в Таргет).
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
    updateMarker(Number(rowId), p.lat, p.lng, p.label, p.status);
  });
  pendingPositions = {};

  window.googleMapsReady = true;
  if (window.onGoogleMapsReady) window.onGoogleMapsReady();
  (window._gmQueue || []).forEach((fn) => fn());
  window._gmQueue = [];
}

function updateMarker(rowId, lat, lng, label, status) {
  if (lat == null || lng == null) return;
  if (!map) {
    pendingPositions[rowId] = { lat, lng, label, status };
    return;
  }
  const pos = { lat, lng };
  const icon = markerIcon(status);
  if (markers[rowId]) {
    markers[rowId].setPosition(pos);
    markers[rowId].setLabel(labelOpts(label, status));
    markers[rowId].setIcon(icon);
  } else {
    markers[rowId] = new google.maps.Marker({
      position: pos,
      map: map,
      icon: icon,
      label: labelOpts(label, status),
      title: label,
    });
    markers[rowId].addListener("click", () => {
      map.panTo(pos);
      map.setZoom(9);
    });
  }
}

function markerIcon(status) {
  const fill = status === "driving" ? "#1D9E75" : "#E24B4A"; // едет — зелёный, стоит — красный
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26">
    <circle cx="13" cy="13" r="10" fill="${fill}" stroke="white" stroke-width="2"/>
  </svg>`;
  return {
    url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
    scaledSize: new google.maps.Size(26, 26),
    anchor: new google.maps.Point(13, 13),
    labelOrigin: new google.maps.Point(13, -8),
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
};

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

function updateTargetMarker(rowId, lat, lng, label, lo) {
  if (lat == null || lng == null) return;
  if (!map) return; // таргет-маркер не критичен при ранней загрузке, пропускаем
  const pos = { lat, lng };
  if (targetMarkers[rowId]) {
    targetMarkers[rowId].setPosition(pos);
    targetMarkers[rowId].setLabel(targetLabel(label, lo));
    targetMarkers[rowId].setIcon(flagIcon(lo));
  } else {
    targetMarkers[rowId] = new google.maps.Marker({
      position: pos,
      map: map,
      icon: flagIcon(lo),
      label: targetLabel(label, lo),
      title: `Таргет: ${label || ""}`,
    });
  }
}

// Перекрасить уже стоящий флажок без пересчёта маршрута (после клика по L/O)
function recolorTargetMarker(rowId, label, lo) {
  const m = targetMarkers[rowId];
  if (!m) return;
  m.setIcon(flagIcon(lo));
  m.setLabel(targetLabel(label, lo));
}

function removeTargetMarker(rowId) {
  if (targetMarkers[rowId]) {
    targetMarkers[rowId].setMap(null);
    delete targetMarkers[rowId];
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
    }
  } catch (e) {
    console.error("Не удалось загрузить список машин", e);
  }
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
          <input list="units-list" class="target-input" name="target-${row.id}" autocomplete="off" value="${escapeHtml(row.target)}" placeholder="ГПС, город, код или машина" />
        </div>
      </td>
      <td><input class="delivery-input" name="delivery-${row.id}" autocomplete="off" value="${escapeHtml(row.delivery)}" placeholder="${deliveryPlaceholder(row.lo)}" /></td>
      <td class="dist-cell ${distMuted}" style="text-align:right">${distHtml}</td>
      <td class="eta-cell ${etaMuted}">${etaHtml}</td>
      <td><input class="note-input" name="note-${row.id}" autocomplete="off" value="${escapeHtml(row.note)}" placeholder="примечание" /></td>
      <td class="row-actions">
        <button class="refresh-row-btn" title="Обновить строку">↻</button>
        <button class="add-btn" title="Добавить строку">+</button>
        <button class="del-btn" title="Удалить строку">✕</button>
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
      updateRowField(id, "delivery", e.target.value);
    });
    tr.querySelector(".note-input").addEventListener("change", (e) => {
      updateRowField(id, "note", e.target.value);
    });

    tr.querySelector(".lo-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      const row = rows.find((r) => r.id === id);
      if (!row) return;
      row.lo = LO_CYCLE[row.lo || ""];
      saveRows();
      const btn = e.currentTarget;
      btn.className = `lo-btn ${loClass(row.lo)}`;
      btn.textContent = loText(row.lo);
      btn.title = loTitle(row.lo);
      tr.querySelector(".delivery-input").placeholder = deliveryPlaceholder(row.lo);
      tr.classList.remove("lo-row-L", "lo-row-O");
      if (row.lo) tr.classList.add(`lo-row-${row.lo}`);
      recolorTargetMarker(id, row.unit, row.lo);
    });

    tr.querySelector(".refresh-row-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      calcRow(id);
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

    const statusLine1 = escapeHtml(data.status_ru + " " + data.duration_str);
    const statusLine2 = data.status === "driving" && data.speed != null
      ? escapeHtml(`${Math.round(data.speed)} км/ч`)
      : "";
    // Каждая строка статуса — в своём nowrap-блоке: максимум две строки
    const statusHtml = statusLine2
      ? `<div class="status-line">${statusLine1}</div><div class="status-line">${statusLine2}</div>`
      : `<div class="status-line">${statusLine1}</div>`;
    const statusClass = data.status === "driving" ? "status-driving" : "status-standing";

    statusCell.innerHTML = statusHtml;
    statusCell.className = `status-cell ${statusClass}`;

    let distText = "—";
    let etaText = "—";
    if (data.dist_km != null) {
      distText = data.dist_km.toFixed(1);
      distCell.textContent = distText;
      distCell.classList.remove("muted");
      etaText = data.eta_local;
      etaCell.textContent = etaText;
      etaCell.classList.remove("muted");
    } else {
      distCell.textContent = "—";
      etaCell.textContent = "—";
    }

    lastCalcText[id] = { status: statusHtml, statusClass: statusClass, dist: distText, eta: etaText };

    if (data.unit_lat != null && data.unit_lng != null) {
      updateMarker(id, data.unit_lat, data.unit_lng, data.number, data.status);
      rowPositions[id] = {
        unitLat: data.unit_lat,
        unitLng: data.unit_lng,
        targetLat: data.target_lat != null ? data.target_lat : null,
        targetLng: data.target_lng != null ? data.target_lng : null,
        polyline: data.route_polyline || null,
      };

      if (data.target_is_truck && truckInTable(data.target_unit)) {
        // перецеп: цель — машина, которая и так есть в таблице и видна своим маркером
        removeTargetMarker(id);
      } else if (data.target_lat != null && data.target_lng != null) {
        // если машина-цель не в таблице — флажок в её позиции, подпись "→ номер"
        const label = data.target_is_truck ? `${row.unit} → ${data.target_unit}` : row.unit;
        updateTargetMarker(id, data.target_lat, data.target_lng, label, row.lo);
      } else {
        removeTargetMarker(id);
      }
    }
  } catch (e) {
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
calcAllRows();
