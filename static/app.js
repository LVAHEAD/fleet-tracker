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

/* v3.31: исключения из закрытия боковых панелей кликом мимо (с v3.53 такого закрытия нет, список — для notebook.js) (клик по строке —
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
/* v3.53: правые панели сами не закрываются — ни кликом мимо, ни при смене вкладки. Закрывает только свой ярлык
   или крестик; открытие одной панели закрывает другую (это действие диспетчера). SIDE_KEEP читает notebook.js
   (страница /notebook), поэтому константа оставлена. */

window.whenGoogleMaps = function (fn) {
  if (window.googleMapsReady) fn();
  else (window._gmQueue = window._gmQueue || []).push(fn);
};

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
  // v3.52: линия — до той точки, у значка которой кликнули: машина → первая непройденная + плечи extraPolys до точки k
  let poly = (pos && pos.polyline) || null;
  const first = c.ecAt || 0;
  if (k != null && k !== first) {
    poly = null;
    if (pos && pos.polyline && k > first && window.google && google.maps.geometry) {
      const enc = google.maps.geometry.encoding;
      const legs = [pos.polyline].concat((pos.extraPolys || []).slice(first, k));
      if (legs.every(Boolean)) {
        const path = [];
        legs.forEach((e) => enc.decodePath(e).forEach((p) => path.push(p)));
        poly = enc.encodePath(path);
      }
    }
  }
  // v3.112: км 0 (машина уже на точке) — маркеры машины и первой непройденной точки вместо маршрута
  // (после v3.116: «первая непройденная» — не обязательно ①: у OI-1781 ① пройдена, машина стоит на ②, клик у ②)
  const pinPos = rowPositions[id];
  const pins = km === 0 && at === first && pinPos && pinPos.unitLat != null && pinPos.targetLat != null
    ? { unit: [pinPos.unitLat, pinPos.unitLng], target: [pinPos.targetLat, pinPos.targetLng] } : null;
  // v3.159: пройденная точка — на карте ⏱ только маркер машины, центр на ней, зум 5 (маршрут не рисуем)
  const passed = !!(c.doneFlags && c.doneFlags[at] && c.doneFlags[at].done);
  if (k != null && passed && pinPos && pinPos.unitLat != null) {
    window.etaCalc.fromRow({ unit: row.unit || "", point: ((STOP_NUM[at + 1] || "") + " " + String(pt || "").trim()).trim(),
      unitOnly: { lat: pinPos.unitLat, lng: pinPos.unitLng } });
    return;
  }
  window.etaCalc.fromRow({
    unit: row.unit || "", point: ((STOP_NUM[at + 1] || "") + " " + String(pt || "").trim()).trim(),
    km, seed: c.ecSeed || null, polyline: poly, pins,
  });
}

// v3.130: клик по плашке «(N) на точке» — зум 17 на машине. Открыт ⏱ — остаётся, зум 17 на его мини-карте;
// иначе выбираем строку и открываем Карту Флота (панели делят место — ⏱ при этом не закрываем лишний раз).
function otPillClick(id) {
  drawRoute(id);
  const pos0 = rowPositions[id];
  if (window.etaCalc && window.etaCalc.isOpen()) {
    ecFromRow(id);
    if (pos0 && pos0.unitLat != null) window.etaCalc.focusMap(pos0.unitLat, pos0.unitLng, 17);   // v3.131: зум 17 при любом км
    return;
  }
  if (window.fleetMapPanel && !window.fleetMapPanel.isOpen()) window.fleetMapPanel.open();
  const pos = rowPositions[id];
  if (typeof map !== "undefined" && map && pos && pos.unitLat != null) {
    map.setCenter({ lat: pos.unitLat, lng: pos.unitLng });
    map.setZoom(17);
    setTimeout(() => { map.setCenter({ lat: pos.unitLat, lng: pos.unitLng }); map.setZoom(17); }, 320);   // панель выехала — карта пересчитала размер
  }
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
  if (window.fleetSync) window.fleetSync.schedule();   // v2.00: общий Флот на сервере
  if (window.PrepMap) window.PrepMap.sync();   // v3.178: флажки трипов без машины на карте
}

// v3.177: цветная метка клиента — только у пользователя VL (vladimirs.head); остальным кнопки нет
const MARK_NAMES = ["без цвета", "оранжевый", "cyan", "зелёный", "жёлтый"];
function markAllowed() {
  const me = fleetMe();
  return !!me && (me === canonEmail("vladimirs.head@gmail.com") || dispTag(me) === "VL");
}
function markBtnHtml(row) {
  if (!markAllowed()) return "";
  const c = Number(row.mark) || 0;
  return `<button type="button" class="cl-mark" data-c="${c}" title="Метка: ${MARK_NAMES[c]} — клик, следующий цвет"></button>`;
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
      // v3.108: точки с траком в цели узнаём по списку машин — если строки уже нарисованы без него, перерисовать
      if (typeof rows !== "undefined" && rows.some((r) => ptTruckNo(r) || (r.extra || []).some((x) => ptTruckNo(x)))) renderRows();
    }
  } catch (e) {
    console.error("Не удалось загрузить список машин", e);
  }
}

