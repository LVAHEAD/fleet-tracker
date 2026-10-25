/* Песочница Флота, 25.10: варианты размера карты-схемы на закладке «Паромы» (переключатель внизу, виден на этой закладке).
   Схема живёт в Shadow DOM (#ferries-root), поэтому стили вставляются внутрь него. */
(function () {
  var V = {
    0: ["Как было", ""],
    1: ["Невысокая 240 px", "#mapbox svg{max-height:240px}"],
    2: ["Узкая 480 px по центру", "#mapbox svg{max-width:480px;margin:0 auto}"],
    3: ["Свёрнута (кнопка)", ""],
    4: ["Сбоку 340 px, список справа",
      ".wrap{display:grid;grid-template-columns:340px minmax(0,1fr);gap:10px 18px;align-items:start}" +
      ".wrap>.top{grid-column:1/-1}.wrap>.mapwrap{grid-column:1;grid-row:2/span 6;position:sticky;top:8px}" +
      ".wrap>*:not(.top):not(.mapwrap){grid-column:2}#mapbox{min-width:0}.legend span:last-child{flex-basis:100%}"]
  };
  var cur = 0, st, tgl;
  function sh() { var h = document.getElementById("ferries-root"); return h && h.shadowRoot; }
  function apply(n) {
    var r = sh(); if (!r) return; cur = n;
    if (!st) { st = document.createElement("style"); r.appendChild(st); }
    var css = V[n][1];
    if (n === 3) css = ".mapwrap.fold #mapbox,.mapwrap.fold .legend{display:none}.mapwrap.fold{border-style:dashed}";
    st.textContent = css;
    var w = r.getElementById("mapwrap");
    if (!tgl) {
      tgl = document.createElement("button"); tgl.type = "button"; tgl.className = "btn";
      tgl.style.cssText = "margin:6px 10px;display:none";
      tgl.onclick = function () { w.classList.toggle("fold"); tgl.textContent = w.classList.contains("fold") ? "▸ Показать схему" : "▾ Скрыть схему"; };
      w.insertBefore(tgl, w.firstChild);
    }
    if (n === 3) { w.classList.add("fold"); tgl.style.display = "block"; tgl.textContent = "▸ Показать схему"; }
    else { w.classList.remove("fold"); tgl.style.display = "none"; }
    [].forEach.call(bar.querySelectorAll("button"), function (b) { b.classList.toggle("on", +b.dataset.v === n); });
  }
  var bar = document.createElement("div");
  bar.style.cssText = "position:fixed;left:50%;bottom:8px;transform:translateX(-50%);z-index:99999;display:none;gap:6px;flex-wrap:wrap;justify-content:center;padding:6px 8px;background:#fff;border:1px solid #2f6fd6;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.2);font:13px sans-serif;max-width:96vw";
  var s = document.createElement("style");
  s.textContent = ".vbar button{background:#fff;color:#2f6fd6;border:1px solid #2f6fd6;border-radius:6px;padding:4px 9px;cursor:pointer;font:13px sans-serif}.vbar button:hover,.vbar button.on{background:#2f6fd6;color:#fff}";
  document.head.appendChild(s); bar.className = "vbar";
  Object.keys(V).forEach(function (k) {
    var b = document.createElement("button"); b.type = "button"; b.dataset.v = k; b.textContent = k + " · " + V[k][0];
    b.onclick = function () { apply(+k); }; bar.appendChild(b);
  });
  document.body.appendChild(bar);
  setInterval(function () {
    var t = document.getElementById("tab-ferries"), vis = t && !t.hidden && t.offsetParent !== null;
    bar.style.display = vis ? "flex" : "none";
    if (vis && !st) apply(cur);
  }, 400);
})();
