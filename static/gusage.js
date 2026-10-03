/*
Fleet ETA Tracker — плашка-счётчик запросов к Google Routes (v1.51)
Месяц / 10 000 бесплатных (Cloud Monitoring), сегодня, прогноз, экономия кеша.
v3.13: разбивка за сутки — что и кто дёрнул Google (общие счётчики всех процессов).
Обновление раз в 10 минут. Клик — отчёт по оплате в Google Cloud.
*/
(function () {
  const el = document.getElementById("g-usage");
  if (!el) return;
  const fmt = (n) => (n == null ? "—" : Number(n).toLocaleString("ru-RU"));
  async function load() {
    try {
      const r = await fetch("/api/google-usage");
      const d = await r.json();
      el.classList.remove("gu-ok", "gu-warn", "gu-bad", "gu-err");
      if (d.month == null) {
        el.textContent = "G ?";
        el.classList.add("gu-err");
        el.title = "Счётчик Google недоступен: " + (d.error || "нет данных") +
          `\nНаш сервер сегодня: ${fmt(d.calls_local)} запросов, из кеша ${fmt(d.cache_hits)}`;
        return;
      }
      const pct = d.month / d.free;
      el.classList.add(pct < 0.7 ? "gu-ok" : pct < 1 ? "gu-warn" : "gu-bad");
      el.textContent = `G ${fmt(d.month)} / ${Math.round(d.free / 1000)}k`;
      const over = Math.max(0, (d.forecast || 0) - d.free);
      el.title = [
        "Запросы к Google Routes (маршруты)",
        `Месяц: ${fmt(d.month)} из ${fmt(d.free)} бесплатных`,
        `Сегодня (сутки Google): ${fmt(d.today)}`,
        `Прогноз на месяц (по суткам Google): ~${fmt(d.forecast)}` + (over ? ` — сверх бесплатного ~${fmt(over)}` : " — в пределах бесплатного"),
        ...ownForecast(d.forecast_own, d.free),
        `Кеш сегодня сэкономил: ${fmt(d.cache_hits)} запросов`,
        ...breakdown(d.stats),
        ...hourlyLines(d.hourly),
        "Клик — отчёт по оплате в Google Cloud",
      ].join("\n");
    } catch (e) {
      el.textContent = "G ?";
      el.classList.add("gu-err");
      el.title = "Счётчик Google: ошибка запроса";
    }
  }
  const WHY = { edit: "правка строки", all: "«Обновить всё» / загрузка", auto: "автообновление",
    sync: "чужие правки", route: "From → To", other: "прочее" };
  const KIND = { truck: "машина → точка", leg: "точка → точка", multi: "From → To" };
  // v3.13: сколько ушло в Google и сколько взято из кеша — по причинам, видам и людям
  function breakdown(st) {
    if (!st) return [];
    const out = [`Сегодня наш сервер: в Google ${fmt(st.c || 0)}, из кеша ${fmt(st.h || 0)}`];
    const part = (prefix, names, title) => {
      const items = Object.keys(st).filter((k) => k.startsWith(prefix) && st[k] > 0)
        .sort((a, b) => st[b] - st[a])
        .map((k) => { const n = k.slice(prefix.length); return `  ${names ? (names[n] || n) : n}: ${fmt(st[k])}`; });
      if (items.length) out.push(title, ...items);
    };
    part("c_why_", WHY, "В Google — почему:");
    part("c_kind_", KIND, "В Google — что:");
    part("c_user_", null, "В Google — кто:");
    return out;
  }
  // v3.15: прогноз по нашему темпу — запросы нашего сервера в Google за сегодняшние часы
  function ownForecast(f, free) {
    if (!f) return [];
    const over = Math.max(0, f.forecast - free);
    return [`Прогноз на месяц (по нашему темпу ${fmt(f.per_hour)}/ч за ${f.hours} ч): ~${fmt(f.forecast)}` +
      (over ? ` — сверх бесплатного ~${fmt(over)}` : " — в пределах бесплатного")];
  }
  // v3.15: почасовой лог (час по Риге; сутки Google начинаются в 10:00)
  function hourlyLines(h) {
    if (!h) return [];
    const order = Array.from({ length: 24 }, (_, i) => String((10 + i) % 24).padStart(2, "0"));
    const hrs = order.filter((k) => h[k]);
    if (!hrs.length) return [];
    const max = Math.max(1, ...hrs.map((k) => h[k].c || 0));
    return ["По часам (Рига) — в Google / из кеша:",
      ...hrs.map((k) => {
        const c = h[k].c || 0;
        const bar = c ? "▇".repeat(Math.max(1, Math.round((c / max) * 10))) : "·";
        return `  ${k}:00  ${bar} ${fmt(c)} / ${fmt(h[k].h || 0)}`;
      })];
  }
  load();
  setInterval(load, 10 * 60 * 1000);
})();
