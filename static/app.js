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
window.whenGoogleMaps = function (fn) {
  if (window.googleMapsReady) fn();
  else (window._gmQueue = window._gmQueue || []).push(fn);
};

function initMap() {
  map = new google.maps.Map(document.getElementById("map"), {
    center: { lat: 50.5, lng: 10.0 }, // примерно центр Европы
    zoom: 4,
    // v1.66: + / − справа сверху под ⛶ — низ карты часто за экраном
    // v1.67: новый "джойстик" Google (cameraControl) убираем, обычные + / − — справа сверху
    cameraControl: false,
    zoomControl: true,
    zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_TOP },
  });

  Object.keys(pendingPositions).forEach((rowId) => {
    const p = pendingPositions[rowId];
    updateMarker(Number(rowId), p.lat, p.lng, p.label, p.status, p.heading, p.km, p.trailer);
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
  const icon = markerIcon(status, trailer);
  if (markers[rowId]) {
    markers[rowId].setPosition(pos);
    markers[rowId].setIcon(icon);
    markers[rowId].setTitle(label || "");
  } else {
    markers[rowId] = new google.maps.Marker({ position: pos, map: map, icon: icon, title: label, zIndex: 20 });
    markers[rowId].addListener("click", () => { map.panTo(markers[rowId].getPosition()); map.setZoom(9); });
  }
  const cls = `mk-badge ${status === "driving" ? "mk-driving" : "mk-standing"}${trailer ? " mk-trailer" : ""}`;
  const html = truckBadgeHtml(label, status, heading, km);
  if (truckBadges[rowId]) truckBadges[rowId].update(new google.maps.LatLng(lat, lng), html, cls);
  else truckBadges[rowId] = makeBadge(lat, lng, html, cls, 11, () => { map.panTo(pos); map.setZoom(9); });
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
  removeTrailerLink(rowId);
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
  const badge = makeBadge(lt.lat, lt.lng, escapeHtml(lt.number), cls, 11, () => { map.panTo(pos); map.setZoom(9); });
  const line = new google.maps.Polyline({
    path: [{ lat: tLat, lng: tLng }, pos], map, strokeOpacity: 0, zIndex: 5,
    icons: [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 0.8, strokeColor: "#7b4fc0", scale: 3 }, offset: "0", repeat: "12px" }],
  });
  trailerLinks[rowId] = { marker, badge, line };
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
const STOP_NUM = ["", "①", "②", "③", "④", "⑤", "⑥", "⑦"];
let routeExtraLines = [];

function drawRoute(rowId) {
  const pos = rowPositions[rowId];

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
  tr.classList.remove("lo-row-L", "lo-row-O");
  if (row.lo) tr.classList.add(`lo-row-${row.lo}`);
  recolorTargetMarker(row.id, row.unit, markerKind(row));
}

// ---------- v1.53: сортировка Флота ----------
// added — как добавляли; LO / OL — погрузки/выгрузки первыми, внутри по срочности;
// manual — руками (перетаскивание ⠿, на телефоне ↑/↓ в меню ⋯). Строки без L/O — в конце.
// Пересортировка только при загрузке, "Обновить всё" и смене режима — не при автообновлении.
let sortMode = "added";
let manualOrder = [];
try {
  sortMode = localStorage.getItem("fleetSort") || "added";
  manualOrder = JSON.parse(localStorage.getItem("fleetManualOrder") || "[]");
} catch (e) { /* без localStorage — порядок по умолчанию */ }
let displayOrder = null;   // зафиксированный порядок id между пересортировками

function saveSortState() {
  try {
    localStorage.setItem("fleetSort", sortMode);
    localStorage.setItem("fleetManualOrder", JSON.stringify(manualOrder));
  } catch (e) { /* ignore */ }
}

