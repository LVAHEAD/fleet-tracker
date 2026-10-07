/*
Fleet ETA Tracker — вкладка "From → To"
Версия: 1.23 — кнопка "Очистить"; поля сохраняются в localStorage ("route-fields")
и восстанавливаются после перезагрузки (без автопересчёта); коды регионов в
разбивке по отрезкам; время в ч:мм с округлением до 15 мин (у отрезков минимум 0:15).
Ранее 1.22 — несколько погрузок и выгрузок, машина как точка:
  - поля From1.., To1.. появляются по мере заполнения (всегда одно пустое в
    конце каждой группы), пустые поля при расчёте пропускаются;
  - в любое поле можно вписать номер машины (подсказки — тот же datalist
    "units-list", что и во вкладке "Флот"), код региона, GPS или город;
  - маршрут строго по порядку From1 → … → FromN → To1 → … → ToM, правила
    (Инсбрук, паромы) — на сервере, на каждый отрезок;
  - на карте маркеры L1, L2… (синие) и O1, O2… (жёлтые), как цвета L/O во "Флоте".

Отдельная Google Map (window.routeMap), создаётся лениво при первом открытии
вкладки (initRouteTab, вызывается из app.js).
*/

let routeMarkers = [];
let routeLine = null;

const ROUTE_POINT_COLORS = {
  L: { fill: "#4A90D9", text: "#ffffff" },
  O: { fill: "#E0B000", text: "#3D2E00" },
};

function initRouteTab() {
  if (window.routeMap) return; // уже создана
  window.routeMap = new google.maps.Map(document.getElementById("route-map"), {
    center: { lat: 50.5, lng: 10.0 },
    zoom: 4,
  });

  // v3.38: все машины HEAD TRUCK на карте; клик по машине — она в From1, остальные вниз (пересчёт — по кнопке)
  if (window.UnitsLayer) window.UnitsLayer.attach(window.routeMap, { onPick: routePutTruck });

  restoreRouteFields();
  syncRouteFields("route-from-list", "L");
  syncRouteFields("route-to-list", "O");
  document.getElementById("route-calc-btn").addEventListener("click", calcRouteTab);
  document.getElementById("route-clear-btn").addEventListener("click", clearRouteTab);
  document.getElementById("route-to-calc").addEventListener("click", routeToCalc);   // v3.32
}

// v3.38: машина с карты — в From1. В From1 уже машина — заменяем; иначе всё сдвигается вниз.
function routePutTruck(number) {
  const list = document.getElementById("route-from-list");
  const inputs = Array.from(list.querySelectorAll(".route-field input"));
  const vals = inputs.map((i) => i.value.trim());
  const isTruck = (v) => !!v && (typeof unitsCache !== "undefined" ? unitsCache : []).some((u) => u.kind === "truck" && u.number === v);
  if (!vals[0] || isTruck(vals[0])) vals[0] = number;
  else vals.unshift(number);
  list.innerHTML = "";
  vals.filter((v, i) => v || i === 0).forEach((v) => {
    const f = makeRouteField("route-from-list", "L");
    f.querySelector("input").value = v;
    list.appendChild(f);
  });
  syncRouteFields("route-from-list", "L");
  saveRouteFields();
}

// --- Сохранение полей в браузере ---
const ROUTE_STORAGE_KEY = "route-fields";

function saveRouteFields() {
  try {
    localStorage.setItem(ROUTE_STORAGE_KEY, JSON.stringify({
      from: readRouteValues("route-from-list"),
      to: readRouteValues("route-to-list"),
    }));
  } catch (e) { /* localStorage недоступен — просто не сохраняем */ }
}

function restoreRouteFields() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(ROUTE_STORAGE_KEY) || "null"); } catch (e) { saved = null; }
  if (!saved) return;
  [["route-from-list", "L", saved.from], ["route-to-list", "O", saved.to]].forEach(([listId, kind, values]) => {
    const list = document.getElementById(listId);
    list.innerHTML = "";
    (Array.isArray(values) ? values : []).forEach((v) => {
      const f = makeRouteField(listId, kind);
      f.querySelector("input").value = v;
      list.appendChild(f);
    });
  });
}

