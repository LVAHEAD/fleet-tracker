/* Песочница Флота: «Дневник трипа» — три варианта (30.10, //обс Владимира: журнал с датой и автором; видят и пишут все;
   «новое» показываем в самом дневнике, а не на строке). A — окошко у референса, B — 4-я панель справа, C — строка под трипом.
   Данные — в памяти страницы (в макете не сохраняются), записи для примера выдуманы. */
(function () {
  "use strict";
  var ME = "VL", mode = "B", openId = null;
  var LAST_SEEN = {};        // строка -> сколько записей видели в последний раз (для «новое»)
  var DATA = {};             // строка -> [{t, who, text}]
  var SEED = [
    [{ t: "28.10 09:40", who: "JZ", text: "Загрузка перенесена на утро, клиент подтвердил по телефону" },
     { t: "29.10 16:05", who: "VL", text: "Водитель на ночёвке у ⑤, на ④ утром" },
     { t: "30.10 08:12", who: "JZ", text: "Звонил клиент: пломба № 4471, выгрузка до 14:00" },
     { t: "30.10 11:30", who: "JZ", text: "Ждёт у ворот, пропуск оформляют" }],
    [{ t: "29.10 12:00", who: "VL", text: "Паром Росток — Ханко забронирован, отход 31.10" }],
    [{ t: "30.10 07:55", who: "JZ", text: "Прицеп заменён, документы у водителя" },
     { t: "30.10 10:20", who: "VL", text: "CMR в порядке, ждём выгрузку" }]
  ];
  var NEW_FOR_ME = { 0: 2, 2: 1 };   // сколько последних записей «новые» для VL в строках 0 и 2 (для примера)

  function rowsOf() { return Array.prototype.slice.call(document.querySelectorAll("#fleet-tbody tr[data-id]")); }
  function listFor(id, idx) {
    if (!DATA[id]) { DATA[id] = (SEED[idx] || []).map(function (e) { return { t: e.t, who: e.who, text: e.text }; }); if (idx in NEW_FOR_ME) LAST_SEEN[id] = DATA[id].length - NEW_FOR_ME[idx]; }
    return DATA[id];
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function now() { var d = new Date(); function p(n) { return (n < 10 ? "0" : "") + n; } return p(d.getDate()) + "." + p(d.getMonth() + 1) + " " + p(d.getHours()) + ":" + p(d.getMinutes()); }
  function titleOf(tr) {
    var u = tr.querySelector("td input") ? tr.querySelector("td input").value : "";
    var ref = tr.querySelector(".ref-input"); var cl = tr.querySelector(".cl-input");
    return { unit: u, sub: [cl && cl.value, ref && ref.value].filter(Boolean).join(" · ") };
  }

  function journalHtml(tr, id, idx) {
    var arr = listFor(id, idx), seen = LAST_SEEN[id] == null ? arr.length : LAST_SEEN[id];
    var t = titleOf(tr), html = '<div class="dj"><div class="dj-head"><b>Дневник · ' + esc(t.unit) + '</b><span>' + esc(t.sub) + '</span><button type="button" class="dj-x" data-act="close" title="Закрыть">✕</button></div><div class="dj-list">';
    if (!arr.length) html += '<div class="dj-empty">Записей пока нет — напишите первую</div>';
    arr.forEach(function (e, i) {
      var fresh = i >= seen && e.who !== ME;
      if (fresh && i === seen) html += '<div class="dj-new-line">новое с прошлого раза</div>';
      html += '<div class="dj-e' + (e.who === ME ? " mine" : "") + (fresh ? " fresh" : "") + '"><time>' + esc(e.t) + '</time><i>' + esc(e.who) + '</i><p>' + esc(e.text) + '</p>' +
        (e.who === ME ? '<button type="button" class="del" data-act="del" data-i="' + i + '" title="Удалить свою запись">×</button>' : "<span></span>") + "</div>";
    });
    html += '</div><div class="dj-add"><input type="text" placeholder="Новая запись…" maxlength="300"><button type="button" data-act="add">Добавить</button></div></div>';
    return html;
  }

  var pop = null, panel = null, tab = null, crow = null;
  function closeAll() {
    if (pop) { pop.remove(); pop = null; }
    if (crow) { crow.remove(); crow = null; }
    document.body.classList.remove("dj-open");
    if (panel) panel.innerHTML = "";
    document.querySelectorAll(".dj-btn.on").forEach(function (b) { b.classList.remove("on"); });
    openId = null;
  }
  function markSeen(id) { LAST_SEEN[id] = (DATA[id] || []).length; }

  function openFor(tr) {
    var id = tr.dataset.id, idx = rowsOf().indexOf(tr);
    if (openId === id) { closeAll(); return; }
    closeAll();
    openId = id;
    var btn = tr.querySelector(".dj-btn"); if (btn) btn.classList.add("on");
    var h = journalHtml(tr, id, idx);
    if (mode === "A") {
      pop = document.createElement("div"); pop.className = "dj-pop"; pop.innerHTML = h; document.body.appendChild(pop);
      var r = (tr.querySelector(".ref-cell") || tr).getBoundingClientRect();
      var top = r.bottom + 4; if (top + 380 > innerHeight) top = Math.max(8, innerHeight - 390);
      pop.style.top = top + "px"; pop.style.left = Math.max(8, Math.min(r.left - 40, innerWidth - 436)) + "px";
    } else if (mode === "B") {
      panel.innerHTML = h; document.body.classList.add("dj-open");
    } else {
      crow = document.createElement("tr"); crow.className = "dj-row";
      var td = document.createElement("td"); td.colSpan = tr.children.length; td.innerHTML = h; crow.appendChild(td);
      tr.parentNode.insertBefore(crow, tr.nextSibling);
    }
    var inp = document.querySelector(".dj-add input"); if (inp) inp.focus();
    var box = document.querySelector(".dj-list"); if (box) box.scrollTop = box.scrollHeight;
    markSeen(id);    // «новое» уже нарисовано выше; при следующем открытии строки отметки не будет
  }
  function refresh(tr) {   // перерисовать открытый журнал после записи / удаления
    var id = tr.dataset.id, idx = rowsOf().indexOf(tr), host = pop || panel || (crow && crow.firstChild);
    if (!host) return;
    var keep = LAST_SEEN[id]; host.innerHTML = journalHtml(tr, id, idx); LAST_SEEN[id] = keep;
    var box = host.querySelector(".dj-list"); if (box) box.scrollTop = box.scrollHeight;
    var inp = host.querySelector(".dj-add input"); if (inp) inp.focus();
    paintBtn(tr);
  }
  function paintBtn(tr) {
    var b = tr.querySelector(".dj-btn"); if (!b) return;
    var n = listFor(tr.dataset.id, rowsOf().indexOf(tr)).length;
    b.textContent = n ? "📝" + n : "📝"; b.title = "Дневник трипа" + (n ? ": записей " + n : " — пусто");
  }
  function inject() {
    rowsOf().forEach(function (tr) {
      var cell = tr.querySelector(".ref-cell"); if (!cell || cell.querySelector(".dj-btn")) { if (cell) paintBtn(tr); return; }
      var b = document.createElement("button"); b.type = "button"; b.className = "dj-btn"; b.tabIndex = -1; cell.appendChild(b); paintBtn(tr);
    });
  }

  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest(".dj-btn");
    if (b) { e.preventDefault(); e.stopPropagation(); openFor(b.closest("tr")); return; }
    var act = e.target.closest && e.target.closest("[data-act]");
    if (act) {
      var tr = rowsOf().filter(function (r) { return r.dataset.id === openId; })[0]; if (!tr) return;
      var a = act.dataset.act;
      if (a === "close") closeAll();
      if (a === "del") { DATA[openId].splice(+act.dataset.i, 1); LAST_SEEN[openId] = Math.min(LAST_SEEN[openId], DATA[openId].length); refresh(tr); }
      if (a === "add") { var inp = act.parentNode.querySelector("input"), v = inp.value.trim(); if (v) { DATA[openId].push({ t: now(), who: ME, text: v }); LAST_SEEN[openId] = DATA[openId].length; refresh(tr); } }
      return;
    }
    if (pop && !e.target.closest(".dj-pop")) closeAll();    // A — клик мимо закрывает окошко
  }, true);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && e.target.matches && e.target.matches(".dj-add input")) { e.target.parentNode.querySelector("button").click(); }
    if (e.key === "Escape" && openId) closeAll();
  });

  function setMode(m) {
    closeAll(); mode = m;
    document.body.classList.toggle("dj-off", m === "off");
    ["A", "B", "C"].forEach(function (x) { document.body.classList.toggle("dj-mode-" + x, x === m); });
    document.querySelectorAll("#sbx-bar button[data-m]").forEach(function (b) { b.classList.toggle("on", b.dataset.m === m); });
  }
  function init() {
    panel = document.createElement("aside"); panel.className = "dj-panel"; document.body.appendChild(panel);
    tab = document.createElement("div"); tab.className = "dj-tab"; tab.textContent = "📝 Дневник"; tab.title = "Закрыть панель дневника"; document.body.appendChild(tab);
    tab.addEventListener("click", closeAll);
    var bar = document.createElement("div"); bar.id = "sbx-bar";
    bar.innerHTML = 'Дневник трипа: <button data-m="B">B · 4-я панель справа</button><button data-m="off">выкл</button>';
    bar.addEventListener("click", function (e) { var b = e.target.closest("button[data-m]"); if (b) setMode(b.dataset.m); });
    document.body.appendChild(bar);
    var tb = document.getElementById("fleet-tbody");
    if (tb) new MutationObserver(function () { inject(); }).observe(tb, { childList: true });
    inject(); setMode("B");
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();

/* Метка «⚠ 45ка» у ETA позже срока недельного отдыха — три варианта вида (09.11). Образцы — выдуманные; переключатель меняет и метки в самой таблице, если они там есть. */
(function () {
  "use strict";
  function card(k, name) {
    return '<div class="wkv-card" data-wkv="' + k + '"><b>' + name + '</b>' +
      '<div class="sl"><span class="done-ok">✓ пройдена</span></div>' +
      '<div class="sl"><span class="eta-x-t">⏱ 09/11 21:00</span> <span class="wk-over">⚠ 45ка</span></div>' +
      '<div class="sl"><span class="eta-x-t">⏱ 09/11 23:30</span> <span class="wk-over">⚠ 45ка</span></div>' +
      '<div class="sl"><span class="eta-x-t">⏱ 09/11 14:10</span></div></div>';
  }
  function init() {
    if (document.getElementById("wkv")) return;
    var host = document.getElementById("fleet-tbody");
    var box = document.createElement("div"); box.id = "wkv";
    box.innerHTML = '<h4>ETA позже срока недельного отдыха — три варианта метки (образцы: срок 20:49, точки в 21:00 и 23:30 — позже; 14:10 — до срока)</h4>' +
      '<div class="wkv-bar">Вид в таблице: <button type="button" data-v="a" class="on">A</button><button type="button" data-v="b">B</button><button type="button" data-v="c">C</button></div>' +
      '<div class="wkv-cards">' + card("a", "A · красная рамка, мигает вся плашка") + card("b", "B · сплошная плашка + красный ETA") + card("c", "C · пульсирует вся строка ETA") + '</div>';
    var tbl = host ? host.closest("table") : null;
    if (tbl && tbl.parentNode) tbl.parentNode.insertBefore(box, tbl); else document.body.insertBefore(box, document.body.firstChild);
    document.body.setAttribute("data-wkv", "a");
    box.querySelectorAll(".wkv-bar button").forEach(function (b) {
      b.addEventListener("click", function () {
        box.querySelectorAll(".wkv-bar button").forEach(function (x) { x.classList.toggle("on", x === b); });
        document.body.setAttribute("data-wkv", b.dataset.v);
      });
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else setTimeout(init, 0);
})();
