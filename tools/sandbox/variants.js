/* Песочница Флота, 25.10 (v3.207): раскладка 700 px и фильтры по странам теперь в самой аппе (static/ferries.js);
   здесь — только макет мобильного вида закладки «Паромы»: кнопка «📱 Мобильный вид» внизу страницы (рамка телефона 390 px,
   чипы стран в одну строку, карта свёрнута, блок «Заказ паромов» — образец ссылок из листа «Ссылки», строки-карточки). */
(function () {
  function sh() { var h = document.getElementById("ferries-root"); return h && h.shadowRoot; }
  var MCSS = ":host(.m){max-width:390px;margin:0 auto;border:8px solid #1b2230;border-radius:30px;padding:10px;box-sizing:border-box;background:#f4f6fa}" +
    "#mapbox{min-width:0}.m-on .mapwrap{max-width:100%;box-sizing:border-box}.wrap.m-on{display:flex;flex-direction:column;gap:10px}.wrap.m-on>aside.side{width:100%;min-width:0;box-sizing:border-box;grid-column:auto;position:static;display:flex;flex-direction:column;gap:8px}" +
    ".m-on .top{order:-2;flex-direction:column;align-items:stretch;gap:8px}.m-on .search{max-width:none;flex:none;width:100%;box-sizing:border-box}" +
    ".m-on .filters{order:-1;flex-wrap:nowrap;overflow-x:auto;padding-bottom:4px;margin:0 -10px;padding-left:10px;padding-right:10px;scrollbar-width:none;position:sticky;top:0;background:#f4f6fa;z-index:3}" +
    ".m-on .btn{white-space:nowrap;padding:7px 13px;font-size:14px}" +
    ".m-on .mapwrap{max-height:150px;overflow:hidden;position:relative}.m-on .mapwrap.mopen{max-height:none}" +
    ".m-on .mapwrap:not(.mopen)::after{content:'';position:absolute;left:0;right:0;bottom:0;height:46px;background:linear-gradient(transparent,#fff)}" +
    ".m-on .legend span:last-child{display:none}.m-on .legend{padding:6px 10px}" +
    ".m-on .note{font-size:12px}.m-on .grp-h{padding:9px 12px}" +
    ".m-on .row{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:'op hrs' 'rt rt' 'bar bar' 'fr fr';gap:6px 10px;padding:12px}" +
    ".m-on .row>span:first-child{grid-area:op}.m-on .rt{grid-area:rt}.m-on .time{display:contents}" +
    ".m-on .hrs{grid-area:hrs;justify-self:end}.m-on .bar{grid-area:bar}.m-on .freq{grid-area:fr}.m-on .chev{display:none}" +
    ".m-on .more{grid-template-columns:minmax(0,1fr)}.m-on .copy{padding:5px 10px;font-size:13px}" +
    ".mbtn{align-self:flex-start;font:inherit;font-size:13px;padding:6px 12px;border-radius:6px;border:1px solid #2f6fd6;background:#fff;color:#2f6fd6}" +
    ".mord{background:#fff;border:1px solid #dde3ec;border-radius:8px;overflow:hidden}.mord>b{display:block;padding:10px 12px;cursor:pointer}" +
    ".mord a{display:flex;justify-content:space-between;gap:10px;padding:10px 12px;border-top:1px solid #dde3ec;color:#1b2230;text-decoration:none;font-size:14px}" +
    ".mord a span{color:#5a6578;font-size:12px;overflow-wrap:anywhere;text-align:right}.mord:not(.open) a{display:none}";
  var LINKS = [["ScandiLines", "cargoweb.scandlines.com"], ["Eckero Portal", "cargo.eckeroline.com"], ["Eckero mail", "cargo@eckeroline.fi"], ["Tallink mail", "booking.cargo@tallink.ee"], ["Kreiss mail", "booking@kreiss.lv"]];
  var mst, mbtn, mord, mon = false;
  function mobile(on) {
    var r = sh(); if (!r) return; mon = on;
    var host = document.getElementById("ferries-root"), w = r.getElementById("mapwrap");
    if (!mst) { mst = document.createElement("style"); r.appendChild(mst); }
    mst.textContent = on ? MCSS : "";
    host.classList.toggle("m", on); r.querySelector(".wrap").classList.toggle("m-on", on);
    if (on && !mbtn) {
      mbtn = document.createElement("button"); mbtn.type = "button"; mbtn.className = "mbtn"; mbtn.textContent = "▾ Развернуть карту";
      mbtn.onclick = function () { var o = w.classList.toggle("mopen"); mbtn.textContent = o ? "▴ Свернуть карту" : "▾ Развернуть карту"; };
      w.after(mbtn);
      mord = document.createElement("div"); mord.className = "mord";
      mord.innerHTML = "<b>Заказ паромов ▸ <small style='font-weight:400;color:#5a6578'>5 · из листа «Ссылки»</small></b>" + LINKS.map(function (l) { return "<a href='#' onclick='return false'>" + l[0] + "<span>" + l[1] + "</span></a>"; }).join("");
      mord.firstChild.onclick = function () { mord.classList.toggle("open"); };
      mbtn.after(mord);
    }
    if (mbtn) { mbtn.style.display = on ? "" : "none"; mord.style.display = on ? "" : "none"; }
    mb.classList.toggle("on", on);
  }
  var bar = document.createElement("div");
  bar.style.cssText = "position:fixed;left:50%;bottom:8px;transform:translateX(-50%);z-index:99999;display:none;padding:6px 8px;background:#fff;border:1px solid #2f6fd6;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.2)";
  var s = document.createElement("style");
  s.textContent = ".vbar button{background:#fff;color:#2f6fd6;border:1px solid #2f6fd6;border-radius:6px;padding:4px 9px;cursor:pointer;font:13px sans-serif}.vbar button:hover,.vbar button.on{background:#2f6fd6;color:#fff}";
  document.head.appendChild(s); bar.className = "vbar";
  var mb = document.createElement("button"); mb.type = "button"; mb.textContent = "📱 Мобильный вид";
  mb.onclick = function () { mobile(!mon); };
  bar.appendChild(mb); document.body.appendChild(bar);
  setInterval(function () {
    var t = document.getElementById("tab-ferries"), vis = t && !t.hidden && t.offsetParent !== null;
    bar.style.display = vis ? "block" : "none";
  }, 400);
})();