function urgencyKey(row) {
  // v1.55: [0, …] — опаздывающие (ETA позже конца окна), по Delivery;
  // [1, начало окна Delivery (или срок)] — остальные по Delivery, раньше — выше;
  // [2, ETA] — без распознанной даты Delivery.
  const c = lastCalcText[row.id];
  const w = parseDeliveryWindow(row.delivery);
  const etaD = c && c.etaStr ? parseEta(c.etaStr) : null;
  const dKey = w ? (w.start || w.end) : null;
  if (dKey && w.end && etaD && etaD > w.end) return [0, dKey.getTime()];
  if (dKey) return [1, dKey.getTime()];
  return [2, etaD ? etaD.getTime() : Infinity];
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
      const ra = a.lo in rank ? rank[a.lo] : 2, rb = b.lo in rank ? rank[b.lo] : 2;
      if (ra !== rb) return ra - rb;
      if (ra === 2) return idx.get(a.id) - idx.get(b.id);
      const ka = urgencyKey(a), kb = urgencyKey(b);
      if (ka[0] !== kb[0]) return ka[0] - kb[0];
      if (ka[1] !== kb[1]) return ka[1] < kb[1] ? -1 : 1;
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

function renderRows() {
  const tbody = document.getElementById("fleet-tbody");
  tbody.innerHTML = "";
  document.body.classList.toggle("sort-manual", sortMode === "manual");
  orderedRows().forEach((row) => {
    const tr = document.createElement("tr");
    tr.dataset.id = row.id;
    if (row.lo) tr.classList.add(`lo-row-${row.lo}`);
    const multi = !!(row.extra && row.extra.length);
    if (multi) tr.classList.add("multi");
    const cached = lastCalcText[row.id];
    const statusHtml = cached ? cached.status : "—";
    const statusClass = cached ? cached.statusClass : "muted";
    const distHtml = cached ? distCellHtml(row, cached) : "—";
    const distMuted = cached ? "" : "muted";
    const composedEta = cached && cached.etaCore ? composeEta(row, cached) : null;
    const etaHtml = composedEta ? etaCellHtml(row, cached, composedEta) : (cached ? cached.eta : "—");
    const etaMuted = cached ? "" : "muted";
    tr.innerHTML = `
      <td><span class="drag-h" draggable="true" title="Перетащить строку">⠿</span><input list="units-list" class="unit-input" name="unit-${row.id}" autocomplete="off" value="${escapeHtml(row.unit)}" placeholder="номер" /></td>
      <td class="status-cell ${statusClass}">${statusHtml}</td>
      <td>
        <div class="target-wrap">
          ${multi ? `${foldable(row) ? `<span class="lead"><button class="fold-t" title="${row.open ? "Свернуть точки" : escapeHtml(foldTitle(row, cached))}">${row.open ? "▾" : "▸"}</button></span>` : ""}<span class="stop-n">①</span>` : ""}
          <button class="lo-btn ${loClass(row.lo)}" title="${loTitle(row.lo)}">${loText(row.lo)}</button>
          ${cached && cached.targetBadge ? cached.targetBadge : '<span class="cc-badge target-cc" hidden></span>'}
          <input list="points-list" class="target-input" name="target-${row.id}" autocomplete="off" value="${escapeHtml(row.target)}" title="${escapeHtml(row.target)}" placeholder="ГПС, город, код или машина" />
          ${multi ? '<button class="stop-x" data-k="0" title="Убрать эту точку">×</button><span class="add-stop-sp"></span>' : '<button class="add-stop" title="Добавить ещё таргет (следующая выгрузка / погрузка)">+</button>'}
        </div>
        ${extraTargetsHtml(row, cached)}
      </td>
      <td class="delivery-td"><input class="delivery-input" name="delivery-${row.id}" autocomplete="off" value="${escapeHtml(row.delivery)}" title="${escapeHtml(row.delivery)}" placeholder="${deliveryPlaceholder(row.lo)}" />${(row.extra || []).map((x, i) =>
        `<input class="xd-input${folded(row) && i >= 1 ? " fold-hide" : ""}" data-k="${i + 1}" name="delivery-${row.id}-${i + 1}" autocomplete="off" value="${escapeHtml(x.delivery)}" title="${escapeHtml(x.delivery)}" placeholder="${deliveryPlaceholder(x.lo)}" />`).join("")}</td>
      <td class="dist-cell ${distMuted}" style="text-align:right">${distHtml}</td>
      <td class="eta-cell ${etaMuted}${cached && cached.late ? " eta-late" : ""}" title="${escapeHtml(composedEta ? composedEta.title : (cached && cached.etaTip ? cached.etaTip : ""))}">${etaHtml}</td>
      <td class="note-cell"><div class="note-wrap"><input class="note-input" name="note-${row.id}" autocomplete="off" value="${escapeHtml(row.note)}" title="${escapeHtml(row.note)}" placeholder="примечание" />${row.com ? '<span class="com-tri" title="Комментарий"></span>' : ""}<button class="com-ic${row.com ? " has" : ""}" title="${row.com ? "Комментарий — клик, чтобы изменить" : "Добавить комментарий"}">${COM_SVG(!!row.com)}</button></div></td>
      <td class="row-actions">
        <button class="refresh-row-btn" title="Обновить строку">↻</button>
        <span class="wide-acts">
          <button class="add-btn-w" title="Добавить строку ниже">+</button>
          <button class="trl-btn-w" title="Сцепка: у тягача — привязать прицеп, у прицепа — привязать к тягачу">🔗</button>
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
            <button class="del-btn">✕ удалить строку</button>
          </span>
        </span>
      </td>
    `;
    if (blinkRows.has(row.id)) tr.classList.add("row-blink");
    tbody.appendChild(tr);
    markDeliveryInput(tr, row);
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

    tr.querySelector(".add-btn-w").addEventListener("click", (e) => { e.stopPropagation(); tr.querySelector(".add-btn").click(); });
    tr.querySelector(".mv-up-w").addEventListener("click", (e) => { e.stopPropagation(); moveManual(id, -1); });
    tr.querySelector(".mv-down-w").addEventListener("click", (e) => { e.stopPropagation(); moveManual(id, 1); });
    // v1.66: удаление в два клика — первый "взводит", уход мыши сбрасывает
    const delW = tr.querySelector(".del-btn-w");
    delW.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!delW.classList.contains("armed")) {
        delW.classList.add("armed");
        delW.textContent = "удалить?";
        return;
      }
      tr.querySelector(".del-btn").click();
    });
    delW.addEventListener("mouseleave", () => { delW.classList.remove("armed"); delW.textContent = "🗑"; });

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

    tr.querySelector(".com-ic").addEventListener("click", (e) => {
      e.stopPropagation();
      closeRowMenus();
      openComEditor(id, e.currentTarget);
    });

    // v1.64: несколько таргетов в строке
    const addStop = tr.querySelector(".add-stop");
    if (addStop) addStop.addEventListener("click", (e) => {
      e.stopPropagation();
      const row = rows.find((r) => r.id === id);
      if (!row) return;
      row.extra = (row.extra || []).concat([{ lo: "", target: "", delivery: "" }]);
      row.open = true;
      saveRows();
      renderRows();
      const inp = document.querySelector(`#fleet-tbody tr[data-id="${id}"] .xt-input[data-k="${row.extra.length}"]`);
      if (inp) inp.focus();
    });
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
      saveRows();
      calcRow(id);
    }));
    tr.querySelectorAll(".xd-input").forEach((inp) => inp.addEventListener("change", (e) => {
      const row = rows.find((r) => r.id === id);
      const x = row && row.extra && row.extra[Number(inp.dataset.k) - 1];
      if (!x) return;
      x.delivery = e.target.value;
      e.target.title = e.target.value;
      saveRows();
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
      recolorTargetMarker(id + "_" + k, row.unit + " " + STOP_NUM[k + 1], x.lo);
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
      if (e.target.tagName === "INPUT" || e.target.tagName === "BUTTON") return;
      if (e.target.closest && e.target.closest(".com-tri")) return;
      drawRoute(id);
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
      ? `<span class="cc-badge x-cc" title="${escapeHtml(ce.badgeHint || ce.badge)}">${escapeHtml(ce.badge)}</span>` : "";
    const last = k === ex.length;
    const hide = folded(row) && k >= 2 ? " fold-hide" : "";
    return `<div class="target-wrap x-stop${hide}" data-k="${k}">
      ${foldable(row) ? '<span class="lead"></span>' : ""}<span class="stop-n">${STOP_NUM[k + 1]}</span>
      <button class="lo-btn xlo-btn ${loClass(x.lo)}" data-k="${k}" title="${loTitle(x.lo)}">${loText(x.lo)}</button>
      ${badge}
      <input list="points-list" class="xt-input" data-k="${k}" name="target-${row.id}-${k}" autocomplete="off" value="${escapeHtml(x.target)}" title="${escapeHtml(ce && ce.error ? ce.error : x.target)}" placeholder="следующая точка" />
      <button class="stop-x" data-k="${k}" title="Убрать эту точку">×</button>
      ${folded(row) && k === 1
        ? `<button class="fold-more" title="${escapeHtml(foldTitle(row, cached))}">+${row.extra.length - 1}</button>`
        : last ? '<button class="add-stop" title="Добавить ещё таргет">+</button>' : '<span class="add-stop-sp"></span>'}
    </div>`;
  }).join("");
}

