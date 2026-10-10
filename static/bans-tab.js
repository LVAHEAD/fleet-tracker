/*
Fleet ETA Tracker — вкладка "Запреты" (справочная)
Версия: 1.84 — последние удачные данные хранятся в браузере (показ при 429 на сервере),
  "нет данных по: …" для недокачанных стран.
Ранее 1.38 — отметка "данные от …", мягкий показ ошибки при последних удачных данных.
Ранее 1.37 — только наши страны (фильтр на сервере), русские ссылки nakordoni, без trafficban.
Ранее 1.36 — данные nakordoni.eu через /api/bans (кеш на сервере 30 мин):
  - "Сейчас действует" — плашки стран с часами;
  - календарь на 8 дней: полные запреты (Sunday/Holiday/General) — красные,
    частичные (Local/Seasonal) — бледные; подробности при наведении, клик — страница страны;
  - страны, где сейчас машины Флота или их таргеты, подсвечены рамкой;
  - запреты только для ADR скрыты на сервере.
Ранее 1.34–1.35: ссылки и виджет trafficban.com (ссылки оставлены внизу как запасной источник).
*/
(function () {
  const nowEl = document.getElementById("bansNow");
  const calEl = document.getElementById("bansCalendar");
  const btn = document.getElementById("bansRefresh");
  if (!nowEl || !calEl) return;

  const DAYS = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
  const TYPE_RU = { Sunday: "воскресный", Holiday: "праздничный", General: "общий", Local: "местный", Seasonal: "сезонный" };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pad = (n) => String(n).padStart(2, "0");

  // v1.37: плашки ведут на русские страницы стран nakordoni.eu
  const NK_SLUG = {
    AT: "austria", BE: "belgium", DE: "germany", DK: "denmark", EE: "estonia", ES: "spain",
    FI: "finland", FR: "france", IT: "italy", LT: "lithuania", LU: "luxembourg", LV: "latvia",
    NL: "netherlands", NO: "norway", PL: "poland", PT: "portugal", SE: "sweden",
  };
  const ruUrl = (b) => NK_SLUG[b.cc]
    ? `https://nakordoni.eu/ru/for_truck_drivers/traffic_bans/${NK_SLUG[b.cc]}` : (b.url || "#");

  function ourCountries() {
    const set = new Set();
    Object.values(window.fleetCountries || {}).forEach((arr) => arr.forEach((c) => set.add(c)));
    return set;
  }

  function hours(b) {
    if (b.from === "00:00" && (b.until === "23:59" || b.until === "24:00")) return "весь день";
    return `${b.from}–${b.until}`;
  }

  function chip(b, ours, showHours) {
    const tip = [
      `${b.country || b.cc} · ${TYPE_RU[b.type] || b.type || ""} · ${hours(b)}`,
      b.details, b.min_weight ? `от ${b.min_weight} т` : "",
    ].filter(Boolean).join("\n");
    const cls = `ban-chip ${b.full ? "ban-full" : "ban-part"}${ours.has(b.cc) ? " ban-ours" : ""}`;
    const h = showHours ? `<small>${esc(hours(b))}</small>` : "";
    return `<a class="${cls}" href="${esc(ruUrl(b))}" target="_blank" rel="noopener" title="${esc(tip)}">${esc(b.cc)}${h}</a>`;
  }

  // на день — по одной плашке на страну (если запретов несколько, берём "самый полный")
  function perCountry(bans) {
    const m = new Map();
    bans.forEach((b) => {
      const cur = m.get(b.cc);
      if (!cur) m.set(b.cc, { ...b, extra: [] });
      else {
        cur.extra.push(b);
        if (b.full && !cur.full) m.set(b.cc, { ...b, extra: [cur, ...cur.extra] });
      }
    });
    return [...m.values()].map((b) => {
      if (b.extra && b.extra.length) {
        b = { ...b, details: [b.details].concat(b.extra.map((x) => `${hours(x)} ${x.details || ""}`)).filter(Boolean).join("\n") };
      }
      return b;
    }).sort((a, b) => (b.full - a.full) || a.cc.localeCompare(b.cc));
  }

  function render(d) {
    const ours = ourCountries();
    const now = perCountry(d.now || []);
    nowEl.innerHTML = `<span class="bans-now-label">Сейчас действует:</span> `
      + (now.length ? now.map((b) => chip(b, ours, true)).join(" ") : "<span class=\"muted\">нет</span>");

    // все дни окна (8 дней), включая дни без запретов
    const byDate = {};
    (d.days || []).forEach((x) => { byDate[x.date] = x.bans; });
    let dates = Object.keys(byDate).sort();
    if (d.window && d.window.from && d.window.to) {
      dates = [];
      for (let t = new Date(d.window.from + "T12:00:00"); t <= new Date(d.window.to + "T12:00:00"); t.setDate(t.getDate() + 1)) {
        dates.push(`${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`);
      }
    }
    const rows = dates.map((date) => ({ date, bans: byDate[date] || [] })).map((day) => {
      const dt = new Date(day.date + "T12:00:00");
      const wk = dt.getDay() === 0 || dt.getDay() === 6;
      const label = `${DAYS[dt.getDay()]} ${pad(dt.getDate())}.${pad(dt.getMonth() + 1)}`;
      const chips = perCountry(day.bans).map((b) => chip(b, ours, b.full)).join(" ");
      return `<div class="bans-day-row${wk ? " weekend" : ""}"><span class="bans-day-label">${label}</span><div class="bans-day-chips">${chips || '<span class="muted">—</span>'}</div></div>`;
    }).join("");
    calEl.innerHTML = rows || '<div class="muted">Нет данных</div>';
    const when = d.loaded_at ? `данные от ${esc(d.loaded_at)}` : "";
    calEl.innerHTML += d.error
      ? `<div class="bans-err">Обновление не удалось (${esc(d.error)}) — показаны ${when || "прошлые данные"}</div>`
      : (when ? `<div class="bans-when">${when}</div>` : "");
  }

  // v1.84: последние удачные данные — в браузере (после деплоя у сервера кеш пустой)
  const LS_KEY = "fleet.bans.last";
  function saveLast(d) {
    try { if (d && d.days && !(d.missing && d.missing.length)) localStorage.setItem(LS_KEY, JSON.stringify(d)); } catch (e) {}
  }
  function readLast() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || "null"); } catch (e) { return null; }
  }

  async function load(refresh) {
    let d = null, err = null;
    try {
      const res = await fetch("/api/bans" + (refresh ? "?refresh=1" : ""));
      d = await res.json();
      if (d.error && !d.days) { err = d.error; d = null; }
    } catch (e) {
      err = "Не удалось загрузить запреты";
    }
    if (d) {
      saveLast(d);
      // сервер отдал частичные данные — дополняем недостающие страны из браузера
      const last = readLast();
      if (d.missing && d.missing.length && last && last.days) {
        const miss = new Set(d.missing);
        const pick = (arr) => (arr || []).filter((b) => miss.has(b.cc));
        const byDate = {};
        (d.days || []).forEach((x) => { byDate[x.date] = x.bans.slice(); });
        last.days.forEach((x) => { if (byDate[x.date]) byDate[x.date].push(...pick(x.bans)); });
        d = { ...d, now: (d.now || []).concat(pick(last.now)),
              days: Object.keys(byDate).sort().map((k) => ({ date: k, bans: byDate[k] })) };
      }
      render(d);
      return;
    }
    const last = readLast();
    if (last) {
      render({ ...last, error: err, loaded_at: last.loaded_at ? `${last.loaded_at} (сохранено в браузере)` : null });
    } else {
      nowEl.innerHTML = `<span class="bans-err">${esc(err)}</span>`;
    }
  }

  let loaded = false;
  // v3.54: вкладка переехала в левую выезжалку — грузим при каждом открытии панели
  window.addEventListener("left-panel:open", () => { load(false); loaded = true; });
  if (btn) btn.addEventListener("click", async () => {
    btn.disabled = true; btn.textContent = "Обновляю…";
    await load(true);
    btn.disabled = false; btn.textContent = "↻ Обновить";
  });
})();
