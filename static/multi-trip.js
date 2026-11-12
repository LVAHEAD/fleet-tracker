/*
multi-trip.js — машина в нескольких трипах Флота (v3.247, песочница Version 56).
Трипы машины считаем по всему Флоту (у всех диспетчеров), по номеру тягача (unitKey из unit-filter.js).
Б — синий пунктир под номером машины (класс .mt-dot), наведение через 1 с — карточка трипов машины
    (по дате ①, каждый трип в цвет своего диспетчера, клик — к строке, между трипами — стык «запас» / «не успевает»).
А — при вводе номера машины, у которой уже есть другой трип во Флоте, — карточка-предупреждение у поля (openSwapPop).
В — галочка «только машины с 2+ трипами» в окне «Машина ▼» (unit-filter.js).
Стык — простая сверка уже посчитанного ETA последней точки с началом слота ① следующего трипа, без нового расчёта.
Опирается на глобалы app.js / dispatchers.js / delivery-check.js (rows, escapeHtml, dispEntry, dispLabel, rowDisp, shadeHex,
parseDeliveryWindow, openSwapPop, fleetMetaTitle) — во время работы. Грузится ДО app.js.
*/

function multiTripRows(unit) {
  const k = unitKey(unit);
  if (!k) return [];
  return rows.filter((r) => r && r.unit && unitKey(r.unit) === k);
}
function mtSlotStart(r) {
  try { const w = parseDeliveryWindow(String(r.delivery || "")); return (w && (w.start || w.end)) || null; } catch (e) { return null; }
}
function mtSorted(list) {
  return list.slice().sort((a, b) => { const x = mtSlotStart(a), y = mtSlotStart(b); return (x ? +x : 9e15) - (y ? +y : 9e15); });
}
// v3.277: стык между трипами — км по дороге от последней точки трипа до ① следующего (вместо запаса по времени); /api/trip-gap, кеш на странице
const MT_KM = {}, MT_PEND = {};
function mtLastTarget(r) {
  const ex = r.extra || [];
  for (let i = ex.length - 1; i >= 0; i--) { const t = ex[i] && String(ex[i].target || "").trim(); if (t) return t; }
  return String(r.target || "").trim();
}
function mtGapText(n, v) {
  if (v === undefined) return `↓ … км до ① трипа ${n}`;
  if (typeof v === "number") return `↓ ${Math.round(v).toLocaleString("ru-RU")} км до ① трипа ${n}`;
  return `↓ до ① трипа ${n}: ${v}`;
}
function mtGapLoad(a, b) {   // → число км или текст ошибки; числа помнятся (плечо на сервере кешируется 30 дней)
  const k = a + "|" + b;
  if (!a || !b) return Promise.resolve("нет точки");
  if (typeof MT_KM[k] === "number") return Promise.resolve(MT_KM[k]);
  if (!MT_PEND[k]) {
    MT_PEND[k] = fetch("/api/trip-gap", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from: a, to: b }) })
      .then((r) => r.json())
      .then((d) => { if (typeof d.km === "number") MT_KM[k] = d.km; return typeof d.km === "number" ? d.km : (d.error || "не посчитать"); })
      .catch(() => "не посчитать")
      .finally(() => { delete MT_PEND[k]; });
  }
  return MT_PEND[k];
}
function mtLine(r) {
  const d = mtSlotStart(r);
  const p = (n) => String(n).padStart(2, "0");
  return [r.client || "без клиента", r.ref, d && `① ${p(d.getDate())}.${p(d.getMonth() + 1)}`, dispLabel(rowDisp(r))].filter(Boolean).join(" · ");
}

// Б: пунктир под номером у всех строк, чья машина есть во Флоте ещё раз (зовётся после каждой перерисовки — renderRowsTail)
function pairBadge(tr, row, pair) {
  const cell = tr.querySelector(".unit-cell");
  if (!cell) return;
  let b = cell.querySelector(".mt-pair");
  const t = pair.get(tr.dataset.id);
  if (!t) { if (b) b.remove(); return; }
  if (!b) { b = document.createElement("span"); b.className = "mt-pair"; cell.appendChild(b); }
  if (b.textContent !== t) b.textContent = t;
}

