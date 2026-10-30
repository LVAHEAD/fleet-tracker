/* v3.144: фильтр-календарь по TimeSlot во Флоте. Клик по заголовку «TimeSlot» — окно с календарём месяца: клик по дням
(несколько сразу), под числом — сколько трипов с TimeSlot на этот день, «Сегодня» / «Завтра» / «Сбросить».
Трип виден, если TimeSlot ЛЮБОЙ непройденной точки (① … последняя) попадает на выбранный день; окно «с–по» занимает все свои дни
(22:00 – 06:00 через полночь — оба дня); пустой или неразобранный TimeSlot точки («tba», «окно выгрузки») пропускаем и смотрим следующие точки;
если даты нет ни у одной непройденной точки — трип виден всегда (чтобы не пропал из таблицы). Строки без машины (v3.187) фильтруются по дате так же.
Пока фильтр включён, заголовок подсвечен синим. Складывается с диспетчером, L / O и клиентом (rowPassesFilterWith в fleet-sort-filter.js,
после клиента); общий с Картой Флота, как клиент; после F5 помнится (localStorage), дни старше вчерашнего при загрузке отбрасываются.
Чистые функции — slotDayKey, slotWindowDays, rowSlotDays, rowPassesSlot (тест на node: tests/test_slot_filter.py).
Опирается на глобалы delivery-check.js (parseDeliveryWindow) и fleet-sort-filter.js (firstOpenIdx, pointOf), app.js (rows, renderRows) — во время работы.
Грузится ДО app.js. */

let slotFilter = [];   // ключи выбранных дней «ГГГГ-ММ-ДД» (местный календарь браузера)

function slotDayKey(d) {
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

try {
  const y = new Date(); y.setDate(y.getDate() - 1);
  const from = slotDayKey(y);
  const v = JSON.parse(localStorage.getItem("fleet-slot-filter") || "[]");
  if (Array.isArray(v)) slotFilter = v.filter((x) => typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x) && x >= from);
} catch (e) {}

// дни, которые занимает окно TimeSlot (текст точки): от начала до конца, не больше 14 дней; нет даты — []
function slotWindowDays(txt) {
  const w = parseDeliveryWindow(txt);
  if (!w) return [];
  const a = w.start || w.end, b = w.end || w.start;
  if (!a || !b) return [];
  const d = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const last = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  const out = [];
  for (let i = 0; i < 14 && d <= last; i++) { out.push(slotDayKey(d)); d.setDate(d.getDate() + 1); }
  return out;
}

// множество дней по всем непройденным точкам строки; null — все пройдены или даты нет ни у одной
function rowSlotDays(row) {
  const k = firstOpenIdx(row);
  if (k < 0) return null;
  const n = 1 + (row.extra ? row.extra.length : 0);
  const set = new Set();
  for (let j = k; j < n; j++) {
    const p = pointOf(row, j);
    if (p) slotWindowDays(p.delivery).forEach((x) => set.add(x));
  }
  return set.size ? set : null;
}

function rowPassesSlot(row) {
  if (!slotFilter.length) return true;
  if (!row) return true;                  // v3.187: строки без машины фильтруются по дате, как остальные
  const s = rowSlotDays(row);
  if (!s) return true;                    // даты нет — не прячем
  return slotFilter.some((k) => s.has(k));
}

