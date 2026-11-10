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
      h += `<div class="ti-deadline">Следующий недельный — не позже <b>${esc(d.deadline)}</b>
        (через ${esc(d.deadline_in)}), нужен <b>${esc(d.need)}</b>` +
        (d.mapon_weekly ? `<span class="ti-mapon">Mapon: ${esc(d.mapon_weekly)}</span>` : "") + `</div>`;
    }
    if (d.weekly_error) h += `<div class="ti-err">${esc(d.weekly_error)}</div>`;
    if (d.weekly && d.weekly.length) {
      h += `<table class="ti-table"><tr><th>Недельный отдых</th><th>часов</th><th></th></tr>` +
        d.weekly.map((w) => `<tr>
          <td>${esc(w.from)} → ${esc(w.to)}</td><td>${esc(w.hours)}</td>
          <td>${w.daily ? '<span class="ti-tag" title="второй отдых от 24 ч в неделе — считаем суточным">большая 9ка</span>' : w.full ? '<span class="ti-tag ti-full">45+</span>' : '<span class="ti-tag ti-red">сокращ.</span>'}
              ${w.nocard ? '<span class="ti-tag" title="часть отдыха без карты — данные с CAN">без карты</span>' : ""}</td>
        </tr>`).join("") + `</table>`;
    }
    if (d.comp && d.comp.length) {
      const CST = { ok: ["ti-full", "компенсирован"], open: ["ti-red", "нужно добрать"], overdue: ["ti-red", "просрочено"] };
      h += `<table class="ti-table"><tr><th>Компенсация сокращённого отдыха</th><th>недобор</th><th>осталось</th><th></th></tr>` +
        d.comp.slice().reverse().map((c) => `<tr>
          <td>${esc(c.from)} → ${esc(c.to)} (${esc(c.hours)})</td><td>${esc(c.deficit)}</td>
          <td>${c.left ? "<b>" + esc(c.left) + "</b> до " + esc(c.deadline) : "—"}</td>
          <td><span class="ti-tag ${CST[c.status][0]}">${CST[c.status][1]}</span></td></tr>`).join("") +
        `</table><div class="ti-note">Недобор добирают отдыхом не короче 9 ч до конца третьей недели после сокращения; считаем за ${28} дн. истории.</div>`;
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
    if (d.history_error) return `<div class="ti-err">История: ${esc(d.history_error)}</div>`;
    if (!d.history || !d.history.length) return "";
    const ev = (d.history_cards || []).map((c) => ({ at: c.at, card: c.what === "CARD_INSERTED" ? "вставил карту" : "вынул карту" }));
    const rows = d.history.map((g) => ({ at: g.from, g }));
    // события карты — отдельными строками по времени начала (формат «дд.мм чч:мм» сортируется по датам внутри периода)
    const key = (s) => s.slice(3, 5) + s.slice(0, 2) + s.slice(6);
    const all = rows.concat(ev).sort((a, b) => (key(b.at) > key(a.at) ? 1 : key(b.at) < key(a.at) ? -1 : 0));
    return `<details class="ti-hist-d"><summary>История водителя</summary><table class="ti-table ti-hist">` + all.map((r) => {
      if (r.card) return `<tr class="ti-h-card"><td>${esc(r.at)}</td><td colspan="3">${esc(r.card)}</td></tr>`;
      const g = r.g, a = ACT[g.status] || [g.status, ""];
      const nocard = (g.src || []).some((s) => s === "can" || s === "unkn");
      return `<tr class="${a[1]}"><td>${esc(g.from)} → ${esc(g.to)}</td><td><span class="ti-tag ${a[1]}">${esc(a[0])}</span></td>
        <td>${esc(g.hours)}</td><td>${nocard ? '<span class="ti-tag" title="данные с CAN, карты не было">без карты</span>' : ""}</td></tr>`;
    }).join("") + `</table></details>`;
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

  async function load() {
    const q = inp.value.trim();
    if (!q) return;
    out.innerHTML = `<div class="ti-loading">Загрузка…</div>`;
    try {
      const days = (document.getElementById("ti-days") || {}).value || 3;
      const r = await fetch(`/api/truck-info?unit=${encodeURIComponent(q)}&days=${encodeURIComponent(days)}`);
      const j = await r.json();
      if (r.status === 404) return searchDrivers(q);      // не номер трака — ищем водителя по имени
      if (!r.ok || j.error) throw new Error(j.error || r.status);
      // v3.302: карта Флота — на машину / прицеп, зум 9 (закрытая панель выезжает сама)
      if (typeof showUnitOnMap === "function" && typeof j.lat === "number" && typeof j.lng === "number") showUnitOnMap(j.lat, j.lng, 9);
      let h = `<div class="ti-title">${esc(j.number)}</div>`;
      if (j.trailer) {   // v3.258: прицеп — вместо водителей лог рефа
        out.innerHTML = h + `<div class="rl-card" id="ti-reefer"><div class="ti-loading">Реф: загрузка…</div></div>`;
        return loadReefer(q, days);
      }
      if (j.tacho_error) h += `<div class="ti-err">Тахограф: ${esc(j.tacho_error)}</div>`;
      h += `<div class="ti-drivers">${(j.drivers || []).map(driverHtml).join("")}</div>`;
      if (j.stops && j.stops.length) {
        h += `<table class="ti-table ti-stops"><tr><th colspan="3">Стоянки от 2 ч за 3 суток</th></tr>` +
          j.stops.slice().reverse().map((s) => `<tr><td>${esc(s.from)} → ${esc(s.to)}</td>
            <td>${esc(s.hours)}</td><td>${esc(s.address || "")}</td></tr>`).join("") + `</table>`;
      } else if (j.stops_error) {
        h += `<div class="ti-err">Стоянки: ${esc(j.stops_error)}</div>`;
      }
      out.innerHTML = h;
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
    const units = [];
    for (const u of (typeof unitsCache !== "undefined" && unitsCache) || []) {
      if (ptsNorm(u.number).replace(/\s/g, "").includes(t)) { units.push({ v: u.number, l: u.kind === "trailer" ? "прицеп" : "машина" }); if (units.length >= 40) break; }
    }
    optsOf(units, []);
    if (t.length < 2) return;
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
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") load(); });
  inp.addEventListener("change", load);
  const dsel = document.getElementById("ti-days");
  if (dsel) dsel.addEventListener("change", () => { if (inp.value.trim()) load(); });
})();
