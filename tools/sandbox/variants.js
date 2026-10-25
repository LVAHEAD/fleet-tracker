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
