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
        d.weekly.slice().reverse().map((w) => `<tr>
          <td>${esc(w.from)} → ${esc(w.to)}</td><td>${esc(w.hours)}</td>
          <td>${w.full ? '<span class="ti-tag ti-full">45+</span>' : '<span class="ti-tag ti-red">сокращ.</span>'}
              ${w.nocard ? '<span class="ti-tag" title="часть отдыха без карты — данные с CAN">без карты</span>' : ""}</td>
        </tr>`).join("") + `</table>`;
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
    return `<table class="ti-table ti-hist"><tr><th colspan="4">История водителя</th></tr>` + all.map((r) => {
      if (r.card) return `<tr class="ti-h-card"><td>${esc(r.at)}</td><td colspan="3">${esc(r.card)}</td></tr>`;
      const g = r.g, a = ACT[g.status] || [g.status, ""];
      const nocard = (g.src || []).some((s) => s === "can" || s === "unkn");
      return `<tr class="${a[1]}"><td>${esc(g.from)} → ${esc(g.to)}</td><td><span class="ti-tag ${a[1]}">${esc(a[0])}</span></td>
        <td>${esc(g.hours)}</td><td>${nocard ? '<span class="ti-tag" title="данные с CAN, карты не было">без карты</span>' : ""}</td></tr>`;
    }).join("") + `</table>`;
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
      let h = `<div class="ti-title">${esc(j.number)}</div>`;
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
  btn.addEventListener("click", load);
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") load(); });
  inp.addEventListener("change", load);
  const dsel = document.getElementById("ti-days");
  if (dsel) dsel.addEventListener("change", () => { if (inp.value.trim()) load(); });
})();
