/*
Fleet ETA Tracker — вкладка "Карты стран"
Версия: 1.26 (добавлены FI, EE, LV, LT, RO, BG, LU)

Карты почтовых зон (2-значный код индекса, как в кодах BE10, NO01, SE25).
Не зависит от Google Maps — обычные картинки (Wikimedia Commons или свои,
из static/postcode-maps/, когда внешний источник ненадёжен/недоступен напрямую).
Добавить страну: новая строка в массиве PC_MAPS ниже.
*/

const PC_MAPS = [
  { code: "IT", name: "Италия",     url: "https://upload.wikimedia.org/wikipedia/commons/b/b0/2_digit_postcode_italy.png" },
  { code: "FR", name: "Франция",    url: "https://upload.wikimedia.org/wikipedia/commons/e/ef/2_digit_postcode_france.png" },
  { code: "DE", name: "Германия",   url: "https://upload.wikimedia.org/wikipedia/commons/8/88/German_postcode_information.png" },
  { code: "PL", name: "Польша",     url: "https://upload.wikimedia.org/wikipedia/commons/8/82/2_digit_postcode_poland.png" },
  { code: "NL", name: "Нидерланды", url: "https://upload.wikimedia.org/wikipedia/commons/5/51/2_digit_postcode_netherlands.png" },
  { code: "BE", name: "Бельгия",    url: "https://upload.wikimedia.org/wikipedia/commons/9/96/2_digit_postcode_belgique.png" },
  { code: "DK", name: "Дания",      url: "https://upload.wikimedia.org/wikipedia/commons/c/c8/2_digit_postcode_danmark.png" },
  { code: "SE", name: "Швеция",     url: "https://upload.wikimedia.org/wikipedia/commons/e/ee/2_digit_postcode_sweden.png" },
  // Норвегия: карты в этой серии на Wikimedia нет. Когда найдётся, вставьте ссылку в url — таблица заменится картой.
  { code: "NO", name: "Норвегия",   url: null,
    source: "https://en.wikipedia.org/wiki/Postal_codes_in_Norway",
    zones: [
      ["00–12", "Oslo"], ["13–14", "Akershus"], ["15–18", "Østfold"], ["19–21", "Akershus"],
      ["21–29", "Innlandet"], ["30", "Buskerud"], ["30–32", "Vestfold"], ["33–36", "Buskerud"],
      ["36–39", "Telemark"], ["40–44", "Rogaland"], ["44–49", "Agder"], ["50–55", "Vestland"],
      ["55", "Rogaland"], ["56–59", "Vestland"], ["60–66", "Møre og Romsdal"], ["67–69", "Vestland"],
      ["70–79", "Trøndelag"], ["79–89", "Nordland"], ["84", "Nordland и Troms"],
      ["90–94", "Troms"], ["94", "Nordland и Troms"], ["95–99", "Finnmark"]
    ] },
  { code: "ES", name: "Испания",    url: "https://upload.wikimedia.org/wikipedia/commons/5/5c/2_digit_postcode_spain.png" },
  { code: "PT", name: "Португалия", url: "https://upload.wikimedia.org/wikipedia/commons/7/79/2_digit_postcode_portugal.png" },
  { code: "AT", name: "Австрия",    url: "https://upload.wikimedia.org/wikipedia/commons/0/0f/2_digit_postcode_austria.png" },
  { code: "SK", name: "Словакия",   url: "/static/postcode-maps/sk.png" },
  { code: "HU", name: "Венгрия",    url: "/static/postcode-maps/hu.webp" },
  { code: "CZ", name: "Чехия",      url: "/static/postcode-maps/cz.png" },
  // v1.26: Прибалтика, Финляндия, Балканы, Люксембург (Wikimedia Commons, серия GfK "2 digit postcode")
  { code: "FI", name: "Финляндия",  url: "https://upload.wikimedia.org/wikipedia/commons/f/f6/2_digit_postcode_finland.png" },
  { code: "EE", name: "Эстония",    url: "https://upload.wikimedia.org/wikipedia/commons/f/f7/2_digit_postcode_estonia.png" },
  { code: "LV", name: "Латвия",     url: "https://upload.wikimedia.org/wikipedia/commons/a/ac/2_digit_postcode_latvia.png" },
  { code: "LT", name: "Литва",      url: "https://upload.wikimedia.org/wikipedia/commons/2/25/2_digit_postcode_lithuania.png" },
  { code: "RO", name: "Румыния",    url: "https://upload.wikimedia.org/wikipedia/commons/3/37/2_digit_postcode_romania.png" },
  { code: "BG", name: "Болгария",   url: "https://upload.wikimedia.org/wikipedia/commons/b/b7/2_digit_postcode_bulgaria.png" },
  // Люксембург: индексы 4-значные, регион задаёт первая цифра — карта другого стиля (2025)
  { code: "LU", name: "Люксембург", url: "https://upload.wikimedia.org/wikipedia/commons/e/ef/2_digit_postcode_luxembourg.svg" }
];

