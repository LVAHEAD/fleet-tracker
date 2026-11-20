/* Вкладка «Рейтинг»: средние км за смену по каждому тягачу (по GPS, /api/mapon-check?shiftkm=1). */
(function () {
  const go = document.getElementById("rt-go");
  const out = document.getElementById("rt-out");
  const csv = document.getElementById("rt-csv");
  if (!go || !out) return;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const val = (id) => document.getElementById(id).value;
  const qs = (extra) => "shiftkm=1&days=" + encodeURIComponent(val("rt-days")) +
    "&rest_h=" + encodeURIComponent(val("rt-rest")) + "&min_km=" + encodeURIComponent(val("rt-min")) + (extra || "");
  const sync = () => { csv.href = "/api/mapon-check?" + qs("&format=csv"); };
  ["rt-days", "rt-rest", "rt-min"].forEach((id) => document.getElementById(id).addEventListener("change", sync));
  sync();

  function render(d) {
    const rows = d.rating || [];
    if (!rows.length) { out.innerHTML = '<div class="truckinfo-empty">Смен не найдено — уменьши «смена от» км.</div>'; return; }
    const max = Math.max(...rows.map((r) => r.avg)) || 1;
    let h = `<div class="ti-hint">Тягачей: ${esc(d.trucks)}, в рейтинге: ${esc(d.in_rating)}</div>` +
      '<table class="ti-table rt-table"><tr><th>#</th><th>Трак</th><th>Смен</th><th>Км / смена</th><th></th>' +
      '<th>Медиана</th><th>Макс</th><th>Км/ч</th><th>Ч / смена</th><th>Всего км</th></tr>';
    rows.forEach((r) => {
      h += `<tr><td>${r.n}</td><td><b>${esc(r.truck)}</b></td><td>${r.shifts}</td><td><b>${r.avg}</b></td>` +
        `<td class="rt-bar"><i style="width:${Math.round(r.avg / max * 100)}%"></i></td>` +
        `<td>${r.median}</td><td>${r.max}</td><td>${r.speed == null ? "—" : r.speed}</td><td>${r.drive_h}</td><td>${r.total}</td></tr>`;
    });
    h += "</table>";
    const errs = Object.keys(d.errors || {});
    if (errs.length) h += `<div class="ti-err">Не удалось загрузить: ${errs.map(esc).join(", ")}</div>`;
    out.innerHTML = h;
  }

  go.addEventListener("click", async () => {
    sync();
    go.disabled = true;
    out.innerHTML = '<div class="truckinfo-empty">Считаю… (по всем тягачам, до минуты)</div>';
    try {
      const r = await fetch("/api/mapon-check?" + qs());
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || ("HTTP " + r.status));
      render(d);
    } catch (e) {
      out.innerHTML = `<div class="ti-err">Ошибка: ${esc(e.message)}</div>`;
    } finally { go.disabled = false; }
  });
})();
