/* Вкладка «Рейтинг»: средние км за смену по каждому тягачу (по GPS, /api/mapon-check?shiftkm=1). */
(function () {
  const go = document.getElementById("rt-go");
  const out = document.getElementById("rt-out");
  const csv = document.getElementById("rt-csv");
  if (!go || !out) return;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const val = (id) => document.getElementById(id).value;
  const HINT = {
    crew: "Экипаж = трак, который ≥3 суток (и ≥25% рабочих суток) ехал дольше 10,5 ч — одиночке так нельзя. Считаем по GPS трака (Mapon route/list), паромы не в счёт; рабочие сутки — от «от» км, сутки по UTC, первые и последние сутки периода не берём. Рейтинг: средние км за рабочие сутки. Водители на траке могут меняться.",
    shift: "По GPS трака, не по водителю: смена = поездки между стоянками от «отдыха» часов. Неполные смены на краях периода не считаются. Паромы не в счёт.",
  };
  const mode = () => val("rt-mode");
  const applyMode = () => {
    const crew = mode() === "crew";
    document.getElementById("rt-min").value = crew ? 300 : 100;
    document.querySelectorAll(".rt-shift-only").forEach((e) => { e.hidden = crew; });
    document.getElementById("rt-hint").textContent = HINT[mode()] + " Расчёт по всем тягачам — до минуты.";
    out.innerHTML = '<div class="truckinfo-empty"><b>Рейтинг «быстрых» ' + (crew ? "экипажей" : "траков") + '</b><p>Нажми «Показать».</p></div>';
  };
  const qs = (extra) => "shiftkm=1&mode=" + mode() + "&days=" + encodeURIComponent(val("rt-days")) +
    "&rest_h=" + encodeURIComponent(val("rt-rest")) + "&min_km=" + encodeURIComponent(val("rt-min")) + (extra || "");
  const sync = () => { csv.href = "/api/mapon-check?" + qs("&format=csv"); };
  ["rt-days", "rt-rest", "rt-min"].forEach((id) => document.getElementById(id).addEventListener("change", sync));
  document.getElementById("rt-mode").addEventListener("change", () => { applyMode(); sync(); });
  applyMode();
  sync();

  function render(d) {
    const rows = d.rating || [];
    const crew = d.mode === "crew";
    if (!rows.length) {
      out.innerHTML = '<div class="truckinfo-empty">' + (crew ? "Экипажей не найдено: нет траков с ≥3 сутками вождения дольше 10,5 ч. Уменьши «от» км или возьми больший период."
        : "Смен не найдено — уменьши «от» км.") + "</div>";
      return;
    }
    const max = Math.max(...rows.map((r) => r.avg)) || 1;
    let h = `<div class="ti-hint">Тягачей: ${esc(d.trucks)}, в рейтинге: ${esc(d.in_rating)}</div>` +
      '<table class="ti-table rt-table"><tr><th>#</th><th>Трак</th><th>' + (crew ? "Суток" : "Смен") + '</th><th>' + (crew ? "Км / сутки" : "Км / смена") + '</th><th></th>' +
      '<th>Медиана</th><th>Макс</th><th>Км/ч</th><th>' + (crew ? "Ч / сутки" : "Ч / смена") + '</th>' + (crew ? '<th title="суток с вождением > 10,5 ч">&gt;10,5 ч</th>' : "") + '<th>Всего км</th></tr>';
    rows.forEach((r) => {
      h += `<tr><td>${r.n}</td><td><b>${esc(r.truck)}</b></td><td>${r.shifts}</td><td><b>${r.avg}</b></td>` +
        `<td class="rt-bar"><i style="width:${Math.round(r.avg / max * 100)}%"></i></td>` +
        `<td>${r.median}</td><td>${r.max}</td><td>${r.speed == null ? "—" : r.speed}</td><td>${r.drive_h}</td>${crew ? `<td>${r.over}</td>` : ""}<td>${r.total}</td></tr>`;
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