PC_MAPS.sort((a, b) => a.code.localeCompare(b.code));

const pcTabsEl = document.getElementById("pcTabs");
const pcImg = document.getElementById("pcImg");
const pcViewer = document.getElementById("pcViewer");
const pcStatusEl = document.getElementById("pcStatus");
const pcZonesEl = document.getElementById("pcZones");
const pcTitleEl = document.getElementById("pcTitle");
const pcZoomBtn = document.getElementById("pcZoomBtn");
const pcOrigLink = document.getElementById("pcOrigLink");
let pcCurrent = 0;

PC_MAPS.forEach((m, i) => {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "pc-tab";
  b.setAttribute("role", "tab");
  b.title = m.name;
  b.textContent = m.code;
  b.addEventListener("click", () => pcShow(i));
  pcTabsEl.appendChild(b);
});

function pcSetZoom(on) {
  pcViewer.classList.toggle("pc-zoomed", on);
  pcZoomBtn.textContent = on ? "Вписать в экран" : "Увеличить";
}

function pcShow(i) {
  pcCurrent = i;
  const m = PC_MAPS[i];
  [...pcTabsEl.children].forEach((t, j) => {
    t.setAttribute("aria-selected", j === i);
    t.tabIndex = j === i ? 0 : -1;
  });
  pcTabsEl.children[i].scrollIntoView({ block: "nearest", inline: "nearest" });
  pcTitleEl.textContent = `${m.name} (${m.code})`;
  pcOrigLink.href = m.url;
  pcImg.alt = `Карта почтовых зон: ${m.name}`;
  pcSetZoom(false);
  pcZonesEl.hidden = true;
  if (!m.url) {
    pcImg.hidden = true;
    pcImg.removeAttribute("src");
    pcStatusEl.hidden = true;
    pcZoomBtn.hidden = true;
    pcOrigLink.href = m.source;
    pcOrigLink.textContent = "Источник";
    pcZonesEl.innerHTML =
      `<p class="pc-zones-note">Карты пока нет. Зоны по первым двум цифрам индекса:</p>` +
      `<table><thead><tr><th>Зона</th><th>Регион (фюльке)</th></tr></thead><tbody>` +
      m.zones.map(([z, r]) => `<tr><td>${z}</td><td>${r}</td></tr>`).join("") +
      `</tbody></table>`;
    pcZonesEl.hidden = false;
    return;
  }
  pcZoomBtn.hidden = false;
  pcOrigLink.textContent = "Открыть оригинал";
  pcStatusEl.hidden = false;
  pcStatusEl.textContent = "Загрузка карты…";
  pcImg.hidden = true;
  pcImg.src = m.url;
}

pcImg.addEventListener("load", () => { pcStatusEl.hidden = true; pcImg.hidden = false; });
pcImg.addEventListener("error", () => {
  pcImg.hidden = true;
  pcStatusEl.hidden = false;
  pcStatusEl.textContent = "Карта не загрузилась. Проверьте интернет или откройте оригинал по ссылке выше. "
    + "Если карты нет в источнике — свою картинку можно положить в static/postcode-maps/ и указать её в PC_MAPS.";
});

pcImg.addEventListener("click", () => pcSetZoom(!pcViewer.classList.contains("pc-zoomed")));
pcZoomBtn.addEventListener("click", () => pcSetZoom(!pcViewer.classList.contains("pc-zoomed")));

pcTabsEl.addEventListener("keydown", (e) => {
  const next = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
  if (next) {
    const n = (pcCurrent + next + PC_MAPS.length) % PC_MAPS.length;
    pcShow(n);
    pcTabsEl.children[n].focus();
    e.preventDefault();
  }
});

pcShow(0);