// --- Очистить ---
function clearRouteTab() {
  routeCorridor = null;      // v3.32
  lastRouteData = null;
  document.getElementById("route-from-list").innerHTML = "";
  document.getElementById("route-to-list").innerHTML = "";
  syncRouteFields("route-from-list", "L");
  syncRouteFields("route-to-list", "O");
  try { localStorage.removeItem(ROUTE_STORAGE_KEY); } catch (e) { /* ignore */ }

  document.getElementById("route-result").hidden = true;
  document.getElementById("route-points").hidden = true;
  document.getElementById("route-freights").hidden = true;
  document.getElementById("route-geo-warn").hidden = true;
  document.getElementById("route-error").hidden = true;
  document.getElementById("route-legs").innerHTML = "";
  drawRouteOnMap({ points: [] });

  const first = document.querySelector("#route-from-list input");
  if (first) first.focus();
}

// --- Время: ч:мм с округлением до 15 минут ---
function formatHM(hours, minQuarter) {
  let q = Math.round((hours * 60) / 15); // число четвертей часа
  if (minQuarter && hours > 0 && q < 1) q = 1; // короткий отрезок — минимум 0:15
  const total = q * 15;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

// --- Динамические поля ---

function makeRouteField(listId, kind) {
  const wrap = document.createElement("div");
  wrap.className = "route-field is-empty";
  const tag = document.createElement("span");
  tag.className = `route-tag tag-${kind}`;
  const input = document.createElement("input");
  input.setAttribute("list", "points-list");
  input.autocomplete = "off";
  input.addEventListener("input", () => {
    syncRouteFields(listId, kind);
    saveRouteFields();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") calcRouteTab();
  });
  wrap.appendChild(tag);
  wrap.appendChild(input);
  return wrap;
}

// Держим ровно одно пустое поле в конце группы; пустые поля в середине не трогаем
// (пользователь может их дозаполнить), при расчёте они просто пропускаются.
function syncRouteFields(listId, kind) {
  const list = document.getElementById(listId);
  let fields = Array.from(list.querySelectorAll(".route-field"));
  if (fields.length === 0) {
    list.appendChild(makeRouteField(listId, kind));
    fields = Array.from(list.querySelectorAll(".route-field"));
  }

  const isEmpty = (f) => !f.querySelector("input").value.trim();

  // лишние пустые в хвосте — убираем, оставляя одно
  while (fields.length > 1 && isEmpty(fields[fields.length - 1]) && isEmpty(fields[fields.length - 2])) {
    const last = fields.pop();
    if (document.activeElement === last.querySelector("input")) {
      fields[fields.length - 1].querySelector("input").focus();
    }
    last.remove();
  }
  // последнее заполнено — добавляем пустое
  if (!isEmpty(fields[fields.length - 1])) {
    const f = makeRouteField(listId, kind);
    list.appendChild(f);
    fields.push(f);
  }

  const name = kind === "L" ? "From" : "To";
  const example = kind === "L" ? "напр. OI-4310 или ES30" : "напр. SE25";
  fields.forEach((f, i) => {
    const n = i + 1;
    f.querySelector(".route-tag").textContent = `${kind}${n}`;
    const input = f.querySelector("input");
    input.name = `route-${kind}-${n}`;
    input.placeholder = n === 1 ? `${name}${n} (${example})` : `${name}${n} (необязательно)`;
    f.classList.toggle("is-empty", isEmpty(f));
  });
}

function readRouteValues(listId) {
  return Array.from(document.querySelectorAll(`#${listId} input`))
    .map((i) => i.value.trim())
    .filter(Boolean);
}

// --- Расчёт ---

async function calcRouteTab() {
  const froms = readRouteValues("route-from-list");
  const tos = readRouteValues("route-to-list");
  const resultEl = document.getElementById("route-result");
  const pointsEl = document.getElementById("route-points");
  const errorEl = document.getElementById("route-error");
  const btn = document.getElementById("route-calc-btn");

  errorEl.hidden = true;
  resultEl.hidden = true;
  pointsEl.hidden = true;
  document.getElementById("route-freights").hidden = true;
  document.getElementById("route-geo-warn").hidden = true;

  if (froms.length === 0 && tos.length === 0) {
    errorEl.textContent = "Заполните хотя бы одно поле — From или To.";
    errorEl.hidden = false;
    return;
  }

  btn.disabled = true;
  btn.textContent = "Считаю…";

  try {
    const res = await fetch("/api/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ from: froms, to: tos }, routeCorridor ? { corridor: routeCorridor } : {})),
    });
    const data = await res.json();

    if (data.error) {
      errorEl.textContent = data.error;
      errorEl.hidden = false;
      return;
    }

    lastRouteData = data;                   // v3.32: для «⏱ Послать в калькулятор»
    renderRoutePoints(data.points || []);
    renderGeoWarn(data.points || []);
    renderFreights(data.freights);

    if (data.dist_km != null) {
      document.getElementById("route-dist").textContent = data.dist_km.toFixed(1);
      document.getElementById("route-duration").textContent = formatHM(data.duration_h, false);
      renderRouteLegs(data.legs || []);
      renderRouteCorridor(data);
      renderRouteBans(data);
      document.getElementById("route-waypoint-note").hidden = !data.waypoints_applied;
      resultEl.hidden = false;
    }

    drawRouteOnMap(data);
  } catch (e) {
    errorEl.textContent = "Ошибка запроса. Попробуйте ещё раз.";
    errorEl.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = "Рассчитать";
  }
}

