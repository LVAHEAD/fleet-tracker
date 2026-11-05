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