function markMultiTrips() {
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  const cnt = new Map();
  rows.forEach((r) => { const k = r && r.unit ? unitKey(r.unit) : ""; if (k) cnt.set(k, (cnt.get(k) || 0) + 1); });
  // v3.255: значок «1/2», «2/2» — только при «2+ трипа» и сортировке «По загрузке»; порядок — как на экране
  const pairOn = typeof unitMultiOnly !== "undefined" && unitMultiOnly && typeof sortMode !== "undefined" && sortMode === "load";
  const pair = new Map();
  if (pairOn) {
    const vis = new Map();
    document.querySelectorAll("#fleet-tbody tr[data-id]").forEach((tr) => {
      const r = byId.get(tr.dataset.id), k = r && r.unit && !awaitsComplete(r) ? unitKey(r.unit) : "";   // v3.256: «Завершить» не в счёт
      if (k) vis.set(k, (vis.get(k) || 0) + 1);
    });
    const seen = new Map();
    document.querySelectorAll("#fleet-tbody tr[data-id]").forEach((tr) => {
      const r = byId.get(tr.dataset.id), k = r && r.unit && !awaitsComplete(r) ? unitKey(r.unit) : "";
      if (!k || vis.get(k) < 2) return;
      seen.set(k, (seen.get(k) || 0) + 1);
      pair.set(tr.dataset.id, `${seen.get(k)}/${vis.get(k)}`);
    });
  }
  document.querySelectorAll("#fleet-tbody tr[data-id]").forEach((tr) => {
    const row = byId.get(tr.dataset.id);
    const inp = tr.querySelector(".unit-input");
    if (!row || !inp) return;
    const many = !!row.unit && (cnt.get(unitKey(row.unit)) || 0) > 1;
    pairBadge(tr, row, pair);
    if (inp.classList.contains("mt-dot") === many) return;
    inp.classList.toggle("mt-dot", many);
    // подсказка браузера мешала бы карточке: «кто и когда правил» переезжает в низ карточки
    inp.title = many ? "" : (window.fleetMetaTitle ? window.fleetMetaTitle(row.id) : "");
  });
  // v3.273: машина в таргете (перецеп / встреча — номер тягача из Флота) — тот же синий пунктир, что у машин в нескольких трипах
  const fleetUnits = new Set(rows.filter((r) => r && r.unit).map((r) => unitKey(r.unit)));
  document.querySelectorAll("#fleet-tbody .target-input, #fleet-tbody .xt-input").forEach((inp) => {
    const v = unitKey(inp.value);
    inp.classList.toggle("mt-dot", !!v && fleetUnits.has(v));
  });
}