// v3.167: фон плашки страны у машины — цвета флага (приблизительно, для стран парка)
const FLAG_BG = {
  ES: "linear-gradient(#AA151B 0 25%,#F1BF00 25% 75%,#AA151B 75%)",
  IT: "linear-gradient(to right,#009246 0 33.3%,#fff 33.3% 66.6%,#CE2B37 66.6%)",
  DE: "linear-gradient(#000 0 33.3%,#DD0000 33.3% 66.6%,#FFCE00 66.6%)",
  FR: "linear-gradient(to right,#002395 0 33.3%,#fff 33.3% 66.6%,#ED2939 66.6%)",
  NL: "linear-gradient(#AE1C28 0 33.3%,#fff 33.3% 66.6%,#21468B 66.6%)",
  BE: "linear-gradient(to right,#000 0 33.3%,#FAE042 33.3% 66.6%,#ED2939 66.6%)",
  LU: "linear-gradient(#ED2939 0 33.3%,#fff 33.3% 66.6%,#00A1DE 66.6%)",
  DK: "#C8102E",
  SE: "linear-gradient(90deg,transparent 35%,#FECC00 35% 45%,transparent 45%),linear-gradient(transparent 40%,#FECC00 40% 50%,transparent 50%),#006AA7",
  NO: "linear-gradient(90deg,transparent 33%,#00205B 33% 39%,transparent 39%),linear-gradient(transparent 43%,#00205B 43% 49%,transparent 49%),linear-gradient(90deg,transparent 30%,#fff 30% 42%,transparent 42%),linear-gradient(transparent 40%,#fff 40% 52%,transparent 52%),#BA0C2F",
  FI: "linear-gradient(90deg,transparent 30%,#003580 30% 42%,transparent 42%),linear-gradient(transparent 40%,#003580 40% 52%,transparent 52%),#fff",
  PL: "linear-gradient(#fff 0 50%,#DC143C 50%)",
  CZ: "linear-gradient(#fff 0 50%,#D7141A 50%)",
  SK: "linear-gradient(#fff 0 33.3%,#0B4EA2 33.3% 66.6%,#EE1C25 66.6%)",
  HU: "linear-gradient(#CE2939 0 33.3%,#fff 33.3% 66.6%,#477050 66.6%)",
  AT: "linear-gradient(#ED2939 0 33.3%,#fff 33.3% 66.6%,#ED2939 66.6%)",
  CH: "#DA291C",
  PT: "linear-gradient(to right,#006600 0 40%,#FF0000 40%)",
  GB: "#012169",
  IE: "linear-gradient(to right,#169B62 0 33.3%,#fff 33.3% 66.6%,#FF883E 66.6%)",
  LT: "linear-gradient(#FDB913 0 33.3%,#006A44 33.3% 66.6%,#C1272D 66.6%)",
  LV: "linear-gradient(#9E3039 0 40%,#fff 40% 60%,#9E3039 60%)",
  EE: "linear-gradient(#0072CE 0 33.3%,#000 33.3% 66.6%,#fff 66.6%)",
  RO: "linear-gradient(to right,#002B7F 0 33.3%,#FCD116 33.3% 66.6%,#CE1126 66.6%)",
  BG: "linear-gradient(#fff 0 33.3%,#00966E 33.3% 66.6%,#D62612 66.6%)",
  HR: "linear-gradient(#FF0000 0 33.3%,#fff 33.3% 66.6%,#171796 66.6%)",
  SI: "linear-gradient(#fff 0 33.3%,#003DA5 33.3% 66.6%,#ED1C24 66.6%)",
  GR: "linear-gradient(#0D5EAF 0 11.1%,#fff 11.1% 22.2%,#0D5EAF 22.2% 33.3%,#fff 33.3% 44.4%,#0D5EAF 44.4% 55.5%,#fff 55.5% 66.6%,#0D5EAF 66.6% 77.7%,#fff 77.7% 88.8%,#0D5EAF 88.8%)",
  TR: "#E30A17",
  UA: "linear-gradient(#005BBB 0 50%,#FFD500 50%)",
  RU: "linear-gradient(#fff 0 33.3%,#0039A6 33.3% 66.6%,#D52B1E 66.6%)",
  RS: "linear-gradient(#C6363C 0 33.3%,#0C4076 33.3% 66.6%,#fff 66.6%)",
  BY: "linear-gradient(#CF101A 0 50%,#007C30 50%)",
};
// v3.169: плашка точки (ES04, NO17) — флаг страны под прозрачностью 4%, при наведении 10%
const ptFlagCls = (code) => (FLAG_BG[String(code || "").slice(0, 2).toUpperCase()] ? " cc-pt-flag" : "");
const ptFlagStyle = (code) => {
  const bg = FLAG_BG[String(code || "").slice(0, 2).toUpperCase()];
  return bg ? ` style="--f:${bg}"` : "";
};

// --- v1.28: адресная база (Google-таблица) и общий список подсказок points-list ---
window.addressList = [];
const ADDR_TYPE_RU = { load: "погрузка", unload: "выгрузка", port: "порт", customs: "таможня", misc: "прочее" };

