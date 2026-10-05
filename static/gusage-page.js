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
  const KIND = { truck: "машина → точка", leg: "точка → точка", multi: "From → To", corridor: "выбор коридора" };
  let days = [];
  let sel = null;
  let texts = {};      // v3.26: тексты «Для Claude» по суткам — приходят вместе с данными страницы

  function parts(obj, names) {
    return Object.keys(obj || {}).sort((a, b) => obj[b] - obj[a])
      .map((k) => `${esc(names ? (names[k] || k) : k)} ${fmt(obj[k])}`).join(", ");
  }

  function diffCell(g, c) {
    if (g == null) return `<td class="num">—</td>`;
    const d = g - c;
    return `<td class="num gu-diff${d === 0 ? " zero" : ""}">${d > 0 ? "+" : ""}${fmt(d)}</td>`;
  }

  // v3.25: счёт Google по ключам, методам (если не только ComputeRoutes) и ошибкам
  function gBreak(d) {
    if (!d.g_keys) return d.g ? '<span class="gu-dim">нет разбивки</span>' : "";
    const out = [];
    if (Object.keys(d.g_keys).length) out.push(parts(d.g_keys));
    const m = d.g_methods || {};
    if (Object.keys(m).length > 1 || (Object.keys(m).length && !m.ComputeRoutes)) out.push("методы: " + parts(m));
    if (d.g_err && Object.keys(d.g_err).length) out.push(`<span class="gu-errs">ошибки: ${parts(d.g_err)}</span>`);
    else if (d.g) out.push('<span class="gu-dim">ошибок нет</span>');
    return out.join("<br>");
  }

  function renderDays() {
    const tb = $("guDays").querySelector("tbody");
    tb.innerHTML = days.map((d) => {
      const empty = !(d.c || d.h || d.g);
      return `<tr data-day="${d.day}" class="${d.day === sel ? "sel" : ""}${empty ? " empty" : ""}">
        <td>${d.label}${d.day === days[0].day ? " (сегодня)" : ""}</td>
        <td class="num">${fmt(d.g)}</td><td class="num">${fmt(d.c)}</td>${diffCell(d.g, d.c)}<td class="num">${fmt(d.h)}</td>
        <td class="gu-break">${parts(d.why, WHY)}</td><td class="gu-break">${parts(d.kind, KIND)}</td>
        <td class="gu-break">${parts(d.user)}</td><td class="gu-break">${gBreak(d)}</td></tr>`;
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
    tb.innerHTML = d.hours.map((x) => `<tr${x.now ? ' class="gu-now"' : ""}>
      <td>${x.hh}:00${x.now ? ' <span class="gu-dim" title="Google дописывает счёт с задержкой в несколько минут">идёт</span>' : ""}</td>
      <td class="num">${fmt(x.g)}${x.ge ? ` <span class="gu-errs" title="из них ошибок">(${fmt(x.ge)} ош.)</span>` : ""}</td>
      <td class="num">${fmt(x.c)}</td>${diffCell(x.g, x.c)}
      <td class="num">${fmt(x.h)}</td>
      <td><span class="gu-bar" style="width:${Math.round(((x.g != null ? x.g : x.c) || 0) / max * 160)}px" title="Google"></span>
        <span class="gu-bar h" style="width:${Math.round((x.h || 0) / maxH * 60)}px" title="из кеша"></span></td></tr>`).join("");
  }

  async function load(refresh) {
    try {
      const r = await fetch("/api/google-usage/log" + (refresh ? "?refresh=1" : ""));
      const d = await r.json();
      days = d.days || [];
      texts = d.texts || {};
      if (!sel || !days.some((x) => x.day === sel)) sel = d.today;
      const err = $("guErr");
      err.hidden = !d.google_error;
      err.textContent = d.google_error ? "Счёт Google недоступен: " + d.google_error : "";
      renderDays();
      renderHours();
    } catch (e) {
      $("guDays").querySelector("tbody").innerHTML = `<tr><td colspan="9" class="nbp-empty">Ошибка загрузки</td></tr>`;
    }
    try {
      const r = await fetch("/api/google-usage" + (refresh ? "?refresh=1" : ""));
      const u = await r.json();
      const fi = u.forecast_info;
      $("guMonth").textContent = u.month == null ? "Месяц: —"
        : `Месяц: ${fmt(u.month)} из ${fmt(u.free)} бесплатных · прогноз ~${fmt(u.forecast)}` +
          (fi ? ` (по ~${fmt(fi.per_day)}/сутки)` : "") +
          (fi && fi.left > 0 ? ` · осталось ${fmt(fi.left)} на ${fmt(Math.round(fi.days_left))} дн. → можно ~${fmt(fi.per_day_allowed)}/сутки` : "") +
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
  // «📋 Для Claude»: окно с выделенным текстом (если скопировать не дали) и запасное копирование через скрытое поле.
  function showText(text) {
    let box = $("guCopyBox");
    if (!box) {
      box = document.createElement("div");
      box.id = "guCopyBox";
      box.className = "gu-copybox";
      box.innerHTML = `<div class="gu-copyhead">Скопировать не удалось — текст выделен, нажмите Ctrl+C (⌘+C)
        <button type="button" class="gu-copyclose" title="Закрыть">×</button></div><textarea readonly></textarea>`;
      document.body.appendChild(box);
      box.querySelector(".gu-copyclose").addEventListener("click", () => { box.hidden = true; });
    }
    box.hidden = false;
    const ta = box.querySelector("textarea");
    ta.value = text;
    ta.focus();
    ta.select();
  }
  function copyFallback(text) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }
  // v3.26: кнопка копирует уже загруженный текст (пришёл вместе с таблицей) — без запроса в момент клика.
  // Текста нет (страница не догрузилась) — запрос, при ошибке — код ответа на кнопке и ссылка «открыть текст».
  function textUrl() { return "/api/google-usage/log?format=text&day=" + encodeURIComponent(sel || ""); }
  function showLink(msg) {
    let a = $("guTextLink");
    if (!a) {
      a = document.createElement("a");
      a.id = "guTextLink";
      a.className = "gu-textlink";
      a.target = "_blank";
      a.rel = "noopener";
      $("guClaude").after(a);
    }
    a.href = textUrl();
    a.textContent = "открыть текст";
    a.title = msg || "";
    a.hidden = false;
  }
  function copyNow(text) {
    // writeText — обычный путь; не дали — скрытое поле + copy; и это нет — окно с выделенным текстом
    return navigator.clipboard && navigator.clipboard.writeText
      ? navigator.clipboard.writeText(text).then(() => true, () => copyFallback(text))
      : Promise.resolve(copyFallback(text));
  }
  $("guClaude").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const was = "📋 Для Claude";
    const done = (msg, ms) => { btn.textContent = msg; setTimeout(() => { btn.textContent = was; }, ms || 1800); };
    let text = texts[sel];
    if (!text) {
      btn.textContent = "Загружаю…";
      try {
        const r = await fetch(textUrl(), { credentials: "same-origin", cache: "no-store" });
        if (!r.ok) throw new Error(`Ошибка ${r.status}${r.statusText ? " " + r.statusText : ""}`);
        text = await r.text();
      } catch (err) {
        console.error("«Для Claude»: текст не получен", err);
        done(`${err && err.message ? err.message : "Ошибка сети"}: текст не получен`, 4000);
        showLink(String(err && err.message || err));
        return;
      }
    }
    if (await copyNow(text)) done("✓ Скопировано");
    else { btn.textContent = was; showText(text); }
  });

  load(false);
  setInterval(() => { if (!document.hidden) load(false); }, 10 * 60 * 1000);
})();