/* Песочница Флота, 25.10 (обс, Владимир): цепочка перецепа у пройденной точки-машины («OM-8211 ↔ ON-3917»).
   Только вид: текст в поле таргета не меняется (по нему считаются позиция, ✓ и код точки), цепочка рисуется поверх пустой части поля
   и дублируется в подсказке. В цепочку идут пройденные (✓) точки-машины этой строки, последней — исходная машина строки.
   Переключатели внизу страницы на вкладке Флота; «Пример на строке» — превращает ③ и ⑤ первой подходящей строки в точки-машины. */
(function () {
  var mode = "tail", demo = true, narrow = false, saved = new WeakMap(), hid = new WeakMap();
  var ARROW = " ↔ ";
  function wraps(tr) { return Array.prototype.slice.call(tr.querySelectorAll(".target-wrap")); }
  function inp(w) { return w.querySelector(".target-input, .xt-input"); }
  function plaque(w) { return w.querySelector(".lo-btn"); }
  function textW(el, s) {
    var c = textW.c || (textW.c = document.createElement("canvas").getContext("2d"));
    c.font = getComputedStyle(el).font; return c.measureText(s).width;
  }
  function chainFor(tr) {
    var unit = (tr.querySelector(".unit-input") || {}).value || "";
    var out = [], prev = [];
    wraps(tr).forEach(function (w, i) {
      var b = plaque(w), name = (inp(w).value || "").trim();
      if (b && b.dataset.ptk === "truck" && w.classList.contains("pt-done") && name) {
        var list = [name].concat(prev.slice().reverse()); if (unit) list.push(unit.trim());
        out[i] = list; prev.push(name);
      }
    });
    return out;
  }
  function applyDemo(tr) {
    var ws = wraps(tr), on = demo;
    ws.slice(0, 5).forEach(function (w) {      // свёрнутые точки показываем только в примере
      if (on) { if (w.classList.contains("fold-hide")) { hid.set(w, 1); w.classList.remove("fold-hide"); } }
      else if (hid.has(w)) { w.classList.add("fold-hide"); hid.delete(w); }
    });
    [[2, "OM-8211"], [4, "XX-YYYY"]].forEach(function (p) {
      var w = ws[p[0]]; if (!w) return;
      var i = inp(w), b = plaque(w);
      if (on) {
        if (!saved.has(w)) saved.set(w, { v: i.value, k: b.dataset.ptk, d: w.classList.contains("pt-done") });
        i.value = p[1]; b.dataset.ptk = "truck"; w.classList.add("pt-done");
      } else if (saved.has(w)) {
        var s0 = saved.get(w); i.value = s0.v; if (s0.k) b.dataset.ptk = s0.k; else delete b.dataset.ptk;
        w.classList.toggle("pt-done", s0.d); saved.delete(w); clear(w);
      }
    });
  }
  function clear(w) {
    var t = w.querySelector(".chain-tail"); if (t) t.remove();
    delete w.dataset.chain;
  }
  function draw(w, list) {
    var i = inp(w), full = list.join(ARROW);
    if (mode === "off") { clear(w); return; }
    i.title = full;
    if (mode !== "tail") { clear(w); return; }
    var rest = list.slice(1), orig = rest[rest.length - 1];
    var tail = "↔ " + rest.join(ARROW);
    var left = i.offsetLeft + parseFloat(getComputedStyle(i).paddingLeft) + textW(i, i.value) + 10;
    var room = i.offsetLeft + i.offsetWidth - 6 - left;
    if (textW(i, tail) > room) tail = rest.length > 1 ? "↔ … ↔ " + orig : tail;
    if (textW(i, tail) > room) { clear(w); return; }
    var key = tail + "|" + Math.round(left) + "|" + Math.round(room);
    if (w.dataset.chain === key) return;
    var t = w.querySelector(".chain-tail");
    if (!t) { t = document.createElement("span"); t.className = "chain-tail"; w.appendChild(t); }
    t.textContent = tail; t.style.left = left + "px"; t.style.maxWidth = room + "px"; t.style.font = getComputedStyle(i).font;
    t.title = full; w.dataset.chain = key;
  }
  function pass() {
    var body = document.getElementById("fleet-tbody"); if (!body || body.offsetParent === null) return;
    document.body.classList.toggle("ch-narrow", narrow);
    var rows = Array.prototype.slice.call(body.querySelectorAll("tr")).filter(function (tr) { return tr.querySelector(".unit-input"); });
    var demoRow = rows.filter(function (tr) { return wraps(tr).length >= 3; }).sort(function (a, b) { return wraps(b).length - wraps(a).length; })[0];
    if (demoRow) applyDemo(demoRow);
    rows.forEach(function (tr) {
      var ch = chainFor(tr);
      wraps(tr).forEach(function (w, i) { if (ch[i]) draw(w, ch[i]); else if (w.querySelector(".chain-tail")) clear(w); });
    });
  }
  var bar = document.createElement("div"); bar.className = "vbar";
  bar.style.cssText = "position:fixed;left:50%;bottom:8px;transform:translateX(-50%);z-index:99999;display:none;gap:6px;padding:6px 8px;background:#fff;border:1px solid #2f6fd6;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.2);font:12px sans-serif;align-items:center";
  function btn(txt, fn) { var b = document.createElement("button"); b.type = "button"; b.textContent = txt; b.onclick = function () { fn(b); pass(); sync(); }; bar.appendChild(b); return b; }
  var lab = document.createElement("span"); lab.textContent = "Цепочка перецепа:"; bar.appendChild(lab);
  var bOff = btn("Выкл", function () { mode = "off"; }), bTail = btn("Хвост в поле", function () { mode = "tail"; }), bTip = btn("Только подсказка", function () { mode = "tip"; });
  var bDemo = btn("Пример на строке", function () { demo = !demo; }), bNar = btn("Узкая колонка", function () { narrow = !narrow; });
  function sync() {
    bOff.classList.toggle("on", mode === "off"); bTail.classList.toggle("on", mode === "tail"); bTip.classList.toggle("on", mode === "tip");
    bDemo.classList.toggle("on", demo); bNar.classList.toggle("on", narrow);
  }
  document.body.appendChild(bar); sync();
  setInterval(function () {
    var b = document.getElementById("fleet-tbody"), vis = b && b.offsetParent !== null;
    bar.style.display = vis ? "flex" : "none";
    if (vis) pass();
  }, 400);
})();