// v1.66: 3 и больше точек — по умолчанию свёрнуто: видны ① ②, дальше сводка
function foldable(row) { return !!(row.extra && row.extra.length >= 2); }
function folded(row) { return foldable(row) && !row.open; }
function plTochek(n) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "точка";
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "точки";
  return "точек";
}
function foldTitle(row, cached) {
  const n = row.extra.length - 1;             // скрыто точек
  const lastI = row.extra.length - 1;
  const last = row.extra[lastI];
  const ce = cached && cached.extra && cached.extra[lastI];
  const e = ce && (ce.eta_tacho || ce.eta_local);
  return `Ещё ${n} ${plTochek(n)} — клик, чтобы показать все\nПоследняя ${STOP_NUM[lastI + 2]} ${(ce && ce.badge ? ce.badge + " " : "") + (last.target || "—")}${e ? "\n⏱ " + e : ""}`;
}

function distCellHtml(row, c) {
  if (!row.extra || !row.extra.length) return c.dist;
  const lines = [`<div class="sl">${c.dist}</div>`];
  row.extra.forEach((x, i) => {
    const ce = c.extra && c.extra[i];
    // v1.65: у 2-й и следующих точек — плечо от предыдущей точки, сумма только в подсказке
    const txt = ce && ce.leg_km != null ? ce.leg_km.toFixed(1) : "—";
    const tip = ce && ce.leg_km != null ? `${ce.leg_km.toFixed(1)} км от точки ${STOP_NUM[i + 1]} (от машины всего ${ce.dist_km.toFixed(1)})` : (ce && ce.error) || "";
    lines.push(`<div class="sl${folded(row) && i >= 1 ? " fold-hide" : ""}" title="${escapeHtml(tip)}">${txt}</div>`);
  });
  return lines.join("");
}

