/* v3.174: перестановка колонок Флота перетаскиванием заголовка. Последняя колонка (кнопки строки) закреплена.
Переставляются colgroup, thead и ячейки каждой строки по метке data-ci (исходный номер колонки); MutationObserver за #fleet-tbody
ставит порядок на перерисованные строки. Порядок — в localStorage браузера (`fleet-col-order`); битый или неполный — исходный.
На телефоне (≤767 px) порядок не применяется: mobile.css привязывает колонки по номеру. Кнопка «⇄ Сброс колонок» — самая правая над таблицей.
Грузится ПОСЛЕ app.js. */
(function () {
  "use strict";
  var KEY = "fleet-col-order";
  var mobile = window.matchMedia ? window.matchMedia("(max-width: 767px)") : { matches: false };
  var table, N, order, natural, drag = null, queued = false, busy = false;

  function load() {
    try {
      var a = JSON.parse(localStorage.getItem(KEY));
      if (Array.isArray(a) && a.length === N && a.slice().sort(function (x, y) { return x - y; }).join() === natural.join()) return a;
    } catch (e) {}
    return natural.slice();
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(order)); } catch (e) {} }
  function cellsOf(row) {
    return [].filter.call(row.children, function (c) { return c.tagName === "TD" || c.tagName === "TH" || c.tagName === "COL"; });
  }
  function ci(el) { return +el.getAttribute("data-ci"); }
  function applyRow(row) {
    var cells = cellsOf(row);
    if (cells.length !== N) return;
    cells.forEach(function (c, i) { if (c.getAttribute("data-ci") == null) c.setAttribute("data-ci", i); });
    var ord = mobile.matches ? natural : order;
    var cur = cells.map(ci).join(), want = ord.join();
    if (cur === want) return;
    var by = {};
    cells.forEach(function (c) { by[ci(c)] = c; });
    ord.forEach(function (k) { row.appendChild(by[k]); });
  }
  function applyAll() {
    queued = false; busy = true;
    try {
      var cg = table.querySelector("colgroup"); if (cg) applyRow(cg);
      var hr = table.querySelector("thead tr"); if (hr) applyRow(hr);
      [].forEach.call(table.querySelectorAll("#fleet-tbody > tr"), applyRow);
    } finally { busy = false; }
  }
  function schedule() { if (!queued && !busy) { queued = true; requestAnimationFrame(applyAll); } }

  function clearMarks() {
    [].forEach.call(table.querySelectorAll("th"), function (t) { t.classList.remove("fv-over-l", "fv-over-r", "fv-dragging"); });
  }
  function initDrag() {
    var ths = cellsOf(table.querySelector("thead tr"));
    ths.forEach(function (th, i) {
      th.setAttribute("data-ci", i);
      if (i === N - 1) return;                      // последняя колонка (кнопки строки) закреплена
      th.setAttribute("draggable", "true");
      th.addEventListener("dragstart", function (e) {
        drag = ci(th); th.classList.add("fv-dragging");
        try { e.dataTransfer.setData("text/plain", "col"); e.dataTransfer.effectAllowed = "move"; } catch (x) {}
      });
      th.addEventListener("dragend", function () { drag = null; clearMarks(); });
      th.addEventListener("dragover", function (e) {
        if (drag == null || ci(th) === N - 1) return;
        e.preventDefault();
        var r = th.getBoundingClientRect(), left = e.clientX < r.left + r.width / 2;
        clearMarks(); th.classList.add(left ? "fv-over-l" : "fv-over-r");
      });
      th.addEventListener("dragleave", function () { th.classList.remove("fv-over-l", "fv-over-r"); });
      th.addEventListener("drop", function (e) {
        if (drag == null) return;
        e.preventDefault();
        var r = th.getBoundingClientRect(), left = e.clientX < r.left + r.width / 2, to = ci(th);
        var o = order.filter(function (k) { return k !== drag; });
        var pos = o.indexOf(to) + (left ? 0 : 1);
        o.splice(pos, 0, drag);
        order = o; save(); drag = null; clearMarks(); applyAll();
      });
    });
  }
  function init() {
    table = document.getElementById("fleet-table"); if (!table) return;
    N = cellsOf(table.querySelector("thead tr")).length;
    natural = []; for (var i = 0; i < N; i++) natural.push(i);
    order = load();
    initDrag();
    new MutationObserver(schedule).observe(document.getElementById("fleet-tbody"), { childList: true, subtree: true });
    applyAll();
    if (mobile.addEventListener) mobile.addEventListener("change", applyAll);
    // кнопка «Сброс колонок» — самая правая в панели над таблицей (.sb-r), после «корзина» / «завершённые»
    var sbr = document.querySelector(".sb-r");
    if (sbr) {
      var last = [].filter.call(sbr.querySelectorAll("button"), function (b) { return b.id !== "m-edit-btn"; }).pop();
      var btn = document.createElement("button");
      btn.type = "button"; btn.id = "col-reset-btn"; btn.textContent = "⇄ Сброс колонок";
      btn.title = "Вернуть порядок колонок как по умолчанию";
      if (last) btn.className = last.className;
      btn.addEventListener("click", function () { order = natural.slice(); save(); applyAll(); });
      sbr.appendChild(btn);
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
