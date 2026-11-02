/* Песочница Флота: «Лог рефа прицепа» в Truck Info (02.11, //обс Владимира). Макет на настоящих данных прицепа C-728A (Mapon reefer/historic_period, 20.10–2.11).
   Вкладка Truck Info → «Показать» (любой ввод) → блок «Реф». Период — селектор 3 / 7 / 14 суток. «Сейчас» заморожено: 02.11 09:55 UTC.
   Включение — подряд идущие интервалы «on», разрыв меньше 5 мин склеиваем. Подзарядка: до 60 мин «мало», 60–119 «достаточно», от 120 «хорошо» (пороги — константы).
   Варианты: A — сводка + список интервалов; B — сводка + полоса по суткам (включения на шкале 24 ч). Выбран B — переключателя нет. Время — Рига. */
(function () {
  "use strict";
  var NOW = Date.parse("2026-11-02T09:55:22Z");
  var UNIT = "C-728A";
  var MIN_OK = 60, MIN_GOOD = 120, GAP_MIN = 5;           // пороги, минуты
  var RAW_ON = [["2026-10-20T09:11:49Z","2026-10-20T09:35:36Z"],["2026-10-21T09:29:20Z","2026-10-21T09:30:30Z"],["2026-10-21T09:31:10Z","2026-10-21T09:35:05Z"],["2026-10-21T11:47:14Z","2026-10-21T11:48:24Z"],["2026-10-22T14:00:52Z","2026-10-22T14:03:52Z"],["2026-10-22T14:04:02Z","2026-10-22T15:03:29Z"],["2026-10-22T15:26:02Z","2026-10-26T03:03:34Z"],["2026-10-26T06:13:02Z","2026-10-26T08:04:12Z"],["2026-10-26T09:28:15Z","2026-10-26T09:31:52Z"],["2026-10-27T18:13:35Z","2026-10-27T18:18:35Z"],["2026-10-28T15:18:14Z","2026-10-28T15:21:59Z"],["2026-10-28T15:26:34Z","2026-10-28T16:54:21Z"],["2026-10-28T20:15:46Z","2026-10-28T20:18:56Z"],["2026-10-30T16:11:45Z","2026-10-30T16:15:30Z"],["2026-10-31T12:39:04Z","2026-10-31T12:39:15Z"],["2026-10-31T12:43:35Z","2026-10-31T12:43:45Z"],["2026-10-31T13:07:07Z","2026-10-31T13:07:17Z"],["2026-11-02T09:05:12Z","2026-11-02T09:05:22Z"],["2026-11-02T09:09:53Z","2026-11-02T09:10:03Z"],["2026-11-02T09:12:33Z","2026-11-02T09:17:18Z"]];
  var MODE = "B";   // выбран B (по суткам) — переключателя нет

  var ON = [];                                              // склеенные включения [from, till] в мс
  RAW_ON.forEach(function (p) {
    var a = Date.parse(p[0]), b = Date.parse(p[1]);
    var last = ON[ON.length - 1];
    if (last && a - last[1] < GAP_MIN * 6e4) last[1] = b; else ON.push([a, b]);
  });

  var tz = { timeZone: "Europe/Riga" };
  var fD = new Intl.DateTimeFormat("ru", Object.assign({ day: "2-digit", month: "2-digit" }, tz));
  var fT = new Intl.DateTimeFormat("ru", Object.assign({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" }, tz));
  var dt = function (ms) { return fD.format(ms) + " " + fT.format(ms); };
  var hm = function (min) { if (min < 1) return "< 1 мин"; min = Math.round(min); return min >= 60 ? Math.floor(min / 60) + " ч " + (min % 60 ? (min % 60) + " мин" : "").trim() : min + " мин"; };
  var kind = function (min) { return min >= MIN_GOOD ? "good" : min >= MIN_OK ? "ok" : "low"; };
  var KIND_TXT = { good: "хорошо", ok: "достаточно", low: "мало" };

  function model(days) {
    var from = NOW - days * 864e5, out = [];
    ON.forEach(function (p) {
      var a = Math.max(p[0], from), b = Math.min(p[1], NOW);
      if (b > a) out.push({ a: a, b: b, min: (b - a) / 6e4, k: kind((b - a) / 6e4) });
    });
    var idle = [], t = from;
    out.forEach(function (o) { if (o.a > t) idle.push({ a: t, b: o.a, h: (o.a - t) / 36e5 }); t = o.b; });
    if (NOW > t) idle.push({ a: t, b: NOW, h: (NOW - t) / 36e5, open: true });
    var okList = out.filter(function (o) { return o.min >= MIN_OK; });
    return {
      from: from, on: out, idle: idle,
      total: out.reduce(function (s, o) { return s + o.min; }, 0),
      ok: okList.length, good: out.filter(function (o) { return o.min >= MIN_GOOD; }).length,
      longest: idle.reduce(function (m, i) { return i.h > m ? i.h : m; }, 0),
      lastOn: out.length ? out[out.length - 1].b : null,
      lastOk: okList.length ? okList[okList.length - 1].b : null
    };
  }

  function summary(m) {
    var ago = function (ms) { return ms ? dt(ms) + " (" + hm((NOW - ms) / 6e4) + " назад)" : "нет за период"; };
    var rows = [
      ["Включений", m.on.length + " · достаточных (≥ 1 ч): " + m.ok + " · хороших (≥ 2 ч): " + m.good],
      ["Работал всего", hm(m.total)],
      ["Самый долгий простой", m.longest ? hm(m.longest * 60) : "—"],
      ["Последнее включение", ago(m.lastOn)],
      ["Последнее достаточное", ago(m.lastOk)]
    ];
    return '<div class="rl-sum">' + rows.map(function (r) { return '<div class="rl-k">' + r[0] + "</div><div>" + r[1] + "</div>"; }).join("") + "</div>";
  }

  function listA(m) {
    var ev = m.on.map(function (o) { return { a: o.a, html: '<span class="rl-t">' + dt(o.a) + " – " + fT.format(o.b) + '</span><span>включён ' + hm(o.min) + '</span><span class="rl-b rl-' + o.k + '">' + KIND_TXT[o.k] + "</span>" }; })
      .concat(m.idle.map(function (i) { return { a: i.a, html: '<span class="rl-t">' + dt(i.a) + " – " + (i.open ? "сейчас" : fT.format(i.b)) + '</span><span class="rl-off">простой ' + hm(i.h * 60) + "</span><span></span>" }; }))
      .sort(function (x, y) { return y.a - x.a; });
    return '<div class="rl-list">' + ev.map(function (e) { return '<div class="rl-r">' + e.html + "</div>"; }).join("") + "</div>";
  }

  function listB(m) {                                       // полоса по суткам: 24 ч слева направо (Рига), включения — отрезки
    var days = {}, order = [];
    var dayKey = function (ms) { return fD.format(ms); };
    var mins = function (ms) { var p = fT.format(ms).split(":"); return (+p[0]) * 60 + (+p[1]); };
    m.on.forEach(function (o) {                             // включение, идущее через полночь, режем по суткам
      var cur = o.a;
      while (cur < o.b) {
        var k = dayKey(cur), s = mins(cur), left = (o.b - cur) / 6e4, len = Math.min(left, 1440 - s);
        if (!days[k]) { days[k] = []; order.push(k); }
        days[k].push('<i class="rl-seg rl-s-' + o.k + '" style="left:' + (s / 14.4) + "%;width:" + Math.max(len / 14.4, 0.5) + '%" title="' + dt(o.a) + " · " + hm(o.min) + '"></i>');
        cur += Math.max(len, 1) * 6e4 + 1000;
      }
    });
    var all = [], d = m.from;
    for (; d <= NOW; d += 864e5) all.push(dayKey(d));
    if (all.indexOf(dayKey(NOW)) < 0) all.push(dayKey(NOW));
    return '<div class="rl-days"><div class="rl-axis"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>' +
      all.map(function (k) { return '<div class="rl-day"><span class="rl-dl">' + k + '</span><span class="rl-bar">' + (days[k] || []).join("") + "</span></div>"; }).join("") +
      '<div class="rl-leg"><i class="rl-seg rl-s-low"></i> мало (&lt; 1 ч) <i class="rl-seg rl-s-ok"></i> достаточно (≥ 1 ч) <i class="rl-seg rl-s-good"></i> хорошо (≥ 2 ч)</div></div>';
  }

  function render() {
    var out = document.getElementById("ti-out");
    if (!out) return;
    var sel = document.getElementById("ti-days"), days = sel ? +sel.value || 14 : 14;
    var inp = document.getElementById("ti-unit"), unit = (inp && inp.value.trim()) || UNIT;
    var m = model(days);
    out.innerHTML = '<div class="rl-card"><div class="rl-h"><b>Реф · ' + unit.replace(/[<>&"]/g, "") + '</b> <span class="rl-demo">макет: данные прицепа ' + UNIT + ", время — Рига, за " + days + " сут.</span></div>" +
      summary(m) + (MODE === "A" ? listA(m) : listB(m)) + "</div>";
  }

  function init() {
    var s = document.createElement("style");
    s.textContent =
      ".rl-card{background:#fff;border:1px solid #d6e4f7;border-radius:8px;padding:10px 14px;margin:10px 0;max-width:760px;font:13px/1.5 -apple-system,Segoe UI,sans-serif;color:#1b2230}" +
      ".rl-h{margin-bottom:8px}.rl-demo{color:#6b7785;font-size:11px;margin-left:6px}" +
      ".rl-sum{display:grid;grid-template-columns:170px 1fr;gap:3px 12px;margin-bottom:10px}.rl-k{color:#6b7785}" +
      ".rl-list{border-top:1px solid #eef3fc}.rl-r{display:grid;grid-template-columns:170px 1fr 90px;gap:8px;padding:3px 0;border-bottom:1px solid #f3f6fb}" +
      ".rl-t{color:#6b7785}.rl-off{color:#9aa3af}" +
      ".rl-b{justify-self:start;padding:0 8px;border-radius:10px;font-size:11px;font-weight:600;border:1px solid}" +
      ".rl-low{color:#6b7785;background:#f1f3f6;border-color:#d9dee6}.rl-ok{color:#1f7a3d;background:#e8f5ec;border-color:#a8d5b5}.rl-good{color:#fff;background:#2e9a52;border-color:#2e9a52}" +
      ".rl-days{border-top:1px solid #eef3fc;padding-top:8px}.rl-axis{display:grid;grid-template-columns:repeat(5,1fr);margin-left:54px;font-size:10px;color:#9aa3af}.rl-axis span:last-child{text-align:right}" +
      ".rl-day{display:flex;align-items:center;gap:6px;margin:2px 0}.rl-dl{width:48px;color:#6b7785;font-size:12px}" +
      ".rl-bar{position:relative;flex:1;height:14px;background:#f3f6fb;border-radius:3px}" +
      ".rl-seg{position:absolute;top:0;height:100%;border-radius:2px;display:inline-block}.rl-leg .rl-seg{position:static;width:14px;height:10px;margin:0 3px 0 10px;vertical-align:middle}" +
      ".rl-s-low{background:#b6bdc8}.rl-s-ok{background:#79c58f}.rl-s-good{background:#2e9a52}.rl-leg{margin:8px 0 0 54px;font-size:11px;color:#6b7785}" +
      "#rl-bar{position:fixed;right:12px;bottom:12px;z-index:9999;display:flex;gap:6px;align-items:center;background:#fff;border:1px solid #d6e4f7;border-radius:8px;padding:5px 8px;font:12px -apple-system,Segoe UI,sans-serif}" +
      "#rl-bar span{color:#6b7785}#rl-bar button{font:inherit;padding:3px 9px;border:1px solid #2f6fd6;border-radius:6px;background:#fff;color:#2f6fd6;cursor:pointer}" +
      "#rl-bar button:hover,#rl-bar button[aria-pressed=\"true\"]{background:#2f6fd6;color:#fff}";
    document.head.appendChild(s);
    var bar = document.createElement("div"); bar.id = "rl-bar";
    bar.innerHTML = '<span>Реф в Truck Info:</span><button type="button" data-m="A">A · список</button><button type="button" data-m="B">B · по суткам</button>';
    bar.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-m]"); if (!b) return;
      MODE = b.dataset.m; mark(); if (document.querySelector("#ti-out .rl-card")) render();
    });
    var go = document.getElementById("ti-go");
    if (go) go.addEventListener("click", function () { setTimeout(render, 60); setTimeout(render, 700); }, true);
    mark();
  }
  function mark() { document.querySelectorAll("#rl-bar button").forEach(function (x) { x.setAttribute("aria-pressed", String(x.dataset.m === MODE)); }); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
