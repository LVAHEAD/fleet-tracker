/* Песочница Флота: «Пары» — три варианта показа машин с 2+ трипами (01.11, //обс Владимира; выбран А — пары только при сортировке «По загрузке»).
   полоска — цветная полоска слева, пары чередуются; линия — тонкая линия между парами; значок — 1/2, 2/2 в первой ячейке.
   Макет: при включённой галочке «только машины с 2+ трипами» трипы одной машины стоят подряд, пары — по дате ① первого трипа.
   Сброс других фильтров и ручная сортировка здесь не показаны. Опирается на глобалы app.js / unit-filter.js / multi-trip.js. */
(function () {
  "use strict";
  var MODE = "stripe";                                   // stripe | line | badge | off
  var MODES = [["stripe", "полоска"], ["line", "линия"], ["badge", "значок"], ["off", "выкл"]];

  function rowById(id) {
    var list = typeof rows !== "undefined" ? rows : [];
    for (var i = 0; i < list.length; i++) if (list[i] && String(list[i].id) === String(id)) return list[i];
    return null;
  }
  function unitOfId(id) { var r = rowById(id); return r && r.unit ? unitKey(r.unit) : null; }
  function startOfId(id) { var r = rowById(id); var d = r ? mtSlotStart(r) : null; return d ? +d : 9e15; }

  function apply() {
    var tb = document.getElementById("fleet-tbody"); if (!tb) return;
    var trs = Array.prototype.slice.call(tb.querySelectorAll("tr[data-id]"));
    trs.forEach(function (tr) {
      tr.classList.remove("pv-a", "pv-b", "pv-gap");
      var td = tr.querySelector("td"); if (td) td.removeAttribute("data-pv");
    });
    var on = typeof unitMultiOnly !== "undefined" && unitMultiOnly && MODE !== "off";
    if (!on) return;

    var groups = {};
    trs.forEach(function (tr) { var k = unitOfId(tr.dataset.id); if (k) (groups[k] = groups[k] || []).push(tr); });
    var pairs = Object.keys(groups).filter(function (k) { return groups[k].length > 1; }).map(function (k) {
      var g = groups[k].slice().sort(function (a, b) { return startOfId(a.dataset.id) - startOfId(b.dataset.id); });
      return { g: g, first: startOfId(g[0].dataset.id) };
    }).sort(function (x, y) { return x.first - y.first; });

    var ordered = [];
    pairs.forEach(function (p, pi) {
      p.g.forEach(function (tr, j) {
        tr.classList.add(pi % 2 ? "pv-b" : "pv-a");
        if (j === 0 && pi > 0) tr.classList.add("pv-gap");
        var td = tr.querySelector("td"); if (td) td.setAttribute("data-pv", (j + 1) + "/" + p.g.length);
        ordered.push(tr);
      });
    });
    var target = ordered.concat(trs.filter(function (t) { return ordered.indexOf(t) < 0; }));
    var same = target.every(function (t, i) { return trs[i] === t; });
    if (!same) target.forEach(function (t) { tb.appendChild(t); });
  }

  function mark() {
    document.body.classList.remove("pv-stripe", "pv-line", "pv-badge", "pv-off");
    document.body.classList.add("pv-" + MODE);
    document.querySelectorAll("#pv-bar button").forEach(function (x) { x.setAttribute("aria-pressed", String(x.dataset.m === MODE)); });
  }

  function css() {
    var s = document.createElement("style");
    s.textContent =
      "#pv-bar{position:fixed;left:12px;bottom:58px;z-index:9999;display:flex;gap:6px;align-items:center;background:#fff;border:1px solid #d6e4f7;border-radius:8px;padding:5px 8px;font:12px -apple-system,Segoe UI,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.08)}" +
      "#pv-bar span{color:#6b7785;margin-right:2px}" +
      "#pv-bar button{font:inherit;padding:3px 9px;border:1px solid #2f6fd6;border-radius:6px;background:#fff;color:#2f6fd6;cursor:pointer}" +
      "#pv-bar button[aria-pressed=\"true\"]{background:#2f6fd6;color:#fff}" +
      "body.pv-stripe tr.pv-a>td:first-child{box-shadow:inset 4px 0 0 #2f6fd6}" +
      "body.pv-stripe tr.pv-b>td:first-child{box-shadow:inset 4px 0 0 #8fb6ea}" +
      "body.pv-line tr.pv-gap>td{border-top:2px solid #2f6fd6}" +
      "body.pv-badge tr[data-id]>td[data-pv]{position:relative}" +
      "body.pv-badge tr[data-id]>td[data-pv]::after{content:attr(data-pv);position:absolute;left:2px;top:2px;font:600 10px -apple-system,sans-serif;color:#2f6fd6;background:#eef5ff;border-radius:4px;padding:0 3px}";
    document.head.appendChild(s);
  }

  function bar() {
    var b = document.createElement("div"); b.id = "pv-bar";
    b.innerHTML = "<span>Пары (2+ трипа):</span>" + MODES.map(function (m) { return '<button type="button" data-m="' + m[0] + '">' + m[1] + "</button>"; }).join("");
    b.addEventListener("click", function (e) {
      var t = e.target.closest("button[data-m]"); if (!t) return;
      MODE = t.dataset.m; mark(); apply();
    });
    document.body.appendChild(b);
  }

  function init() {
    css(); bar(); mark(); apply();
    var tb = document.getElementById("fleet-tbody");
    if (tb) new MutationObserver(apply).observe(tb, { childList: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
