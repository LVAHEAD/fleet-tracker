/*
Fleet ETA Tracker — страница /gusage (v3.21): лог запросов к Google Routes.
По суткам Google (14 дней) и по часам Риги выбранных суток: сколько насчитал Google (Cloud Monitoring),
сколько отправил наш сервер, сколько взято из кеша; почему / что / кто. «📋 Для Claude» — то же текстом.
*/
(function () {
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => (n == null ? "—" : Number(n).toLocaleString("ru-RU"));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const WHY = { edit: "правка строки", all: "«Обновить всё» / загрузка", auto: "автообновление",
    sync: "чужие правки", route: "From → To", other: "прочее" };
  const KIND = { truck: "машина → точка", leg: "точка → точка", multi: "From → To" };
  let days = [];
  let sel = null;

  function parts(obj, names) {
    return Object.keys(obj || {}).sort((a, b) => obj[b] - obj[a])
      .map((k) => `${esc(names ? (names[k] || k) : k)} ${fmt(obj[k])}`).join(", ");
  }

  function diffCell(g, c) {
    if (g == null) return `<td class="num">—</td>`;
    const d = g - c;
    return `<td class="num gu-diff${d === 0 ? " zero" : ""}">${d > 0 ? "+" : ""}${fmt(d)}</td>`;
  }

  function renderDays() {
    const tb = $("guDays").querySelector("tbody");
    tb.innerHTML = days.map((d) => {
      const empty = !(d.c || d.h || d.g);
      return `<tr data-day="${d.day}" class="${d.day === sel ? "sel" : ""}${empty ? " empty" : ""}">
        <td>${d.label}${d.day === days[0].day ? " (сегодня)" : ""}</td>
        <td class="num">${fmt(d.g)}</td><td class="num">${fmt(d.c)}</td>${diffCell(d.g, d.c)}<td class="num">${fmt(d.h)}</td>
        <td class="gu-break">${parts(d.why, WHY)}</td><td class="gu-break">${parts(d.kind, KIND)}</td>
        <td class="gu-break">${parts(d.user)}</td></tr>`;
    }).join("");
  }

  function renderHours() {
    const d = days.find((x) => x.day === sel);
    $("guHoursTitle").textContent = d ? `По часам — ${d.label}` : "По часам";
    const tb = $("guHours").querySelector("tbody");
    if (!d || !d.hours.length) {
      tb.innerHTML = `<tr><td colspan="6" class="nbp-empty">За эти сутки данных по часам нет</td></tr>`;
      return;
    }
    const max = Math.max(1, ...d.hours.map((x) => Math.max(x.g || 0, x.c || 0)));
    const maxH = Math.max(1, ...d.hours.map((x) => x.h || 0));
    tb.innerHTML = d.hours.map((x) => `<tr>
      <td>${x.hh}:00</td><td class="num">${fmt(x.g)}</td><td class="num">${fmt(x.c)}</td>${diffCell(x.g, x.c)}
      <td class="num">${fmt(x.h)}</td>
      <td><span class="gu-bar" style="width:${Math.round(((x.g != null ? x.g : x.c) || 0) / max * 160)}px" title="Google"></span>
        <span class="gu-bar h" style="width:${Math.round((x.h || 0) / maxH * 60)}px" title="из кеша"></span></td></tr>`).join("");
  }

  async function load(refresh) {
    try {
      const r = await fetch("/api/google-usage/log" + (refresh ? "?refresh=1" : ""));
      const d = await r.json();
      days = d.days || [];
      if (!sel || !days.some((x) => x.day === sel)) sel = d.today;
      const err = $("guErr");
      err.hidden = !d.google_error;
      err.textContent = d.google_error ? "Счёт Google недоступен: " + d.google_error : "";
      renderDays();
      renderHours();
    } catch (e) {
      $("guDays").querySelector("tbody").innerHTML = `<tr><td colspan="8" class="nbp-empty">Ошибка загрузки</td></tr>`;
    }
    try {
      const r = await fetch("/api/google-usage" + (refresh ? "?refresh=1" : ""));
      const u = await r.json();
      $("guMonth").textContent = u.month == null ? "Месяц: —"
        : `Месяц: ${fmt(u.month)} из ${fmt(u.free)} бесплатных · прогноз по суткам Google ~${fmt(u.forecast)}` +
          (u.forecast_own ? ` · по нашему темпу ~${fmt(u.forecast_own.forecast)}` : "");
    } catch (e) { /* ignore */ }
  }

  $("guDays").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-day]");
    if (!tr) return;
    sel = tr.dataset.day;
    renderDays();
    renderHours();
  });
  $("guRefresh").addEventListener("click", () => load(true));
  $("guClaude").addEventListener("click", async (e) => {
    const btn = e.target;
    const was = btn.textContent;
    try {
      const r = await fetch("/api/google-usage/log?format=text&day=" + encodeURIComponent(sel || ""));
      await navigator.clipboard.writeText(await r.text());
      btn.textContent = "✓ Скопировано";
    } catch (err) {
      btn.textContent = "Не удалось скопировать";
    }
    setTimeout(() => { btn.textContent = was; }, 1800);
  });

  load(false);
  setInterval(() => { if (!document.hidden) load(false); }, 10 * 60 * 1000);
})();