// ---------- v3.32: коридор ИТ ↔ Бенелюкс — кнопки под результатом; «сравнить км» — то же меню, что во Флоте ----------
let routeCorridor = null;      // выбор диспетчера (до «Очистить»), null — авто
function renderRouteCorridor(data) {
  const el = document.getElementById("route-corridor");
  const k = data.corridor;
  if (!k || !k.used) { el.hidden = true; el.innerHTML = ""; return; }
  const tun = { "Монблан": 250, "Фрежюс": 250 };
  const btn = (name, label) => `<button type="button" data-n="${routeEscape(name || "")}" class="${(routeCorridor || null) === name ? "on" : ""}"` +
    (name && tun[name] ? ` title="туннель ~${tun[name]} €"` : "") + `>${label}</button>`;
  el.innerHTML = `<span>Коридор в обход Швейцарии: <b>${routeEscape(k.used)}</b>${routeCorridor ? " (вручную)" : " (авто)"}</span> ` +
    `<span class="rt-cor-seg">${btn(null, "авто")}${(k.names || []).map((n) => btn(n, routeEscape(n) + (tun[n] ? " 🚇" : ""))).join("")}</span> ` +
    `<a href="#" class="rt-cor-b">сравнить км</a>`;
  el.hidden = false;
  el.querySelectorAll(".rt-cor-seg button").forEach((b) => b.addEventListener("click", () => {
    const n = b.dataset.n || null;
    if (n === (routeCorridor || null)) return;
    routeCorridor = n;
    calcRouteTab();
  }));
  el.querySelector(".rt-cor-b").addEventListener("click", (e) => {
    e.preventDefault();
    corridorMenu(e.currentTarget, k, routeCorridor, (n) => { routeCorridor = n; calcRouteTab(); });
  });
}

// ---------- v3.32: «⏱ Послать в калькулятор» — первый отрезок (From1 → следующая точка) ----------
let lastRouteData = null;
function routeToCalc() {
  const d = lastRouteData;
  if (!d || !window.etaCalc || d.dist_km == null) return;
  const pts = d.points || [], legs = d.legs || [];
  const km = legs.length ? legs[0].dist_km : d.dist_km;
  let poly = d.route_polyline || null;
  // линия всего маршрута — отрезаем первый отрезок по доле км (линия Google ≈ км по дорогам)
  if (poly && legs.length > 1 && d.dist_km > 0 && window.google && google.maps.geometry) {
    const path = google.maps.geometry.encoding.decodePath(poly), sph = google.maps.geometry.spherical;
    const total = sph.computeLength(path), cut = total * km / d.dist_km, out = [path[0]];
    let acc = 0;
    for (let i = 1; i < path.length; i++) {
      const seg = sph.computeDistanceBetween(path[i - 1], path[i]);
      if (acc + seg >= cut) { out.push(sph.interpolate(path[i - 1], path[i], seg ? (cut - acc) / seg : 0)); break; }
      acc += seg; out.push(path[i]);
    }
    poly = google.maps.geometry.encoding.encodePath(out);
  }
  const name = (p) => (p ? String(p.label || p.raw || "").split(",")[0].trim() : "");
  window.etaCalc.openWith({
    label: "From → To: " + name(pts[0]) + " → " + name(pts[1]),
    km, polyline: poly, seed: d.calc_seed || null,
    noSeedNote: pts[0] && pts[0].is_truck ? "тахографа машины нет — состав и остаток прежние" : "",
  });
}

