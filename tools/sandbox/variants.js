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
    if (mon && !inM) mobile(false);
    if (!st) { st = document.createElement("style"); r.appendChild(st); }
    var w = r.getElementById("mapwrap"), fl = r.getElementById("flt"), sb = r.getElementById("selbar");
    if (!aside) { aside = document.createElement("aside"); aside.className = "side"; w.parentNode.insertBefore(aside, w); aside.appendChild(w); }
    st.textContent = "aside.side{display:contents}" + V[n][1];
    if (V[n][2]) { aside.appendChild(fl); aside.appendChild(sb); }
    else { aside.after(fl); fl.after(sb); }
    [].forEach.call(bar.querySelectorAll("button"), function (b) { b.classList.toggle("on", +b.dataset.v === n); });
  }

  /* ---- 25.10: мобильный вид закладки «Паромы» (макет): рамка телефона 390 px, чипы стран в одну прокручиваемую строку,
     карта свёрнута (кнопка), строки-карточки, блок «Заказ паромов» (ссылки из листа «Ссылки», здесь — образец) ---- */
  var MCSS = ":host(.m){max-width:390px;margin:0 auto;border:8px solid #1b2230;border-radius:30px;padding:10px;box-sizing:border-box;background:#f4f6fa}" +
    "#mapbox{min-width:0}.m-on .wrap{display:flex;flex-direction:column;gap:10px}.m-on .wrap>aside.side{position:static;display:flex;flex-direction:column;gap:8px}" +
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

  /* ---- фильтры по странам (решено 25.10): «Все» + страна; страна показывает линии «из» и «в» неё; одна за раз; по числу линий ---- */
  var cSel = "Все", cOrig = null, cObs = null;
  function countries() {
    var n = {};
    FERRY_DATA.forEach(function (d) { d.dir.split("↔").forEach(function (c) { c = c.trim(); n[c] = (n[c] || 0) + 1; }); });
    return Object.keys(n).sort(function (a, b) { return n[b] - n[a] || a.localeCompare(b); }).map(function (c) { return [c, n[c]]; });
  }
  function cApply() {
    var r = sh(); if (!r) return;
    [].forEach.call(r.querySelectorAll(".line"), function (l) {
      var d = FERRY_DATA[+l.dataset.i].dir;
      l.style.display = (cSel === "Все" || d.split("↔").some(function (c) { return c.trim() === cSel; })) ? "" : "none";
    });
    [].forEach.call(r.querySelectorAll(".grp"), function (g) {
      var vis = [].some.call(g.querySelectorAll(".line"), function (l) { return l.style.display !== "none"; });
      g.style.display = vis ? "" : "none";
    });
    [].forEach.call(r.querySelectorAll("#flt .btn"), function (b) { b.setAttribute("aria-pressed", b.dataset.c === cSel); });
  }
  function countryChips(on) {
    var r = sh(); if (!r) return; var f = r.getElementById("flt");
    if (on) {
      if (cOrig === null) cOrig = f.innerHTML;
      f.innerHTML = '<button type="button" class="btn" data-c="Все">Все</button>' + countries().map(function (c) { return '<button type="button" class="btn" data-c="' + c[0] + '">' + c[0] + " " + c[1] + "</button>"; }).join("");
      if (!f._cl) { f._cl = 1; f.addEventListener("click", function (e) { var b = e.target.closest("[data-c]"); if (!b) return; e.stopPropagation(); cSel = b.dataset.c; cApply(); }, true); }
      cSel = "Все"; cApply();
      if (!cObs) { cObs = new MutationObserver(cApply); cObs.observe(r.getElementById("list"), { childList: true }); }
    } else {
      if (cObs) { cObs.disconnect(); cObs = null; }
      cSel = "Все"; cApply();
      if (cOrig !== null) { f.innerHTML = cOrig; cOrig = null; }
    }
  }
  var mst, mbtn, mord, mon = false, inM = false;
  function mobile(on) {
    var r = sh(); if (!r) return; if (on) { inM = true; apply(0); inM = false; } mon = on;
    var host = document.getElementById("ferries-root"), w = r.getElementById("mapwrap"), a = r.querySelector("aside.side");
    if (!mst) { mst = document.createElement("style"); r.appendChild(mst); }
    mst.textContent = on ? MCSS : ""; countryChips(on);
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
  var mb = document.createElement("button"); mb.type = "button"; mb.textContent = "📱 Мобильный вид";
  mb.onclick = function () { mobile(!mon); };
  var bar = document.createElement("div");
  bar.style.cssText = "position:fixed;left:50%;bottom:8px;transform:translateX(-50%);z-index:99999;display:none;gap:6px;flex-wrap:wrap;justify-content:center;padding:6px 8px;background:#fff;border:1px solid #2f6fd6;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.2);font:13px sans-serif;max-width:96vw";
  var s = document.createElement("style");
  s.textContent = ".vbar button{background:#fff;color:#2f6fd6;border:1px solid #2f6fd6;border-radius:6px;padding:4px 9px;cursor:pointer;font:13px sans-serif}.vbar button:hover,.vbar button.on{background:#2f6fd6;color:#fff}";
  document.head.appendChild(s); bar.className = "vbar";
  V.forEach(function (v, k) {
    var b = document.createElement("button"); b.type = "button"; b.dataset.v = k; b.textContent = k + " · " + v[0];
    b.onclick = function () { apply(k); }; bar.appendChild(b);
  });
  bar.appendChild(mb);
  document.body.appendChild(bar);
  setInterval(function () {
    var t = document.getElementById("tab-ferries"), vis = t && !t.hidden && t.offsetParent !== null;
    bar.style.display = vis ? "flex" : "none";
    if (vis && !st) apply(cur);
  }, 400);
})();
