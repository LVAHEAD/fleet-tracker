/* Песочница Флота: «Подсказка у значка страны» — три варианта карточки вместо браузерного title (02.11, //обс Владимира).
   Правило: если есть объект Mapon — указать его; если нет — что сейчас (код зоны) и ГПС.
   A — объект Mapon, иначе код зоны + ГПС; B — всегда код зоны, объект Mapon второй строкой; C — только объект или только ГПС (без кода зоны).
   Показ только в столбце «Статус», задержка 0.5 с; в «Таргете» наведение без изменений. Данные демонстрационные. Переключатель внизу слева. */
(function () {
  "use strict";
  var MODE = "A";
  var MODES = [["A", "объект / код+ГПС"], ["B", "код + объект"], ["C", "объект или ГПС"]];
  var SAMPLE = {
    withObj: { zone: "NO15", obj: "BAMA Tranby depot", grp: "Bama · стоянки", gps: "59.91234, 10.74512", t: "02.11 04:20" },
    noObj:   { zone: "NO15", obj: "", grp: "", gps: "59.66021, 10.85790", t: "02.11 04:20" }
  };

  function lines(d) {
    if (MODE === "A") {
      if (d.obj) return ["Объект Mapon: " + d.obj, d.grp, "ГПС " + d.gps, "Позиция " + d.t];
      return ["Сейчас: около " + d.zone, "ГПС " + d.gps, "Позиция " + d.t];
    }
    if (MODE === "B") {
      return ["Сейчас: около " + d.zone, d.obj ? "Объект Mapon: " + d.obj : "Объект Mapon: нет", "ГПС " + d.gps, "Позиция " + d.t];
    }
    return [d.obj ? "Объект Mapon: " + d.obj : "ГПС " + d.gps, d.obj ? "ГПС " + d.gps : "Позиция " + d.t];
  }

  function card(x, y, d) {
    var el = document.getElementById("tip-demo") || document.createElement("div");
    el.id = "tip-demo";
    el.innerHTML = lines(d).map(function (t, i) { return i === 0 ? "<b>" + t + "</b>" : "<div>" + t + "</div>"; }).join("");
    el.style.left = x + "px"; el.style.top = y + "px";
    document.body.appendChild(el);
  }
  function hide() { var el = document.getElementById("tip-demo"); if (el) el.remove(); }

  function init() {
    var s = document.createElement("style");
    s.textContent =
      "#tip-demo{position:fixed;z-index:9999;background:#fff;border:1px solid #d6e4f7;border-radius:8px;padding:8px 10px;font:12px/1.5 -apple-system,Segoe UI,sans-serif;color:#1b2230;box-shadow:0 4px 14px rgba(0,0,0,.12);pointer-events:none;max-width:320px}" +
      "#tip-demo b{color:#2f6fd6}" +
      "#tip-bar{position:fixed;left:12px;bottom:12px;z-index:9999;display:flex;gap:6px;align-items:center;background:#fff;border:1px solid #d6e4f7;border-radius:8px;padding:5px 8px;font:12px -apple-system,Segoe UI,sans-serif}" +
      "#tip-bar span{color:#6b7785;margin-right:2px}" +
      "#tip-bar button{font:inherit;padding:3px 9px;border:1px solid #2f6fd6;border-radius:6px;background:#fff;color:#2f6fd6;cursor:pointer}" +
      "#tip-bar button[aria-pressed=\"true\"]{background:#2f6fd6;color:#fff}";
    document.head.appendChild(s);

    var bar = document.createElement("div"); bar.id = "tip-bar";
    bar.innerHTML = "<span>Подсказка у «NO»:</span>" + MODES.map(function (m) { return '<button type="button" data-m="' + m[0] + '">' + m[1] + "</button>"; }).join("");
    bar.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-m]"); if (!b) return;
      MODE = b.dataset.m; mark();
    });
    document.body.appendChild(bar);

    var timer = null, cur = null;
    function statusCol() { var th = document.getElementById("status-th"); return th ? th.cellIndex : -1; }
    document.addEventListener("mouseover", function (e) {
      var c = e.target.closest && e.target.closest("#fleet-tbody .cc-badge");
      var td = c && c.closest("td");
      if (!c || !td || td.cellIndex !== statusCol()) return;          // только столбец «Статус»; «Таргет» не трогаем
      if (cur === c) return;
      cur = c;
      if (c.dataset.tipTitle === undefined) c.dataset.tipTitle = c.getAttribute("title") || "";
      c.removeAttribute("title");
      clearTimeout(timer);
      timer = setTimeout(function () {                                  // задержка 0.5 с
        var r = c.getBoundingClientRect();
        card(r.left, r.bottom + 6, MODE === "C" ? SAMPLE.noObj : SAMPLE.withObj);
      }, 500);
    });
    document.addEventListener("mouseout", function (e) {
      var c = e.target.closest && e.target.closest("#fleet-tbody .cc-badge");
      if (!c) return;
      clearTimeout(timer); cur = null;
      if (c.dataset.tipTitle !== undefined) c.setAttribute("title", c.dataset.tipTitle);
      hide();
    });
    mark();
  }
  function mark() {
    document.querySelectorAll("#tip-bar button").forEach(function (x) { x.setAttribute("aria-pressed", String(x.dataset.m === MODE)); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