// v1.45: полные запреты по пути (при выезде сейчас, соло) — только предупреждение
function renderRouteBans(data) {
  const el = document.getElementById("route-bans");
  const list = data.bans_route || [];
  el.className = "route-bans";
  if (data.bans_status === "loading") {
    el.textContent = "Запреты по пути: данные ещё загружаются — пересчитайте через минуту.";
    el.classList.add("route-bans-none");
  } else if (list.length) {
    el.innerHTML = "🚫 <b>Запреты по пути</b> (при выезде сейчас, соло; ETA не сдвинут):<br>" +
      list.map(routeEscape).join("<br>");
  } else if (data.bans_status === "ok") {
    el.textContent = "Полных запретов по пути нет (при выезде сейчас).";
    el.classList.add("route-bans-none");
  } else {
    el.hidden = true;
    return;
  }
  el.hidden = false;
}

function routeEscape(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

// v1.37: предупреждение, если город распознан подозрительно (короткий ввод или
// место в стране, где мы не ездим) — чтобы "fin" -> городок во Франции не проскочил
function renderGeoWarn(points) {
  const el = document.getElementById("route-geo-warn");
  const bad = points.filter((p) => p.geo && p.geo.suspicious);
  if (!bad.length) { el.hidden = true; el.innerHTML = ""; return; }
  el.innerHTML = "⚠ Проверьте: " + bad.map((p) =>
    `<b>${p.kind}${p.num}</b> «${routeEscape(p.raw || "")}» распознан как ${routeEscape(p.geo.found)}${p.geo.cc ? " (" + routeEscape(p.geo.cc) + ")" : ""}`
  ).join("; ") + ". Если это не то — введите код региона, GPS или склад из базы.";
  el.hidden = false;
}

// v1.29: похожие рейсы из базы фрахтов и ориентир цены
const FREIGHT_LEVEL_RU = { 1: "те же регионы", 2: "соседние регионы (до 150 км)", 3: "та же пара стран" };

function fmtEur(n) {
  return n == null ? "—" : `${Math.round(n).toLocaleString("ru-RU")} €`;
}

function renderFreights(f) {
  const el = document.getElementById("route-freights");
  if (!f) { el.hidden = true; return; }
  if (f.error) {
    el.innerHTML = `<div class="frt-err">База фрахтов недоступна: ${routeEscape(f.error)}</div>`;
    el.hidden = false;
    return;
  }
  if (!f.total) {
    el.innerHTML = `<div class="frt-head">Похожие рейсы (${routeEscape(f.query)}): не найдено</div>`;
    el.hidden = false;
    return;
  }
  const levels = (f.levels || []).map((l) => FREIGHT_LEVEL_RU[l]).join(", ");
  const rows = f.trips.map((t) => `
    <tr class="${t.contract ? "frt-row-contract" : ""}">
      <td>${routeEscape(t.from)} → ${routeEscape(t.to)}</td>
      <td>${routeEscape(t.client)}</td>
      <td class="num">${fmtEur(t.price)}</td>
      <td class="num">${t.eur_km != null ? t.eur_km.toFixed(2) + " €/км" : ""}</td>
      <td>${routeEscape(t.date)}</td>
      <td class="frt-tag">${t.contract ? '<span class="frt-contract">контракт</span> ' : ""}${t.outsourced ? "аутсорс" : ""}${t.level > 1 ? ` <span title="${routeEscape(FREIGHT_LEVEL_RU[t.level])}">≈</span>` : ""}</td>
    </tr>`).join("");
  const e = f.estimate;
  const est = e ? `
    <div class="frt-est">
      Ориентир: <b>${fmtEur(e.low)}–${fmtEur(e.high)}</b> · медиана <b>${fmtEur(e.median)}</b>
      ${e.eur_km_route != null ? ` · <b>${e.eur_km_route.toFixed(2)} €/км</b> по этому маршруту` : ""}
      ${e.eur_km_hist != null ? ` · ${e.eur_km_hist.toFixed(2)} €/км в истории` : ""}
      <span class="frt-muted">(${e.n} рейсов, ${routeEscape(e.basis)})</span>
    </div>` : "";
  // v1.76: таблица рейсов — в раскрывашке (заголовок и "Ориентир" видны всегда), состояние запоминается
  let open = false;
  try { open = localStorage.getItem("frtOpen") === "1"; } catch (err) { /* ignore */ }
  el.innerHTML = `
    <div class="frt-head frt-toggle" role="button" tabindex="0" title="Показать / скрыть рейсы">
      <span class="frt-caret">▸</span> Похожие рейсы (${routeEscape(f.query)}): ${f.total}
      <span class="frt-muted">— ${routeEscape(levels)}${f.total > f.trips.length ? `, показаны ${f.trips.length} свежих` : ""}</span></div>
    ${est}
    <table class="frt-table">${rows}</table>`;
  const setOpen = (v) => {
    open = v;
    el.classList.toggle("frt-open", open);
    try { localStorage.setItem("frtOpen", open ? "1" : "0"); } catch (err) { /* ignore */ }
  };
  el.classList.toggle("frt-open", open);
  const head = el.querySelector(".frt-toggle");
  head.addEventListener("click", () => setOpen(!open));
  head.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); setOpen(!open); } });
  el.hidden = false;
}