function etaCellHtml(row, c, composed) {
  const first = composed ? composed.html : (c.eta || "—");
  if (!row.extra || !row.extra.length) return first;
  const lines = [`<div class="sl">${first}</div>`];
  row.extra.forEach((x, i) => {
    const ce = c.extra && c.extra[i];
    let inner = '<span class="eta-x-t">—</span>';
    let tip = "";
    if (ce && ce.error) {
      inner = `<span class="eta-x-err">${escapeHtml(ce.error)}</span>`;
      tip = ce.error;
    } else if (ce && (ce.eta_tacho || ce.eta_local)) {
      const wk = ce.tacho_weeklimit ? '<span class="wk-mark" title="Недельный лимит вождения кончится по пути">56</span>' : "";
      inner = `${wk}<span class="eta-x-t">⏱ ${escapeHtml(ce.eta_tacho || ce.eta_local)}</span><span class="eta-simple">через ${STOP_NUM[i + 1]}</span>`;
      tip = [`Точка ${STOP_NUM[i + 2]}: ${x.target}`,
             `${ce.leg_km.toFixed(1)} км от точки ${STOP_NUM[i + 1]}, всего ${ce.dist_km.toFixed(1)} км`,
             `+30 мин на каждой точке до неё`,
             ce.eta_tacho ? `⏱ По тахографу: ${ce.eta_tacho}` : "",
             `Простой ETA: ${ce.eta_local}`].filter(Boolean).join("\n");
    }
    lines.push(`<div class="sl${folded(row) && i >= 1 ? " fold-hide" : ""}" title="${escapeHtml(tip)}"><span class="eta-nb-sp"></span>${inner}</div>`);
  });
  return lines.join("");
}

