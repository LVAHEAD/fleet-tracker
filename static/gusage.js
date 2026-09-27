/*
Fleet ETA Tracker — плашка-счётчик запросов к Google Routes (v1.51)
Месяц / 10 000 бесплатных (Cloud Monitoring), сегодня, прогноз, экономия кеша.
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
        `Прогноз на месяц: ~${fmt(d.forecast)}` + (over ? ` — сверх бесплатного ~${fmt(over)}` : " — в пределах бесплатного"),
        `Кеш сегодня сэкономил: ${fmt(d.cache_hits)} запросов`,
        "Клик — отчёт по оплате в Google Cloud",
      ].join("\n");
    } catch (e) {
      el.textContent = "G ?";
      el.classList.add("gu-err");
      el.title = "Счётчик Google: ошибка запроса";
    }
  }
  load();
  setInterval(load, 10 * 60 * 1000);
})();
