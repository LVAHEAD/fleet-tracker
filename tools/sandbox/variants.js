/* Песочница Флота, 25.10: варианты карты-схемы на закладке «Паромы» (переключатель внизу, виден на этой закладке).
   Выбрано Владимиром: «сбоку 340 px» (вариант 1); ищем лучший вид бокового варианта.
   Схема живёт в Shadow DOM (#ferries-root): стили вставляются внутрь, карта / фильтры переносятся в колонку <aside>. */
(function () {
  function side(w, right) {
    var a = right ? "minmax(0,1fr) " + w + "px" : w + "px minmax(0,1fr)", c1 = right ? 2 : 1, c2 = right ? 1 : 2;
    return ".wrap{display:grid;grid-template-columns:" + a + ";gap:10px 18px;align-items:start}.wrap>.top{grid-column:1/-1}" +
      ".wrap>aside.side{display:block;grid-column:" + c1 + ";grid-row:2/span 8;position:sticky;top:8px}" +
      ".wrap>*:not(.top):not(aside.side){grid-column:" + c2 + "}#mapbox{min-width:0}.legend span:last-child{flex-basis:100%}" +
      "aside.side .mapwrap{margin-bottom:10px}aside.side .filters{margin-bottom:6px}";
  }
  var V = [
    ["Как было", "", 0],
    ["Сбоку 340 (выбран)", side(340), 0],
    ["Сбоку 340 + фильтры под картой", side(340), 1],
    ["Сбоку 280 компакт + фильтры", side(280), 1],
    ["Сбоку 420 + фильтры", side(420), 1],
    ["Справа 340 + фильтры", side(340, true), 1],
    ["Сбоку 600", side(600), 1],
    ["Сбоку 700", side(700), 1],
    ["Сбоку 800", side(800), 1]
  ];
  var cur = 1, st, aside;
  function sh() { var h = document.getElementById("ferries-root"); return h && h.shadowRoot; }
  function apply(n) {
    var r = sh(); if (!r) return; cur = n;
    if (!st) { st = document.createElement("style"); r.appendChild(st); }
    var w = r.getElementById("mapwrap"), fl = r.getElementById("flt"), sb = r.getElementById("selbar");
    if (!aside) { aside = document.createElement("aside"); aside.className = "side"; w.parentNode.insertBefore(aside, w); aside.appendChild(w); }
    st.textContent = "aside.side{display:contents}" + V[n][1];
    if (V[n][2]) { aside.appendChild(fl); aside.appendChild(sb); }
    else { aside.after(fl); fl.after(sb); }
    [].forEach.call(bar.querySelectorAll("button"), function (b) { b.classList.toggle("on", +b.dataset.v === n); });
  }
  var bar = document.createElement("div");
  bar.style.cssText = "position:fixed;left:50%;bottom:8px;transform:translateX(-50%);z-index:99999;display:none;gap:6px;flex-wrap:wrap;justify-content:center;padding:6px 8px;background:#fff;border:1px solid #2f6fd6;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.2);font:13px sans-serif;max-width:96vw";
  var s = document.createElement("style");
  s.textContent = ".vbar button{background:#fff;color:#2f6fd6;border:1px solid #2f6fd6;border-radius:6px;padding:4px 9px;cursor:pointer;font:13px sans-serif}.vbar button:hover,.vbar button.on{background:#2f6fd6;color:#fff}";
  document.head.appendChild(s); bar.className = "vbar";
  V.forEach(function (v, k) {
    var b = document.createElement("button"); b.type = "button"; b.dataset.v = k; b.textContent = k + " · " + v[0];
    b.onclick = function () { apply(k); }; bar.appendChild(b);
  });
  document.body.appendChild(bar);
  setInterval(function () {
    var t = document.getElementById("tab-ferries"), vis = t && !t.hidden && t.offsetParent !== null;
    bar.style.display = vis ? "flex" : "none";
    if (vis && !st) apply(cur);
  }, 400);
})();