async function loadAddressList(refresh) {
  try {
    const res = await fetch("/api/addresses" + (refresh ? "?refresh=1" : ""));
    const data = await res.json();
    window.addressList = data.addresses || [];
    if (window.PrepMap) window.PrepMap.sync();   // v3.178: адреса загрузились — можно ставить флажки
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

// v3.155: при наведении на любое поле таргета (points-list) — полный адрес из «Full address» и второй строкой type · client · supplier
function addressTipFor(v) {
  const q = String(v || "").trim().toLowerCase();
  if (!q) return "";
  const a = (window.addressList || []).find((x) =>
    String(x.name || "").trim().toLowerCase() === q || String(x.alias || "").trim().toLowerCase() === q);
  if (!a) return "";
  const head = a.full || a.name;
  const extra = [ADDR_TYPE_RU[a.type] || a.type, a.client, a.supplier].filter(Boolean).join(" · ");
  return extra ? head + "\n" + extra : head;
}
document.addEventListener("mouseover", (e) => {
  const inp = e.target.closest && e.target.closest('input[list="points-list"]');
  if (!inp) return;
  if (inp.dataset.tipOrig === undefined) inp.dataset.tipOrig = inp.title || "";
  inp.title = addressTipFor(inp.value) || inp.dataset.tipOrig;
});

function addressTooltip(a) {
  if (!a) return "";
  return [a.name, a.open && `Open: ${a.open}`, a.notes && `Notes: ${a.notes}`].filter(Boolean).join("\n");
}

// Обновить всё, что зависит от L/O в строке таблицы
function applyLoToRow(tr, row) {
  const btn = tr.querySelector(".lo-btn");
  btn.className = `lo-btn ${ptBtnClass(row)}`;   // v3.108: у встречи с траком / перецепа — нейтральный L/O или ⇄
  btn.textContent = ptBtnText(row);
  btn.title = ptBtnTitle(row);
  tr.querySelector(".delivery-input").placeholder = deliveryPlaceholder(ptLo(row));
  stripeRow(tr, row);   // v3.10: по первой непройденной точке
  recolorTargetMarker(row.id, row.unit, markerKind(row));
  const chip = row.extra && row.extra.length ? tr.querySelector(".target-wrap:not(.x-stop) .stop-n") : null;
  if (chip) chip.innerHTML = numChip(1, ptLo(row));
}

// v3.15: соло / экипаж. Авто — по второму слоту тахографа (+ история трака за неделю),
// клик по кругу: авто → 👤 соло вручную → 👥 экипаж вручную → авто.
// У одиночки справа — остаток вождения на неделю целыми часами (вниз).
function crewOf(data) {
  return data.crew ? { crew: data.crew, src: data.crew_src, wl: data.week_left_sec, lim: data.week_limit,
                       driven: data.week_driven_sec, next: data.week_next_sec, hmax: data.crew_hist_max_h,
                       short: data.week_short_last || null, names: data.crew_names || null,
                       nocard: !!data.crew_nocard, nosub: !!data.crew_nosub, gpsfix: data.tacho_gps_fix || null, seenAt: data.crew_seen_at || null } : null;
}
// v3.105: память «экипаж». Две карты в тахографе — запоминаем в строке (трак + время), метку обновляем раз в сутки;
// Mapon потом может потерять вторую карту (OI-3194), а режим остаётся экипажем до 14 суток. Другой трак — память сбрасываем.
function keepCrewSeen(row, data) {
  const u = row.unit || "", cs = row.crewSeen;
  if (data && data.crew === "team" && data.crew_src === "tacho" && u) {
    if (!cs || cs.u !== u || Date.now() - cs.t > 24 * 3600 * 1000) { row.crewSeen = { u, t: Date.now() }; saveRows(); }
  } else if (cs && cs.u !== u) {
    delete row.crewSeen;
    saveRows();
  }
}
// v3.115: соло / экипаж и память «экипаж», которые диспетчер поставил этой машине во Флоте, — для From → To и ⏱ калькулятора
// (там строки нет, а ручной 👤 / 👥 важнее истории GPS). Нет в Флоте / ничего не ставили — пусто.
function fleetCrewFor(name) {
  const k = (s) => String(s || "").toUpperCase().replace(/[\s-]/g, "");
  const key = k(name), out = {};
  if (!key) return out;
  const mine = rows.filter((r) => r.unit && k(r.unit) === key);
  const rc = mine.find((r) => r.crew), rs = mine.find((r) => r.crewSeen && r.crewSeen.u === r.unit);
  if (rc) out.from_crew = rc.crew;
  if (rs) out.from_crew_seen = Math.floor(rs.crewSeen.t / 1000);
  return out;
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
      c && c.src === "memory" ? "⚠ Экипаж — из памяти: две карты в тахографе видели " +
        (c.seenAt ? new Date(c.seenAt * 1000).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "раньше") +
        ", сейчас Mapon видит одну (если это уже соло — клик: соло вручную)" :
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
  // v3.104: тахограф Mapon отстаёт от GPS (карты не считаны) — остаток дня и начало смены по GPS
  if (c && c.gpsfix) {
    tip.push(`⚠ Тахограф отстаёт от GPS: в смене по GPS ${hm(c.gpsfix.driven)} вождения, по тахографу ${hm(c.gpsfix.tacho)} — ETA по GPS`);
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
      <td class="unit-cell"${dispTag(rowDisp(row)) ? ` data-dc="${dispTag(rowDisp(row))}"` : ""}><span class="drag-h" draggable="true" title="Перетащить строку">⠿</span><input list="units-list" class="unit-input" name="unit-${row.id}" autocomplete="off" value="${escapeHtml(row.unit)}" title="${escapeHtml(window.fleetMetaTitle ? window.fleetMetaTitle(row.id) : "")}" placeholder="номер" />${dispHtml(row)}<div class="row3">${blinkIcoHtml()}<button class="cmpl-btn" hidden title="Все точки пройдены — завершить трип (уйдёт в «Завершённые», оттуда можно вернуть)">✓ Завершить</button></div></td>
      <td class="status-cell ${statusClass}">${statusHtml}</td>
      <td>
        <div class="target-wrap${hideK(row, 0) ? " fold-hide" : ""}">
          <span class="lead">${!folded(row) || foldVisible(row)[0] === 0 ? foldBtnHtml(row, cached) : ""}</span><span class="stop-n">${multi ? numChip(1, ptLo(row)) : ""}</span>
          <button class="lo-btn ${ptBtnClass(row)}"${ptkAttr(pointKind(row.target, cached && cached.targetAddress, ptTruckNo(row)))} title="${escapeHtml(ptBtnTitle(row))}">${ptBtnText(row)}</button>
          ${cached && cached.targetBadge ? cached.targetBadge : '<span class="cc-badge target-cc" hidden></span>'}
          <input list="points-list" class="target-input" name="target-${row.id}" autocomplete="off" value="${escapeHtml(row.target)}" title="${escapeHtml(row.target) || 'ГПС, название, машина, код, город'}" placeholder="ГПС, название, машина, код, город" />
          ${multi ? '<button class="stop-x" data-k="0" title="Убрать эту точку">×</button>' + addStopHtml(row, 0) : '<span class="stop-x-sp"></span><button class="add-stop" data-k="0" title="Добавить ещё таргет (следующая выгрузка / погрузка)">+</button>'}
        </div>
        ${extraTargetsHtml(row, cached)}
      </td>
      <td class="delivery-td"><input class="delivery-input${hideK(row, 0) ? " fold-hide" : ""}" name="delivery-${row.id}" autocomplete="off" value="${escapeHtml(row.delivery)}" title="${escapeHtml(row.delivery)}" placeholder="${deliveryPlaceholder(ptLo(row))}" />${(row.extra || []).map((x, i) =>
        `<input class="xd-input${hideK(row, i + 1) ? " fold-hide" : ""}" data-k="${i + 1}" name="delivery-${row.id}-${i + 1}" autocomplete="off" value="${escapeHtml(x.delivery)}" title="${escapeHtml(x.delivery)}" placeholder="${deliveryPlaceholder(ptLo(x))}" />`).join("")}</td>
      <td class="dist-cell ${distMuted}">${distHtml}</td>
      <td class="eta-cell ${etaMuted}${cached && cached.late ? " eta-late" : ""}" title="${escapeHtml(composedEta ? composedEta.title : (cached && cached.etaTip ? cached.etaTip : ""))}">${etaHtml}</td>
      <td class="note-cell"><div class="note-wrap"><input class="note-input" name="note-${row.id}" autocomplete="off" value="${escapeHtml(row.note)}" title="${escapeHtml(row.note)}" placeholder="примечание" />${comBtnHtml(row.com, 0)}</div>${(row.extra || []).map((x, i) =>
        `<div class="note-wrap xn-wrap${hideNoteK(row, i + 1) ? " fold-hide" : ""}"><input class="xn-input" data-k="${i + 1}" name="note-${row.id}-${i + 1}" autocomplete="off" value="${escapeHtml(x.note || "")}" title="${escapeHtml(x.note || "")}" placeholder="примечание к ${i + 2}" />${comBtnHtml(x.com, i + 1)}</div>`).join("")}</td>
      <td class="cl-cell"><input class="cl-input" name="client-${row.id}" autocomplete="off" value="${escapeHtml(row.client || "")}" title="${escapeHtml(row.client || "")}" placeholder="client" />${markBtnHtml(row)}</td>
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
  if (window.PrepMap) window.PrepMap.sync();   // v3.179: плашки кодов у трипов без машины
  if (window.slotQuickUpdate) window.slotQuickUpdate();   // v3.180: быстрые кнопки T / +1 / +2 (только VL)
  updateFleetCount();
}

// v3.156: «Флот (N)» — все активные строки с машиной, фильтры на число не влияют
function updateFleetCount() {
  const el = document.getElementById("fleet-count");
  if (!el) return;
  const n = rows.filter((r) => r.unit).length;
  el.textContent = n ? ` (${n})` : "";
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

    // v3.177: цветная метка под клиентом — клик: прозрачная → оранж → cyan → зелёная → жёлтая; поле строки mark (0–4)
    const markB = tr.querySelector(".cl-mark");
    if (markB) markB.addEventListener("click", (e) => {
      e.stopPropagation();
      const row = rows.find((r) => r.id === id);
      if (!row) return;
      const c = ((Number(row.mark) || 0) + 1) % MARK_NAMES.length;
      setRowField(id, "mark", c || null);
      markB.dataset.c = String(c);
      markB.title = "Метка: " + MARK_NAMES[c] + " — клик, следующий цвет";
    });

    tr.querySelector(".lo-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      const row = rows.find((r) => r.id === id);
      if (!row) return;
      if (row.swap || ptTruckNo(row)) return;   // v3.108: у встречи с траком / перецепа тип не меняем
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
      const c = lastCalcText[id];
      if (c && c.allDone) { closeRowMenus(); return completeTrip(id); }
      // v3.146: подтверждение — карточка у пункта меню, не системное окно (позиция снята до закрытия меню)
      const r0 = e.currentTarget.getBoundingClientRect();
      closeRowMenus();
      openSwapPop({ getBoundingClientRect: () => r0 }, "Не все точки трипа пройдены", "Всё равно завершить?",
        [{ text: "Завершить", ok: true, fn: () => completeTrip(id) }, { text: "Отмена" }]);
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
      freshEmptyIds.add(nr.id);
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
      shiftDoneFlags(id, k + 1, 1);   // v3.136: авто-✓ едут вместе с точками — строка не меняет L / O и не прячется фильтром
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
      removeStop(id, Number(b.dataset.k), b);
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
      if (x.swap || ptTruckNo(x)) return;   // v3.108
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
      if (typeof setWorkRow === "function") setWorkRow(id);          // v3.149: любой клик в трипе — строка «в работе»
      fuelSeenClick(tr, id);                                          // v3.30: мало топлива — тоже
      reeferSeenClick(tr, id);                                        // v3.34: тревога рефа — тоже
      // v3.163: Ctrl/Cmd+клик по полю таргета — вкладка «Адреса» с карточкой адреса из поля
      if (e.target.tagName === "INPUT" && (e.ctrlKey || e.metaKey) && window.addrOpenFor
          && (e.target.classList.contains("target-input") || e.target.classList.contains("xt-input"))) {
        window.addrOpenFor(e.target.value);
        return;
      }
      if (e.target.tagName === "INPUT" || e.target.tagName === "BUTTON") return;
      if (e.target.closest && e.target.closest(".com-tri")) return;
      const chip = e.target.closest && e.target.closest(".stop-n");
      if (chip && chip.querySelector(".pn-chip")) {                 // v1.79: ✓ пройдена / нет
        const w = chip.closest(".target-wrap");
        const kk = w.classList.contains("x-stop") ? Number(w.dataset.k) : 0;
        if (swapChipClick(id, kk, chip)) return;   // v3.108: точка с траком в цели — вопрос про перецеп
        if (armDoneClick(chip, id, kk)) return;    // v3.159: отметка ✓ — первый клик взводит, второй ставит / снимает
        toggleDone(id, kk);
        return;
      }
      const cc = e.target.closest && e.target.closest(".cc-badge");
      if (cc && !cc.hidden) {                                         // v3.48: значок страны — открыть ⏱ с данными строки
        const w = cc.closest(".x-stop");                              // у точки ②③… — расчёт до неё
        ecFromRow(id, true, w ? Number(w.dataset.k) : null);
        return;
      }
      if (e.target.closest && e.target.closest(".ot-pill")) { otPillClick(id); return; }   // v3.130: плашка «на точке»
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
      ? `<span class="cc-badge x-cc${ptFlagCls(ce.badge)}"${ptFlagStyle(ce.badge)} title="${escapeHtml(ce.badgeHint || ce.badge)}">${escapeHtml(ce.badge)}</span>`
      : '<span class="cc-badge x-cc" hidden></span>';   // v3.22: пустое место той же ширины — поля ровные
    const last = k === ex.length;
    const hide = hideK(row, k) ? " fold-hide" : "";
    const fv = folded(row) ? foldVisible(row) : null;
    return `<div class="target-wrap x-stop${hide}" data-k="${k}">
      <span class="lead">${fv && fv[0] === k ? foldBtnHtml(row, cached) : ""}</span><span class="stop-n">${numChip(k + 1, ptLo(x))}</span>
      <button class="lo-btn xlo-btn ${ptBtnClass(x)}"${ptkAttr(pointKind(x.target, ce && ce.address, ptTruckNo(x)))} data-k="${k}" title="${escapeHtml(ptBtnTitle(x))}">${ptBtnText(x)}</button>
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
    const dkm = ce && ce.done && ce.done_leg_km != null ? Math.round(ce.done_leg_km) : null;   // v3.122: км пройденной точки — серым, зачёркнуто
    const txt = ce && ce.done ? (dkm != null ? `<span class="done-km done-km-n">${dkm}</span>` : '<span class="done-km">✓</span>') : ce && ce.leg_km != null ? String(Math.round(ce.leg_km)) : "—";   // v3.35: без десятых
    const tip = dkm != null ? `${dkm} км от точки ${STOP_NUM[i + 1]} (пройдена)` : ce && ce.leg_km != null ?`${Math.round(ce.leg_km)} км от точки ${STOP_NUM[i + 1]} (от машины всего ${Math.round(ce.dist_km)})${totalTip}` : (ce && ce.error) || "";   // v3.45: км до целого
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
    const chk = ce && !ce.done && !ce.error ? slotCheck(x.delivery, (nbAt === i && c.onArr) || ce.eta_tacho || ce.eta_local) : { late: false, lines: [] };
    const lateCls = chk.late ? " sl-late" : "";
    if (ce && ce.done) {
      inner = doneEtaHtml(ce);
      tip = ce.done_by != null ? `Точка пройдена: пройдена следующая ${STOP_NUM[ce.done_by + 1]}`
        : ce.done_auto ? `Точка пройдена: трак стоял ${ce.done_zone ? "в зоне «" + ce.done_zone + "»" : "здесь"}${ce.done_arr ? " с " + ce.done_arr : ""}, уехал ${ce.done_at}`
        : (ce.done_msrc && ce.done_at ? `Отмечена пройденной вручную, время ${ce.done_at} (${ce.done_msrc === "mapon" ? "отъезд со стоянки Mapon" : "момент нажатия"})` : "Отмечена пройденной вручную");
    } else if (ce && ce.error) {
      inner = `<span class="eta-x-err">${escapeHtml(ce.error)}</span>`;
      tip = ce.error;
    } else if (ce && (ce.eta_tacho || ce.eta_local)) {
      const wk = ce.tacho_weeklimit ? '<span class="wk-mark" title="Недельный лимит вождения кончится по пути">56</span>' : "";
      const fb = ce.ferry ? `<button type="button" class="fer-b${ce.ferry.manual ? " fer-man" : ""}${ce.ferry.late ? " fer-late" : ""}" data-i="${i}" title="Паром: ${escapeHtml(ce.ferry.label)}${ce.ferry.manual ? " (выбран вручную)" : " (авто)"}. Клик — выбрать другую линию">⛴${ce.ferry.late ? "⚠" : ""}</button>` : "";   // v3.193
      inner = `${wk}<span class="eta-x-t">⏱ ${escapeHtml(ce.eta_tacho || ce.eta_local)}${tzBadge(ce.eta_tz)}</span>${fb}`;
      tip = [`Точка ${STOP_NUM[i + 2]}: ${x.target}`,
             `${ce.leg_km.toFixed(1)} км от точки ${STOP_NUM[i + 1]}, всего ${ce.dist_km.toFixed(1)} км`,
             ce.ferry ? `⛴ ${ce.ferry.label}: ${ce.ferry.hours} ч + Gate-In ${ce.ferry.gate_in_h} ч${ce.ferry.dep ? `, отход ${ce.ferry.dep}` : ""}, в порту назначения ~${ce.ferry.arrive}` : "",   // v3.191
             ce.ferry && ce.ferry.late ? `⚠ Не успевает к Gate-In: в порту ~${ce.ferry.port_arr}, отход ${ce.ferry.dep} (минус ${ce.ferry.gate_in_h} ч) — считаем как без расписания` : "",   // v3.192
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

function removeStop(id, k, anchor, confirmed) {
  const row = rows.find((r) => r.id === id);
  if (!row || !row.extra || !row.extra.length) return;
  // v3.11: у точки свой комментарий — спросить; v3.146: карточка у крестика, не системное окно
  const own = k > 0 ? row.extra[k - 1] : null;
  if (own && own.com && !confirmed && anchor) {
    openSwapPop(anchor, `У точки ${STOP_NUM[k + 1]} есть комментарий`, "Удалить вместе с ним?",
      [{ text: "Удалить", ok: true, fn: () => removeStop(id, k, null, true) }, { text: "Отмена" }]);
    return;
  }
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
  shiftDoneFlags(id, k, -1);   // v3.136: то же при удалении точки
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
  // v3.13: точка ① уже пройдена (✓ авто или вручную) — дата в прошлом нормальна
  const c = lastCalcText[row.id];
  const passed = (row.done && row.done[0] === true) || !!(c && c.doneFlags && c.doneFlags[0] && c.doneFlags[0].done);
  const bad = !passed && !!(ref && Date.now() - ref.getTime() > 2 * 86400000);
  inp.classList.toggle("del-suspect", bad);
  inp.title = bad ? `${row.delivery}\n⚠ Дата в прошлом — проверь (опечатка?)` : (row.delivery || "");
}

// v1.48: NoBan — кнопка в начале ETA. 🚫 (розовая) — полный запрет по пути, клик → NoBan;
// NB (зелёная) — NoBan включён, запреты не показываем; ⊘ (бледная) — запретов нет.
// v3.82: трак стоит на объекте первой непройденной точки k — в её ETA время ПРИЕЗДА вместо расчётного ⏱
// (зелёное; красное, если приехал позже окна TimeSlot). Уехал — дальше работает «✓ время отъезда».
function onSiteArr(row, data, k) {
  const ot = data.on_target;
  if (!ot || !ot.arr) return null;
  const pt = k === 0 ? row : ((row.extra && row.extra[k - 1]) || {});
  const chk = slotCheck(pt.delivery, ot.arr);
  const tip = `📍 Приехал ${ot.arr}, стоит на объекте${data.duration_str ? " " + data.duration_str : ""}. Уедет — здесь будет время отъезда`;
  return { arr: ot.arr, late: chk.late, lines: chk.lines, tip,
           html: `<span class="eta-x-t eta-arr${chk.late ? " eta-arr-late" : ""}" title="${escapeHtml(tip)}">📍 ${escapeHtml(ot.arr)}${tzBadge(data.eta_tz)}</span>` };
}
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
    if (field === "unit") { delete row.done; updateFleetCount(); }
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

  // v3.124: прежний статус не затираем «…» — приглушаем строку (calc-busy), пока идёт расчёт, чтобы можно было работать;
  // «…» — только когда статуса ещё нет (первое открытие)
  if (statusCell.querySelector(".status-line")) tr.classList.add("calc-busy");
  else { statusCell.textContent = "…"; statusCell.className = "status-cell muted"; }

  try {
    const res = await fetch("/api/calc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign(
        { unit: row.unit, target: row.target },
        row.extra && row.extra.length ? { extra: row.extra.map((x) => x.target || "") } : {},
        row.ferry ? { ferry: row.ferry } : {},   // v3.193: линию парома выбрал диспетчер
        ferryDeps(row),   // v3.192: отход парома из «Даты» точки-порта
        row.trailer ? { trailer: row.trailer } : {},
        row.crew ? { crew: row.crew } : {},
        row.crewSeen && row.crewSeen.u === row.unit ? { crew_seen: Math.floor(row.crewSeen.t / 1000) } : {},   // v3.105: память «экипаж»
        row.x10 ? { x10: true } : {},                                    // v3.39: 10-й час сегодня
        row.corridor ? { corridor: row.corridor } : {},                 // v3.32: коридор выбрал диспетчер
        { done: doneManualArray(row), done_seen: doneSeenArray(row), done_arr: doneArrArray(row), done_click: doneClickArray(row), why: why || "edit" })),
    });
    const data = await res.json();
    if (!data.error) { keepDoneSeen(row, data); keepCrewSeen(row, data); remapDone(data); }

    if (data.error) {
      statusCell.textContent = data.error;
      statusCell.className = "status-cell";
      distCell.textContent = "—";
      etaCell.textContent = "—";
      delete lastCalcText[id];
      return;
    }

    // v1.31: плашка страны, где машина сейчас
    const flagBg = FLAG_BG[data.unit_country];   // v3.167: цвета флага страны
    const ccBadge = data.unit_country
      ? `<span class="cc-badge${flagBg ? " cc-flag" : ""}"${flagBg ? ` style="background:${flagBg}"` : ""} title="${escapeHtml(data.unit_code_hint || data.unit_country)}">${escapeHtml(data.unit_country)}</span>`
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
    const otLo = otIdx ? ptLo(row.extra[otIdx - 1]) : ptLo(row);
    // v3.112: булавка убрана — вместо неё номер точки в кружке (у одной точки тоже)
    const ot = data.on_target
      ? `<span class="ot-pill" title="${escapeHtml(data.on_target.how === "object" ? "На объекте Mapon: " + data.on_target.name : "В радиусе 300 м от таргета")}">${numChip(otIdx + 1, otLo)} на точке</span>` : "";
    // v1.70: прицеп — рефка; сцепка тягач ↔ прицеп (угадана по координатам)
    const trTag = data.is_trailer ? '<span class="trl-tag" title="Прицеп">П</span>' : "";
    const reeferHtml = data.is_trailer ? reeferPillHtml(data, row) : "";
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
      line2 = `<div class="status-line2">${tfHtml}${linkedTrailerHtml(row.trailer, data.linked_trailer, row)}</div>`;
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
    let onArr = null;               // v3.82: время приезда, пока трак на объекте первой непройденной точки
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
        ? `<span class="eta-tacho">⏱ ${escapeHtml(data.eta_tacho)}${tzBadge(data.eta_tz)}</span>`   // v3.18: серое простое ETA — только в подсказке; v3.143: «лок.» — местное время страны точки
        : `<span class="eta-tacho eta-only">${escapeHtml(data.eta_local)}${tzBadge(data.eta_tz)}</span>`;
      // v1.46: "56" — одиночка упирается в недельный лимит вождения, стоп до пн 00:00 UTC
      if (data.tacho_weeklimit) {
        etaText = `<span class="wk-mark" title="Недельный лимит вождения кончится по пути — стоп до пн 00:00 UTC (02:00 CEST), учтено в ⏱ ETA">56</span>` + etaText;
      }
      const osa = onSiteArr(row, data, 0);
      if (osa) { etaText = osa.html; onArr = osa.arr; }
      etaCore = etaText;
      bansR = (data.bans_route || []).slice();
      (data.extra || []).forEach((x, i) => (x.bans_route || []).forEach((b) => bansR.push(`${STOP_NUM[i + 1]}→${STOP_NUM[i + 2]} ${b}`)));
      nearR = banNearLines(data);
      banInfo = banInfoLines(data);
      const chk = deliveryCheck(row, onArr || data.eta_tacho || data.eta_local);
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
      if (osa) tip.unshift(osa.tip);
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
        const osa = onSiteArr(row, data, act0);
        if (osa) onArr = osa.arr;
        etaCore = osa ? osa.html : `${wk}<span class="eta-x-t">⏱ ${escapeHtml(et || "—")}${tzBadge(data.eta_tz)}</span>`;
        bansR = (data.bans_route || []).slice();
        (data.extra || []).forEach((x, i) => (x.bans_route || []).forEach((b) => bansR.push(`${STOP_NUM[i + 1]}→${STOP_NUM[i + 2]} ${b}`)));
        nearR = banNearLines(data);
        banInfo = banInfoLines(data);
        tipLines = ["Простой ETA: " + (data.eta_local || "—")].concat(data.eta_tacho ? ["⏱ По тахографу: " + data.eta_tacho] : [])
          .concat(data.route_countries && data.route_countries.length > 1 ? ["Страны: " + data.route_countries.join(" → ")] : []);
        if (osa) tipLines.unshift(osa.tip);
        Object.assign(cx, { etaCore, bansR, tipLines, nearR, banInfo, nbAt: act0 - 1, onArr });
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
      ? `<span class="target-cc-wrap target-cc"><span class="cc-badge${ptFlagCls(data.target_badge)}"${ptFlagStyle(data.target_badge)} title="${escapeHtml(data.target_code_hint || data.target_badge)}">${escapeHtml(data.target_badge)}</span>${dovoz}</span>`
      : '<span class="cc-badge target-cc" hidden></span>';
    const oldTb = tr.querySelector(".target-cc");
    if (oldTb) oldTb.outerHTML = targetBadge;

    const wasWait = awaitsComplete(row);   // v3.81
    const fv0 = folded(row) ? foldVisible(row).join() : "";   // v3.11: окно свёрнутых точек до расчёта
    lastCalcText[id] = { targetAddress: data.first_done ? null : (data.target_address || null),   // v3.199: при пройденной ① адрес в ответе — первой активной точки, не ①
                          status: statusHtml, statusClass: statusClass, dist: distText, eta: etaText, etaTip, targetBadge, late, anyLate, etaCore, bansR, tipLines, nearR, banInfo, onArr,
                         etaStr: onArr || data.eta_tacho || data.eta_local, extra: extraCalc(data),
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
    lastDoneFlags[id] = lastCalcText[id].doneFlags;   // v3.136: запас для пересчёта после вставки / удаления точки
    applyDoneClasses(tr, row, lastCalcText[id]);
    // v3.81: трип стал «ждущим завершения» (или перестал) — поднять / опустить; не во время набора текста
    if (awaitsComplete(row) !== wasWait) {
      const ae = document.activeElement;
      if (!(ae && ae.closest && ae.closest("#fleet-tbody"))) setTimeout(resort, 0);
    }
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
      setPtk(w.querySelector(".xlo-btn"), pointKind(row.extra[i] && row.extra[i].target, ce.address, ptTruckNo(row.extra[i])));   // v3.195: именная плашка
      w.querySelector(".xlo-btn").insertAdjacentHTML("afterend", ce.badge
        ? `<span class="cc-badge x-cc${ptFlagCls(ce.badge)}"${ptFlagStyle(ce.badge)} title="${escapeHtml(ce.badgeHint || ce.badge)}">${escapeHtml(ce.badge)}</span>`
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
      try { updateMarker(id, data.unit_lat, data.unit_lng, data.number, data.status, data.direction, data.dist_km, data.is_trailer, badgeTargetText(row)); }
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
        ferries: (data.extra || []).filter((x) => x.ferry && x.ferry.from_ll).map((x) => [x.ferry.from_ll, x.ferry.to_ll]),   // v3.192: пунктир порт → порт
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
      if (tr) setPtk(tr.querySelector(".lo-btn"), pointKind(row.target, data.first_done ? null : data.target_address, ptTruckNo(row)));   // v3.195: именная плашка

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
          data.dist_km != null ? fmtKm(data.dist_km) : "", data.target_is_truck ? "" : tgtLine(row.target));
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
          x.leg_km != null ? fmtKm(x.leg_km) : "", tgtLine(ex.target));   // v1.78: без "+"; v3.102: таргет точки
      });
    }
  } catch (e) {
    console.error("calcRow", e);
    statusCell.textContent = "Ошибка запроса";
  } finally {
    tr.classList.remove("calc-busy");   // v3.124
    rowCalcAt[id] = Date.now();         // v3.126: фон ↻ пропускает свежие строки
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
// v3.119: плашка рефа — переключатель Temp / NoTemp (поле строки noTemp; NoTemp — груз без температуры, тревоги рефа выключены)
function reeferPillHtml(data, row) {
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
  if (row && row.noTemp) {
    lines.push("NoTemp: тревоги рефа выключены, клик — вернуть Temp");
    return `<span class="rf-pill rf-nt rf-tog" data-nt="1" title="${escapeHtml(lines.join("\n"))}">NoTemp${fuel}</span>`;
  }
  const cls = r.warn || r.fuel_low ? "rf-warn" : on.length ? "rf-on" : "rf-off";
  const tog = row ? " rf-tog" : "";
  if (row) lines.push("Клик — NoTemp (груз без температуры, тревоги рефа выключатся)");
  return `<span class="rf-pill ${cls}${tog}" title="${escapeHtml(lines.join("\n"))}">${escapeHtml(txt)}${fuel}</span>`;
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
function linkedTrailerHtml(number, lt, row) {
  const un = `<button class="trl-unlink" title="Отвязать прицеп (вернётся отдельной строкой)">×</button>`;
  if (!lt) return `<span class="hitch-pill">🔗 ${escapeHtml(number)}</span>${un}`;
  if (lt.error) return `<span class="hitch-pill rf-warn" title="${escapeHtml(lt.error)}">🔗 ${escapeHtml(number)} ?</span>${un}`;
  const far = lt.far ? `<span class="trl-far" title="Прицеп в ${escapeHtml(fmtKm(lt.km))} от тягача — перецепили?">⚠ ${escapeHtml(fmtKm(lt.km))}</span>` : "";
  return `<span class="hitch-pill" title="Привязанный прицеп${lt.km != null ? " · " + fmtKm(lt.km) + " от тягача" : ""}">🔗 ${escapeHtml(lt.number)}</span>${un}${reeferPillHtml(lt, row)}${far}`;
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
  // над первой видимой строкой (① или первая точка свёрнутого трипа) — пустая полоса сверху у каждой ячейки,
  // в Таргете в ней полоска (иначе колонки, где у этой точки нет своей строки, съезжают)
  if (i === 0 || (folded(row) && i === foldVisible(row)[0])) {
    tr.querySelectorAll(":scope > td").forEach((td) => td.insertAdjacentHTML("afterbegin", '<div class="cor-sp"></div>'));
    const tw = i === 0 ? tr.querySelector(".target-wrap:not(.x-stop)") : tr.querySelector(`.x-stop[data-k="${i}"]`);
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

// v1.64: ответ сервера по следующим точкам -> то, что держим в lastCalcText
// v3.192: {dep: {текст точки: начало окна «Даты» (сек)}} — для расчёта отхода парома; пусто — поле не шлём
function ferryDeps(row) {
  const dep = {};
  [{ target: row.target, delivery: row.delivery }].concat(row.extra || []).forEach((p) => {
    const t = String(p.target || "").trim();
    const w = t && p.delivery ? parseDeliveryWindow(p.delivery) : null;
    if (w && w.start) dep[t.toLowerCase()] = Math.floor(w.start.getTime() / 1000);
  });
  return Object.keys(dep).length ? { dep } : {};
}

function extraCalc(data) {
  return (data.extra || []).map((x) => ({
    error: x.error || null,
    done: !!x.done, done_at: x.done_at || null, done_arr: x.done_arr || null, done_tz: x.done_tz || null, eta_tz: x.eta_tz || null, done_auto: !!x.done_auto, from_truck: !!x.from_truck,
    done_by: x.done_by != null ? x.done_by : null, done_zone: x.done_zone || null,
    dist_km: x.dist_km, leg_km: x.leg_km,
    eta_tacho: x.eta_tacho || null, eta_local: x.eta_local || null,
    tacho_weeklimit: !!x.tacho_weeklimit,
    badge: x.badge || null, badgeHint: x.badge_hint || null,
    address: x.target_address || null,
    ferry: x.ferry || null,   // v3.191/v3.192
  }));
}

// v3.103: подсказка автообновления — время последнего пересчёта всех строк (и автоматического, и ↻)
let lastCalcAt = 0;
function updateAutoTip() {
  const lbl = document.querySelector(".auto-lbl");
  if (!lbl) return;
  if (!lbl.dataset.tipBase) lbl.dataset.tipBase = lbl.title || "";
  const t = lastCalcAt ? new Date(lastCalcAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : "";
  lbl.title = lbl.dataset.tipBase + (t ? "\nПоследнее обновление: " + t : "");
}
// v3.126: ↻ — сначала строки на экране (прошли фильтры), остальные в фоне по 2 за раз; свежие (< 2 мин) в фоне пропускаются
const rowCalcAt = {};
const BG_FRESH_MS = 2 * 60 * 1000;
let bgToken = 0;
function calcAllRows(opts) {
  const kind = (opts && opts.auto) ? "auto" : ((opts && opts.kind) || "manual");
  const todo = rows.filter((r) => r.unit);
  const vis = todo.filter((r) => rowPassesFilter(r));
  const rest = todo.filter((r) => !vis.includes(r));
  const token = ++bgToken;   // новый проход отменяет фон предыдущего
  const btns = document.querySelectorAll(".bar-refresh");   // v3.43: верхняя и нижняя панель
  let left = vis.length;
  const show = () => {
    btns.forEach((btn) => {
      btn.textContent = left > 0 ? `↻ ${vis.length - left}/${vis.length}` : "↻";
      btn.classList.toggle("busy", left > 0);
    });
  };
  show();
  const t0 = performance.now();
  let slow = { unit: "", sec: 0 };
  const run = (r) => {
    const t1 = performance.now();
    return Promise.resolve(calcRow(r.id, kind === "auto" ? "auto" : "all")).finally(() => {
      const sec = (performance.now() - t1) / 1000;
      if (sec > slow.sec) slow = { unit: r.unit, sec };
    });
  };
  const jobs = vis.map((r) => run(r).finally(() => { left -= 1; show(); }));
  // v1.53: после "Обновить всё" (и загрузки) — пересортировать по выбранному режиму;
  // v1.59: автообновление строки не переставляет
  const resortAfter = kind !== "auto";
  return Promise.allSettled(jobs).then(() => {
    const secVis = (performance.now() - t0) / 1000;
    lastCalcAt = Date.now(); updateAutoTip(); if (resortAfter) resort();
    // фон: невидимые строки, не свежие; при смене фильтра ставшие видимыми идут первыми
    // v3.156: автообновление считает только строки на экране; скрытые фильтром (чужие) — при загрузке, по ↻ и когда стали видимыми
    const queue = kind === "auto" ? [] : rest.filter((r) => Date.now() - (rowCalcAt[r.id] || 0) > BG_FRESH_MS);
    const worker = async () => {
      while (queue.length && token === bgToken) {
        const i = queue.findIndex((r) => rowPassesFilter(r));
        await run(queue.splice(i >= 0 ? i : 0, 1)[0]);
      }
    };
    Promise.allSettled([worker(), worker()]).then(() => {
      if (token !== bgToken) return;   // проход вытеснен новым — не считаем
      const secFull = (performance.now() - t0) / 1000;
      try {
        fetch("/api/refresh-stat", { method: "POST", headers: { "Content-Type": "application/json" }, keepalive: true,
          body: JSON.stringify({ kind, rows: todo.length, rows_visible: vis.length, sec_visible: secVis, sec_full: secFull,
                                 slowest_unit: slow.unit, slowest_sec: slow.sec }) }).catch(() => {});
      } catch (e) { /* статистика не критична */ }
    });
  });
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
  updateAutoTip();
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
      bar.querySelectorAll("button[data-sort]").forEach((b) => {
        if (b.hasAttribute("data-sort-toggle")) {   // v3.173: одна кнопка направления — «L → O» ⇄ «O → L»
          const d = sortDir();
          b.dataset.sort = d;
          b.textContent = d === "LO" ? "L → O" : "O → L";
          b.title = d === "LO" ? "Сначала погрузки, потом выгрузки; клик — переключить на O → L"
            : "Сначала выгрузки, потом погрузки; клик — переключить на L → O";
        }
        b.classList.toggle("on", b.dataset.sort === sortMode);
      });
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
    if (b.hasAttribute("data-sort-toggle")) {
      // уже сортируем по направлению — переключаем на обратное; были «руками» — возвращаем последнее направление
      sortMode = sortMode === "LO" ? "OL" : sortMode === "OL" ? "LO" : sortDir();
    } else sortMode = b.dataset.sort;
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
  const nr = emptyRow();
  freshEmptyIds.add(nr.id);
  rows.push(nr);
  saveRows();
  // пустая строка видна только своему диспетчеру: при чужом фильтре переключаемся на себя, иначе строка сразу пропадёт
  if (!rowPassesOwn(nr)) {
    const b = document.querySelector(`.own-flt button[data-own="${fleetMe()}"]`) || document.querySelector('.own-flt button[data-own="all"]');
    if (b) b.click();
  }
  renderRows();
  // новая строка — в конце длинной таблицы: прокручиваем к ней и ставим курсор в поле машины
  const added = document.querySelector(`#fleet-tbody tr[data-id="${nr.id}"]`);
  if (added) {
    added.scrollIntoView({ behavior: "smooth", block: "center" });
    const inp = added.querySelector(".unit-input");
    if (inp) inp.focus();
  }
});

document.getElementById("refresh-btn").addEventListener("click", () => calcAllRows({ kind: "manual" }));

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
if (window.fleetSync) window.fleetSync.start(); else calcAllRows({ kind: "open" });

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
    dimRoute(id);                                                  // v3.84: старая линия бледнее, пока считаем
    Promise.resolve(calcRow(id, "edit")).finally(() => refreshRoute(id));   // v3.84: новая линия — сразу, без сдвига карты
  });
});

// v3.193: ⛴ у ETA точки после порта — меню выбора линии парома; выбор хранится в трипе, строка пересчитывается
document.getElementById("fleet-tbody").addEventListener("click", (e) => {
  const b = e.target.closest(".fer-b");
  if (!b) return;
  e.stopPropagation();
  const id = Number(b.closest("tr").dataset.id);
  const row = rows.find((r) => r.id === id);
  const ce = row && lastCalcText[id] && (lastCalcText[id].extra || [])[Number(b.dataset.i)];
  if (!ce || !ce.ferry) return;
  ferryMenu(b, ce.ferry, row.ferry || null, (lineId) => {
    if (lineId) row.ferry = lineId; else delete row.ferry;
    saveRows();
    dimRoute(id);
    Promise.resolve(calcRow(id, "edit")).finally(() => refreshRoute(id));
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
