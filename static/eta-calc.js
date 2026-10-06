/*
Fleet ETA Tracker — ⏱ ETA-калькулятор (v3.28): утилита «что если» без машины, панель справа (язычок под 📓).
Открыта одна панель за раз (карта 🗺, Блокнот 📓 или калькулятор); ширина тянется за левый край и запоминается
(localStorage "eta-calc-w"); Esc — закрыть. На телефоне (до 768 px) язычка нет.
Считает всё в браузере, к серверу и Google не ходит. Макет согласован в песочнице 05–06.10 (BACKLOG.md).
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
  - продления до 10 ч у соло не учитываем.
*/
const EtaCalc = (() => {
  const SPEED = 70, WEEK = 56, BREAK_AFTER = 4.5, BREAK = 0.75;
  const W_KEY = "eta-calc-w", MIN_W = 380, DEF_W = 500;   // v3.31: общая ширина панелей

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

  /*
  Расчёт рейса. p: { dist, shiftH, leftH, team, rest (9 | 11), shorts (1–3), wkLeft (ч, соло),
                     extras {№ отдыха: +ч}, shifts {№ отдыха: на сколько ч вождения встать раньше}, nowMs }.
  Время внутри — часы от ETD. Возвращает события ev [{k: d | b | r, t0, t1, km0, km1, ...}], etd, eta (мс),
  wk — где кончается недельный остаток (соло) или null.
  */
  function simulate(p) {
    const team = !!p.team, m = team ? 18 : 9;
    const etd = up15(p.nowMs) + Math.max(0, p.shiftH || 0) * 3600e3;
    const at = (h) => etd + h * 3600e3;
    const extras = p.extras || {}, shifts = p.shifts || {};
    const wkLeft = team ? Infinity : Math.max(0, p.wkLeft == null ? WEEK : p.wkLeft);
    const cut = {};
    const allow = (base, i) => { cut[i] = Math.min(shifts[i] || 0, base); return base - cut[i]; };
    let t = 0, kmLeft = Math.max(0, p.dist || 0), kmDone = 0, since = 0, sl = p.shorts || 0;
    let day = allow(Math.min(Math.max(0, p.leftH || 0), m), 0);
    let monday = nextMonday(etd), weekCap = wkLeft, weekDriven = 0, wk = null, guard = 0;
    const ev = [];
    if (!team && wkLeft <= 0) wk = { t: 0, km: 0 };
    while (kmLeft > 0.01 && guard++ < 500) {
      const can = team ? day : Math.min(day, BREAK_AFTER - since);
      if (can <= 1e-6) {
        if (!team && since >= BREAK_AFTER - 1e-6 && day > 1e-6) {           // перерыв 45 мин
          ev.push({ k: "b", t0: t, t1: t + BREAK, km0: kmDone, km1: kmDone });
          t += BREAK; since = 0; continue;
        }
        const i = ev.filter((x) => x.k === "r").length;                  // суточный отдых
        const want9 = !team && p.rest === 9 && sl > 0;
        const len = (team || want9 ? 9 : 11) + (extras[i] || 0);
        const short = want9 && len < 11;
        if (short) sl--;
        ev.push({ k: "r", t0: t, t1: t + len, km0: kmDone, km1: kmDone, i, short, extra: extras[i] || 0, shift: cut[i] || 0 });
        t += len; since = 0; day = allow(m, i + 1);
        if (len >= 24) {                                                  // недельный — неделя заново
          sl = 3;
          if (!wk) { weekDriven = 0; weekCap = WEEK; monday = nextMonday(at(t)); }
        }
        continue;
      }
      const d = Math.min(can, kmLeft / SPEED);
      if (!wk && !team) {
        const room = weekCap - weekDriven;
        if (d >= room - 1e-9 && at(t + room) < monday) wk = { t: t + room, km: kmDone + room * SPEED };
      }
      const last = ev[ev.length - 1];
      if (last && last.k === "d") { last.t1 += d; last.km1 += d * SPEED; }
      else ev.push({ k: "d", t0: t, t1: t + d, km0: kmDone, km1: kmDone + d * SPEED });
      if (at(t) < monday) weekDriven += Math.min(d, Math.max(0, (monday - at(t)) / 3600e3));
      t += d; kmLeft -= d * SPEED; kmDone += d * SPEED; day -= d; since += d;
    }
    return { dist: Math.max(0, p.dist || 0), ev, etd, eta: up15(at(t)), at, drive: Math.max(0, p.dist || 0) / SPEED,
             wk: wk ? { ms: at(wk.t), km: wk.km } : null, wkLeft };
  }

  // ---------- панель ----------
  const st = { shH: 0,      // сдвиг выезда, ч (поле — ЧЧ:ММ)
               team: true, rest: 9, shorts: 3, extras: {}, shifts: {}, drag: null,
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
        <div class="ec-sec"><div class="ec-lb"><span>Расстояние, км</span><span>70 … 5000</span></div>
          <div class="ec-ln"><input type="number" id="ec-km-n" min="70" step="10" value="1500"><input type="range" id="ec-km-r" min="70" max="5000" step="10" value="1500"></div></div>
        <div class="ec-sec"><div class="ec-lb"><span>Сдвиг выезда, ч</span><span class="ec-now"></span></div>
          <div class="ec-ln"><input type="text" id="ec-sh-n" class="ec-hm" inputmode="numeric" value="00:00" title="ЧЧ:ММ · ↑ ↓ — шаг 30 мин"><input type="range" id="ec-sh-r" min="0" max="72" step="0.5" value="0"></div></div>
        <div class="ec-sec"><div class="ec-lb"><span>Остаток вождения на момент выезда, ч</span><span class="ec-lmax"></span></div>
          <div class="ec-ln"><input type="number" id="ec-lf-n" min="0" max="18" step="0.25" value="18"><input type="range" id="ec-lf-r" min="0" max="18" step="0.25" value="18"></div></div>
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
          <p class="ec-note">Правый край отдыха — длиннее (шаг 15 мин), левый — весь отдых раньше. Двойной клик по ручке — вернуть.</p>
          <div class="ec-strip"></div>
          <div class="ec-days"></div>
          <div class="ec-wnote"></div>
          <div class="ec-legend"><span><i class="d"></i>езда</span><span><i class="b"></i>перерыв 45 мин</span><span><i class="r"></i>суточный отдых</span><span><i class="w"></i>недельный остаток кончился</span></div>
        </div>
        <div class="ec-sec ec-msec">
          <div class="ec-h"><a href="#" class="ec-mtg" title="Свернуть / развернуть карту">▾ Карта</a><span class="ec-mut ec-mnote"></span></div>
          <div class="ec-mbox">
            <div class="ec-map"></div>
            <div class="ec-mempty">Кликни строку трипа — здесь будет её маршрут с отдыхами</div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(panel);

    let w = DEF_W;
    if (typeof sideWidthReset === "function") sideWidthReset();
    try { w = Number(localStorage.getItem(W_KEY)) || DEF_W; } catch (e) { /* ignore */ }
    setWidth(w);

    $(".ec-x").addEventListener("click", close);
    // v3.31: правка руками — подпись «из строки» пропадает; км поменяли — линия строки больше не та
    $(".ec-body").addEventListener("input", (e) => {
      if (!e.isTrusted || !e.target.closest(".ec-sec") || e.target.closest(".ec-msec")) return;
      manual(e.target.id === "ec-km-n" || e.target.id === "ec-km-r");
    }, true);
    $(".ec-body").addEventListener("click", (e) => { if (e.target.closest(".ec-team button, .ec-rest button")) manual(false); }, true);
    $(".ec-mtg").addEventListener("click", (e) => { e.preventDefault(); mapFold(!st.mapFolded); });
    try { st.mapFolded = localStorage.getItem(MAP_KEY) === "0"; } catch (e) { /* ignore */ }
    mapFold(!!st.mapFolded, true);
    pair("km"); shPair(); pair("lf", clampLeft);
    $("#ec-wk-n").addEventListener("input", () => { const v = Number($("#ec-wk-n").value); if (v > 56) $("#ec-wk-n").value = 56; if (v < 0) $("#ec-wk-n").value = 0; calc(); });
    panel.querySelectorAll(".ec-team button").forEach((b) => b.addEventListener("click", () => {
      st.team = b.dataset.v === "1"; st.extras = {}; st.shifts = {};
      panel.querySelectorAll(".ec-team button").forEach((x) => x.classList.toggle("on", x === b));
      clampLeft(); restUI(); calc();
    }));
    $(".ec-rst").addEventListener("click", (e) => { e.preventDefault(); st.extras = {}; st.shifts = {}; calc(); });
    bindStrip();
    bindResize();
    restUI();
  }

  // ---------- v3.31: данные машины из строки Флота ----------
  function fromRow(r) {
    if (!panel) return;
    if (r.km == null || !(r.km > 0)) {          // строка не посчитана или ошибка — ничего не меняем
      st.srcShown = true;
      st.src = { unit: r.unit, point: r.point, km: null, polyline: null, note: "нет км у строки — не посчитана или ошибка" };
      srcUI(); drawMapSoon();
      return;
    }
    const kmv = Math.round(r.km);
    $("#ec-km-n").value = kmv; $("#ec-km-r").value = Math.min(kmv, 5000);
    const s = r.seed;
    const notes = [];
    if (s) {
      st.team = !!s.team;
      panel.querySelectorAll(".ec-team button").forEach((x) => x.classList.toggle("on", (x.dataset.v === "1") === st.team));
      $("#ec-lf-n").value = s.left_h; clampLeft();
      setSh(s.shift_h || 0);
      if (!st.team) {
        st.rest = s.shorts > 0 ? 9 : 11;
        st.shorts = Math.max(1, Math.min(3, s.shorts || 1));
        if (s.week_left_h != null) $("#ec-wk-n").value = s.week_left_h;
      }
      if (s.resting) notes.push("на отдыхе — выезд после него");
      if (s.unknown) notes.push("тахографа нет — остаток по максимуму");
      else if (s.nocard) notes.push("тахографа нет — стоит ≥ 9 ч, свежий день");
    } else {
      setSh(0);
      const nn = r.noSeedNote != null ? r.noSeedNote : "тахографа нет — состав и остаток прежние";
      if (nn) notes.push(nn);
    }
    st.extras = {}; st.shifts = {};
    st.src = { unit: r.unit, point: r.point, label: r.label || "", km: kmv, polyline: r.polyline || null, note: notes.join(" · ") };
    st.srcShown = true;
    st.mapFit = true;
    restUI(); srcUI(); calc();
  }
  function manual(kmChanged) {
    if (st.srcShown) { st.srcShown = false; srcUI(); }
    if (kmChanged && st.src && st.src.polyline) { st.src.polyline = null; drawMapSoon(); }
  }
  function srcUI() {
    const el = $(".ec-src"), s = st.src;
    el.hidden = !(st.srcShown && s);
    if (el.hidden) return;
    el.classList.toggle("bad", s.km == null);
    el.innerHTML = (s.label ? "из " + escH(s.label) : `из <b>${escH(s.unit || "строки")}</b>${s.point ? " → " + escH(s.point) : ""}`) +
      (s.note ? `<span class="ec-mut"> · ${escH(s.note)}</span>` : "");
  }
  const escH = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function setWidth(w) {
    const z = typeof uiZoom === "function" ? uiZoom() : 1;
    const max = Math.round((window.innerWidth / z) * 0.85);
    const v = Math.max(MIN_W, Math.min(max, Math.round(w)));
    document.documentElement.style.setProperty("--calcw", v + "px");
    // v3.30: ширина на виду — подпись при перетаскивании и подсказка ручки
    const h = $(".ec-resize"), lab = $(".w-label");
    if (lab) lab.textContent = v + " px";
    if (h) h.title = `Ширина ${v} px (по умолчанию ${DEF_W}) — потянуть шире / уже; шире ${DEF_W} — наползает на таблицу`;
  }
  function bindResize() {
    $(".ec-resize").addEventListener("mousedown", (e) => {
      e.preventDefault();
      document.body.classList.add("ec-resizing");
      const z = typeof uiZoom === "function" ? uiZoom() : 1;
      const move = (ev) => setWidth((window.innerWidth - ev.clientX) / z);
      const up = () => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        document.body.classList.remove("ec-resizing");
        const cur = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--calcw"), 10);
        try { localStorage.setItem(W_KEY, String(cur)); } catch (err) { /* ignore */ }
        calc();
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    });
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
    n.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { setSh(st.shH); return; }
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      e.preventDefault();
      const k = st.shH * 2;
      setSh((e.key === "ArrowUp" ? Math.floor(k + 1e-6) + 1 : Math.ceil(k - 1e-6) - 1) / 2);
      calc();
      n.dispatchEvent(new Event("input", { bubbles: true }));   // подпись «из строки» — как при правке руками
    });
  }
  function clampLeft() {
    const n = $("#ec-lf-n"), m = st.team ? 18 : 9;
    let v = Number(n.value);
    if (isNaN(v)) return;
    if (v > m) { v = m; n.value = m; }
    if (v < 0) { v = 0; n.value = 0; }
    $("#ec-lf-r").value = v;
  }
  function restUI() {
    const box = $(".ec-rest");
    if (st.team) { box.innerHTML = '<span class="ec-mut2">всегда 9 ч</span>'; return; }
    box.innerHTML = '<div class="ec-rl"><span class="ec-seg ec-sm ec-r911">' +
      [9, 11].map((v) => `<button type="button" data-v="${v}" class="${st.rest === v ? "on" : ""}">${v} ч</button>`).join("") + "</span>" +
      (st.rest === 9 ? '<span class="ec-mut2">9-к осталось</span><span class="ec-seg ec-sm ec-sh">' +
        [1, 2, 3].map((v) => `<button type="button" data-v="${v}" class="${st.shorts === v ? "on" : ""}">${v}</button>`).join("") +
        '</span><span class="ec-mut">→ 11 ч</span>' : "") + "</div>";
    box.querySelectorAll(".ec-r911 button").forEach((b) => b.addEventListener("click", () => { st.rest = Number(b.dataset.v); restUI(); calc(); }));
    box.querySelectorAll(".ec-sh button").forEach((b) => b.addEventListener("click", () => { st.shorts = Number(b.dataset.v); restUI(); calc(); }));
  }

  function params() {
    return {
      dist: Number($("#ec-km-n").value) || 0, shiftH: st.shH, leftH: Number($("#ec-lf-n").value) || 0,
      team: st.team, rest: st.rest, shorts: st.shorts, wkLeft: Number($("#ec-wk-n").value),
      extras: st.extras, shifts: st.shifts, nowMs: Date.now(),
    };
  }

  function calc() {
    if (!panel) return;
    const m = st.team ? 18 : 9;
    $("#ec-lf-r").max = m; $("#ec-lf-n").max = m;
    $(".ec-lmax").textContent = "макс. " + m + " ч";
    $(".ec-now").textContent = "сейчас " + fdt(new Date());
    $(".ec-wk").hidden = st.team;
    S = simulate(params());
    $(".ec-etd").textContent = fdt(new Date(S.etd));
    $(".ec-eta").textContent = fdt(new Date(S.eta));
    $(".ec-dur").textContent = hm((S.eta - S.etd) / 3600e3);
    $(".ec-drv").innerHTML = "(" + ICO.drive + " " + hmm(S.drive) + ")";
    drawStrip();
    drawDays();
    drawMapSoon();
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
      cum += kmd;
      rows.push(`<span class="ec-dl">${WD[day.w.getUTCDay()]} ${fd(d0)}</span><div class="ec-day">${[6, 12, 18].map((h) => `<span class="gl" style="left:${h / 24 * 100}%"></span>`).join("")}${segs}${wk}</div>` +
        `<span class="ec-dv">${hmm(drv)} <span>(${km(kmd)})</span></span><span class="ec-dr">${S.eta <= d1 ? "🏁 " + ft(new Date(S.eta)) : km(Math.max(0, S.dist - cum))}</span>`);
    }
    const axis = Array.from({ length: 13 }, (_, k) => `<span style="left:${k * 2 / 24 * 100}%">${k * 2}</span>`).join("") +
                 Array.from({ length: 25 }, (_, h) => `<i class="${h % 2 ? "" : "e"}" style="left:${h / 24 * 100}%"></i>`).join("");
    $(".ec-days").innerHTML = `<div class="ec-dgrid"><span></span><div class="ec-hr">${axis}</div><span class="ec-dv">${ICO.drive} <span>(км)</span></span><span class="ec-dr">остаток</span>${rows.join("")}</div>`;
  }

  // ---------- ручки отдыха: правая — длина, левая — весь отдых раньше ----------
  function bindStrip() {
    const strip = $(".ec-strip");
    strip.addEventListener("pointerdown", (e) => {
      const h = e.target.closest(".ec-hdl");
      if (!h) return;
      e.preventDefault();
      const i = Number(h.dataset.i), side = h.dataset.side, w = strip.getBoundingClientRect().width || 1;
      st.drag = { i, side, x0: e.clientX, v0: (side === "l" ? st.shifts : st.extras)[i] || 0, hpp: (S.eta - S.etd) / 3600e3 / w };
      strip.setPointerCapture(e.pointerId);
      calc();
    });
    strip.addEventListener("pointermove", (e) => {
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
    strip.addEventListener("pointerup", end);
    strip.addEventListener("pointercancel", end);
    strip.addEventListener("dblclick", (e) => {
      const h = e.target.closest(".ec-hdl");
      if (!h) return;
      delete (h.dataset.side === "l" ? st.shifts : st.extras)[Number(h.dataset.i)];
      calc();
    });
    strip.addEventListener("keydown", (e) => {
      const h = e.target.closest(".ec-hdl");
      if (!h || (e.key !== "ArrowRight" && e.key !== "ArrowLeft")) return;
      e.preventDefault();
      const i = Number(h.dataset.i), side = h.dataset.side, store = side === "l" ? st.shifts : st.extras;
      store[i] = Math.max(0, (store[i] || 0) + (e.key === "ArrowRight" ? 0.25 : -0.25) * (side === "l" ? -1 : 1));
      calc();
      const again = strip.querySelector(`.ec-hdl[data-i="${i}"][data-side="${side}"]`);
      if (again) again.focus();
    });
  }

  // ---------- v3.31: мини-карта — линия маршрута строки, нарезанная по раскладу ----------
  const MAP_KEY = "eta-calc-map";
  const ZONE_KM = 40;                 // точка отдыха примерная (70 км/ч) — кружок ±40 км
  const CODE_MAX_KM = 80;             // дальше — кода нет (AT, CH без своих кодов — не подставлять соседский)
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
  function drawMap() {
    if (!panel || !S || !isOpen() || st.mapFolded) return;
    const enc = st.src && st.src.polyline, box = $(".ec-mbox");
    box.classList.toggle("empty", !enc);
    $(".ec-mnote").textContent = enc ? "точки отдыха примерные: 70 км/ч, ±" + ZONE_KM + " км" : "";
    if (!enc || !window.googleMapsReady || !window.google || !google.maps.geometry) return;
    loadCodes();
    if (!gmap) {
      gmap = new google.maps.Map($(".ec-map"), {
        center: { lat: 50.5, lng: 10 }, zoom: 4, disableDefaultUI: true, zoomControl: true, clickableIcons: false,
        zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_TOP },
      });
    }
    lays.forEach((o) => o.setMap(null));
    lays = [];
    const L = line(enc), k = L.len / ((S.dist || 1) * 1000);   // км расклада → метры линии
    const add = (o) => { lays.push(o); return o; };
    const dot = (pos, color, scale, title, label) => add(new google.maps.Marker({
      map: gmap, position: pos, title, zIndex: label ? 3 : 2,
      icon: { path: google.maps.SymbolPath.CIRCLE, scale, fillColor: color, fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2,
              labelOrigin: new google.maps.Point(0, -2.6) },
      label: label ? { text: label, fontSize: "11px", fontWeight: "600", color: "#1a1a1a" } : null,
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
    dot(L.path[0], "#1a1a1a", 5, "Машина сейчас · ETD " + fdt(new Date(S.etd)));
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
    window.addEventListener("resize", () => {
      const w = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--calcw"), 10);
      if (w) setWidth(w);
    });
  });

  // v3.32: «⏱ Послать в калькулятор» из From → To — открыть и залить
  function openWith(r) {
    open();
    if (isOpen()) fromRow(r);
  }

  return { open, close, isOpen, simulate, fromRow, openWith };
})();
window.etaCalc = EtaCalc;
