/*
Fleet ETA Tracker — ⏱ ETA-калькулятор (v3.28): утилита «что если» без машины, панель справа (язычок под 📓).
Открыта одна панель за раз (карта 🗺, Блокнот 📓 или калькулятор); ширина тянется за левый край и запоминается
(v3.34: одна на все боковые панели — sidePanelW в app.js); Esc — закрыть. На телефоне (до 768 px) язычка нет.
v3.39: расклад считает сервер (/api/eta-plan) — тот же движок, что ETA во Флоте и From → To; Google не нужен.
Макет согласован в песочнице 05–06.10 (BACKLOG.md).
v3.31: открыт калькулятор — клик по строке Флота заполняет его данными машины (app.js → fromRow: км до первой
непройденной точки, экипаж / соло, остаток вождения, сдвиг до конца отдыха, 9-ки и недельный остаток соло);
над полями — подпись источника, правка руками её убирает. Мини-карта: линия маршрута строки, нарезанная
по раскладу (езда, перерывы, отдыхи с кодом зоны, 🏁) — карта Google создаётся один раз, Routes не нужен.

Правила расчёта:
  - скорость 70 км/ч; ETD и ETA — вверх до 15 мин;
  - экипаж: до 18 ч вождения в сутки без перерывов, суточный отдых всегда 9 ч;
  - соло: 9 ч вождения в сутки, через 4:30 — перерыв 45 мин, отдых 9 ч (пока остались сокращения) или 11 ч;
  - отдых — чистые 9 / 11 ч, без запаса: запас диспетчер добавляет сам, растягивая отдых на шкале;
  - 9-ка, растянутая до 11 ч и больше, — обычный отдых, сокращение не тратится;
  - отдых от 24 ч — недельный сокращённый, от 45 ч — недельный; после него неделя и сокращения — заново;
  - недельный остаток соло (56 ч) — только отметка на шкале, ETA не сдвигаем;
  - v3.39: 10-й час у соло — вручную, «+1 ч» на дне; окно смены соло 15 ч, ночная смена (00:00–04:00) — 11 ч;
    экипаж — 21 ч.
*/
const EtaCalc = (() => {
  const SPEED = 70, WEEK = 56, BREAK_AFTER = 4.5, BREAK = 0.75;

  // ---------- форматы ----------
  const p2 = (n) => String(n).padStart(2, "0");
  /* v3.32: все времена — EU time (Europe/Berlin, как ETA во Флоте), а не пояс браузера. Внутри — обычные мс;
     для вида и границ суток переводим в «настенное» время Берлина: wall(ms) — Date, у которого UTC-поля =
     берлинские часы; fromWall — обратно (на переходе часов — ближайшее настоящее время). */
  const EU_TZ = "Europe/Berlin";
  const euFmt = new Intl.DateTimeFormat("en-GB", { timeZone: EU_TZ, hourCycle: "h23", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit" });
  const offCache = {};
  function euOff(ms) {                    // смещение Берлина от UTC в мс (кеш по часу)
    const h = Math.floor(ms / 3600e3);
    if (offCache[h] != null) return offCache[h];
    const p = {};
    euFmt.formatToParts(new Date(h * 3600e3)).forEach((x) => { p[x.type] = x.value; });
    const w = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute);
    return (offCache[h] = w - h * 3600e3);
  }
  const wall = (ms) => new Date(ms + euOff(ms));
  const fromWall = (w) => w - euOff(w - euOff(w));
  const wallMidnight = (ms) => { const w = wall(ms); return Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate()); };
  // начала суток (Берлин) от суток с ms до конца рейса: [{ms, w (Date стены)}]
  function euDays(fromMs, toMs) {
    const out = [];
    for (let w = wallMidnight(fromMs), g = 0; g < 400; g++, w += 86400e3) {
      const ms = fromWall(w);
      if (ms >= toMs && out.length) break;
      out.push({ ms, w: new Date(w) });
    }
    return out;
  }
  const fd = (d) => { const w = wall(+d); return p2(w.getUTCDate()) + "/" + p2(w.getUTCMonth() + 1); };
  const ft = (d) => { const w = wall(+d); return p2(w.getUTCHours()) + ":" + p2(w.getUTCMinutes()); };
  const fdt = (d) => fd(d) + " " + ft(d);
  const hm = (h) => { const m = Math.round(h * 60); return Math.floor(m / 60) + " ч" + (m % 60 ? " " + p2(m % 60) + " мин" : ""); };
  const hmm = (h) => { const m = Math.round(h * 60); return Math.floor(m / 60) + ":" + p2(m % 60); };
  const km = (v) => Math.round(v).toLocaleString("ru-RU") + " км";
  const up15 = (ms) => { const q = 15 * 60e3; return Math.ceil(ms / q) * q; };
  const WD = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
  function nextMonday(ms) {
    // v3.32: неделя тахографа — с понедельника 00:00 UTC (как на сервере)
    const x = new Date(ms); x.setUTCHours(0, 0, 0, 0);
    x.setUTCDate(x.getUTCDate() + ((8 - x.getUTCDay()) % 7 || 7));
    return x.getTime();
  }
  function restKind(e) {
    if (e.k !== "r") return "";
    const h = e.t1 - e.t0;
    return h >= 45 ? "недельный" : h >= 24 ? "недельный сокр." : e.short ? "сокр." : "";
  }

  // ---------- панель ----------
  const st = { shH: 0, lfH: 18,   // сдвиг выезда и остаток вождения, ч (поля — ЧЧ:ММ)
               team: true, rest: 9, shorts: 3, extras: {}, shifts: {}, ext: new Set(), drag: null,   // ext — дни с 10-м часом
               src: null,      // v3.31: {unit, point, km, polyline, note} — откуда данные (клик по строке)
               srcShown: false };   // подпись источника видна, пока ничего не правили руками
  let panel = null, tab = null, S = null;
  const $ = (sel) => panel.querySelector(sel);
  const ICO = {
    drive: '<svg class="ec-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2.6" fill="currentColor"/><path d="M3.4 10.5 9.6 11.4M20.6 10.5 14.4 11.4M12 14.6V21" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>',
    rest: '<svg class="ec-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6v13M21 13v6M3 16h18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/><rect x="3" y="11.5" width="18" height="4.5" fill="currentColor"/><circle cx="6.6" cy="9.6" r="1.9" fill="currentColor"/></svg>',
  };

  function build() {
    panel = document.createElement("aside");
    panel.className = "ec-panel";
    panel.id = "eta-calc";
    panel.setAttribute("aria-hidden", "true");
    panel.innerHTML = `
      <div class="ec-resize" title="Потянуть — шире / уже (ширина запоминается)"></div>
      <div class="w-label"></div>
      <div class="ec-head"><span>⏱ ETA-калькулятор</span><button type="button" class="ec-x" title="Закрыть (Esc)">×</button></div>
      <div class="ec-body">
        <div class="ec-sec ec-ft">
          <div class="ec-ftg"><span class="ec-ftk">From</span><input type="text" id="ec-from" list="points-list" autocomplete="off" placeholder="машина, ГПС, город или код">
            <span class="ec-ftk">To</span><input type="text" id="ec-to" list="points-list" autocomplete="off" placeholder="ГПС, город или код"></div></div>
        <div class="ec-sec"><div class="ec-lb"><span>Расстояние, км</span><span>70 … 5000</span></div>
          <div class="ec-ln"><input type="number" id="ec-km-n" min="70" step="10" value="1500"><input type="range" id="ec-km-r" min="70" max="5000" step="10" value="1500"></div></div>
        <div class="ec-sec ec-two"><div>
          <div class="ec-lb"><span title="Через сколько часов выезд. Если машина уже стоит на отдыхе — сколько ей осталось отдыхать: остаток вождения и смена начнутся заново">Сдвиг выезда / отдых, ч</span><span class="ec-now"></span></div>
          <div class="ec-ln"><span class="ec-hmw"><input type="text" id="ec-sh-n" class="ec-hm" inputmode="numeric" value="00:00" title="ЧЧ:ММ · ↑ ↓ — шаг 30 мин"><span class="ec-spin"><button type="button" data-d="1" tabindex="-1" title="+30 мин">▴</button><button type="button" data-d="-1" tabindex="-1" title="−30 мин">▾</button></span></span><input type="range" id="ec-sh-r" min="0" max="72" step="0.5" value="0"></div></div>
          <div><div class="ec-lb"><span>Остаток вождения, ч</span><span class="ec-lmax"></span></div>
          <div class="ec-ln"><span class="ec-hmw"><input type="text" id="ec-lf-n" class="ec-hm" inputmode="numeric" value="18:00" title="ЧЧ:ММ · ↑ ↓ — шаг 15 мин"><span class="ec-spin"><button type="button" data-d="1" tabindex="-1" title="+15 мин">▴</button><button type="button" data-d="-1" tabindex="-1" title="−15 мин">▾</button></span></span><input type="range" id="ec-lf-r" min="0" max="18" step="0.25" value="18"></div></div></div>
        <div class="ec-sec ec-restnow">
          <button type="button" class="ec-rn-btn" title="Машина уже стоит на отдыхе: сколько стоит (тахо / GPS, можно поправить) и 9 или 11 ч — выезд посчитается после отдыха, день свежий">🌙 Встал на отдых</button>
          <div class="ec-rn-form" hidden>
            <span class="ec-rn-pre" hidden>встал в</span>
            <span class="ec-hmw"><input type="text" class="ec-hm ec-rn-t" inputmode="numeric" value="00:00" title="ЧЧ:ММ · ↑ ↓ — шаг 15 мин"><span class="ec-spin"><button type="button" data-d="1" tabindex="-1" title="+15 мин">▴</button><button type="button" data-d="-1" tabindex="-1" title="−15 мин">▾</button></span></span>
            <span class="ec-rn-post">назад</span>
            <a href="#" class="ec-rn-mode">показать во сколько</a>
            <span class="ec-seg ec-sm ec-rn-len"><button type="button" data-v="9" class="on">9 ч</button><button type="button" data-v="11">11 ч</button></span>
            <button type="button" class="ec-rn-ok">Применить</button><button type="button" class="ec-rn-no">Сбросить</button>
          </div>
          <span class="ec-mut2 ec-rn-info"></span>
        </div>
        <div class="ec-sec ec-g2">
          <span class="ec-lb">Состав</span>
          <div class="ec-rl"><span class="ec-seg ec-team"><button type="button" data-v="1" class="on">Экипаж</button><button type="button" data-v="0">Соло</button></span>
            <span class="ec-wk" hidden>неделя осталось, ч <input type="number" id="ec-wk-n" min="0" max="56" step="0.5" value="56"> <span class="ec-mut">из 56</span></span></div>
          <span class="ec-lb">Отдых</span><div class="ec-rest"></div>
        </div>
        <div class="ec-sec">
          <div class="ec-src" hidden></div>
          <div class="ec-res">
            <div><span class="ec-k">ETD</span><b class="ec-etd"></b></div><i></i>
            <div><span class="ec-k">В пути</span><b class="ec-dur"></b> <span class="ec-drv"></span></div><i></i>
            <div><span class="ec-k">ETA</span><b class="ec-eta"></b></div>
          </div>
        </div>
        <div class="ec-sec">
          <div class="ec-h">Шкала <a href="#" class="ec-rst">сбросить отдыхи</a></div>
          <p class="ec-note">Правый край отдыха — длиннее (шаг 15 мин), левый — весь отдых раньше. Двойной клик по ручке — вернуть. Те же ручки есть в таблице по дням.</p>
          <div class="ec-ext ec-rl"></div>
          <div class="ec-strip"></div>
          <div class="ec-days"></div>
          <div class="ec-wnote"></div>
          <div class="ec-legend"><span><i class="d"></i>езда</span><span><i class="b"></i>перерыв 45 мин</span><span><i class="r"></i>суточный отдых</span><span><i class="w"></i>недельный остаток кончился</span></div>
        </div>
        <div class="ec-sec ec-msec">
          <div class="ec-h"><a href="#" class="ec-mtg" title="Свернуть / развернуть карту">▾ Карта</a><span class="ec-mut ec-mnote"></span></div>
          <div class="ec-mbox">
            <div class="ec-map"></div>
            <div class="ec-mempty">Заполни From и To или кликни строку трипа — здесь будет маршрут с отдыхами</div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(panel);

    sidePanelW.set(sidePanelW.get());   // v3.34: ширина общая для всех боковых панелей

    $(".ec-x").addEventListener("click", close);
    // v3.31: правка руками — подпись «из строки» пропадает; км поменяли — линия строки больше не та
    $(".ec-body").addEventListener("input", (e) => {
      if (!e.isTrusted || !e.target.closest(".ec-sec") || e.target.closest(".ec-msec, .ec-ft")) return;
      manual(e.target.id === "ec-km-n" || e.target.id === "ec-km-r");
    }, true);
    $(".ec-body").addEventListener("click", (e) => { if (e.target.closest(".ec-team button, .ec-rest button")) manual(false); }, true);
    $(".ec-mtg").addEventListener("click", (e) => { e.preventDefault(); mapFold(!st.mapFolded); });
    $(".ec-ext").addEventListener("click", (e) => {        // v3.39: 10-й час — вкл / выкл на дне
      const b = e.target.closest("button[data-i]");
      if (!b) return;
      const i = Number(b.dataset.i);
      if (st.ext.has(i)) st.ext.delete(i); else st.ext.add(i);
      if (i === 0) setLf(st.lfH + (st.ext.has(0) ? 1 : 0));   // первый день: остаток +1 ч (или обратно в предел)
      manual(false);
      calc();
    });
    try { st.mapFolded = localStorage.getItem(MAP_KEY) === "0"; } catch (e) { /* ignore */ }
    mapFold(!!st.mapFolded, true);
    pair("km"); shPair(); lfPair(); restNowPair();
    $("#ec-wk-n").addEventListener("input", () => { const v = Number($("#ec-wk-n").value); if (v > 56) $("#ec-wk-n").value = 56; if (v < 0) $("#ec-wk-n").value = 0; calc(); });
    panel.querySelectorAll(".ec-team button").forEach((b) => b.addEventListener("click", () => {
      st.team = b.dataset.v === "1"; st.extras = {}; st.shifts = {};
      panel.querySelectorAll(".ec-team button").forEach((x) => x.classList.toggle("on", x === b));
      clampLeft(); restUI(); calc();
    }));
    $(".ec-rst").addEventListener("click", (e) => { e.preventDefault(); st.extras = {}; st.shifts = {}; calc(); });
    bindStrip();
    bindResize();
    bindFT();
    restUI();
  }

  // ---------- v3.31: данные машины из строки Флота ----------
  function fromRow(r, fromFT) {
    if (!panel) return;
    if (!fromFT) { $("#ec-from").value = ""; $("#ec-to").value = ""; ftStatus(""); ftKey = ""; }   // v3.51: строка Флота / From → To — поля From / To чистые
    if (r.km === 0 && r.pins) {                 // v3.112: машина уже на точке — маршрута нет, на карте маркеры машины и точки
      st.srcShown = true;
      st.src = { unit: r.unit, point: r.point, km: 0, polyline: null, pins: r.pins, note: "машина уже на точке" };
      srcUI(); drawMapSoon();
      return;
    }
    if (r.km == null || !(r.km > 0)) {          // строка не посчитана или ошибка — ничего не меняем
      st.srcShown = true;
      st.src = { unit: r.unit, point: r.point, km: null, polyline: null, note: "нет км у строки — не посчитана или ошибка" };
      srcUI(); drawMapSoon();
      return;
    }
    const kmv = Math.round(r.km);
    $("#ec-km-n").value = kmv; $("#ec-km-r").value = Math.min(kmv, 5000);
    const notes = applySeed(r.seed, r.noSeedNote);
    st.src = { unit: r.unit, point: r.point, label: r.label || "", km: kmv, polyline: r.polyline || null, note: notes.join(" · ") };
    st.srcShown = true;
    st.mapFit = true;
    restUI(); srcUI(); calc();
  }
  // v3.115: откуда взят состав — чтобы было видно, почему «экипаж» или «соло» (нет crew_src — не пишем)
  function crewSrcNote(s) {
    if (!s || s.crew_src == null) return "";
    const seen = s.crew_seen_at ? new Date(s.crew_seen_at * 1000).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" }) : "";
    const src = {
      manual: "вручную во Флоте",
      tacho: s.team ? "две карты в тахографе" : "одна карта в тахографе",
      hist: s.team ? "езда за сутки до " + (s.crew_hist_h || "?") + " ч — если это соло, поставьте 👤 в строке Флота" : "по истории",
      memory: "две карты видели " + seen,
    }[s.crew_src] || s.crew_src;
    return (s.team ? "экипаж" : "соло") + " (" + src + ")";
  }
  // v3.114: данные машины (seed) — состав, остаток, смена, неделя; одно место для строки Флота, From → To и выбора машины в From.
  // Возвращает заметки для подписи источника.
  function applySeed(s, noSeedNote) {
    const notes = [];
    if (s) {
      st.team = !!s.team;
      const cn = crewSrcNote(s);
      if (cn) notes.push(cn);
      panel.querySelectorAll(".ec-team button").forEach((x) => x.classList.toggle("on", (x.dataset.v === "1") === st.team));
      setLf(s.left_h || 0);
      setSh(s.shift_h || 0);
      st.startMs = s.used_h > 0 ? Date.now() - s.used_h * 3600000 : null;   // v3.106: окно смены уже идёт
      st.standH = s.stand_h || 0;   // v3.125: сколько уже стоит (GPS)
      st.restTachoH = s.rest_h || 0;   // v3.145: сколько уже стоит по тахографу — резерв
      if (!st.team) {
        st.rest = 9;   // v3.85: 0 сокращённых — это «9 ч, остаток 0» (до недельного 11 ч), а не «11 ч»
        st.shorts = Math.max(0, Math.min(3, s.shorts || 0));
        if (s.week_left_h != null) $("#ec-wk-n").value = s.week_left_h;
      }
      if (s.resting) notes.push("на отдыхе — выезд после него");
      else if (s.used_h > 0) {   // v3.107: когда началась, до скольки окно, сколько выезжено; время — по часам браузера
        const hm = (ts) => new Date(ts * 1000).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
        const hh = (h) => Math.floor(h) + ":" + String(Math.round((h % 1) * 60)).padStart(2, "0");
        let t = "смена с " + hm(s.start_ts) + " (" + s.used_h.toFixed(1) + " ч) · окно до " + hm(s.end_ts);
        if (s.driven_h != null) t += " · выезжено " + hh(s.driven_h) + " (GPS)";
        t += " · остаток " + hh(s.left_h || 0) + (s.shift_src === "gps" ? " · начало — по GPS" : " · по тахографу");
        notes.push(t);
      }
      if (s.gps_fix) notes.push("тахограф отстаёт от GPS — остаток по GPS");   // v3.104
      if (s.unknown) notes.push("тахографа нет — остаток по максимуму");
      else if (s.nocard) notes.push("тахографа нет — стоит ≥ 9 ч, свежий день");
    } else {
      setSh(0);
      st.startMs = null;
      st.standH = 0; st.restTachoH = 0;
      const nn = noSeedNote != null ? noSeedNote : "тахографа нет — состав и остаток прежние";
      if (nn) notes.push(nn);
    }
    st.extras = {}; st.shifts = {}; st.ext = new Set();
    st.restStartMs = null; st.restEndMs = null; restNowInfo();   // v3.140: другая машина / новые данные — ручной «встал на отдых» снят (v3.145: и начало)
    return notes;
  }
  // ---------- v3.51: From / To — км, линия и (машина в From) тахограф через /api/route, как вкладка From → To ----------
  let ftKey = "", ftSeq = 0;
  // v3.59: статус From / To выводится в ту же строку наверху, что и подпись источника
  function ftStatus(t, bad) {
    st.ftMsg = t ? { t, bad: !!bad } : null;
    srcUI();
  }
  function bindFT() {
    const f = $("#ec-from"), t = $("#ec-to");
    [f, t].forEach((el) => {
      el.addEventListener("change", ftCalc);           // выбор из подсказок и уход из поля
      el.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); ftCalc(); } });
      el.addEventListener("focus", () => el.select());
    });
  }
  async function ftCalc() {
    const from = $("#ec-from").value.trim(), to = $("#ec-to").value.trim();
    if (!from) { ftKey = ""; ftStatus(""); return; }
    if (!to) { ftSeed(from); return; }            // v3.114: в From машина, To пока пусто — данные машины без маршрута
    const key = from + "\n" + to;
    if (key === ftKey) return;
    ftKey = key;
    const seq = ++ftSeq;
    ftStatus("считаю…");
    try {
      const r = await fetch("/api/route", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.assign({ from: [from], to: [to] }, fleetCrewFor(from))) });
      const d = await r.json();
      if (seq !== ftSeq) return;
      if (d.error || d.dist_km == null) { ftKey = ""; ftStatus(d.error || "не посчитать", true); return; }
      ftStatus(d.dist_km.toFixed(0) + " км по дорогам");
      const p0 = (d.points || [])[0] || {}, truck = !!p0.is_truck;
      fromRow({
        label: "From → To: " + from + " → " + to, unit: truck ? from : "", km: d.dist_km,
        polyline: d.route_polyline || null, seed: truck ? (d.calc_seed || null) : null,
        noSeedNote: truck ? "тахографа машины нет — состав и остаток прежние" : "",
      }, true);
    } catch (e) {
      if (seq === ftSeq) { ftKey = ""; ftStatus("ошибка запроса", true); }
    }
  }
  // v3.114: машина выбрана в From, To пусто — подтянуть её данные (км не трогаем); не машина — ничего не делаем
  async function ftSeed(from) {
    const key = "seed:" + from;
    if (key === ftKey) return;
    ftKey = key;
    const seq = ++ftSeq;
    try {
      const r = await fetch("/api/unit-seed", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.assign({ from }, fleetCrewFor(from))) });
      const d = await r.json();
      if (seq !== ftSeq) return;
      if (d.error) { ftKey = ""; ftStatus(d.error, true); return; }
      if (!d.truck) { ftStatus(""); return; }
      st.srcShown = false;                           // подпись «из …» относилась к прежнему маршруту
      const notes = applySeed(d.calc_seed || null, "тахографа машины нет — состав и остаток прежние");
      ftStatus("🚛 " + d.unit + ": данные подтянуты" + (notes.length ? " · " + notes.join(" · ") : ""));
      restUI(); calc();
    } catch (e) {
      if (seq === ftSeq) { ftKey = ""; ftStatus("ошибка запроса", true); }
    }
  }
  function manual(kmChanged) {
    if (st.srcShown) { st.srcShown = false; srcUI(); }
    if (kmChanged && st.src && st.src.polyline) { st.src.polyline = null; drawMapSoon(); }
  }
  function srcUI() {
    const el = $(".ec-src"), s = st.src, fm = st.ftMsg;
    if (!el) return;
    const cap = !!(st.srcShown && s);
    el.hidden = !(cap || fm);
    if (el.hidden) return;
    el.classList.toggle("bad", fm ? fm.bad : (cap && s.km == null));
    const capHtml = cap ? (s.label ? "из " + escH(s.label) : `из <b>${escH(s.unit || "строки")}</b>${s.point ? " → " + escH(s.point) : ""}`) +
      (s.note ? `<span class="ec-mut"> · ${escH(s.note)}</span>` : "") : "";
    const fmHtml = fm ? (cap ? '<span class="ec-mut"> · </span>' : "") + escH(fm.t) : "";
    el.innerHTML = capHtml + fmHtml;
  }
  const escH = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // v3.34: ширина — одна на все боковые панели (sidePanelW в app.js)
  function bindResize() {
    $(".ec-resize").addEventListener("mousedown", (e) => sidePanelW.drag(e, "ec-resizing", calc));
  }

  // поле ввода + ползунок одного значения
  function pair(key, clamp) {
    const n = $("#ec-" + key + "-n"), r = $("#ec-" + key + "-r");
    r.addEventListener("input", () => { n.value = r.value; calc(); });
    n.addEventListener("input", () => {
      if (clamp) clamp();
      else { const v = Number(n.value); if (!isNaN(v)) r.value = Math.min(v, Number(r.max)); }
      calc();
    });
  }
  // v3.33: сдвиг выезда — ЧЧ:ММ (01:00, 00:30, 25:30), шаг 30 мин; принимает и «1,5», «2», «130»
  const fmtHM = (h) => { const m = Math.round(Math.max(0, h) * 60); return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); };
  function parseHM(t) {
    t = String(t).trim().replace(",", ".");
    if (!t) return 0;
    let m = t.match(/^(\d{1,3})[:.\s](\d{0,2})$/);
    if (m && t.includes(":")) return Number(m[1]) + Math.min(59, Number(m[2] || 0)) / 60;
    if (/^\d{1,2}(\.\d+)?$/.test(t)) return Number(t);   // «2», «1.5» — часы
    m = t.match(/^(\d{1,2})(\d{2})$/);                    // «130», «2530» — ЧЧММ
    return m ? Number(m[1]) + Math.min(59, Number(m[2])) / 60 : null;
  }
  function setSh(h, keepText) {
    st.shH = Math.max(0, h);
    if (!keepText) $("#ec-sh-n").value = fmtHM(st.shH);
    $("#ec-sh-r").value = Math.min(st.shH, 72);
  }
  function shPair() {
    const n = $("#ec-sh-n"), r = $("#ec-sh-r");
    r.addEventListener("input", () => { setSh(Number(r.value)); calc(); });
    n.addEventListener("input", () => { const v = parseHM(n.value); if (v != null) { setSh(v, true); calc(); } });
    n.addEventListener("blur", () => setSh(st.shH));
    n.addEventListener("focus", () => n.select());
    // шаг 30 мин: клавиши ↑ ↓ и стрелочки ▴ ▾ в поле (у текстового поля браузер своих не рисует)
    const step = (d) => {
      const k = st.shH * 2;
      setSh((d > 0 ? Math.floor(k + 1e-6) + 1 : Math.ceil(k - 1e-6) - 1) / 2);
      calc();
      manual(false);   // подпись «из строки» — как при правке руками
    };
    n.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { setSh(st.shH); return; }
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      e.preventDefault();
      step(e.key === "ArrowUp" ? 1 : -1);
    });
    n.parentElement.querySelectorAll(".ec-spin button").forEach((b) => {
      b.addEventListener("mousedown", (e) => e.preventDefault());   // фокус и выделение в поле не сбиваем
      b.addEventListener("click", () => step(Number(b.dataset.d)));
    });
  }
  // v3.140: «🌙 Встал на отдых» — диспетчер говорит, с какого времени машина стоит на отдыхе 9 / 11 ч.
  // Сдвиг выезда = сколько осталось отдыхать (вверх до 15 мин); сервер при выезде после конца отдыха ставит свежий день.
  // v3.145: «🌙 Встал на отдых» — «N:MM назад» (сколько уже стоит: тахо / GPS, можно вписать своё) или «встал в ЧЧ:ММ»; 9 / 11 ч
  const restHM = (ts) => new Date(ts).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  const restAgoH = () => (st.restStartMs ? Math.max(0, (Date.now() - st.restStartMs) / 3600000) : 0);
  function restNowInfo() {
    const el = $(".ec-rn-info");
    if (!el) return;
    el.textContent = st.restEndMs
      ? "стоит " + fmtHM(restAgoH()) + " · встал в " + restHM(st.restStartMs) + " · отдых до " + restHM(st.restEndMs) + " · выезд после него, день свежий"
      : "";
  }
  function restNowPair() {
    const btn = $(".ec-rn-btn"), form = $(".ec-rn-form"), t = $(".ec-rn-t");
    const pre = $(".ec-rn-pre"), post = $(".ec-rn-post"), mode = $(".ec-rn-mode");
    const clockMode = () => st.restAgo === false;
    const len = () => st.restLen || 9;
    const lenBtns = () => form.querySelectorAll(".ec-rn-len button").forEach((x) => x.classList.toggle("on", Number(x.dataset.v) === len()));
    // показ поля: «N:MM» назад или «ЧЧ:ММ» во сколько
    const show = () => {
      pre.hidden = !clockMode(); post.hidden = clockMode();
      mode.textContent = clockMode() ? "показать, сколько назад" : "показать во сколько";
      t.value = !st.restStartMs ? (clockMode() ? "" : "00:00") : clockMode() ? restHM(st.restStartMs) : fmtHM(restAgoH());
      t.style.borderColor = "";
    };
    // тахо / GPS знают, сколько стоит — подставляем, пока не применено и не сброшено
    const prefill = () => {
      if (st.restStartMs) return;
      const h = st.standH || st.restTachoH || 0;
      if (h > 0) st.restStartMs = Date.now() - h * 3600000;
    };
    // что ввели — сразу становится началом отдыха (применяется кнопкой)
    const fromText = () => {
      const v = String(t.value).trim();
      if (clockMode()) {
        const m = v.match(/^(\d{1,2})[:.](\d{2})$/);
        if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return false;
        const now = Date.now(), d = new Date(now);
        d.setHours(Number(m[1]), Number(m[2]), 0, 0);
        let start = d.getTime();
        if (start > now) start -= 86400000;   // позже, чем сейчас — значит, вчера
        st.restStartMs = start;
      } else {
        const h = parseHM(v);
        if (h == null || h < 0) return false;
        st.restStartMs = Date.now() - h * 3600000;
      }
      return true;
    };
    btn.addEventListener("click", () => {
      form.hidden = !form.hidden;
      if (!form.hidden) { prefill(); show(); lenBtns(); }
    });
    mode.addEventListener("click", (e) => { e.preventDefault(); st.restAgo = clockMode(); show(); });
    t.addEventListener("input", () => { if (fromText()) restNowInfo(); });
    t.addEventListener("blur", () => show());
    t.addEventListener("focus", () => t.select());
    t.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { show(); return; }
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      e.preventDefault();
      step(e.key === "ArrowUp" ? 1 : -1);
    });
    // шаг 15 мин: ▴ ▾ и ↑ ↓
    const step = (d) => {
      if (!st.restStartMs) st.restStartMs = Date.now();
      if (clockMode()) st.restStartMs += d * 900000;
      else st.restStartMs = Date.now() - Math.max(0, Math.round(restAgoH() * 4) + d) / 4 * 3600000;
      show();
      restNowInfo();
    };
    form.querySelectorAll(".ec-spin button").forEach((b) => {
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", () => step(Number(b.dataset.d)));
    });
    form.querySelectorAll(".ec-rn-len button").forEach((b) => b.addEventListener("click", () => { st.restLen = Number(b.dataset.v); lenBtns(); }));
    $(".ec-rn-ok").addEventListener("click", () => {
      if (!st.restStartMs || !fromText()) { t.style.borderColor = "#d33"; return; }
      st.restStartMs = Math.round(st.restStartMs / 60000) * 60000;
      st.restLen = len();
      st.restEndMs = st.restStartMs + len() * 3600000;
      setSh(Math.max(0, Math.ceil((st.restEndMs - Date.now()) / 900000) / 4));
      if (!st.team) { st.rest = len(); if (len() === 9 && !st.shorts) st.shorts = 3; }   // как кнопки «9 / 11 ч» в «Отдыхе»
      restUI(); restNowInfo(); form.hidden = true; calc(); manual(false);
    });
    $(".ec-rn-no").addEventListener("click", () => { st.restStartMs = null; st.restEndMs = null; restNowInfo(); form.hidden = true; calc(); });
    // «N:MM назад» растёт со временем — обновляем, пока поле не в фокусе
    setInterval(() => {
      if (!st.restStartMs) return;
      if (!form.hidden && document.activeElement !== t) show();
      restNowInfo();
    }, 30000);
  }
  // v3.37: остаток вождения — тоже ЧЧ:ММ, шаг 15 мин; предел — 18:00 экипаж / 9:00 соло
  const lfMax = () => (st.team ? 18 : st.ext.has(0) ? 10 : 9);   // v3.39: 10-й час в первый день — до 10:00
  function setLf(h, keepText) {
    st.lfH = Math.min(lfMax(), Math.max(0, Number(h) || 0));
    if (!keepText) $("#ec-lf-n").value = fmtHM(st.lfH);
    $("#ec-lf-r").value = st.lfH;
  }
  function lfPair() {
    const n = $("#ec-lf-n"), r = $("#ec-lf-r");
    r.addEventListener("input", () => { setLf(Number(r.value)); calc(); });
    n.addEventListener("input", () => { const v = parseHM(n.value); if (v != null) { setLf(v, v <= lfMax()); calc(); } });
    n.addEventListener("blur", () => setLf(st.lfH));
    n.addEventListener("focus", () => n.select());
    const step = (d) => {
      const k = st.lfH * 4;
      setLf((d > 0 ? Math.floor(k + 1e-6) + 1 : Math.ceil(k - 1e-6) - 1) / 4);
      calc();
      manual(false);
    };
    n.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { setLf(st.lfH); return; }
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      e.preventDefault();
      step(e.key === "ArrowUp" ? 1 : -1);
    });
    n.parentElement.querySelectorAll(".ec-spin button").forEach((b) => {
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", () => step(Number(b.dataset.d)));
    });
  }
  function clampLeft() { setLf(st.lfH); }   // смена экипаж / соло — остаток в новый предел
  function restUI() {
    const box = $(".ec-rest");
    if (st.team) { box.innerHTML = '<span class="ec-mut2">всегда 9 ч</span>'; return; }
    box.innerHTML = '<div class="ec-rl"><span class="ec-seg ec-sm ec-r911">' +
      [9, 11].map((v) => `<button type="button" data-v="${v}" class="${st.rest === v ? "on" : ""}">${v} ч</button>`).join("") + "</span>" +
      (st.rest === 9 ? '<span class="ec-mut2">9-к осталось</span><span class="ec-seg ec-sm ec-sh">' +
        [0, 1, 2, 3].map((v) => `<button type="button" data-v="${v}" class="${st.shorts === v ? "on" : ""}">${v}</button>`).join("") +
        '</span><span class="ec-mut">' + (st.shorts ? "→ 11 ч" : "до недельного — 11 ч, потом снова 3") + '</span>' : "") + "</div>";
    box.querySelectorAll(".ec-r911 button").forEach((b) => b.addEventListener("click", () => { st.rest = Number(b.dataset.v); if (st.rest === 9 && !st.shorts) st.shorts = 3; restUI(); calc(); }));
    box.querySelectorAll(".ec-sh button").forEach((b) => b.addEventListener("click", () => { st.shorts = Number(b.dataset.v); restUI(); calc(); }));
  }

  function params() {
    return {
      dist: Number($("#ec-km-n").value) || 0, shiftH: st.shH, leftH: st.lfH,
      team: st.team, rest: st.rest, shorts: st.shorts, wkLeft: Number($("#ec-wk-n").value),
      extras: st.extras, shifts: st.shifts, ext: st.team ? [] : Array.from(st.ext), nowMs: Date.now(), shiftStartMs: st.startMs || null, standH: st.standH || 0,
      restEndMs: st.restEndMs && Date.now() - st.restEndMs < 12 * 3600000 ? st.restEndMs : null,
    };
  }

  // v3.39: расклад — с сервера (/api/eta-plan, тот же движок, что Флот); пока идёт запрос — следующий ждёт
  let inFlight = false, again = false;
  function calc() {
    if (!panel) return;
    const m = lfMax();
    $("#ec-lf-r").max = m;
    $(".ec-lmax").textContent = "макс. " + m + " ч";
    $(".ec-now").textContent = "сейчас " + fdt(new Date());
    $(".ec-wk").hidden = st.team;
    request();
  }
  async function request() {
    if (inFlight) { again = true; return; }
    inFlight = true;
    try {
      const r = await fetch("/api/eta-plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params()) });
      const d = await r.json();
      if (d && d.ev) {
        S = d;
        S.at = (h) => S.etd + h * 3600e3;
        render();
      }
    } catch (e) { /* сеть — оставляем прошлый расклад */ }
    inFlight = false;
    if (again) { again = false; request(); }
  }
  function render() {
    if (!panel || !S) return;
    $(".ec-etd").textContent = fdt(new Date(S.etd));
    $(".ec-eta").textContent = fdt(new Date(S.eta));
    $(".ec-dur").textContent = hm((S.eta - S.etd) / 3600e3);
    $(".ec-drv").innerHTML = "(" + ICO.drive + " " + hmm(S.drive) + ")";
    drawStrip();
    drawDays();
    drawExt();
    drawMapSoon();
  }
  // v3.39: 10-й час у соло — вручную, «+1 ч» на дне вождения (день N — до N-го отдыха)
  function drawExt() {
    const box = $(".ec-ext");
    if (!box) return;
    if (st.team) { box.innerHTML = ""; return; }
    const n = S.ev.filter((e) => e.k === "r").length + 1;
    box.innerHTML = '<span class="ec-mut2">10-й час</span>' + Array.from({ length: n }, (_, i) =>
      `<button type="button" data-i="${i}" class="${st.ext.has(i) ? "on" : ""}" title="День ${i + 1}: вождение 10 ч вместо 9">д${i + 1} +1 ч</button>`).join("");
  }

  // ---------- шкала рейса: полоса, кровати и км, полночь и даты, ручки отдыха ----------
  const pos = (ms) => Math.max(0, Math.min(100, (ms - S.etd) / ((S.eta - S.etd) || 1) * 100));
  function midnights() {
    return euDays(S.etd, S.eta).map((x) => x.ms).filter((ms) => ms > S.etd && ms < S.eta);
  }
  function span(e) {
    const a = new Date(S.at(e.t0)), b = new Date(S.at(e.t1));
    return fd(a) === fd(b) ? fd(a) + " " + ft(a) + "–" + ft(b) : fdt(a) + " – " + fdt(b);
  }
  function tip(e) {
    const h = e.t1 - e.t0;
    if (e.k === "d") return "Вождение " + span(e) + " · " + hmm(h) + " · " + Math.round(e.km0).toLocaleString("ru-RU") + " → " + km(e.km1);
    if (e.k === "b") return "Перерыв " + span(e) + " · 0:45";
    const kind = restKind(e);
    return "Отдых " + span(e) + " · " + hmm(h) + (kind ? " · " + kind : "");
  }
  function drawStrip() {
    const tot = (S.eta - S.etd) / 3600e3 || 1, rs = S.ev.filter((e) => e.k === "r"), mids = midnights(), dr = st.drag;
    const bar = S.ev.map((e) => `<div class="${e.k}" title="${tip(e)}" style="width:${((e.t1 - e.t0) / tot * 100).toFixed(3)}%"></div>`).join("");
    const pins = rs.map((e) => `<span class="ec-pin" style="left:${pos(S.at((e.t0 + e.t1) / 2))}%" title="${tip(e)}">${Math.round(e.km0)}${ICO.rest}</span>`).join("");
    const lab = (e) => '<span class="ec-dlab">' + (dr.side === "l" ? "встаёт " + fdt(new Date(S.at(e.t0))) : hm(e.t1 - e.t0) + (restKind(e) ? " · " + restKind(e) : "")) + "</span>";
    const hdls = rs.map((e) => {
      const aL = dr && dr.i === e.i && dr.side === "l", aR = dr && dr.i === e.i && dr.side === "r";
      return `<div class="ec-hdl l${aL ? " act" : ""}" tabindex="0" role="slider" aria-label="Начало отдыха ${e.i + 1}" aria-valuetext="${fdt(new Date(S.at(e.t0)))}" data-i="${e.i}" data-side="l" style="left:${pos(S.at(e.t0))}%">${aL ? lab(e) : ""}</div>` +
             `<div class="ec-hdl${aR ? " act" : ""}" tabindex="0" role="slider" aria-label="Длина отдыха ${e.i + 1}" aria-valuetext="${hm(e.t1 - e.t0)}" data-i="${e.i}" data-side="r" style="left:${pos(S.at(e.t1))}%">${aR ? lab(e) : ""}</div>`;
    }).join("");
    $(".ec-strip").innerHTML =
      `<div class="ec-above">${pins}</div><div class="ec-bar">${bar}</div>` +
      `<div class="ec-ov">${mids.map((d) => `<div class="ec-mid" style="left:${pos(d)}%"></div>`).join("")}${S.wk ? `<div class="ec-wkl" style="left:${pos(S.wk.ms)}%"></div>` : ""}</div>` +
      `<div class="ec-hs">${hdls}</div>` +
      `<div class="ec-ticks">${mids.map((d) => `<div class="ec-tick" style="left:${pos(d)}%"><span>${fd(new Date(d))}</span></div>`).join("")}</div>`;
    $(".ec-wnote").innerHTML = S.wk
      ? `<div class="ec-warn">⚠ Недельный остаток ${hmm(S.wkLeft)} кончается ${fdt(new Date(S.wk.ms))} на ${km(S.wk.km)} — только отметка, ETA не сдвигаем.</div>` : "";
  }

  // ---------- расклад по дням: строка на сутки 00–24, вождение (км), остаток ----------
  function drawDays() {
    const rows = [], days = euDays(S.etd, S.eta + 1);
    let cum = 0;
    for (let di = 0; di < days.length; di++) {
      const day = days[di], d0 = day.ms, d1 = di + 1 < days.length ? days[di + 1].ms : fromWall(day.w.getTime() + 86400e3), len = d1 - d0;
      if (d0 >= S.eta) break;
      let drv = 0, kmd = 0;
      const segs = S.ev.map((e) => {
        const a = S.at(e.t0), b = S.at(e.t1), s = Math.max(a, d0), f = Math.min(b, d1);
        if (f <= s) return "";
        if (e.k === "d") { drv += (f - s) / 3600e3; kmd += (f - s) / 3600e3 * SPEED; }
        return `<i class="${e.k}" title="${tip(e)}" style="left:${((s - d0) / len * 100).toFixed(3)}%;width:${((f - s) / len * 100).toFixed(3)}%"></i>`;
      }).join("");
      const wk = S.wk && S.wk.ms >= d0 && S.wk.ms < d1 ? `<i class="w" title="Недельный остаток кончился ${ft(new Date(S.wk.ms))}" style="left:${((S.wk.ms - d0) / len * 100).toFixed(3)}%"></i>` : "";
      // v3.59: ручки отдыха и в таблице по дням — те же, что на шкале (тянуть отдых прямо здесь)
      const hd = S.ev.filter((e) => e.k === "r").map((e) => {
        const dr = st.drag, act = (side) => dr && dr.i === e.i && dr.side === side ? " act" : "";
        const one = (side, ms, aria) => ms >= d0 && ms < d1
          ? `<div class="ec-hdl${side === "l" ? " l" : ""}${act(side)}" tabindex="0" role="slider" aria-label="${side === "l" ? "Начало" : "Длина"} отдыха ${e.i + 1}" aria-valuetext="${aria}" data-i="${e.i}" data-side="${side}" style="left:${((ms - d0) / len * 100).toFixed(3)}%"></div>` : "";
        return one("l", S.at(e.t0), fdt(new Date(S.at(e.t0)))) + one("r", S.at(e.t1), hm(e.t1 - e.t0));
      }).join("");
      cum += kmd;
      rows.push(`<span class="ec-dl">${WD[day.w.getUTCDay()]} ${fd(d0)}</span><div class="ec-day" data-len="${len}">${[6, 12, 18].map((h) => `<span class="gl" style="left:${h / 24 * 100}%"></span>`).join("")}${segs}${wk}${hd}</div>` +
        `<span class="ec-dv">${hmm(drv)} <span>(${km(kmd)})</span></span><span class="ec-dr">${S.eta <= d1 ? "🏁 " + ft(new Date(S.eta)) : km(Math.max(0, S.dist - cum))}</span>`);
    }
    const axis = Array.from({ length: 13 }, (_, k) => `<span style="left:${k * 2 / 24 * 100}%">${k * 2}</span>`).join("") +
                 Array.from({ length: 25 }, (_, h) => `<i class="${h % 2 ? "" : "e"}" style="left:${h / 24 * 100}%"></i>`).join("");
    $(".ec-days").innerHTML = `<div class="ec-dgrid"><span></span><div class="ec-hr">${axis}</div><span class="ec-dv">${ICO.drive} <span>(км)</span></span><span class="ec-dr">остаток</span>${rows.join("")}</div>`;
  }

  // ---------- ручки отдыха: правая — длина, левая — весь отдых раньше ----------
  // v3.59: один обработчик на шкалу (.ec-strip) и на таблицу по дням (.ec-days);
  // на дне 1 px = len / ширина строки (data-len), на шкале — весь рейс / ширина шкалы
  function bindStrip() {
    [$(".ec-strip"), $(".ec-days")].forEach(bindDrag);
  }
  function bindDrag(box) {
    box.addEventListener("pointerdown", (e) => {
      const h = e.target.closest(".ec-hdl");
      if (!h) return;
      e.preventDefault();
      const i = Number(h.dataset.i), side = h.dataset.side;
      const track = h.parentElement.dataset.len ? h.parentElement : box;
      const w = track.getBoundingClientRect().width || 1;
      const spanH = track.dataset.len ? Number(track.dataset.len) / 3600e3 : (S.eta - S.etd) / 3600e3;
      st.drag = { i, side, x0: e.clientX, v0: (side === "l" ? st.shifts : st.extras)[i] || 0, hpp: spanH / w };
      box.setPointerCapture(e.pointerId);
      calc();
    });
    box.addEventListener("pointermove", (e) => {
      const dr = st.drag;
      if (!dr) return;
      const dh = (e.clientX - dr.x0) * dr.hpp, store = dr.side === "l" ? st.shifts : st.extras;
      const v = Math.max(0, Math.round((dr.v0 + (dr.side === "l" ? -dh : dh)) * 4) / 4);
      if (v !== (store[dr.i] || 0)) { store[dr.i] = v; calc(); }
    });
    const end = () => {
      const dr = st.drag;
      if (!dr) return;
      if (dr.side === "l") {          // раньше начала дня не сдвинуть — запоминаем, сколько вышло на деле
        const r = S.ev.find((x) => x.k === "r" && x.i === dr.i);
        if (r) st.shifts[dr.i] = r.shift;
      }
      st.drag = null;
      calc();
    };
    box.addEventListener("pointerup", end);
    box.addEventListener("pointercancel", end);
    box.addEventListener("dblclick", (e) => {
      const h = e.target.closest(".ec-hdl");
      if (!h) return;
      delete (h.dataset.side === "l" ? st.shifts : st.extras)[Number(h.dataset.i)];
      calc();
    });
    box.addEventListener("keydown", (e) => {
      const h = e.target.closest(".ec-hdl");
      if (!h || (e.key !== "ArrowRight" && e.key !== "ArrowLeft")) return;
      e.preventDefault();
      const i = Number(h.dataset.i), side = h.dataset.side, store = side === "l" ? st.shifts : st.extras;
      store[i] = Math.max(0, (store[i] || 0) + (e.key === "ArrowRight" ? 0.25 : -0.25) * (side === "l" ? -1 : 1));
      calc();
      const again = box.querySelector(`.ec-hdl[data-i="${i}"][data-side="${side}"]`);
      if (again) again.focus();
    });
  }

  // ---------- v3.31: мини-карта — линия маршрута строки, нарезанная по раскладу ----------
  const MAP_KEY = "eta-calc-map";
  const ZONE_KM = 40;                 // точка отдыха примерная (70 км/ч) — кружок ±40 км
  const CODE_MAX_KM = 80;             // дальше — кода нет (AT, CH без своих кодов — не подставлять соседский)
  let refBtn = null, unitData = null, unitFor = "";
  async function loadUnit(fresh) {              // v3.51: своя машина на мини-карте — позиция из Mapon (/api/units)
    const num = (st.src && st.src.unit) || "";
    if (num !== unitFor) unitData = null;
    unitFor = num;
    if (!num || !window.UnitsLayer) { unitData = null; return; }
    const u = await UnitsLayer.findUnit(num, fresh).catch(() => null);
    if (unitFor === num) { unitData = u; drawMapSoon(); }
  }
  let gmap = null, lays = [], codes = null, codesLoading = false, mapRaf = 0, lineKey = "", lineCache = null;
  function mapFold(folded, init) {
    st.mapFolded = folded;
    $(".ec-msec").classList.toggle("folded", folded);
    $(".ec-mtg").textContent = (folded ? "▸" : "▾") + " Карта";
    if (!init) { try { localStorage.setItem(MAP_KEY, folded ? "0" : "1"); } catch (e) { /* ignore */ } }
    if (!folded) { st.mapFit = true; drawMapSoon(); }
  }
  function drawMapSoon() {
    if (mapRaf) return;
    mapRaf = requestAnimationFrame(() => { mapRaf = 0; drawMap(); });
  }
  function loadCodes() {
    if (codes || codesLoading) return;
    codesLoading = true;
    fetch("/api/region-codes").then((r) => r.json()).then((d) => { codes = d.codes || []; drawMapSoon(); })
      .catch(() => { codes = []; });
  }
  function codeAt(lat, lng) {
    if (!codes || !codes.length) return "";
    const k = Math.cos(lat * Math.PI / 180);
    let best = Infinity, code = "";
    for (const c of codes) {
      const d = (c.lat - lat) ** 2 + ((c.lng - lng) * k) ** 2;
      if (d < best) { best = d; code = c.code; }
    }
    return Math.sqrt(best) * 111.2 <= CODE_MAX_KM ? code : "";
  }
  // линия строки: точки и накопленные метры (считаем один раз на линию)
  function line(enc) {
    if (lineKey === enc && lineCache) return lineCache;
    const path = google.maps.geometry.encoding.decodePath(enc), cum = [0];
    for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + google.maps.geometry.spherical.computeDistanceBetween(path[i - 1], path[i]));
    lineKey = enc; lineCache = { path, cum, len: cum[cum.length - 1] || 1 };
    return lineCache;
  }
  function pointAt(L, m) {
    m = Math.max(0, Math.min(L.len, m));
    let lo = 0, hi = L.cum.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (L.cum[mid] <= m) lo = mid; else hi = mid; }
    const a = L.path[lo], b = L.path[hi], seg = (L.cum[hi] - L.cum[lo]) || 1;
    return google.maps.geometry.spherical.interpolate(a, b, (m - L.cum[lo]) / seg);
  }
  function slice(L, m0, m1) {
    const out = [pointAt(L, m0)];
    for (let i = 0; i < L.path.length; i++) if (L.cum[i] > m0 && L.cum[i] < m1) out.push(L.path[i]);
    out.push(pointAt(L, m1));
    return out;
  }
  // v3.131: плашка «на точке» — после любой отрисовки (и с маркерами, и с короткой линией маршрута) центр по машине и свой зум
  function focusMap(lat, lng, z) { st.focus = { lat, lng, z }; drawMapSoon(); }
  function drawMap() {
    drawMapBody();
    const f = st.focus;
    if (!f) return;
    st.focus = null;
    if (gmap && isOpen() && !st.mapFolded) {
      google.maps.event.trigger(gmap, "resize");
      gmap.setCenter({ lat: f.lat, lng: f.lng }); gmap.setZoom(f.z);
    }
  }
  function drawMapBody() {
    if (!panel || !isOpen() || st.mapFolded) return;
    const enc = st.src && st.src.polyline, pins = !enc && st.src && st.src.pins, box = $(".ec-mbox");
    if (enc && !S) return;
    box.classList.toggle("empty", !enc && !pins);
    $(".ec-mnote").textContent = enc ? "точки отдыха примерные: 70 км/ч, ±" + ZONE_KM + " км" : (pins ? "машина уже на точке — маршрута нет" : "");
    if (!enc && !pins) return;
    if (!window.googleMapsReady || !window.google || !google.maps.geometry) return;
    loadCodes();
    if (!gmap) {
      gmap = MapsCommon.make($(".ec-map"), { disableDefaultUI: true });   // v3.50: общий конфиг
      refBtn = MapsCommon.refreshBtn(gmap, () => loadUnit(true));                           // v3.51: ↻ — своя машина
      if (window.ObjLayer) ObjLayer.attach(gmap);   // v3.55: объекты Mapon — 🏭
    }
    const unitNum = (st.src && st.src.unit) || "";
    refBtn.hidden = !unitNum;
    if (unitNum && unitFor !== unitNum) loadUnit(true);
    lays.forEach((o) => o.setMap(null));
    lays = [];
    if (!enc) {                                 // v3.112: маршрута нет (км 0) — маркеры машины и точки
      const pu = pins.unit, ptg = pins.target;
      lays.push(new google.maps.Marker({ map: gmap, position: { lat: pu[0], lng: pu[1] }, title: "Машина", zIndex: 2,
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 7, fillColor: "#2f6fd6", fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2 },
        label: st.src.unit ? { text: st.src.unit, className: "ul-lab ec-plate", fontSize: "11px", fontWeight: "600", color: "#1a1a1a" } : null }));
      lays.push(new google.maps.Marker({ map: gmap, position: { lat: ptg[0], lng: ptg[1] }, title: "Точка", zIndex: 3,
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 9, fillColor: "#2ea043", fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2 },
        label: { text: "уже на точке", className: "ul-lab ec-plate", fontSize: "11px", fontWeight: "600", color: "#1a1a1a" } }));
      if (st.mapFit) {
        const b = new google.maps.LatLngBounds();
        b.extend({ lat: pu[0], lng: pu[1] }); b.extend({ lat: ptg[0], lng: ptg[1] });
        gmap.fitBounds(b, 60);
        google.maps.event.addListenerOnce(gmap, "idle", () => { if (gmap.getZoom() > 16) gmap.setZoom(16); });
        st.mapFit = false;
      }
      return;
    }
    const L = line(enc), k = L.len / ((S.dist || 1) * 1000);   // км расклада → метры линии
    const add = (o) => { lays.push(o); return o; };
    // v3.51: подписи — на белых плашках, как номера машин (ul-lab)
    const dot = (pos, color, scale, title, label) => add(new google.maps.Marker({
      map: gmap, position: pos, title, zIndex: label ? 3 : 2,
      icon: { path: google.maps.SymbolPath.CIRCLE, scale, fillColor: color, fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2,
              labelOrigin: new google.maps.Point(0, -16 / scale) },
      label: label ? { text: label, className: "ul-lab ec-plate", fontSize: "11px", fontWeight: "600", color: "#1a1a1a" } : null,
    }));
    let day = 0;
    S.ev.forEach((e) => {
      if (e.k === "d") {
        add(new google.maps.Polyline({ map: gmap, path: slice(L, e.km0 * 1000 * k, e.km1 * 1000 * k),
          strokeColor: day % 2 ? "#0F6E56" : "#1D9E75", strokeOpacity: 0.95, strokeWeight: 5 }));
      } else if (e.k === "b") {
        dot(pointAt(L, e.km0 * 1000 * k), "#EF9F27", 4, "Перерыв " + span(e) + " · 0:45");
      } else {
        day++;
        const p = pointAt(L, e.km0 * 1000 * k), code = codeAt(p.lat(), p.lng()), kind = restKind(e);
        add(new google.maps.Circle({ map: gmap, center: p, radius: ZONE_KM * 1000, strokeColor: "#5F5E5A", strokeOpacity: 0.6,
          strokeWeight: 1, fillColor: "#B4B2A9", fillOpacity: 0.25, clickable: false }));
        dot(p, "#5F5E5A", 7, "Отдых " + hm(e.t1 - e.t0) + (kind ? " (" + kind + ")" : "") + " · с " + fdt(new Date(S.at(e.t0))) +
          (code ? " · " + code : "") + " · " + km(e.km0), "🛏" + (code ? " " + code : ""));
      }
    });
    if (S.wk) dot(pointAt(L, S.wk.km * 1000 * k), "#c0392b", 5, "Недельный остаток кончился " + fdt(new Date(S.wk.ms)));
    // v3.51: старт — машина кружком, как на картах Флота / Локатора; без машины — плашка 📍 ETD
    if (unitNum && unitData && window.UnitsLayer) {
      const drv = unitData.st === "driving";
      add(new google.maps.Marker({ map: gmap, position: { lat: unitData.lat, lng: unitData.lng }, zIndex: 5,
        icon: UnitsLayer.icon(unitData), title: UnitsLayer.title(unitData) + "\nETD " + fdt(new Date(S.etd)),
        label: { text: String(unitData.number), className: "ul-lab " + (drv ? "ul-drv" : "ul-std"), color: "#1a1a1a", fontSize: "12px", fontWeight: "600" } }));
    } else if (unitNum) {
      dot(L.path[0], "#1a1a1a", 5, unitNum + " · ETD " + fdt(new Date(S.etd)));
    } else {
      dot(L.path[0], "#1a1a1a", 5, "Старт · ETD " + fdt(new Date(S.etd)), "📍 " + fdt(new Date(S.etd)));
    }
    dot(L.path[L.path.length - 1], "#2f6fd6", 6, "ETA " + fdt(new Date(S.eta)) + " · " + km(S.dist), "🏁 " + fdt(new Date(S.eta)));
    if (st.mapFit) {
      st.mapFit = false;
      const b = new google.maps.LatLngBounds();
      L.path.forEach((p) => b.extend(p));
      google.maps.event.trigger(gmap, "resize");
      gmap.fitBounds(b, 24);
    }
  }

  // ---------- открыть / закрыть ----------
  const isOpen = () => !!panel && panel.classList.contains("open");
  function open() {
    if (window.matchMedia("(max-width: 767px)").matches) return;
    if (!panel) build();
    if (typeof Notebook !== "undefined" && Notebook.close) Notebook.close();   // открыта одна панель за раз
    if (window.fleetMapPanel) window.fleetMapPanel.close();
    if (typeof sideMarginFix === "function") sideMarginFix();       // v3.32: левый край не скачет
    panel.classList.add("open");
    panel.setAttribute("aria-hidden", "false");
    document.body.classList.add("calc-open");
    st.mapFit = true;
    calc();
  }
  function close() {
    if (!isOpen()) return;
    panel.classList.remove("open");
    panel.setAttribute("aria-hidden", "true");
    document.body.classList.remove("calc-open");
  }

  document.addEventListener("DOMContentLoaded", () => {
    tab = document.getElementById("calc-tab");
    if (!tab) return;
    tab.addEventListener("click", (e) => { e.stopPropagation(); isOpen() ? close() : open(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && isOpen() && !st.drag) close(); });
  });

  // v3.32: «⏱ Послать в калькулятор» из From → To — открыть и залить
  function openWith(r) {
    open();
    if (isOpen()) fromRow(r);
  }

  return { open, close, isOpen, fromRow, openWith, focusMap };
})();
window.etaCalc = EtaCalc;