function removeStop(id, k) {
  const row = rows.find((r) => r.id === id);
  if (!row || !row.extra || !row.extra.length) return;
  if (k === 0) {
    const nx = row.extra.shift();
    row.lo = nx.lo || "";
    row.target = nx.target || "";
    row.delivery = nx.delivery || "";
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

// v1.59: Delivery с датой сильно в прошлом (опечатка "27.06" вместо "27.09") — жёлтым
function markDeliveryInput(tr, row) {
  const inp = tr && tr.querySelector(".delivery-input");
  if (!inp || !row) return;
  const w = parseDeliveryWindow(row.delivery);
  const ref = w ? (w.end || w.start) : null;
  const bad = !!(ref && Date.now() - ref.getTime() > 2 * 86400000);
  inp.classList.toggle("del-suspect", bad);
  inp.title = bad ? `${row.delivery}\n⚠ Дата в прошлом — проверь (опечатка?)` : (row.delivery || "");
}

// v1.48: NoBan — кнопка в начале ETA. 🚫 (розовая) — полный запрет по пути, клик → NoBan;
// NB (зелёная) — NoBan включён, запреты не показываем; ⊘ (бледная) — запретов нет.
function composeEta(row, c) {
  const bans = c.bansR || [];
  let btn;
  if (row.noban) {
    btn = `<button class="eta-nb nb-on" title="NoBan включён — запреты по пути не показываются. Клик — выключить">NB</button>`;
  } else if (bans.length) {
    btn = `<button class="eta-nb nb-ban" title="${escapeHtml("Запрет по пути:\n" + bans.join("\n") + "\nКлик — NoBan (груз без запретов)")}">🚫</button>`;
  } else {
    btn = `<button class="eta-nb" title="Запретов по пути нет. Клик — NoBan">⊘</button>`;
  }
  const tip = (c.tipLines || []).slice();
  if (bans.length) {
    tip.push(row.noban ? "NoBan — запреты по пути скрыты:" : "🚫 Запрет по пути (ETA не сдвинут):", ...bans);
  } else if (row.noban) {
    tip.push("NoBan включён");
  }
  return { html: btn + (c.etaCore || ""), title: tip.join("\n") };
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
  row.noban = !row.noban;
  saveRows();
  if (c && c.etaCore) {
    const composed = composeEta(row, c);
    const cell = tr.querySelector(".eta-cell");
    cell.innerHTML = etaCellHtml(row, c, composed);
    cell.title = composed.title;
    c.eta = composed.html;
    c.etaTip = composed.title;
  }
});

// ---------- v1.56: комментарий строки (как заметка в Google Таблицах) ----------
// Жёлтый уголок у Примечания; наведение — всплывает текст; клик по уголку/окошку или
// ⋯ → "📝 Комментарий" — правка. Клик мимо / "Готово" — сохранить, Esc — отмена.
let comPop = null, comEd = null, comHideT = null;

function placeFloat(el, anchor, dx) {
  const a = anchor.getBoundingClientRect();
  const w = el.offsetWidth, h = el.offsetHeight;
  el.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, a.right - w + (dx || 0))) + "px";
  el.style.top = (a.bottom + 6 + h < window.innerHeight ? a.bottom + 6 : Math.max(8, a.top - 6 - h)) + "px";
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
  if (!row || !row.com) return;
  comPop = document.createElement("div");
  comPop.className = "com-pop";
  comPop.innerHTML = `<div class="com-hd">${escapeHtml(row.unit || "")} · комментарий — клик, чтобы изменить</div>${escapeHtml(row.com)}`;
  document.body.appendChild(comPop);
  placeFloat(comPop, tri, 6);
  comPop.addEventListener("mouseenter", () => clearTimeout(comHideT));
  comPop.addEventListener("mouseleave", () => { comHideT = setTimeout(hideComPop, 250); });
  comPop.addEventListener("click", (e) => { e.stopPropagation(); openComEditor(row.id, tri); });
}

