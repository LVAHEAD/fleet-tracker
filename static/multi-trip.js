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
function mtLine(r) {
  const d = mtSlotStart(r);
  const p = (n) => String(n).padStart(2, "0");
  return [r.client || "без клиента", r.ref, d && `① ${p(d.getDate())}.${p(d.getMonth() + 1)}`, dispLabel(rowDisp(r))].filter(Boolean).join(" · ");
}

// Б: пунктир под номером у всех строк, чья машина есть во Флоте ещё раз (зовётся после каждой перерисовки — renderRowsTail)
function markMultiTrips() {
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  const cnt = new Map();
  rows.forEach((r) => { const k = r && r.unit ? unitKey(r.unit) : ""; if (k) cnt.set(k, (cnt.get(k) || 0) + 1); });
  document.querySelectorAll("#fleet-tbody tr[data-id]").forEach((tr) => {
    const row = byId.get(tr.dataset.id);
    const inp = tr.querySelector(".unit-input");
    if (!row || !inp) return;
    const many = !!row.unit && (cnt.get(unitKey(row.unit)) || 0) > 1;
    if (inp.classList.contains("mt-dot") === many) return;
    inp.classList.toggle("mt-dot", many);
    // подсказка браузера мешала бы карточке: «кто и когда правил» переезжает в низ карточки
    inp.title = many ? "" : (window.fleetMetaTitle ? window.fleetMetaTitle(row.id) : "");
  });
}

(function () {
  if (typeof document === "undefined") return;
  let card = null, tShow = null, tHide = null;
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
    const list = mtSorted(multiTripRows(me.unit));
    if (list.length < 2) return;
    let h = `<div class="mtc-h"><b>${escapeHtml(String(me.unit).trim())}</b> — трипов во Флоте: ${list.length}</div>`;
    list.forEach((x, i) => {
      const xt = trOf(x.id), e = etaEnd(xt), st = mtSlotStart(x), de = dispEntry(rowDisp(x));
      const dc = (de && de.color) || "#f4f6fa", db = shadeHex(dc, 0.18) || "#c9d3e3";
      const cd = codes(xt);
      h += `<div class="mtc-r${x === me ? " me" : ""}" data-id="${x.id}" style="--mtd:${escapeHtml(dc)};--mtdb:${escapeHtml(db)}"`
        + `${x === me ? "" : ' title="Клик — к этому трипу"'}><span class="mtc-n">${i + 1}/${list.length}</span>`
        + `<span class="mtc-m"><b>${escapeHtml(x.client || "без клиента")}</b>${x.ref ? " · " + escapeHtml(x.ref) : ""}${cd ? `<i>${escapeHtml(cd)}</i>` : ""}</span>`
        + `<span class="mtc-d">① ${st ? fmtD(st) : "—"}<br>ETA ${escapeHtml(e.t || "—")}</span><span class="mtc-w">${escapeHtml(dispLabel(rowDisp(x)))}</span></div>`;
      if (i < list.length - 1) {   // стык: конец этого трипа против начала слота ① следующего
        const nx = mtSlotStart(list[i + 1]);
        if (e.d && nx) {
          const hrs = (nx - e.d) / 36e5, bad = hrs < 0, a = Math.abs(hrs);
          const dur = a >= 36 ? (a / 24).toFixed(1).replace(".", ",") + " сут" : Math.round(a) + " ч";
          h += `<div class="mtc-gap${bad ? " bad" : ""}">${bad ? `⚠ не успевает на ① трипа ${i + 2} — опоздание ${dur}` : `↓ запас до ① трипа ${i + 2}: ${dur}`}</div>`;
        } else {
          h += '<div class="mtc-gap">↓ стык не посчитать — нет ETA или даты ①</div>';
        }
      }
    });
    const meta = window.fleetMetaTitle ? window.fleetMetaTitle(me.id) : "";
    if (meta) h += `<div class="mtc-f">${escapeHtml(meta).replace(/\n/g, "<br>")}</div>`;
    card = document.createElement("div");
    card.className = "mt-card";
    card.innerHTML = h;
    document.body.appendChild(card);
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
    const inp = e.target.closest && e.target.closest(".unit-input.mt-dot");
    if (!inp || document.activeElement === inp) return;   // в поле печатают — карточку не показываем
    clearTimeout(tHide);
    clearTimeout(tShow);
    tShow = setTimeout(() => show(inp), 1000);
  });
  document.addEventListener("mouseout", (e) => {
    if (e.target.closest && e.target.closest(".unit-input.mt-dot")) { clearTimeout(tShow); tHide = setTimeout(hide, 250); }
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
