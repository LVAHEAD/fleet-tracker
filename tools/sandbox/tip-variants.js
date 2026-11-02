/* Песочница Флота: «Подсказка у значка страны» — четыре варианта карточки вместо браузерного title (02.11, //обс Владимира).
   Правило Владимира: стоит на объекте Mapon (любом) — код зоны (NO31) + объект + ГПС с нашей кнопкой «копировать»;
   нет объекта — код зоны + ГПС с кнопкой; движется — код зоны + ГПС с кнопкой.
   A — код + объект в одной строке, ГПС ниже; B — сетка «Объект / ГПС» под заголовком с кодом; C — всё в одну строку;
   D — как B, плюс метка состояния («на объекте» / «нет объекта» / «в движении»).
   Показ только в столбце «Статус», задержка 0.5 с; в «Таргете» наведение без изменений. Данные демонстрационные.
   Внизу слева два переключателя: вариант (A–D) и пример (по строкам / на объекте / нет объекта / движется). */
(function () {
  "use strict";
  var MODE = "A", STATE = "auto";
  var MODES = [["A", "A · код+объект"], ["B", "B · сетка"], ["C", "C · строка"], ["D", "D · с состоянием"]];
  var STATES = [["auto", "по строкам"], ["obj", "на объекте"], ["none", "нет объекта"], ["move", "движется"]];
  var SAMPLE = {
    obj:  { zone: "NO31", obj: "BAMA Tranby depot", gps: "59.91234, 10.74512", tag: "на объекте Mapon" },
    none: { zone: "NO31", obj: "", gps: "59.66021, 10.85790", tag: "стоит, объекта нет" },
    move: { zone: "NO31", obj: "", gps: "59.70418, 10.80233", tag: "в движении" }
  };
  var ORDER = ["obj", "none", "move"];
  var COPY_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15V6a2 2 0 0 1 2-2h9"></path></svg>';
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  function cp(v) { return '<button type="button" class="addr-copy" data-cp="' + esc(v) + '" title="Копировать: ГПС" aria-label="Копировать: ГПС">' + COPY_SVG + "</button>"; }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise(function (ok, bad) {
      var t = document.createElement("textarea"); t.value = text; t.style.cssText = "position:fixed;opacity:0";
      document.body.appendChild(t); t.select();
      var r = false; try { r = document.execCommand("copy"); } catch (e) {}
      t.remove(); r ? ok() : bad();
    });
  }

  function html(d) {
    var code = '<span class="tt-cc tip-code">' + esc(d.zone) + "</span>";
    if (MODE === "A") {
      return '<div class="mtc-h">' + code + (d.obj ? " <b>" + esc(d.obj) + "</b>" : "") + "</div>" +
        '<div class="tt-cp">ГПС ' + esc(d.gps) + cp(d.gps) + "</div>";
    }
    if (MODE === "B") {
      return '<div class="mtc-h">' + code + "</div><div class=\"tt-g\">" +
        (d.obj ? '<div class="tt-k">Объект</div><div>' + esc(d.obj) + "</div>" : "") +
        '<div class="tt-k">ГПС</div><div class="tt-cp">' + esc(d.gps) + cp(d.gps) + "</div></div>";
    }
    if (MODE === "C") {
      return '<div class="tt-cp tip-one">' + code + (d.obj ? " <b>" + esc(d.obj) + "</b> ·" : "") + " " + esc(d.gps) + cp(d.gps) + "</div>";
    }
    return '<div class="mtc-h">' + code + ' <span class="tip-tag">' + esc(d.tag) + "</span></div><div class=\"tt-g\">" +
      (d.obj ? '<div class="tt-k">Объект</div><div>' + esc(d.obj) + "</div>" : "") +
      '<div class="tt-k">ГПС</div><div class="tt-cp">' + esc(d.gps) + cp(d.gps) + "</div></div>";
  }

  var card = null, tHide = 0;
  function hide() { clearTimeout(tHide); if (card) { card.remove(); card = null; } }
  function show(c, d) {
    hide();
    card = document.createElement("div");
    card.className = "mt-card tt-card";
    card.innerHTML = html(d);
    document.body.appendChild(card);
    var r = c.getBoundingClientRect();
    var top = r.bottom + card.offsetHeight + 8 > window.innerHeight ? Math.max(8, r.top - card.offsetHeight - 4) : r.bottom + 4;
    card.style.left = Math.max(8, Math.min(r.left, window.innerWidth - card.offsetWidth - 8)) + "px";
    card.style.top = top + "px";
    card.addEventListener("mouseenter", function () { clearTimeout(tHide); });
    card.addEventListener("mouseleave", function () { tHide = setTimeout(hide, 250); });
    card.addEventListener("click", function (ev) {
      var b = ev.target.closest(".addr-copy"); if (!b) return;
      copyText(b.dataset.cp).then(function () { b.classList.add("ok"); setTimeout(function () { b.classList.remove("ok"); }, 1500); }).catch(function () {});
    });
  }

  function init() {
    var s = document.createElement("style");
    s.textContent =
      ".tip-tag{display:inline-block;margin-left:4px;padding:0 6px;border-radius:10px;background:#eef3fc;color:#2f6fd6;font-size:11px;font-weight:600}" +
      ".tip-code{margin-left:0;font-size:12px}.tip-one{white-space:nowrap}" +
      "#tip-bar{position:fixed;left:12px;bottom:12px;z-index:9999;display:flex;flex-wrap:wrap;gap:6px;align-items:center;max-width:calc(100vw - 24px);background:#fff;border:1px solid #d6e4f7;border-radius:8px;padding:5px 8px;font:12px -apple-system,Segoe UI,sans-serif}" +
      "#tip-bar span{color:#6b7785;margin-right:2px}" +
      "#tip-bar button{font:inherit;padding:3px 9px;border:1px solid #2f6fd6;border-radius:6px;background:#fff;color:#2f6fd6;cursor:pointer}" +
      "#tip-bar button:hover,#tip-bar button[aria-pressed=\"true\"]{background:#2f6fd6;color:#fff}";
    document.head.appendChild(s);

    var bar = document.createElement("div"); bar.id = "tip-bar";
    bar.innerHTML = "<span>Подсказка у «NO»:</span>" +
      MODES.map(function (m) { return '<button type="button" data-m="' + m[0] + '">' + m[1] + "</button>"; }).join("") +
      "<span>· пример:</span>" +
      STATES.map(function (m) { return '<button type="button" data-s="' + m[0] + '">' + m[1] + "</button>"; }).join("");
    bar.addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      if (b.dataset.m) MODE = b.dataset.m;
      if (b.dataset.s) STATE = b.dataset.s;
      mark();
    });
    document.body.appendChild(bar);

    var timer = 0, cur = null;
    function statusCol() { var th = document.getElementById("status-th"); return th ? th.cellIndex : -1; }
    function sample(c) {
      if (STATE !== "auto") return SAMPLE[STATE];
      var i = Array.prototype.indexOf.call(document.querySelectorAll("#fleet-tbody tr[data-id]"), c.closest("tr"));
      return SAMPLE[ORDER[(i < 0 ? 0 : i) % 3]];
    }
    document.addEventListener("mouseover", function (e) {
      var c = e.target.closest && e.target.closest("#fleet-tbody .cc-badge");
      var td = c && c.closest("td");
      if (!c || !td || td.cellIndex !== statusCol()) return;          // только столбец «Статус»; «Таргет» не трогаем
      clearTimeout(tHide);
      if (cur === c) return;
      cur = c;
      if (c.dataset.tipTitle === undefined) c.dataset.tipTitle = c.getAttribute("title") || "";
      c.removeAttribute("title");
      clearTimeout(timer);
      timer = setTimeout(function () { show(c, sample(c)); }, 500);      // задержка 0.5 с
    });
    document.addEventListener("mouseout", function (e) {
      var c = e.target.closest && e.target.closest("#fleet-tbody .cc-badge");
      if (!c || (e.relatedTarget && c.contains(e.relatedTarget))) return;
      clearTimeout(timer); cur = null;
      if (c.dataset.tipTitle !== undefined) c.setAttribute("title", c.dataset.tipTitle);
      tHide = setTimeout(hide, 250);
    });
    document.addEventListener("mousedown", function (e) { if (card && !card.contains(e.target)) hide(); });
    mark();
  }
  function mark() {
    document.querySelectorAll("#tip-bar button").forEach(function (x) {
      x.setAttribute("aria-pressed", String(x.dataset.m ? x.dataset.m === MODE : x.dataset.s === STATE));
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