function closeComEditor(save) {
  if (!comEd) return;
  const id = Number(comEd.dataset.id);
  const val = comEd.querySelector("textarea").value.replace(/\s+$/, "");
  comEd.remove();
  comEd = null;
  if (save) {
    const row = rows.find((r) => r.id === id);
    if (row && (row.com || "") !== val) {
      row.com = val;
      saveRows();
      renderRows();
    }
  }
}

function openComEditor(id, anchor) {
  hideComPop();
  closeComEditor(true);
  const row = rows.find((r) => r.id === id);
  if (!row) return;
  comEd = document.createElement("div");
  comEd.className = "com-ed";
  comEd.dataset.id = id;
  comEd.innerHTML = `<div class="com-ed-hd">${escapeHtml(row.unit || "строка")} <span>· комментарий</span></div>
    <textarea placeholder="Инструкция водителю, рефы, адрес, контакты…">${escapeHtml(row.com || "")}</textarea>
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
    openComEditor(Number(t.closest("tr").dataset.id), t);
  });
  document.addEventListener("mousedown", (e) => {
    if (comEd && !comEd.contains(e.target)) closeComEditor(true);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && comEd) closeComEditor(false);
  });
  window.addEventListener("scroll", () => { hideComPop(); }, true);
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
  trlEd.style.top = Math.min(window.innerHeight - trlEd.offsetHeight - 8, r.bottom + 4) + "px";
  trlEd.style.left = Math.max(8, r.right - trlEd.offsetWidth) + "px";
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
    out.lines.push("⚠ Дата Delivery в прошлом — проверь (опечатка?)");
    return out;
  }
  const hm = (d) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (w.end && etaD > w.end) {
    out.late = true;
    out.lines.push(`Позже Delivery (${row.delivery}) — окно до ${hm(w.end)}`);
  } else if (w.start && etaD < w.start) {
    out.lines.push(`⏳ Раньше окна Delivery — с ${hm(w.start)}, будет ждать`);
  }
  return out;
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
  const chk = deliveryCheck(row, c.etaStr);
  c.late = chk.late;
  c.tipLines = (c.tipLines || []).filter((l) => !l.startsWith("Позже Delivery") && !l.startsWith("⏳ Раньше окна") && !l.startsWith("⚠ Дата Delivery"));
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
      body: JSON.stringify(Object.assign(
        { unit: row.unit, target: row.target },
        row.extra && row.extra.length ? { extra: row.extra.map((x) => x.target || "") } : {},
        row.trailer ? { trailer: row.trailer } : {})),
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
    // v1.59: трак на объекте таргета (полигон Mapon или радиус 300 м)
    const ot = data.on_target
      ? `<span class="ot-pill" title="${escapeHtml(data.on_target.how === "object" ? "На объекте Mapon: " + data.on_target.name : "В радиусе 300 м от таргета")}">📍 на объекте</span>` : "";
    // v1.70: прицеп — рефка; сцепка тягач ↔ прицеп (угадана по координатам)
    const trTag = data.is_trailer ? '<span class="trl-tag" title="Прицеп">П</span>' : "";
    const reeferHtml = data.is_trailer ? reeferPillHtml(data) : "";
    // у прицепа — вторая строка (рефка + кнопка "к тягачу"); у тягача с привязанным прицепом —
    // вторая строка с прицепом; без привязки — кнопка 🔗? в первой строке (v1.71)
    let hitchHtml = "", line2 = "";
    if (data.is_trailer) {
      hitchHtml = hitchPillHtml(data, false);
      if (reeferHtml || hitchHtml) line2 = `<div class="status-line2">${reeferHtml}${hitchHtml}</div>`;
    } else if (row.trailer) {
      line2 = `<div class="status-line2">${linkedTrailerHtml(row.trailer, data.linked_trailer)}</div>`;
    } else {
      hitchHtml = hitchPillHtml(data, true);
    }
    const statusHtml = `<div class="status-line" title="${escapeHtml(data.status_ru + " " + data.duration_str + (data.on_target ? "\nна объекте" + (data.on_target.name ? ": " + data.on_target.name : "") : "") + (tachoTip ? "\n" + tachoTip : ""))}">${trTag}${statusLine1}${extra}${pauseIc}${ot}${data.is_trailer ? "" : hitchHtml}</div>${line2}`;
    const statusClass = data.status === "driving" ? "status-driving" : "status-standing";

    statusCell.innerHTML = statusHtml;
    statusCell.className = `status-cell ${statusClass}`;

    let distText = "—";
    let etaText = "—";
    let etaTip = "";
    let late = false;
    let etaCore = null, bansR = [], tipLines = [];
    if (data.dist_km != null) {
      distText = data.dist_km.toFixed(1);
      distCell.classList.remove("muted");
      // v1.33: две строки — простой ETA и ⏱ по тахографу; подробности в подсказке
      const tip = ["Простой ETA: км ÷ 70, без остановок"]
        .concat(data.eta_tacho ? ["⏱ По тахографу: " + data.eta_tacho].concat(data.tacho_summary || []) : [])
        .concat(data.tacho_error ? ["Тахограф: " + data.tacho_error] : [])
        .concat(data.route_countries && data.route_countries.length > 1 ? ["Страны: " + data.route_countries.join(" → ")] : []);
      // v1.43: одна строка — ⏱ по тахографу крупно, простой мелко серым
      etaText = data.eta_tacho
        ? `<span class="eta-tacho">⏱ ${escapeHtml(data.eta_tacho)}</span><span class="eta-simple">${escapeHtml(data.eta_local)}</span>`
        : `<span class="eta-tacho eta-only">${escapeHtml(data.eta_local)}</span>`;
      // v1.46: "56" — одиночка упирается в недельный лимит вождения, стоп до пн 00:00 UTC
      if (data.tacho_weeklimit) {
        etaText = `<span class="wk-mark" title="Недельный лимит вождения кончится по пути — стоп до пн 00:00 UTC (02:00 CEST), учтено в ⏱ ETA">56</span>` + etaText;
      }
      etaCore = etaText;
      bansR = (data.bans_route || []).slice();
      (data.extra || []).forEach((x, i) => (x.bans_route || []).forEach((b) => bansR.push(`${STOP_NUM[i + 1]}→${STOP_NUM[i + 2]} ${b}`)));
      const chk = deliveryCheck(row, data.eta_tacho || data.eta_local);
      late = chk.late;
      // v1.59: стала опаздывать с прошлого расчёта — мигать до клика
      const prevC = lastCalcText[id];
      if (prevC && prevC.etaCore && prevC.late === false && late) {
        blinkRows.add(id);
        tr.classList.add("row-blink");
      }
      etaCell.classList.toggle("eta-late", late);
      tip.unshift(...chk.lines);
      tipLines = tip;
      // v1.48: кнопка NoBan / 🚫 в начале ETA
      const composed = composeEta(row, { etaCore, bansR, tipLines });
      etaText = composed.html;
      etaTip = composed.title;
      const cx = { dist: distText, eta: etaText, extra: extraCalc(data) };
      distCell.innerHTML = distCellHtml(row, cx);
      etaCell.innerHTML = etaCellHtml(row, cx, composed);
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

    lastCalcText[id] = { status: statusHtml, statusClass: statusClass, dist: distText, eta: etaText, etaTip, targetBadge, late, etaCore, bansR, tipLines,
                         etaStr: data.eta_tacho || data.eta_local, extra: extraCalc(data) };
    // v1.64: плашки кодов у следующих точек
    (lastCalcText[id].extra || []).forEach((ce, i) => {
      const w = tr.querySelector(`.x-stop[data-k="${i + 1}"]`);
      if (!w) return;
      const old = w.querySelector(".x-cc");
      if (old) old.remove();
      if (ce.badge) w.querySelector(".xlo-btn").insertAdjacentHTML("afterend",
        `<span class="cc-badge x-cc" title="${escapeHtml(ce.badgeHint || ce.badge)}">${escapeHtml(ce.badge)}</span>`);
      const inp = w.querySelector(".xt-input");
      if (inp) inp.title = ce.error || (row.extra[i] && row.extra[i].target) || "";
      if (ce.address && row.extra[i] && !row.extra[i].lo && (ce.address.type === "load" || ce.address.type === "unload")) {
        row.extra[i].lo = ce.address.type === "load" ? "L" : "O";
        saveRows();
        const b = w.querySelector(".xlo-btn");
        b.className = `lo-btn xlo-btn ${loClass(row.extra[i].lo)}`;
        b.textContent = loText(row.extra[i].lo);
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

      if (data.target_is_truck && truckInTable(data.target_unit)) {
        // перецеп: цель — машина, которая и так есть в таблице и видна своим маркером
        removeTargetMarker(id);
      } else if (data.target_lat != null && data.target_lng != null) {
        // если машина-цель не в таблице — флажок в её позиции, подпись "→ номер"
        const multi = row.extra && row.extra.length;
        const label = (data.target_is_truck ? `${row.unit} → ${data.target_unit}` : row.unit) + (multi ? " ①" : "");
        updateTargetMarker(id, data.target_lat, data.target_lng, label, markerKind(row));
      } else {
        removeTargetMarker(id);
      }
      // v1.64: флажки следующих точек
      removeExtraTargets(id);
      (data.extra || []).forEach((x, i) => {
        if (x.lat == null || x.lng == null) return;
        const ex = (row.extra || [])[i] || {};
        const kind = ex.lo || (x.target_address && ["port", "customs", "misc"].includes(x.target_address.type) ? x.target_address.type : "");
        updateTargetMarker(id + "_" + (i + 1), x.lat, x.lng, `${row.unit} ${STOP_NUM[i + 2]}`, kind);
      });
    }
  } catch (e) {
    console.error("calcRow", e);
    statusCell.textContent = "Ошибка запроса";
  }
}

// v1.70: рефка прицепа — "❄ 8.9° / 4.5°" (возврат по отсекам), подробности в подсказке
function fmtT(v) { return v == null ? "—" : `${Number(v).toFixed(1).replace(/\.0$/, "")}°`; }
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
function extraCalc(data) {
  return (data.extra || []).map((x) => ({
    error: x.error || null,
    dist_km: x.dist_km, leg_km: x.leg_km,
    eta_tacho: x.eta_tacho || null, eta_local: x.eta_local || null,
    tacho_weeklimit: !!x.tacho_weeklimit,
    badge: x.badge || null, badgeHint: x.badge_hint || null,
    address: x.target_address || null,
  }));
}

function calcAllRows(opts) {
  const jobs = rows.filter((r) => r.unit).map((r) => calcRow(r.id));
  // v1.53: после "Обновить всё" (и загрузки) — пересортировать по выбранному режиму;
  // v1.59: автообновление строки не переставляет
  const resortAfter = !(opts && opts.auto);
  Promise.allSettled(jobs).then(() => { if (resortAfter && sortMode !== "added") resort(); });
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
(function () {
  const bar = document.getElementById("sort-bar");
  if (!bar) return;
  const mark = () => bar.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.sort === sortMode));
  bar.addEventListener("click", (e) => {
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
  });
  mark();
})();

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