(function () {
  if (typeof document === "undefined") return;
  const th = document.getElementById("slot-flt-th");
  if (!th) return;
  const MON = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
  const WD = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
  let pop = null, view = null;   // view = { y, m }
  const save = () => { try { localStorage.setItem("fleet-slot-filter", JSON.stringify(slotFilter)); } catch (e) {} };
  const mark = () => {
    th.classList.toggle("slot-on", slotFilter.length > 0);
    th.title = slotFilter.length ? `Фильтр по TimeSlot: выбрано дней — ${slotFilter.length}, клик — изменить`
      : "Фильтр-календарь по TimeSlot — клик";
    if (window.slotQuickUpdate) window.slotQuickUpdate();
  };
  const rerender = () => { mark(); if (typeof renderRows === "function") renderRows(); };

  // сколько трипов (видимых по диспетчеру, в т.ч. без машины — v3.187) имеют TimeSlot на каждый день
  function counts() {
    const c = {};
    rows.filter((r) => r && rowPassesOwn(r)).forEach((r) => {
      const s = rowSlotDays(r);
      if (s) s.forEach((k) => { c[k] = (c[k] || 0) + 1; });
    });
    return c;
  }
  function render() {
    const { y, m } = view, cnt = counts(), todayKey = slotDayKey(new Date());
    const offset = (new Date(y, m, 1).getDay() + 6) % 7, days = new Date(y, m + 1, 0).getDate();
    let cells = "";
    for (let i = 0; i < offset; i++) cells += '<span class="sf-c sf-e"></span>';
    for (let d = 1; d <= days; d++) {
      const key = slotDayKey(new Date(y, m, d)), n = cnt[key] || 0;
      cells += `<button type="button" class="sf-c${slotFilter.includes(key) ? " sf-on" : ""}${key === todayKey ? " sf-today" : ""}" data-k="${key}">`
        + `<b>${d}</b><i>${n || ""}</i></button>`;
    }
    pop.innerHTML = `<div class="sf-head"><button type="button" class="sf-nav" data-d="-1" title="Предыдущий месяц">‹</button>`
      + `<span class="sf-title">${MON[m]} ${y}</span><button type="button" class="sf-nav" data-d="1" title="Следующий месяц">›</button></div>`
      + `<div class="sf-wd">${WD.map((w) => `<span>${w}</span>`).join("")}</div><div class="sf-grid">${cells}</div>`
      + `<div class="sf-foot"><button type="button" class="sf-today-btn">Сегодня</button><button type="button" class="sf-tom-btn">Завтра</button>`
      + `<button type="button" class="sf-reset">Сбросить</button></div>`;
  }
  function close() { if (pop) { pop.remove(); pop = null; } }
  function pick(offsetDays) {
    const d = new Date(); d.setDate(d.getDate() + offsetDays);
    slotFilter = [slotDayKey(d)];
    view = { y: d.getFullYear(), m: d.getMonth() };
    save(); render(); rerender();
  }
  function open() {
    close();
    document.dispatchEvent(new CustomEvent("fleet-popup-open", { detail: "slot" }));   // другое окно фильтра закрываем
    const now = new Date();
    const first = slotFilter.length ? new Date(slotFilter[0] + "T12:00:00") : now;
    view = { y: first.getFullYear(), m: first.getMonth() };
    pop = document.createElement("div");
    pop.id = "slot-flt-pop";
    pop.className = "slot-flt-pop";
    document.body.appendChild(pop);
    render();
    const r = th.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8)) + "px";
    pop.style.top = (r.bottom + 4) + "px";
    pop.addEventListener("click", (e) => {
      e.stopPropagation();
      const t = e.target.closest("button");
      if (!t) return;
      if (t.dataset.k) {
        const k = t.dataset.k;
        slotFilter = slotFilter.includes(k) ? slotFilter.filter((x) => x !== k) : [...slotFilter, k].sort();
        save(); render(); rerender();
      } else if (t.dataset.d) {
        const d = new Date(view.y, view.m + Number(t.dataset.d), 1);
        view = { y: d.getFullYear(), m: d.getMonth() };
        render();
      } else if (t.classList.contains("sf-today-btn")) pick(0);
      else if (t.classList.contains("sf-tom-btn")) pick(1);
      else if (t.classList.contains("sf-reset")) { slotFilter = []; save(); rerender(); close(); }   // v3.205: «Сбросить» закрывает окно
    });
  }

  // v3.180: быстрые кнопки «T» / «+1» / «+2» справа от заголовка (v3.205 — у всех диспетчеров): фильтр на сегодня / завтра / послезавтра; повторный клик снимает
  const quick = document.createElement("span");
  quick.className = "sq-wrap";
  quick.hidden = true;
  [["T", 0, "Сегодня"], ["+1", 1, "Завтра"], ["+2", 2, "Послезавтра"]].forEach(([t, d, name]) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "sq-btn"; b.dataset.d = String(d); b.textContent = t;
    b.title = name + " — фильтр по TimeSlot (повторный клик снимает)";
    quick.appendChild(b);
  });
  th.appendChild(quick);
  const dayKeyPlus = (d) => { const x = new Date(); x.setDate(x.getDate() + d); return slotDayKey(x); };
  window.slotQuickUpdate = () => {
    const vis = typeof markAllowed === "function" && markAllowed();
    quick.hidden = !vis;
    th.classList.toggle("sq-vl", !!vis);
    [].forEach.call(quick.children, (b) => b.classList.toggle("on", slotFilter.length === 1 && slotFilter[0] === dayKeyPlus(Number(b.dataset.d))));
  };
  quick.addEventListener("click", (e) => {
    e.stopPropagation();
    const b = e.target.closest(".sq-btn");
    if (!b) return;
    const k = dayKeyPlus(Number(b.dataset.d));
    slotFilter = slotFilter.length === 1 && slotFilter[0] === k ? [] : [k];
    save();
    if (pop) render();
    rerender();
  });

  th.addEventListener("click", (e) => { e.stopPropagation(); if (pop) close(); else open(); });
  // v3.173: слушаем в фазе перехвата — клик вне окна закрывает его, даже если ниже по дереву стоит stopPropagation
  document.addEventListener("click", (e) => { if (pop && !pop.contains(e.target) && !th.contains(e.target)) close(); }, true);
  document.addEventListener("fleet-popup-open", (e) => { if (e.detail !== "slot") close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  // правый клик по шапке Флота — сброс фильтров Машина / Клиент / Дата одним проходом
  (window.fleetFltResets = window.fleetFltResets || []).push(() => { slotFilter = []; save(); mark(); close(); });
  const thead = th.closest("thead");
  if (thead) thead.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    window.fleetFltResets.forEach((f) => { try { f(); } catch (err) {} });
    if (typeof renderRows === "function") renderRows();
  });
  window.addEventListener("scroll", (e) => { if (pop && !pop.contains(e.target)) close(); }, true);
  mark();
})();
