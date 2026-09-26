/*
Fleet ETA Tracker — вкладка "Запреты" (справочная)
Версия: 1.34
  - ссылки на страницы запретов trafficban.com по дням (сегодня + 4 дня);
  - кнопки стран -> страница страны на trafficban.com (русская версия);
  - ниже — официальный плагин trafficban.com (templates/partials/trafficban_plugin.html).
Информация trafficban.com — справочная, ответственность за решения на её основе
сайт не несёт (их оговорка).
*/
(function () {
  const COUNTRIES = [
    ["AT", "austria", 14], ["BE", "belgium", 20], ["BG", "bulgaria", 32], ["CH", "switzerland", 181],
    ["CZ", "czech_republic", 41], ["DE", "germany", 135], ["DK", "denmark", 42], ["EE", "estonia", 50],
    ["ES", "spain", 75], ["FI", "finland", 55], ["FR", "france", 56], ["GB", "united_kingdom", 205],
    ["HR", "croatia", 37], ["HU", "hungary", 212], ["IT", "italy", 213], ["LI", "liechtenstein", 219],
    ["LT", "lithuania", 108], ["LU", "luxembourg", 109], ["LV", "latvia", 110], ["NL", "netherlands", 76],
    ["NO", "norway", 140], ["PL", "poland", 151], ["PT", "portugal", 153], ["RO", "romania", 157],
    ["SE", "sweden", 182], ["SI", "slovenia", 173], ["SK", "slovakia", 172],
  ];
  const DAYS_RU = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

  const daysEl = document.getElementById("bansDays");
  const cEl = document.getElementById("bansCountries");
  if (!daysEl || !cEl) return;

  const pad = (n) => String(n).padStart(2, "0");
  const today = new Date();
  for (let i = 0; i < 5; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
    const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const label = i === 0 ? "Сегодня" : i === 1 ? "Завтра" : DAYS_RU[d.getDay()];
    const a = document.createElement("a");
    a.className = "bans-day" + (d.getDay() === 0 || d.getDay() === 6 ? " bans-weekend" : "");
    a.href = `https://trafficban.com/${iso}`;
    a.target = "_blank";
    a.rel = "noopener";
    a.innerHTML = `<b>${label}</b><span>${pad(d.getDate())}.${pad(d.getMonth() + 1)}</span>`;
    daysEl.appendChild(a);
  }

  COUNTRIES.forEach(([code, slug, id]) => {
    const a = document.createElement("a");
    a.className = "pc-tab bans-country";
    a.href = `https://trafficban.com/country.${slug}.home.${id}.ru.html`;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = code;
    cEl.appendChild(a);
  });
})();