// v1.28: у точки из адресной базы — часы работы и заметки
function addrExtra(a) {
  if (!a) return "";
  const bits = [a.open && `🕒 ${a.open}`, a.notes && `📝 ${a.notes}`].filter(Boolean);
  return bits.length ? ` <span class="route-addr-extra">${routeEscape(bits.join("   "))}</span>` : "";
}

function renderRoutePoints(points) {
  const el = document.getElementById("route-points");
  el.innerHTML = points.map((p) => `
    <div class="route-point">
      <span class="route-tag tag-${p.kind}">${p.kind}${p.num}</span>
      <span>${routeEscape(p.label)}${p.dovoz ? ` <span class="dovoz-badge">+довоз ${routeEscape(p.dovoz)}</span>` : ""}${addrExtra(p.address)}</span>
    </div>`).join("");
  el.hidden = points.length === 0;
}

function legCode(code) {
  return code ? `<span class="leg-code">${routeEscape(code)}</span>` : "";
}

function renderRouteLegs(legs) {
  const el = document.getElementById("route-legs");
  if (legs.length <= 1) {
    // один отрезок — разбивка не нужна, итог и так его показывает
    el.innerHTML = "";
    return;
  }
  el.innerHTML = `<table class="route-legs">${legs.map((l) => `
    <tr>
      <td>${routeEscape(l.from)}${legCode(l.from_code)} → ${routeEscape(l.to)}${legCode(l.to_code)}</td>
      <td class="num">${l.dist_km.toFixed(1)} км</td>
      <td class="num">~${formatHM(l.duration_h, l.dist_km > 0)}</td>
      <td class="leg-rule">${l.waypoints_applied ? routeEscape(l.rule || "обход/паромы") : ""}</td>
    </tr>`).join("")}</table>`;
}

// --- Карта ---

function routePointIcon(kind) {
  const c = ROUTE_POINT_COLORS[kind] || ROUTE_POINT_COLORS.L;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30">
    <circle cx="15" cy="15" r="12" fill="${c.fill}" stroke="white" stroke-width="2"/>
  </svg>`;
  return {
    url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
    scaledSize: new google.maps.Size(30, 30),
    anchor: new google.maps.Point(15, 15),
  };
}

function drawRouteOnMap(data) {
  const map = window.routeMap;

  routeMarkers.forEach((m) => m.setMap(null));
  routeMarkers = [];
  if (routeLine) routeLine.setMap(null);
  routeLine = null;

  const bounds = new google.maps.LatLngBounds();
  const points = data.points || [];

  points.forEach((p) => {
    if (p.lat == null || p.lng == null) return;
    const c = ROUTE_POINT_COLORS[p.kind] || ROUTE_POINT_COLORS.L;
    const m = new google.maps.Marker({
      position: { lat: p.lat, lng: p.lng },
      map: map,
      icon: routePointIcon(p.kind),
      label: { text: `${p.kind}${p.num}`, fontSize: "11px", fontWeight: "700", color: c.text },
      title: p.label,
      zIndex: 10,
    });
    routeMarkers.push(m);
    bounds.extend(m.getPosition());
  });

  if (data.route_polyline) {
    const path = google.maps.geometry.encoding.decodePath(data.route_polyline);
    routeLine = new google.maps.Polyline({
      path: path,
      strokeColor: "#4285F4",
      strokeOpacity: 0.85,
      strokeWeight: 4,
      map: map,
    });
    path.forEach((pt) => bounds.extend(pt));
    map.fitBounds(bounds, 40);
  } else if (routeMarkers.length > 0) {
    // только одна точка — центрируем на ней вместо fitBounds (слишком крупный зум)
    map.setCenter(bounds.getCenter());
    map.setZoom(9);
  }
}

window.initRouteTab = initRouteTab;