(function () {
  if (typeof document === "undefined") return;
  let card = null, tShow = null, tHide = null;
  const MT_HOVER = ".unit-input.mt-dot, #fleet-tbody .target-input.mt-dot, #fleet-tbody .xt-input.mt-dot";
  const p2 = (n) => String(n).padStart(2, "0");
  const fmtD = (d) => `${p2(d.getDate())}/${p2(d.getMonth() + 1)}`;
  const trOf = (id) => document.querySelector(`#fleet-tbody tr[data-id="${id}"]`);
  function codes(tr) {
    const c = tr ? Array.from(tr.querySelectorAll(".target-cc .cc-badge, .cc-badge.x-cc")).map((x) => (x.hidden ? "" : x.textContent.trim())).filter(Boolean) : [];
    return c.length ? c[0] + (c.length > 1 ? " → " + c[c.length - 1] : "") : "";
  }
  function etaEnd(tr) {   // ETA последней точки трипа: текст и дата (год — ближайший к сегодня)
    const c = tr && tr.querySelector(".eta-cell");
    if (!c) return { t: "", d: null };
    const ls = c.innerText.split("\n").map((x) => x.replace(/[⏱📍]/g, "").trim()).filter(Boolean);
    const t = ls.length ? ls[ls.length - 1] : "";
    const m = /(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/.exec(t);
    if (!m) return { t, d: null };
    const now = new Date();
    let d = new Date(now.getFullYear(), +m[2] - 1, +m[1], +m[3], +m[4]);
    if (d - now > 180 * 864e5) d.setFullYear(d.getFullYear() - 1);
    else if (now - d > 180 * 864e5) d.setFullYear(d.getFullYear() + 1);
    return { t: m[0], d };
  }
  function hide() { clearTimeout(tShow); if (card) { card.remove(); card = null; } }
  function show(inp) {
    hide();
    const tr = inp.closest("tr[data-id]");
    const me = tr && rows.find((r) => String(r.id) === tr.dataset.id);
    if (!me) return;
    const isT = inp.matches(".target-input, .xt-input");   // машина в таргете: трипы этой машины, без стыков
    const unit = isT ? String(inp.value || "").trim() : me.unit;
    const list = mtSorted(multiTripRows(unit));
    if (list.length < (isT ? 1 : 2)) return;
    let h = `<div class="mtc-h"><b>${escapeHtml(String(unit).trim().toUpperCase())}</b> — трипов во Флоте: ${list.length}</div>`;
    list.forEach((x, i) => {
      const xt = trOf(x.id), e = etaEnd(xt), st = mtSlotStart(x), de = dispEntry(rowDisp(x));
      const dc = (de && de.color) || "#f4f6fa", db = shadeHex(dc, 0.18) || "#c9d3e3";
      const cd = codes(xt);
      // v3.255: у последней точки главная — плановая дата, ETA в скобках; запас считаем от плана (нет плана — от ETA)
      const nPts = 1 + (x.extra ? x.extra.length : 0), lp = typeof pointOf === "function" ? pointOf(x, nPts - 1) : null;
      let pw = null; try { pw = lp && lp.delivery ? parseDeliveryWindow(String(lp.delivery)) : null; } catch (err) { pw = null; }
      const plan = pw && (pw.end || pw.start) || null;
      const pd = plan ? `${fmtD(plan)} ${p2(plan.getHours())}:${p2(plan.getMinutes())}` : "";
      const lastTxt = plan ? `Дата ${pd}${e.t ? ` (ETA ${escapeHtml(e.t)})` : ""}` : `ETA ${escapeHtml(e.t || "—")}`;
      h += `<div class="mtc-r${x === me ? " me" : ""}" data-id="${x.id}" style="--mtd:${escapeHtml(dc)};--mtdb:${escapeHtml(db)}"`
        + `${x === me ? "" : ' title="Клик — к этому трипу"'}><span class="mtc-n">${i + 1}/${list.length}</span>`
        + `<span class="mtc-m"><b>${escapeHtml(x.client || "без клиента")}</b>${x.ref ? " · " + escapeHtml(x.ref) : ""}${cd ? `<i>${escapeHtml(cd)}</i>` : ""}</span>`
        + `<span class="mtc-d">① ${st ? fmtD(st) : "—"}<br>${lastTxt}</span><span class="mtc-w">${escapeHtml(dispLabel(rowDisp(x)))}</span></div>`;
      if (!isT && i < list.length - 1) {   // стык: км по дороге до ① следующего трипа (v3.277)
        const ga = mtLastTarget(x), gb = String(list[i + 1].target || "").trim(), gk = ga + "|" + gb;
        h += `<div class="mtc-gap" data-n="${i + 2}" data-a="${escapeHtml(ga)}" data-b="${escapeHtml(gb)}">${mtGapText(i + 2, MT_KM[gk])}</div>`;
      }
    });
    const meta = !isT && window.fleetMetaTitle ? window.fleetMetaTitle(me.id) : "";
    if (meta) h += `<div class="mtc-f">${escapeHtml(meta).replace(/\n/g, "<br>")}</div>`;
    card = document.createElement("div");
    card.className = "mt-card";
    card.innerHTML = h;
    document.body.appendChild(card);
    card.querySelectorAll(".mtc-gap[data-a]").forEach((g) => {   // цифры — с сервера, карточка уже на экране
      if (typeof MT_KM[g.dataset.a + "|" + g.dataset.b] === "number") return;
      mtGapLoad(g.dataset.a, g.dataset.b).then((v) => { if (g.isConnected) g.textContent = mtGapText(g.dataset.n, v); });
    });
    const r = inp.getBoundingClientRect();
    const z = typeof uiZoom === "function" ? uiZoom() : 1;
    const top = r.bottom + card.offsetHeight * z + 8 > window.innerHeight ? Math.max(8, r.top - card.offsetHeight * z - 4) : r.bottom + 4;
    card.style.left = Math.max(8, Math.min(r.left, window.innerWidth - card.offsetWidth * z - 8)) / z + "px";
    card.style.top = top / z + "px";
    card.addEventListener("mouseenter", () => clearTimeout(tHide));
    card.addEventListener("mouseleave", () => { tHide = setTimeout(hide, 250); });
    card.addEventListener("click", (ev) => {
      const rr = ev.target.closest(".mtc-r:not(.me)");
      if (!rr) return;
      const g = trOf(rr.dataset.id);
      hide();
      if (!g) return;   // трип скрыт фильтром — строки на экране нет
      g.scrollIntoView({ behavior: "smooth", block: "center" });
      g.classList.add("mt-flash");
      setTimeout(() => g.classList.remove("mt-flash"), 1600);
    });
  }
  document.addEventListener("mouseover", (e) => {
    const inp = e.target.closest && e.target.closest(MT_HOVER);
    if (!inp || document.activeElement === inp) return;   // в поле печатают — карточку не показываем
    if (inp.title && inp.dataset.mtT === undefined) { inp.dataset.mtT = inp.title; inp.title = ""; }   // подсказка браузера мешает карточке — на время наведения убираем
    clearTimeout(tHide);
    clearTimeout(tShow);
    tShow = setTimeout(() => show(inp), 1000);
  });
  document.addEventListener("mouseout", (e) => {
    const o = e.target.closest && e.target.closest(MT_HOVER);
    if (o) {
      clearTimeout(tShow); tHide = setTimeout(hide, 250);
      if (o.dataset.mtT !== undefined) { if (!o.title) o.title = o.dataset.mtT; delete o.dataset.mtT; }
    }
  });
  document.addEventListener("mousedown", (e) => { if (card && !card.contains(e.target)) hide(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
  window.multiTripHide = hide;
})();

// А: вписали номер машины, у которой во Флоте уже есть другой трип — карточка у поля (только при вводе, не при загрузке)
function multiTripWarn(id, unit) {
  const others = mtSorted(multiTripRows(unit).filter((r) => r.id !== id));
  if (!others.length || typeof openSwapPop !== "function") return;
  setTimeout(() => {   // строка могла перерисоваться после правки — берём поле заново
    const inp = document.querySelector(`#fleet-tbody tr[data-id="${id}"] .unit-input`);
    if (!inp) return;
    openSwapPop(inp, `У ${escapeHtml(String(unit).trim().toUpperCase())} уже есть трип во Флоте`,
      others.map((r) => "• " + escapeHtml(mtLine(r))).join("<br>"), [{ text: "Понятно", ok: true }]);
  }, 60);
}

// v3.305: карта Флота, машина в 2+ трипах — у ВЫБРАННОЙ строки две линии «до этого трипа»:
// (1) машина → последняя точка предыдущего трипа, по прямой, цветом его диспетчера;
// (2) эта точка → ① выбранного трипа, по дорогам (плечо /api/trip-gap, тот же кеш Google), пунктиром, тем же цветом.
// Линии лежат в routeExtraLines (map-core.js) — стираются и перерисовываются вместе с маршрутом.
const MT_LINE = {};
function mtGapLine(a, b) {
  const k = a + "|" + b;
  if (MT_LINE[k]) return MT_LINE[k];
  MT_LINE[k] = fetch("/api/trip-gap", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from: a, to: b, line: true }) })
    .then((r) => r.json())
    .then((d) => { if (typeof d.km !== "number") delete MT_LINE[k]; else MT_KM[k] = d.km; return d; })
    .catch(() => { delete MT_LINE[k]; return {}; });
  return MT_LINE[k];
}
function mtLineColor(prev) {
  const e = dispEntry(rowDisp(prev));
  return (e && e.color && shadeHex(e.color, 0.42)) || "#7b4fc0";
}
let MT_DRAW = 0;   // номер последней перерисовки: запоздавший ответ старой не рисуем (иначе линии задвоятся)
let MT_OBJS = [];  // маркер и плашка конца предыдущего трипа
function mtFlagIcon(color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="30"><line x1="4" y1="2" x2="4" y2="28" stroke="${color}" stroke-width="2.5"/>`
    + `<path d="M4,3 L22,8 L4,13 Z" fill="#fff" stroke="${color}" stroke-width="2"/></svg>`;
  return { url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg), scaledSize: new google.maps.Size(26, 30), anchor: new google.maps.Point(4, 28) };
}
function drawGapLines(rowId) {
  const my = ++MT_DRAW;
  MT_OBJS.forEach((o) => o.setMap(null));
  MT_OBJS = [];
  if (typeof map === "undefined" || !map) return;
  const row = rows.find((r) => String(r.id) === String(rowId));
  if (!row || !row.unit) return;
  const list = mtSorted(multiTripRows(row.unit)), idx = list.indexOf(row);
  if (idx <= 0) return;                    // первый трип машины — линий «до него» нет
  const prev = list[idx - 1];
  const a = mtLastTarget(prev), b = String(row.target || "").trim();
  if (!a || !b) return;
  const pos = rowPositions[rowId] || rowPositions[prev.id];
  const pp = rowPositions[prev.id];
  const color = mtLineColor(prev);
  mtGapLine(a, b).then((d) => {
    if (!d || !d.from_ll || my !== MT_DRAW || !isSelected(rowId)) return;   // за время запроса выбрали другую строку
    if (routePolyline && mtHideTruckLeg(rowId)) { routePolyline.setMap(null); routePolyline = null; }   // v3.307: голубой участок машина → ① уже нарисован, а теперь он лишний
    const from = { lat: d.from_ll[0], lng: d.from_ll[1] };
    // линия 1: дорога машина → последняя точка предыдущего трипа — готовые линии его строки (без Google); нет их — прямая
    const legs = pp && pp.polyline ? [pp.polyline].concat((pp.extraPolys || []).filter(Boolean)) : [];
    if (legs.length) {
      legs.forEach((enc) => routeExtraLines.push(new google.maps.Polyline({ path: google.maps.geometry.encoding.decodePath(enc),
        strokeColor: color, strokeOpacity: 0.9, strokeWeight: 4, map: map, zIndex: 4 })));
    } else if (pos && pos.unitLat != null) {
      routeExtraLines.push(new google.maps.Polyline({ path: [{ lat: pos.unitLat, lng: pos.unitLng }, from],
        strokeColor: color, strokeOpacity: 0.9, strokeWeight: 3, map: map, zIndex: 4 }));
    }
    // маркер последней точки предыдущего трипа
    const mk = new google.maps.Marker({ position: from, map: map, icon: mtFlagIcon(color), zIndex: 18, title: "Конец трипа " + idx + ": " + a });
    const gps = a.match(/^(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)$/);   // GPS — до 3 знаков, название — до 15 символов
    const txt = gps ? `${(+gps[1]).toFixed(3)}, ${(+gps[2]).toFixed(3)}` : (a.length > 15 ? a.slice(0, 14).trim() + "…" : a);
    const bd = makeBadge(from.lat, from.lng, `<span class="tb-ic">🏁</span> Конец трипа ${idx}<span class="mk-tgt">${escapeHtml(txt)}</span>`, "mk-tbadge", 34, null);
    const paint = () => { if (bd.div) bd.div.style.borderColor = color; };
    paint(); setTimeout(paint, 0);
    MT_OBJS.push(mk, bd);
    // линия 2: от неё к ① этого трипа, по дорогам
    const path = d.polyline ? google.maps.geometry.encoding.decodePath(d.polyline) : [from, { lat: d.to_ll[0], lng: d.to_ll[1] }];
    routeExtraLines.push(new google.maps.Polyline({ path: path, strokeOpacity: 0, map: map, zIndex: 4,
      icons: [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 0.9, strokeColor: color, scale: 3 }, offset: "0", repeat: "12px" }] }));
    // плашка машины: км до конца предыдущего трипа и два цвета
    const km = mtTruckKm(row), tp = lastTruckPos[rowId], ma = markerArgs[rowId];
    if (km != null && tp && ma && ma.km !== km) updateMarker(rowId, tp.lat, tp.lng, ma.label, truckStatus[rowId], truckHeading[rowId], km, ma.trailer, ma.tgt);
    else applyBadgeLook(rowId);
  });
}
// v3.306: КМ ① следующего трипа машины — «от точек»: пока предыдущий трип машины не закончен (не все ✓), км до ① =
// плечо от его последней точки до ① (то же число, что «↓ N км до ①» в карточке; кеш), а не от текущей позиции машины.
// Только показ (ячейка КМ, бейдж км на карте): ETA, ⏱ калькулятор и серверный расчёт не меняются.

function mtPrevRow(row) {   // предыдущий трип той же машины (по дате ①), если он не закончен; иначе null
  try {
    if (!row || !row.unit) return null;
    const list = mtSorted(multiTripRows(row.unit)), idx = list.indexOf(row);
    if (idx <= 0) return null;
    const prev = list[idx - 1], pc = lastCalcText[prev.id];
    return pc && !pc.allDone ? prev : null;   // нет данных о предыдущем или он закончен — считаем от машины, как раньше
  } catch (e) { return null; }
}
function mtPrevOpen(row) {   // → {a, b, prev}: последняя точка предыдущего трипа, ① этого
  const prev = mtPrevRow(row);
  if (!prev) return null;
  const a = mtLastTarget(prev), b = String(row.target || "").trim();
  return a && b ? { a, b, prev } : null;
}
// v3.308: км от машины до последней точки предыдущего трипа (уже посчитан в его строке: «от машины всего») — в плашку машины
function mtTruckKm(row) {
  const prev = mtPrevRow(row);
  if (!prev) return null;
  const pc = lastCalcText[prev.id], n = (prev.extra || []).length;
  const ce = n ? (pc.extra || [])[n - 1] : null;
  const v = n ? (ce && !ce.done && ce.dist_km != null ? Number(ce.dist_km) : null) : pc.ecKm;
  return typeof v === "number" && isFinite(v) ? v : null;
}
function mtKmOverride(row) {
  const g = mtPrevOpen(row);
  if (!g) return null;
  const v = MT_KM[g.a + "|" + g.b];
  if (typeof v === "number") return v;
  mtGapLoad(g.a, g.b).then((r) => { if (typeof r === "number" && typeof calcRow === "function") calcRow(row.id); });
  return null;
}
// v3.307: при КМ «от точек» голубой участок машина → ① на карте не рисуем (его заменяют линии 1 и 2)
function mtHideTruckLeg(rowId) {
  const row = rows.find((r) => String(r.id) === String(rowId));
  const g = mtPrevOpen(row);
  return !!g && typeof MT_KM[g.a + "|" + g.b] === "number";
}

// v3.310: строка посчиталась — следующие трипы этой машины, которые считались раньше (когда данных о ней ещё не было)
// и потому показали КМ от машины, пересчитываем: теперь есть «предыдущий трип не закончен». Один раз: после пересчёта у них mtKm уже есть.
function mtAfterCalc(row) {
  if (!row || !row.unit) return;
  multiTripRows(row.unit).forEach((r) => {
    if (r === row) return;
    const c = lastCalcText[r.id];
    if (c && c.mtKm == null && mtPrevRow(r) === row && typeof calcRow === "function") calcRow(r.id);
  });
}
