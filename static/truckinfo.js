/*
Fleet ETA Tracker — вкладка "Truck Info"
Версия: 1.42 — водители, недельные отдыхи 24/45 ч (по истории Mapon daily_activities),
срок следующего недельного, события карты, стоянки за 3 суток.
*/
(function () {
  const inp = document.getElementById("ti-unit");
  const btn = document.getElementById("ti-go");
  const out = document.getElementById("ti-out");
  if (!inp || !btn || !out) return;
  // v3.354: «часов» недельного отдыха — целые часы вниз, точное время в скобках: 24:00 (24:09)
  const hoursFloor = (v) => { const m = /^(\d+):(\d{2})$/.exec(String(v == null ? "" : v)); return m ? `${+m[1]}:00 <span class="ti-sub">(${esc(v)})</span>` : esc(v); };
  // недобор до 45 ч — от отдыха, округлённого вниз, то есть вверх: 20:51 → 21H (только вид, расчёт по точным минутам)
  // v3.355: метка вида отдыха перед датой: 24H — сокращённый 24:00–24:59, 9h+ — суточный (короче 24 ч в список недельных и не попадает), 24H+ — сокращённый дольше (до 45), 9h+ — «большая 9ка», 45H+ — полный
  const weeklyKind = (w) => {
    const h = /^(\d+):/.exec(String(w.hours || ""));
    if (w.base_idle || (h && +h[1] >= 100)) return "простой";   // v3.356: отдых от 100 ч — вероятно простой / отпуск, не рабочий недельный
    if (w.daily) return "9h+";
    if (w.full) return "45H+";
    const m = /^(\d+):/.exec(String(w.hours || ""));
    if (!m) return "24H";
    return +m[1] > 24 ? "24H+" : +m[1] === 24 ? "24H" : "9h+";   // короче 24 ч — это уже суточный отдых (9h+), не недельный
  };
  const deficitH = (v) => { const m = /^(\d+):(\d{2})$/.exec(String(v == null ? "" : v)); return m ? `${+m[1] + (+m[2] > 0 ? 1 : 0)}H` : esc(v); };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const STATE = { DRIVING: "едет", REST: "отдыхает", AVAILABLE: "готовность", WORK: "работа" };

  function driverHtml(d) {
    let h = `<div class="ti-driver"><div class="ti-dname">${esc(d.name)}
      <span class="ti-state">${esc(STATE[d.state] || d.state || "")}</span></div>`;
    h += `<div class="ti-grid">
      <div><span>сегодня осталось</span><b>${esc(d.today_left || "—")}</b></div>
      <div><span>неделя осталось</span><b>${esc(d.week_left || "—")}</b></div>
      <div><span>продления 10 ч</span><b>${d.ext_left != null ? esc(d.ext_left) : "—"}</b></div>
      <div><span>сокращения 9 ч</span><b>${d.short_left != null ? esc(d.short_left) : "—"}</b></div>
    </div>`;
    if (d.ongoing) {
      h += `<div class="ti-now">На недельном отдыхе уже <b>${esc(d.resting)}</b>` +
           (d.can_go ? `, можно ехать с <b>${esc(d.can_go)}</b>` : "") + `</div>`;
    } else if (d.resting) {
      h += `<div class="ti-now ti-now-soft">Отдыхает ${esc(d.resting)}</div>`;
    }
    if (d.deadline) {
      h += `<div class="ti-deadline">` + (d.alt
        ? `Следующий недельный — <b>или</b> <b>24ка</b> до ${esc(d.alt.until)} (через ${esc(d.alt.until_in)}): тогда ${esc(d.alt.from)} → ${esc(d.alt.to)} станет 9кой; <b>или</b> не успеют — <b>45ка</b> ${esc(d.deadline)} (через ${esc(d.deadline_in)})`
        : `Следующий недельный — <b>${/^45/.test(String(d.need)) ? "45ка" : "24ка"}</b> ${esc(d.deadline)}
        (через ${esc(d.deadline_in)})`) +
        (d.mapon_weekly ? ` <span class="ti-mapon">Mapon: ${esc(d.mapon_weekly)}</span>` : "") + `</div>`;
    }
    if (d.weekly_error) h += `<div class="ti-err">${esc(d.weekly_error)}</div>`;
    if (d.weekly && d.weekly.length) {
      h += `<table class="ti-table"><tr><th>Недельный отдых</th><th>часов</th><th></th></tr>` +
        d.weekly.map((w) => `<tr class="ti-rowclick" title="Показать на карте, где стоял" data-ts="${w.ts || ""}" data-te="${w.te || ""}">
          <td><b class="ti-kind">${esc(weeklyKind(w))}</b> ${w.edge ? '<span title="отдых начался раньше, чем данные Mapon за 28 дней — начало и длительность не меньше показанных">≤</span> ' : ""}${esc(w.from)} → ${esc(w.to)}</td><td>${w.edge ? "≥ " : ""}${hoursFloor(w.hours)}</td>
          <td>${w.daily ? '<span class="ti-tag" title="второй отдых от 24 ч в неделе — считаем суточным">большая 9ка</span>' : w.full ? '<span class="ti-tag ti-full">45+</span>' : '<span class="ti-tag ti-red">сокращ.</span>'}
              ${w.nocard ? '<span class="ti-tag" title="часть отдыха без карты — данные с CAN">без карты</span>' : ""}</td>
        </tr>${w.late ? `<tr class="ti-violrow"><td colspan="3"><span class="ti-tag ti-viol" title="Нарушение: недельный начался позже, чем через 6 суток после конца прошлого недельного (561/2006, ст. 8(6))">нарушение: на ${esc(w.late)} позже 6 суток</span></td></tr>` : ""}`).join("") + (d.alt ? `<tr class="ti-nextred"><td><b class="ti-kind">24ка</b> до ${esc(d.alt.until)} <span class="ti-dim">(через ${esc(d.alt.until_in)}) — или</span></td><td></td><td></td></tr>` : "") + (d.deadline && d.need ? `<tr class="ti-nextred"><td><b class="ti-kind">${/^45/.test(String(d.need)) ? "45ка" : "24ка"}</b> ${esc(d.deadline)}${d.deadline_in ? ` <span class="ti-dim">(через ${esc(d.deadline_in)})</span>` : ""}</td><td></td><td></td></tr>` : "") + `</table><div class="ti-mapnote" style="display:none"></div>`;
    }
    if (d.comp && d.comp.length) {
      const CST = {
        ok: (c) => ["ti-full", "компенсирован" + (c.done_at ? " " + esc(c.done_at) : "")],
        open: (c) => ["ti-red", "нужно добрать до " + esc(c.until21 || c.deadline)],
        overdue: (c) => ["ti-red", "просрочено до " + esc(c.until21 || c.deadline)] };
      h += `<table class="ti-table"><tr><th>Компенсация сокращённого отдыха</th><th>недобор</th><th>осталось</th></tr>` +
        d.comp.slice().reverse().map((c) => { const [cls, txt] = CST[c.status](c); return `<tr>
          <td class="ti-jump" data-ts="${c.ts || ""}" data-te="${c.te || ""}" title="Показать этот отдых в «Недельном отдыхе»">${esc(c.from)} → ${esc(c.to)} (${esc(c.hours)})</td><td>${deficitH(c.deficit)}</td>
          <td class="ti-jump" data-ts="${c.dts || ""}" data-te="${c.dte || ""}" title="${c.dts ? "Показать отдых, которым долг закрыт" : "Показать срок"}"><span class="ti-tag ${cls}">${txt}</span></td></tr>`; }).join("") +
        `</table><div class="ti-note">Недобор добирают одним куском к отдыху не короче 9 ч (к 9-ке или 45-ке) до конца третьей недели после сокращения; считаем за ${d.comp_days || 28} дн. истории.</div>`;
    }
    if (d.cards && d.cards.length) {
      h += `<div class="ti-cards">Карта: ` + d.cards.slice().reverse()
        .map((c) => `<span>${esc(c.at)} ${esc(c.what)}</span>`).join("") + `</div>`;
    }
    return h + historyHtml(d) + `</div>`;
  }

  // История водителя: езда / работа / отдых и вставил/вынул карту, новое сверху
  const ACT = { DRIVING: ["езда", "ti-a-drv"], WORK: ["работа", "ti-a-wrk"], REST: ["отдых", "ti-a-rst"],
                AVAILABLE: ["готовность", "ti-a-av"] };
  function historyHtml(d) {
    const wrap = (inner) => `<div class="ti-hist-wrap">${segHtml()}${inner}</div>`;   // v3.367: период — рядом с кнопкой «История водителя»
    if (d.history_error) return wrap(`<div class="ti-err">История: ${esc(d.history_error)}</div>`);
    if (!d.history || !d.history.length) return wrap("");
    const ev = (d.history_cards || []).map((c) => ({ at: c.at, card: c.what === "CARD_INSERTED" ? "вставил карту" : "вынул карту" }));
    const rows = d.history.map((g) => ({ at: g.from, g }));
    // события карты — отдельными строками по времени начала (формат «дд.мм чч:мм» сортируется по датам внутри периода)
    const key = (s) => s.slice(3, 5) + s.slice(0, 2) + s.slice(6);
    const all = rows.concat(ev).sort((a, b) => (key(b.at) > key(a.at) ? 1 : key(b.at) < key(a.at) ? -1 : 0));
    return wrap(`<details class="ti-hist-d"><summary>История водителя</summary><table class="ti-table ti-hist">` + all.map((r) => {
      if (r.card) return `<tr class="ti-h-card"><td>${esc(r.at)}</td><td colspan="3">${esc(r.card)}</td></tr>`;
      const g = r.g, a = ACT[g.status] || [g.status, ""];
      const nocard = (g.src || []).some((s) => s === "can" || s === "unkn");
      return `<tr class="${a[1]}"><td>${esc(g.from)} → ${esc(g.to)}</td><td><span class="ti-tag ${a[1]}">${esc(a[0])}</span></td>
        <td>${esc(g.hours)}</td><td>${nocard ? '<span class="ti-tag" title="данные с CAN, карты не было">без карты</span>' : ""}</td></tr>`;
    }).join("") + `</table></details>`);
  }

  // Поиск водителя по имени: один найден — сразу его трак, несколько — список
  async function searchDrivers(q) {
    out.innerHTML = `<div class="ti-loading">Ищу водителя…</div>`;
    const r = await fetch(`/api/driver-search?q=${encodeURIComponent(q)}`);
    const j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error || r.status);
    const list = j.drivers || [];
    if (!list.length) {
      out.innerHTML = `<div class="ti-err">Не найден ни трак, ни водитель «${esc(q)}» (водитель ищется среди тех, у кого сейчас карта в тягаче)</div>`;
      return;
    }
    if (list.length === 1) { inp.value = list[0].number; return load(); }
    out.innerHTML = `<div class="ti-find">` + list.map((d) => `<button type="button" class="ti-pick" data-n="${esc(d.number)}">
      <span>${esc(d.name)}</span><span class="ti-tag">${esc(STATE[d.state] || d.state || "")}</span>
      <b>${esc(d.number)}</b></button>`).join("") + `</div>`;
    out.querySelectorAll(".ti-pick").forEach((b) => b.addEventListener("click", () => { inp.value = b.dataset.n; load(); }));
  }

  // v3.258: лог рефа прицепа — сводка и полоса по суткам (время — Рига); подзарядка: до 1 ч «мало», от 1 ч «достаточно», от 2 ч «хорошо»
  const RIGA = { timeZone: "Europe/Riga" };
  const fD = new Intl.DateTimeFormat("ru", Object.assign({ day: "2-digit", month: "2-digit" }, RIGA));
  const fT = new Intl.DateTimeFormat("ru", Object.assign({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" }, RIGA));
  const rlDt = (ms) => fD.format(ms) + " " + fT.format(ms);
  const rlHm = (m) => { if (m < 1) return "< 1 мин"; m = Math.round(m); return m >= 60 ? Math.floor(m / 60) + " ч" + (m % 60 ? " " + (m % 60) + " мин" : "") : m + " мин"; };
  function reeferHtml(j) {
    if (j.no_reefer) return `<div class="rl-h"><b>Реф</b></div><div class="ti-err">У этого юнита нет данных рефа за период.</div>`;
    const sm = j.summary || {}, now = Date.parse(j.till), from = Date.parse(j.from);
    const ago = (iso) => { const t = iso ? Date.parse(iso) : 0; return t ? `${rlDt(t)} (${rlHm((now - t) / 6e4)} назад)` : "нет за период"; };
    const rows = [["Включений", `${sm.count || 0} · достаточных (≥ 1 ч): ${sm.ok || 0} · хороших (≥ 2 ч): ${sm.good || 0}`],
      ["Работал всего", rlHm(sm.total_min || 0)], ["Самый долгий простой", rlHm(sm.longest_idle_min || 0)],
      ["Последнее включение", ago(sm.last_on)], ["Последнее достаточное", ago(sm.last_ok)]];
    const key = (ms) => fD.format(ms), mins = (ms) => { const p = fT.format(ms).split(":"); return (+p[0]) * 60 + (+p[1]); };
    const byDay = {}, txt = {};
    (j.on || []).forEach((o) => {                       // включение через полночь режем по суткам
      const a = Date.parse(o.from), b = Date.parse(o.till);
      for (let cur = a; cur < b;) {
        const k = key(cur), st = mins(cur), left = (b - cur) / 6e4, len = Math.min(left, 1440 - st);
        const first = cur === a, last = left <= 1440 - st;   // подпись к полосе: когда включили и на сколько (через сутки — с … / весь день / до …)
        (txt[k] = txt[k] || []).push(first && last ? `${fT.format(cur)} · ${rlHm(o.min)}` : first ? `с ${fT.format(cur)} · всего ${rlHm(o.min)}` : last ? `до ${fT.format(b)}` : "весь день");
        (byDay[k] = byDay[k] || []).push(`<i class="rl-seg rl-s-${o.kind}" style="left:${st / 14.4}%;width:${Math.max(len / 14.4, 0.5)}%" title="${esc(rlDt(a))} · ${esc(rlHm(o.min))}"></i>`);
        cur += Math.max(len, 1) * 6e4 + 1000;
        while (cur < b && key(cur) === k) cur += 36e5;   // сутки с переводом часов длиннее 24 ч — не повторяем день
      }
    });
    const keys = [];
    for (let d = from; d <= now; d += 864e5) keys.push(key(d));
    if (keys.indexOf(key(now)) < 0) keys.push(key(now));
    return `<div class="rl-h"><b>Реф</b> <span class="rl-demo">время — Рига, за ${esc(j.days)} сут.</span></div>`
      + `<div class="rl-sum">${rows.map((r) => `<div class="rl-k">${r[0]}</div><div>${esc(r[1])}</div>`).join("")}</div>`
      + `<div class="rl-days"><div class="rl-day"><span class="rl-dl"></span><span class="rl-axis"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></span><span class="rl-dd"></span></div>`
      + keys.map((k) => `<div class="rl-day"><span class="rl-dl">${k}</span><span class="rl-bar">${(byDay[k] || []).join("")}</span><span class="rl-dd" title="${esc((txt[k] || []).join(" · "))}">${esc((txt[k] || []).join(" · "))}</span></div>`).join("")
      + `<div class="rl-leg"><i class="rl-seg rl-s-low"></i> мало (&lt; 1 ч) <i class="rl-seg rl-s-ok"></i> достаточно (≥ 1 ч) <i class="rl-seg rl-s-good"></i> хорошо (≥ 2 ч)</div></div>`;
  }
  async function loadReefer(q, days) {
    const box = () => document.getElementById("ti-reefer");
    try {
      const r = await fetch(`/api/reefer-log?unit=${encodeURIComponent(q)}&days=${encodeURIComponent(days)}`);
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || r.status);
      if (box()) box().innerHTML = reeferHtml(j);
    } catch (e) {
      if (box()) box().innerHTML = `<div class="ti-err">Реф: ${esc(e.message)}</div>`;
    }
  }

  // v3.368: soft — смена периода: без «Загрузка…», карту не двигаем, прокрутка остаётся (страница не «обновляется»)
  const scroller = () => { for (let e = out.parentElement; e; e = e.parentElement) { const o = getComputedStyle(e).overflowY; if ((o === "auto" || o === "scroll") && e.scrollHeight > e.clientHeight) return e; } return document.scrollingElement; };
  async function load(opt) {
    const q = inp.value.trim();
    if (!q) return;
    const soft = !!(opt && opt.soft === true);
    if (!soft) out.innerHTML = `<div class="ti-loading">Загрузка…</div>`;
    try {
      const days = histDays;
      const r = await fetch(`/api/truck-info?unit=${encodeURIComponent(q)}&days=${encodeURIComponent(days)}`);
      const j = await r.json();
      if (r.status === 404) return searchDrivers(q);      // не номер трака — ищем водителя по имени
      if (!r.ok || j.error) throw new Error(j.error || r.status);
      // v3.302: карта Флота — на машину / прицеп, зум 9 (закрытая панель выезжает сама)
      if (!soft && typeof showUnitOnMap === "function" && typeof j.lat === "number" && typeof j.lng === "number") {
        // v3.330: маркер (значок как у машинок Флота) — только если трака / прицепа нет во Флоте; тягач прицепа — по строке Флота
        const nrm = (x) => String(x || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
        const fr = (typeof rows !== "undefined" ? rows : []).find((r) => j.trailer ? nrm(r.trailer) && nrm(r.trailer) === nrm(j.number) : nrm(r.unit) === nrm(j.number));
        j.tractor = j.trailer && fr ? fr.unit : "";
        let fill = "";
        try { const e = fr && typeof dispEntry === "function" ? dispEntry(rowDisp(fr)) : null; fill = e && e.color ? e.color : ""; } catch (e) {}
        window.tiPinOpts = { st: j.st, dir: j.dir, trailer: !!j.trailer, fill, tractor: "" };
        // v3.338: маркер Truck Info — когда плашки машины на карте Флота нет (нет во Флоте или спрятана фильтром); видимая плашка Флота — без дубля
        const fm = fr && typeof markers !== "undefined" ? markers[fr.id] : null;
        const calcOpen = !!(window.etaCalc && window.etaCalc.isOpen());   // открыт ⏱ — смотрим его карту, плашек Флота на ней нет
        const onMap = !calcOpen && !!(fm && fm.getMap && fm.getMap() && fm.getVisible());
        showUnitOnMap(j.lat, j.lng, 9, onMap ? "" : j.number);   // во Флоте уже есть плашка — только переезд карты
      }
      lastUnit = j.trailer ? "" : String(j.number || "");
      lastShown = String(j.number || "");
      // v3.368: пара «трак ⇄ прицеп» одинаково в обе стороны: привязан по строке Флота — метка, нет — подсказка ближайшего по GPS
      const nrm2 = (x) => String(x || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      const frow = (typeof rows !== "undefined" ? rows : []).find((r) => j.trailer ? nrm2(r.trailer) && nrm2(r.trailer) === nrm2(j.number) : nrm2(r.unit) === nrm2(j.number));
      const pairNo = j.trailer ? (j.tractor || "") : (frow && frow.trailer ? String(frow.trailer) : "");
      const pairWord = j.trailer ? "тягач" : "прицеп";
      const pairTag = pairNo ? ` <a href="#" class="ti-tag ti-tractor" data-unit="${esc(pairNo)}" title="${pairWord} по строке Флота — клик: открыть его Truck Info">${pairWord}: ${esc(pairNo)}</a>` : ` <span class="ti-pair-hint" id="ti-pair"></span>`;
      let h = `<div class="ti-title">${esc(j.number)}${pairTag}</div>`;
      if (!pairNo) {
        const thisNo = String(j.number || "");
        fetch(`/api/nearest-units?unit=${encodeURIComponent(thisNo)}&kind=${j.trailer ? "truck" : "trailer"}`).then((r) => r.json()).then((n) => {
          const it = (n.items || [])[0], box = document.getElementById("ti-pair");
          if (!box || !it || lastShown !== thisNo) return;
          box.innerHTML = `<a href="#" class="ti-tag ti-tractor ti-dimtag" data-unit="${esc(it.number)}" title="не привязан во Флоте. Ближайший по GPS — клик: открыть его Truck Info">${pairWord}: ? ${esc(it.number)} · ${it.km < 10 ? it.km.toFixed(1) : Math.round(it.km)} км</a>`;
        }).catch(() => {});
      }
      if (j.trailer) {   // v3.258: прицеп — вместо водителей лог рефа
        out.innerHTML = h + `<div class="rl-card" id="ti-reefer"><div class="ti-loading">Реф: загрузка…</div></div>` + segHtml();
        return loadReefer(q, days);
      }
      if (j.tacho_error) h += `<div class="ti-err">Тахограф: ${esc(j.tacho_error)}</div>`;
      const mp = j.panel && window.TachoPop ? `<div class="tp tp-mp tp-static" id="ti-mp"></div>` : "";   // v3.362: панель Tachograph «как в Mapon»
      h += `<div class="ti-drivers">${mp}${(j.drivers || []).map(driverHtml).join("")}</div>`;
      if (j.stops && j.stops.length) {
        h += `<table class="ti-table ti-stops"><tr><th colspan="3">Стоянки от 2 ч за 3 суток</th></tr>` +
          j.stops.slice().reverse().map((s) => `<tr><td>${esc(s.from)} → ${esc(s.to)}</td>
            <td>${esc(s.hours)}</td><td>${esc(s.address || "")}</td></tr>`).join("") + `</table>`;
      } else if (j.stops_error) {
        h += `<div class="ti-err">Стоянки: ${esc(j.stops_error)}</div>`;
      }
      out.innerHTML = h;
      const mpEl = document.getElementById("ti-mp");
      if (mpEl) {
        const draw = (i) => { mpEl.innerHTML = window.TachoPop.render({ u: j.number, h: "", p: j.panel }, i); };
        const first = Math.max(0, (j.panel.drivers || []).findIndex((x) => x.state === "DRIVING"));
        draw(first);
        mpEl.addEventListener("click", (e) => { const tb = e.target.closest(".mp-tab"); if (tb) draw(+tb.dataset.tab); });
      }
    } catch (e) {
      out.innerHTML = `<div class="ti-err">Ошибка: ${esc(e.message)}</div>`;
    }
  }
  // v3.302: подсказки по набранному тексту — номера тягачей и прицепов (unitsCache) и имена водителей (/api/driver-search)
  const dl = document.createElement("datalist");
  dl.id = "ti-list";
  inp.setAttribute("list", "ti-list");
  inp.after(dl);
  let dlTimer = null, dlSeq = 0;
  const optsOf = (units, drivers) => {
    const frag = document.createDocumentFragment();
    units.concat(drivers).forEach((x) => { const o = document.createElement("option"); o.value = x.v; o.label = x.l; frag.appendChild(o); });
    dl.replaceChildren(frag);
  };
  function fillList() {
    const q = inp.value.trim(), seq = ++dlSeq;
    clearTimeout(dlTimer);
    if (!q) { dl.replaceChildren(); return; }
    const t = ptsNorm(q).replace(/\s/g, "");
    if (t.length < 2) { dl.replaceChildren(); return; }   // с одной буквы — слишком много машин
    const starts = [], rest = [];
    for (const u of (typeof unitsCache !== "undefined" && unitsCache) || []) {
      const n = ptsNorm(u.number).replace(/\s/g, "");
      if (!n.includes(t)) continue;
      (n.startsWith(t) ? starts : rest).push({ v: u.number, l: u.kind === "trailer" ? "прицеп" : "машина" });
    }
    const units = starts.concat(rest).slice(0, 10);   // начало номера — первым, не больше 10
    optsOf(units, []);
    dlTimer = setTimeout(async () => {
      try {
        const r = await fetch(`/api/driver-search?q=${encodeURIComponent(q)}`);
        const j = await r.json();
        if (seq !== dlSeq || !j.drivers) return;
        optsOf(units, j.drivers.map((d) => ({ v: d.number, l: `${d.name} · ${STATE[d.state] || d.state || ""}` })));
      } catch (e) { /* подсказки по водителям не критичны */ }
    }, 250);
  }
  ["input", "focus"].forEach((ev) => inp.addEventListener(ev, fillList));
  btn.addEventListener("click", load);
  // v3.362: период истории водителя / лога рефа — кнопки внизу [3 сут][7 сут][14 сут] (было: список сверху)
  let histDays = 3, lastShown = "";
  try { histDays = [3, 7, 14].includes(+localStorage.getItem("ti-days")) ? +localStorage.getItem("ti-days") : 3; } catch (e) {}
  const segHtml = () => `<div class="ti-seg-row" title="за сколько суток история водителя"><div class="ti-seg">` +
    [3, 7, 14].map((n) => `<button type="button" data-d="${n}" class="${n === histDays ? "on" : ""}">${n} сут</button>`).join("") + `</div></div>`;
  let blinkTimer = null, lastUnit = "";
  // v3.360: где трак стоял в интервале отдыха — метка на карте (/api/truck-rest-stop); ошибка — строка под таблицей водителя
  async function showRestOnMap(ts, te, card) {
    const note = card && card.querySelector(".ti-mapnote");
    const say = (t) => { if (note) { note.textContent = t; note.style.display = t ? "" : "none"; } };
    if (!lastUnit || !ts || !te) return;
    say("Ищу, где стоял…");
    try {
      const r = await fetch(`/api/truck-rest-stop?unit=${encodeURIComponent(lastUnit)}&from=${ts}&to=${te}`);
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || r.status);
      window.tiPinOpts = Object.assign({}, window.tiPinOpts || {}, { st: "standing", dir: null, tractor: "",
        title: `Стоял ${j.from} → ${j.to} (${j.hours})${j.address ? " · " + j.address : ""}` });
      if (typeof showUnitOnMap === "function") showUnitOnMap(j.lat, j.lng, 12, `${j.from} → ${j.to}`);
      say(`Стоял ${j.from} → ${j.to} (${j.hours})${j.address ? " · " + j.address : ""}`);
    } catch (e) {
      say(String(e.message || e));
    }
  }
  // v3.358: клик в «Компенсации» — строка этого отдыха в «Недельном отдыхе» моргает 5 с (1 — сокращённый отдых, 2 — отдых, которым долг закрыт)
  out.addEventListener("click", (e) => {
    const j = e.target.closest(".ti-jump");
    if (!j) return;
    const ts = +j.dataset.ts, te = +j.dataset.te, card = j.closest(".ti-driver");
    if (!ts || !te || !card) return;
    let best = null, bo = 0;
    card.querySelectorAll("tr[data-ts]").forEach((tr) => {
      const a = +tr.dataset.ts, b = +tr.dataset.te;
      const o = Math.min(te, b) - Math.max(ts, a);
      if (a && b && o > bo) { bo = o; best = tr; }
    });
    if (!best) return;
    clearTimeout(blinkTimer);                                         // новый клик сбрасывает прежнее моргание — моргает только одна строка
    out.querySelectorAll("tr.ti-blink").forEach((tr) => tr.classList.remove("ti-blink"));
    void best.offsetWidth;
    best.classList.add("ti-blink");
    best.scrollIntoView({ block: "nearest", behavior: "smooth" });
    blinkTimer = setTimeout(() => best.classList.remove("ti-blink"), 5000);
  });
  // v3.360: клик по периоду / плашке в «Компенсации» — ещё и карта (где стоял этот отдых); клик по строке «Недельного отдыха» — только карта
  out.addEventListener("click", (e) => {
    const j = e.target.closest(".ti-jump");
    const tr = j ? null : e.target.closest("tr.ti-rowclick");
    const el = j || tr;
    if (!el) return;
    const card = el.closest(".ti-driver");
    showRestOnMap(+el.dataset.ts, +el.dataset.te, card);
  });
  // v3.331: клик по метке «тягач: …» — Truck Info по тягачу
  out.addEventListener("click", (e) => {
    const t = e.target.closest(".ti-tractor");
    if (!t) return;
    e.preventDefault();
    inp.value = t.dataset.unit || "";
    load();
  });
  // v3.362: Ctrl+клик по номеру машины во Флоте — открыть Truck Info с этой машиной
  window.tiOpenUnit = (unit) => {
    const v = String(unit || "").trim();
    if (!v) return;
    const tb = document.querySelector('.main-tab-btn[data-tab="truckinfo"]');
    if (tb && !tb.classList.contains("active")) tb.click();
    inp.value = v;
    load();
  };
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") load(); });
  inp.addEventListener("change", load);
  out.addEventListener("click", async (e) => {
    const sb = e.target.closest(".ti-seg button");
    if (!sb) return;
    const n = +sb.dataset.d;
    if (!n || n === histDays) return;
    histDays = n;
    try { localStorage.setItem("ti-days", String(n)); } catch (er) {}
    const wasOpen = !!out.querySelector(".ti-hist-d[open]");
    const sc = scroller(), top = sc ? sc.scrollTop : 0;
    await load({ soft: true });
    if (sc) sc.scrollTop = top;
    if (wasOpen) out.querySelectorAll(".ti-hist-d").forEach((d) => { d.open = true; });
  });
})();
