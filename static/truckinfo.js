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
    return h + `</div>`;
  }

  async function load() {
    const q = inp.value.trim();
    if (!q) return;
    out.innerHTML = `<div class="ti-loading">Загрузка…</div>`;
    try {
      const r = await fetch(`/api/truck-info?unit=${encodeURIComponent(q)}`);
      const j = await r.json();
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
})();
