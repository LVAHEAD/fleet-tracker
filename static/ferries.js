/*
Fleet ETA Tracker — закладка «Паромы» (v3.197): карта-схема линий + таблица с фильтрами, поиском и раскрывающимися условиями / контактами.
Данные — static/ferries-data.js (справочно, сверять с оператором). Верстка и стили живут в Shadow DOM: с остальной аппой не пересекаются.
Клик по линии или порту на схеме — оставить в таблице только эти линии; наведение на строку подсвечивает линию.
*/
(function () {
  const host = document.getElementById("ferries-root");
  if (!host || typeof FERRY_DATA === "undefined") return;
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>
/* Макет закладки «Паромы». Идея: строка = линия; слева оператор, в центре маршрут и порты, справа время рейса крупно с полоской-масштабом; условия и контакты раскрываются. Цвета — синий аппы «Синий Кальк». */
:host{display:block;--bg:#f4f6fa;--surface:#fff;--line:#dde3ec;--fg:#1b2230;--muted:#5a6578;--accent:#2f6fd6;--accent-soft:#e6eefb;--bar:#bcd3f5;--chip-bg:92%;--chip-fg:28%;--warn:#9a5b00;--warn-bg:#fdf1dc;--water:#e3edfa;--land:#fbfcfe;--coast:#a9b8cf;--c-fi:#2f6fd6;--c-se:#14907a;--c-dk:#c47a0c;--c-ee:#8a4fd0}
*{box-sizing:border-box}
.wrap{display:flex;flex-direction:column;gap:14px}
.top{display:flex;flex-wrap:wrap;gap:10px 16px;align-items:center;justify-content:space-between}
h1{font-size:19px;margin:0;font-weight:650}
h1 small{font-weight:400;color:var(--muted);font-size:13px;margin-left:8px}
.search{flex:1 1 220px;max-width:340px;padding:7px 10px;border:1px solid var(--line);border-radius:6px;background:var(--surface);color:var(--fg);font:inherit}
.search:focus-visible,.btn:focus-visible,.row:focus-visible,.copy:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.filters{display:flex;flex-wrap:wrap;gap:6px}
.btn{font:inherit;font-size:13px;padding:5px 12px;border-radius:6px;border:1px solid var(--accent);background:var(--surface);color:var(--accent);cursor:pointer}
.btn:hover,.btn[aria-pressed="true"]{background:var(--accent);color:#fff}
.note{margin:0;color:var(--muted);font-size:12.5px}
.grp{display:flex;flex-direction:column;gap:0;background:var(--surface);border:1px solid var(--line);border-radius:8px;overflow:hidden}
.grp-h{display:flex;align-items:center;gap:10px;padding:9px 14px;background:var(--accent-soft);border-bottom:1px solid var(--line);font-weight:600}
.pair{display:inline-flex;align-items:center;gap:4px;font:600 12px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.cc{padding:3px 5px;border-radius:4px;background:var(--surface);border:1px solid var(--line);color:var(--fg)}
.grp-h .n{margin-left:auto;font-weight:400;color:var(--muted);font-size:12.5px}
.line{border-top:1px solid var(--line)}
.line:first-of-type{border-top:0}
.row{display:grid;grid-template-columns:150px minmax(0,1fr) minmax(170px,230px) 24px;gap:6px 16px;align-items:center;padding:11px 14px;cursor:pointer;width:100%;text-align:left;background:none;border:0;color:inherit;font:inherit}
.row:hover{background:var(--accent-soft)}
.op{display:inline-block;max-width:100%;padding:3px 9px;border-radius:5px;font-weight:600;font-size:13px;background:hsl(var(--h) 60% var(--chip-bg));color:hsl(var(--h) 55% var(--chip-fg));overflow-wrap:anywhere}
.route{font-weight:600;font-size:14.5px;overflow-wrap:anywhere}
.ports{color:var(--muted);font-size:12.5px;margin-top:2px;overflow-wrap:anywhere}
.time{display:flex;flex-direction:column;gap:3px;min-width:0}
.hrs{font-size:20px;font-weight:650;font-variant-numeric:tabular-nums;line-height:1.1}
.hrs i{font-style:normal;font-size:12px;font-weight:500;color:var(--muted);margin-right:3px}
.hrs u{text-decoration:none;font-size:13px;font-weight:500;color:var(--muted);margin-left:3px}
.bar{height:5px;border-radius:3px;background:var(--line);overflow:hidden}
.bar b{display:block;height:100%;background:var(--bar);border-right:3px solid var(--accent)}
.freq{font-size:12.5px;color:var(--muted)}
.tag{display:inline-block;margin-right:5px;padding:1px 6px;border-radius:4px;font-size:11.5px;font-weight:600;background:var(--warn-bg);color:var(--warn)}
.tag.direct{background:var(--accent-soft);color:var(--accent)}
.chev{justify-self:end;color:var(--muted);transition:transform .15s}
.line.open .chev{transform:rotate(90deg)}
.more{display:none;padding:2px 14px 14px 14px;grid-template-columns:150px minmax(0,1fr);gap:8px 16px}
.line.open .more{display:grid}
.more h4{margin:0;font-size:11.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:600}
.more p{margin:0;overflow-wrap:anywhere}
.ct{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center}
.ct span{user-select:all}
.copy{font:inherit;font-size:12px;padding:1px 7px;border-radius:5px;border:1px solid var(--accent);background:var(--surface);color:var(--accent);cursor:pointer;margin-left:5px}
.copy:hover{background:var(--accent);color:#fff}

.mapwrap{overflow-x:auto;border:1px solid var(--line);border-radius:8px;background:var(--surface)}
#mapbox svg{display:block;width:100%;height:auto}
.wrap{display:grid;grid-template-columns:700px minmax(0,1fr);gap:10px 18px;align-items:start}
.wrap>.top{grid-column:1/-1}
.wrap>aside.side{grid-column:1;grid-row:2/span 8;position:sticky;top:8px}
.wrap>*:not(.top):not(aside.side){grid-column:2}
aside.side .mapwrap{margin-bottom:10px}aside.side .filters{margin-bottom:6px}
.ord{background:var(--surface);border:1px solid var(--line);border-radius:8px;overflow:hidden;margin-top:10px}
.ord-h{display:flex;justify-content:space-between;padding:8px 12px;background:var(--accent-soft);border-bottom:1px solid var(--line);font-weight:600;font-size:13px}
.ord-h span:last-child{font-weight:400;color:var(--muted)}
.ord a{display:flex;justify-content:space-between;align-items:baseline;gap:10px;padding:8px 12px;border-top:1px solid var(--line);color:var(--fg);text-decoration:none;font-size:14px}
.ord-h+a{border-top:0}.ord a:hover{background:var(--accent-soft)}
.ord a span{color:var(--muted);font-size:12.5px;overflow-wrap:anywhere;text-align:right}
.legend span:last-child{flex-basis:100%}
@media (max-width:1150px){.wrap{display:block}.wrap>aside.side{position:static}.wrap>*{margin-bottom:10px}}
.sea{fill:var(--water)}
.land{fill:var(--land);stroke:var(--coast);stroke-width:1.2;stroke-linejoin:round}
.cn{font:600 13px -apple-system,Segoe UI,sans-serif;letter-spacing:.18em;fill:var(--muted);opacity:.55;text-anchor:middle}
.ln{fill:none;stroke-width:3.2;stroke-linecap:round;stroke-linejoin:round;cursor:pointer;opacity:.9;transition:opacity .15s,stroke-width .15s}
.ln.ee{stroke:var(--c-ee)}.ln.fi{stroke:var(--c-fi)}.ln.se{stroke:var(--c-se)}.ln.dk{stroke:var(--c-dk)}
.ln:hover,.ln.hi{stroke-width:6;opacity:1}
.mapwrap.sel .ln:not(.on){opacity:.12}
.mapwrap.sel .pt:not(.on){opacity:.35}
/* раскрытая строка таблицы: её линия и порты на схеме ярко, остальные притушены */
.mapwrap.foc .ln:not(.fon){opacity:.12}
.mapwrap.foc .pt:not(.fon){opacity:.35}
.ln.fon{stroke-width:5.5;opacity:1}
.pt{cursor:pointer}
.pt circle{fill:var(--surface);stroke:var(--fg);stroke-width:2.2}
.pt text{font:600 13px -apple-system,Segoe UI,sans-serif;fill:var(--fg);paint-order:stroke;stroke:var(--land);stroke-width:3.5px;stroke-linejoin:round}
.pt:hover circle,.pt.on circle{fill:var(--accent);stroke:var(--accent)}
.legend{display:flex;flex-wrap:wrap;gap:6px 16px;padding:8px 12px;border-top:1px solid var(--line);font-size:12.5px;color:var(--muted);align-items:center}
.legend i{display:inline-block;width:22px;height:4px;border-radius:2px;margin-right:6px;vertical-align:middle}
.selbar{display:flex;align-items:center;gap:8px;min-height:30px}
.empty{padding:26px;text-align:center;color:var(--muted)}
@media (max-width:760px){
 .row{grid-template-columns:minmax(0,1fr) 24px;}
 .row .op{grid-column:1}
 .row .rt{grid-column:1/2}
 .row .time{grid-column:1/2}
 .chev{grid-column:2;grid-row:1}
 .more{grid-template-columns:minmax(0,1fr)}
}
@media (prefers-reduced-motion:reduce){.chev{transition:none}}
</style>
<div class="wrap">
  <div class="top">
    <h1>Паромы<small id="cnt"></small></h1>
    <input id="q" class="search" type="search" placeholder="Порт, оператор, город" autocomplete="off">
  </div>
  <aside class="side">
  <div class="mapwrap" id="mapwrap"><div id="mapbox"></div>
    <div class="legend"><span><i style="background:var(--c-fi)"></i>Германия ↔ Финляндия</span><span><i style="background:var(--c-se)"></i>Швеция</span><span><i style="background:var(--c-dk)"></i>Дания</span><span><i style="background:var(--c-ee)"></i>Эстония</span><span>Клик по линии или порту — показать в таблице. Схема, береговая линия упрощена.</span></div></div>
  <div class="filters" id="flt"></div>
  <div class="selbar" id="selbar"></div>
  <div class="ord" id="ord" hidden></div>
  </aside>
  <p class="note">Справочно: время и условия сверяйте с оператором. Полоска — длительность рейса от 0 до 43 ч (самый долгий, Росток – Ханко, Transfennica). Клик по линии — условия и контакты.</p>
  <div id="list" style="display:flex;flex-direction:column;gap:14px"></div>
  <p class="note"><b>Регистрация (check-in).</b> Тягач с водителем — не позднее 60–90 мин до отхода; несопровождаемые прицепы — за 2–3 ч; ADR — декларация подана и подтверждена минимум за 24 ч до рейса.</p>
</div>

`;

// ---------- схема-карта: упрощённые берега (вручную, по памяти) + порты + линии ----------
const LON0 = 3.5, LAT1 = 62.8, KX = 36.36, KY = 67.7;
const P = (lon, lat) => [(lon - LON0) * KX, (LAT1 - lat) * KY];
const LAND = [
  [[4,53],[5,53.4],[6.6,53.5],[8,53.7],[8.6,53.9],[8.7,54.0],[8.6,54.9],[8.1,55.5],[8.1,56.6],[8.2,57.1],[9,57.6],[10,57.7],[10.6,57.75],[10.5,57],[10.3,56.5],[10.9,56.5],[10.2,56.15],[9.9,55.5],[9.7,55],[9.5,54.8],[10.15,54.35],[11.1,54.4],[10.9,53.95],[11.4,54],[12.1,54.15],[12.5,54.45],[13.4,54.65],[14.25,53.92],[15.6,54.2],[16.9,54.6],[18.55,54.52],[18.8,54.6],[19.4,54.35],[20,54.7],[21,55.2],[21.1,55.7],[21,56.5],[21.55,57.4],[22.6,57.75],[23.3,57.1],[24.1,57],[24.4,57.9],[24.5,58.4],[23.5,58.8],[23.4,59.2],[24.75,59.45],[26.5,59.6],[28,59.5],[28.2,59.4],[30.5,59.9],[30.5,53]],
  [[28.7,60.7],[27,60.45],[25.65,60.3],[24.95,60.15],[24.4,59.95],[22.95,59.82],[22.4,60],[21.6,60.6],[21.5,61.1],[21.3,62],[21.6,62.8],[30.5,62.8],[30.5,61]],
  [[12.8,55.4],[13.15,55.37],[13.8,55.43],[14.35,55.55],[14.86,56.17],[15.6,56.15],[16.35,56.66],[16.7,57.5],[16.65,57.75],[16.6,58.5],[17.95,58.9],[18.1,59.3],[18.9,59.8],[19,60.5],[17.5,61],[17.2,61.7],[17.5,62.8],[6.2,62.8],[5,62.2],[5,61],[4.9,60.4],[5.2,59.2],[5.6,58.9],[6.6,58.1],[7.5,58],[8.1,58.1],[9,58.55],[9.8,58.9],[10.2,59.05],[10.45,59.2],[10.55,59.8],[10.75,59.92],[10.85,59.8],[10.7,59.3],[11.1,59.1],[11.1,58.5],[11.75,58],[11.9,57.7],[12.2,57.3],[12.6,56.9],[12.85,56.6],[12.7,56.1],[12.95,55.6],[12.9,55.4]],
  [[11,55.4],[11.2,55.95],[11.9,56.1],[12.55,56.05],[12.65,55.6],[12.4,55.2],[11.6,55.1]],
  [[9.8,55.3],[10.3,55.65],[10.8,55.55],[10.6,55.1],[10,55.1]],
  [[11,54.7],[12,54.5],[12.2,54.9],[11.5,55.05]],
  [[14.7,55],[15.15,55.1],[15,55.28]],
  [[18.1,57],[18.7,57.9],[18.95,57.7],[18.5,56.95]],
  [[21.9,58.3],[22.6,58.6],[23.2,58.4],[22.4,58.1]],
];
const PORTS = {
  trav:["Травемюнде / Любек",10.87,53.96,-9,16,"end"], kiel:["Киль",10.15,54.33,-9,4,"end"], rost:["Росток",12.1,54.17,0,20,"middle"],
  swin:["Свиноуйсьце",14.25,53.92,0,20,"middle"], gdy:["Гдыня / Гданьск",18.6,54.5,0,20,"middle"],
  vent:["Вентспилс",21.55,57.4,9,4,"start"], klai:["Клайпеда",21.13,55.71,9,4,"start"], riga:["Рига",24.1,57,0,20,"middle"],
  hels:["Хельсинки",25.15,60.21,0,-10,"middle"], hanko:["Ханко",22.95,59.82,0,-10,"middle"], turku:["Турку",22.2,60.43,0,-10,"middle"],
  nyn:["Нюнесхамн",17.95,58.9,-9,4,"end"], sto:["Стокгольм",18.1,59.32,9,4,"start"], kars:["Карлскруна",15.6,56.16,9,4,"start"],
  karh:["Карлсхамн",14.86,56.17,-8,4,"end"], ystad:["Истад",13.82,55.42,9,8,"start"], trel:["Треллеборг",13.15,55.37,-9,16,"end"],
  malm:["Мальмё",12.95,55.62,10,5,"start"], hsb:["Хельсингборг",12.7,56.05,4,-16,"start"], hsg:["Хельсингёр",12.6,56.04,-9,-6,"end"],
  gote:["Гётеборг",11.95,57.7,10,4,"start"], halm:["Хальмстад",12.85,56.67,9,4,"start"], fred:["Фредериксхавн",10.54,57.44,10,14,"start"],
  hirt:["Хиртсхальс",9.96,57.59,-9,-6,"end"], gren:["Грена",10.92,56.41,-9,4,"end"], cph:["Копенгаген",12.6,55.7,-9,14,"end"],
  oslo:["Осло",10.75,59.9,9,4,"start"], larv:["Ларвик",10.03,59.05,-9,4,"end"], kris:["Кристиансанн",8,58.15,0,20,"middle"],
  kapel:["Капелльшер",19.07,59.72,9,4,"start"], pald:["Палдиски",24.05,59.35,-9,14,"end"], tall:["Таллин",24.75,59.45,9,16,"start"],
  putt:["Путтгарден",11.22,54.5,-9,8,"end"], rody:["Рёдбю",11.35,54.66,9,-4,"start"], gedser:["Гедсер",11.93,54.57,9,12,"start"],
  stav:["Ставангер",5.7,58.97,-9,4,"end"], berg:["Берген",5.3,60.4,-9,4,"end"],
};
// [номер строки таблицы, от, до, промежуточные точки]
const SEG = [
  [0,"trav","hels",[[11.5,54.2],[12.4,54.75],[15.5,55.8],[19.5,58.2],[21.5,59.6],[24.2,59.75]]],[1,"trav","hanko",[[11.5,54.2],[12.4,54.75],[15.5,55.8],[19.5,58.2],[21.5,59.6]]],[2,"rost","hanko",[[13.8,54.9],[15.5,55.8],[19.5,58.2],[21.5,59.6]]],[3,"rost","turku",[[13.8,54.9],[15.5,55.8],[19.5,58.2],[21.3,59.7]]],[4,"rost","hanko",[[13.8,54.9],[15.5,55.8],[19.5,58.2],[21.5,59.6]]],
  [5,"kars","gdy"],[6,"ystad","swin"],[7,"ystad","swin"],[8,"nyn","gdy",[[17.4,57.5]]],[9,"trel","swin"],
  [10,"nyn","vent"],[11,"sto","riga"],[12,"karh","klai"],[13,"trel","klai"],[14,"trel","rost"],[15,"trel","rost"],
  [16,"trel","trav",[[12.4,54.75],[11.5,54.2]]],[17,"gote","kiel",[[11.4,56.5],[10.9,55.4],[10.9,54.8]]],
  [18,"malm","trav",[[12.8,54.95],[11.5,54.2]]],[19,"fred","gote"],[20,"hsg","hsb"],[21,"gren","halm"],
  [22,"hirt","kris"],[23,"hirt","larv"],[24,"hirt","kris"],[25,"hirt","stav"],[25,"stav","berg"],
  [27,"hels","tall"],[28,"hels","tall"],[29,"hels","tall"],[30,"kapel","pald"],[31,"sto","tall",[[19.4,59.45],[22.5,59.55]]],
  [32,"putt","rody"],[33,"rost","gedser",[[12.0,54.4]]],
  [26,"cph","oslo",[[12.67,56],[12.2,56.5],[11.4,57.5],[10.7,58.6],[10.6,59.2]]],
];
function buildMap() {
  const W = 1000, H = Math.round((LAT1 - 52.8) * KY);
  const land = LAND.map((poly) => `<polygon points="${poly.map(([lo, la]) => P(lo, la).map((v) => v.toFixed(1)).join(",")).join(" ")}" class="land"/>`).join("");
  const names = [["ГЕРМАНИЯ",9.2,53.45],["ДАНИЯ",9.1,56.9],["ШВЕЦИЯ",14.3,58.8],["НОРВЕГИЯ",7.6,61],["ФИНЛЯНДИЯ",26,61.7],["ЭСТОНИЯ",25.6,58.9],["ЛАТВИЯ",25.3,56.6],["ЛИТВА",23.7,55.3],["ПОЛЬША",17.5,53.4]]
    .map(([t, lo, la]) => { const [x, y] = P(lo, la); return `<text x="${x.toFixed(0)}" y="${y.toFixed(0)}" class="cn">${t}</text>`; }).join("");
  const seen = {};
  SEG.forEach(([i, a, b, via]) => { const k = [a, b].sort().join("-"); (seen[k] = seen[k] || { a, b, via, ids: new Set() }).ids.add(i); });
  const lines = Object.values(seen).map((s) => {
    const pts = [PORTS[s.a].slice(1, 3)].concat(s.via || [], [PORTS[s.b].slice(1, 3)]).map(([lo, la]) => P(lo, la).map((v) => v.toFixed(1)).join(",")).join(" ");
    const ids = [...s.ids], reg = rows[ids[0]].region;
    return `<polyline points="${pts}" class="ln ${reg === "Швеция" ? "se" : reg === "Дания" ? "dk" : reg === "Эстония" ? "ee" : "fi"}" data-ids="${ids.join(",")}" data-a="${s.a}" data-b="${s.b}"><title>${esc(PORTS[s.a][0])} — ${esc(PORTS[s.b][0])}: ${ids.map((i) => rows[i].op).join(", ")}</title></polyline>`;
  }).join("");
  const ports = Object.entries(PORTS).map(([id, [n, lo, la, dx, dy, an]]) => { const [x, y] = P(lo, la);
    return `<g class="pt" data-p="${id}"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5.5"/><text x="${(x + dx).toFixed(1)}" y="${(y + dy).toFixed(1)}" text-anchor="${an}">${esc(n)}</text></g>`; }).join("");
  root.getElementById("mapbox").innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Схема паромных линий Балтики и Северного моря"><rect width="${W}" height="${H}" class="sea"/>${land}${names}${lines}${ports}</svg>`;
}

const CC = {Германия:"DE",Финляндия:"FI",Швеция:"SE",Польша:"PL",Латвия:"LV",Литва:"LT",Дания:"DK",Норвегия:"NO",Эстония:"EE"};
const MAXH = 43;
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const num = (s) => parseFloat(String(s).replace(",", "."));
function hours(t) {
  if (!t) return null;
  let h = 0, m = 0;
  const a = t.match(/([\d.,]+)(?:\s*[–-]\s*([\d.,]+))?\s*ч/);
  if (a) h = a[2] ? (num(a[1]) + num(a[2])) / 2 : num(a[1]);
  const b = t.match(/([\d.,]+)(?:\s*[–-]\s*([\d.,]+))?\s*мин/);
  if (b) m = b[2] ? (num(b[1]) + num(b[2])) / 2 : num(b[1]);
  return h + m / 60;
}
function hue(s) { let x = 0; for (const c of s) x = (x * 31 + c.charCodeAt(0)) % 360; return x; }
function region(d) { return d.includes("Эстония") ? "Эстония" : d.startsWith("Германия") && d.includes("Финляндия") ? "Германия ↔ Финляндия" : d.startsWith("Швеция") ? "Швеция" : "Дания"; }
const rows = FERRY_DATA.map((d, i) => {
  const m = d.freq.match(/≈\s*([\d.,–\- ]+(?:ч|мин)(?:\s*\d+\s*мин)?)/);
  let rest = d.freq.replace(m ? m[0] : "", "");
  const tg = rest.match(/^\s*(Прямой|С заходом|Транзитный)/);
  if (tg) rest = rest.replace(tg[0], "");
  rest = rest.replace(/^\s*\(([^)]*)\)\s*,?/, "$1,").replace(/^[\s,]+|[\s,]+$/g, "");
  return { ...d, i, time: m ? m[1].trim() : "", h: m ? hours(m[1]) : null, tag: tg ? tg[1] : "", rest, region: region(d.dir) };
});
let reg = "Все", q = "", sel = null, selName = "";
// v3.207: фильтр по странам — «Все» и страна, которая есть в данных (по числу линий); страна показывает линии «из» и «в» неё.
const dirParts = (d) => d.split("↔").map((x) => x.trim());
const regions = (() => { const n = {}; rows.forEach((r) => dirParts(r.dir).forEach((c) => { n[c] = (n[c] || 0) + 1; }));
  return ["Все"].concat(Object.keys(n).sort((a, b) => n[b] - n[a] || a.localeCompare(b, "ru"))); })();
// Развернуть текст под выбранную страну: она первой («Эстония» → «Эстония ↔ Финляндия», «Финляндия» → «Финляндия ↔ Эстония»).
const flipped = (r) => reg !== "Все" && dirParts(r.dir)[1] === reg;
const flipDir = (r) => flipped(r) ? dirParts(r.dir).reverse().join(" ↔ ") : r.dir;
const flipRoute = (r) => flipped(r) ? r.route.split("↔").map((x) => x.trim()).reverse().join(" ↔ ") : r.route;
const flipPorts = (r) => { if (!flipped(r)) return r.ports;
  const sep = r.ports.includes(" · ") ? " · " : r.ports.includes(" — ") ? " — " : null;
  return sep ? r.ports.split(sep).reverse().join(sep) : r.ports; };
function pair(dir) {
  const [a, b] = dir.split("↔").map((x) => CC[x.trim()] || x.trim());
  return `<span class="pair"><span class="cc">${esc(a)}</span>↔<span class="cc">${esc(b)}</span></span>`;
}
function copyText(btn, text) {
  const done = () => { const o = btn.textContent; btn.textContent = "ok"; setTimeout(() => (btn.textContent = o), 900); };
  try { navigator.clipboard.writeText(text).then(done, () => selText(btn)); } catch (e) { selText(btn); }
}
function selText(btn) { const s = btn.previousElementSibling; if (s) { const r = document.createRange(); r.selectNodeContents(s); const g = getSelection(); g.removeAllRanges(); g.addRange(r); } }
function hrsHtml(s) { return esc(s).replace(/\s*ч(?=\s|$)/g, "<u>ч</u>").replace(/\s*мин(?=\s|$)/g, "<u>мин</u>"); }
function lineHtml(r) {
  const ct = r.contact ? r.contact.split(" · ").map((x) => x.replace(/^Tel:\s*/, "")).map((x) => `<span class="c"><span>${esc(x)}</span><button type="button" class="copy" data-t="${esc(x)}" title="Скопировать">копировать</button></span>`).join("") : '<span style="color:var(--muted)">не указаны</span>';
  const tag = r.tag ? `<span class="tag ${r.tag === "Прямой" ? "direct" : ""}">${esc(r.tag)}</span>` : "";
  const pct = r.h != null ? Math.max(3, Math.min(100, (r.h / MAXH) * 100)) : 0;
  return `<div class="line" data-i="${r.i}">
    <button type="button" class="row" aria-expanded="false">
      <span><span class="op" style="--h:${hue(r.op)}">${esc(r.op)}</span></span>
      <span class="rt"><div class="route">${esc(flipRoute(r))}</div><div class="ports">${esc(flipPorts(r))}</div></span>
      <span class="time">${r.time ? `<span class="hrs"><i>≈</i>${hrsHtml(r.time)}</span><span class="bar"><b style="width:${pct}%"></b></span>` : ""}
        <span class="freq">${tag}${esc(r.rest)}</span></span>
      <span class="chev" aria-hidden="true">▸</span>
    </button>
    <div class="more"><h4>Условия</h4><p>${esc(r.cond)}</p><h4>Контакты</h4><div class="ct">${ct}</div></div>
  </div>`;
}
function render() {
  const t = q.trim().toLowerCase();
  const vis = rows.filter((r) => (reg === "Все" || dirParts(r.dir).includes(reg)) && (!sel || sel.has(r.i)) && (!t || (r.op + r.route + r.ports + r.dir + r.cond).toLowerCase().includes(t)));
  markMap();
  root.getElementById("cnt").textContent = vis.length + " из " + rows.length + " линий";
  const groups = [];
  vis.forEach((r) => { let g = groups.find((x) => x.dir === r.dir); if (!g) groups.push((g = { dir: r.dir, rows: [] })); g.rows.push(r); });
  const open = new Set([...root.querySelectorAll(".line.open")].map((e) => e.dataset.i));
  root.getElementById("list").innerHTML = groups.length ? groups.map((g) =>
    `<section class="grp"><div class="grp-h">${pair(flipDir(g.rows[0]))}<span>${esc(flipDir(g.rows[0]))}</span><span class="n">${g.rows.length} лин.</span></div>${g.rows.map(lineHtml).join("")}</section>`).join("")
    : '<div class="grp"><div class="empty">Ничего не найдено. Сбросьте поиск или фильтр.</div></div>';
  root.querySelectorAll(".line").forEach((e) => { if (open.has(e.dataset.i)) { e.classList.add("open"); e.querySelector(".row").setAttribute("aria-expanded", "true"); } });
  focusMap();
}
root.getElementById("flt").innerHTML = regions.map((r) => `<button type="button" class="btn" data-r="${esc(r)}" aria-pressed="${r === reg}">${esc(r)}</button>`).join("");
root.getElementById("flt").addEventListener("click", (e) => {
  const b = e.target.closest(".btn"); if (!b) return;
  reg = b.dataset.r;
  root.querySelectorAll("#flt .btn").forEach((x) => x.setAttribute("aria-pressed", x === b));
  render();
});
root.getElementById("q").addEventListener("input", (e) => { q = e.target.value; render(); });
root.getElementById("list").addEventListener("click", (e) => {
  const c = e.target.closest(".copy"); if (c) { copyText(c, c.dataset.t); return; }
  const r = e.target.closest(".row"); if (!r) return;
  const l = r.parentElement; l.classList.toggle("open"); r.setAttribute("aria-expanded", l.classList.contains("open"));
  focusMap();
});
function focusMap() {   // v3.208: раскрытая строка — выделить её линию на схеме, остальные притушить
  const w = root.getElementById("mapwrap");
  const ids = new Set([...root.querySelectorAll(".line.open")].map((e) => +e.dataset.i));
  const on = ids.size > 0 && !sel;
  w.classList.toggle("foc", on);
  w.querySelectorAll(".ln").forEach((l) => l.classList.toggle("fon", on && l.dataset.ids.split(",").some((i) => ids.has(+i))));
  const ports = new Set(); if (on) SEG.forEach(([i, a, b]) => { if (ids.has(i)) { ports.add(a); ports.add(b); } });
  w.querySelectorAll(".pt").forEach((p) => p.classList.toggle("fon", on && ports.has(p.dataset.p)));
}
function markMap() {
  const w = root.getElementById("mapwrap"); w.classList.toggle("sel", !!sel); focusMap();
  w.querySelectorAll(".ln").forEach((l) => l.classList.toggle("on", !!sel && l.dataset.ids.split(",").some((i) => sel.has(+i))));
  w.querySelectorAll(".pt").forEach((p) => p.classList.toggle("on", !!sel && SEG.some(([i, a, b]) => sel.has(i) && (a === p.dataset.p || b === p.dataset.p)) && selName === PORTS[p.dataset.p][0]));
  root.getElementById("selbar").innerHTML = sel ? `<span class="note">Показано на схеме: <b>${esc(selName)}</b></span><button type="button" class="btn" id="selx">Сбросить</button>` : "";
  const x = root.getElementById("selx"); if (x) x.onclick = () => { sel = null; selName = ""; render(); };
}
function pick(ids, name) { sel = new Set(ids); selName = name; reg = "Все"; root.querySelectorAll("#flt .btn").forEach((b) => b.setAttribute("aria-pressed", b.dataset.r === "Все")); render(); root.getElementById("list").scrollIntoView({ behavior: "smooth", block: "start" }); }
root.getElementById("mapbox").addEventListener("click", (e) => {
  const l = e.target.closest(".ln"), p = e.target.closest(".pt");
  if (l) pick(l.dataset.ids.split(",").map(Number), PORTS[l.dataset.a][0] + " — " + PORTS[l.dataset.b][0]);
  else if (p) pick(SEG.filter(([i, a, b]) => a === p.dataset.p || b === p.dataset.p).map((s) => s[0]), PORTS[p.dataset.p][0]);
});
root.getElementById("list").addEventListener("mouseover", (e) => { const ln = e.target.closest(".line"); root.querySelectorAll(".ln.hi").forEach((x) => x.classList.remove("hi")); if (ln) root.querySelectorAll(".ln").forEach((x) => { if (x.dataset.ids.split(",").includes(ln.dataset.i)) x.classList.add("hi"); }); });
buildMap();
render();

// v3.207: блок «Заказ паромов» — ссылки из листа «Ссылки» (/api/links, группа с названием «заказ паромов»; регистр и лишние пробелы не важны).
// Список правится в листе, в код ничего не зашито; нет группы или лист не прочитан — блок скрыт.
(async function loadOrder() {
  const box = root.getElementById("ord");
  try {
    const r = await fetch("/api/links"); if (!r.ok) return;
    const j = await r.json();
    const g = (j.groups || []).find((x) => (x.title || "").trim().replace(/\s+/g, " ").toLowerCase() === "заказ паромов");
    if (!g || !g.items || !g.items.length) return;
    const sub = (u) => { if (/^mailto:/i.test(u)) return u.slice(7); try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return ""; } };
    box.innerHTML = `<div class="ord-h"><span>Заказ паромов</span><span>${g.items.length}</span></div>` + g.items.map((it) => {
      const mail = /^mailto:/i.test(it.url);
      return `<a href="${esc(it.url)}"${mail ? "" : ' target="_blank" rel="noopener"'} title="${esc(mail ? it.url.slice(7) : it.url)}">${esc(it.name)}<span>${esc(sub(it.url))}</span></a>`;
    }).join("");
    box.hidden = false;
  } catch (e) { /* нет связи — блок просто не показываем */ }
})();

})();
