/*
Fleet ETA Tracker — Локатор (вкладка "Карты стран")
Версия: 1.24

Кнопка "Локатор" вместо картинки страны показывает интерактивную Google-карту
Европы со всеми кодами регионов (GET /api/region-codes):
  - точки раскрашены по странам, подписи кодов появляются при приближении;
  - клик по точке — код, место, координаты и кнопка "копировать";
  - поле ввода принимает код / город / GPS / машину (POST /api/locate):
    карта летит к точке, показывается ближайший код региона.
Точки — центры почтовых зон (границ в данных нет), поэтому у границ зон
"ближайший код" может оказаться соседним.
*/

(function () {
  const COUNTRY_COLORS = {
    BE: "#E4572E", CZ: "#17BEBB", DE: "#2E86AB", DK: "#C1292E", ES: "#F18F01",
    FI: "#6A4C93", FR: "#1B4965", IT: "#3BB273", LV: "#8D6A9F", NL: "#FF7F11",
    NO: "#D1495B", PL: "#EDAE49", PT: "#00798C", SE: "#3066BE", SK: "#9C6644",
  };
  const LABEL_ZOOM = 7; // с этого масштаба показываем подписи кодов

  const btn = document.getElementById("locatorBtn");
  const input = document.getElementById("locatorInput");
  const view = document.getElementById("locatorView");
  const info = document.getElementById("locatorInfo");
  const pcMain = document.getElementById("pcMain");
  const pcTabs = document.getElementById("pcTabs");
  if (!btn || !view) return;

  let map = null;
  let infoWindow = null;
  let codeMarkers = {}; // code -> Marker
  let labelsOn = false;
  let resultMarker = null;
  let pendingQuery = null;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function showLocator() {
    view.hidden = false;
    pcMain.hidden = true;
    btn.classList.add("active");
    [...pcTabs.children].forEach((t) => t.setAttribute("aria-selected", "false"));
    if (!map) window.whenGoogleMaps(initLocatorMap);
    else google.maps.event.trigger(map, "resize");
  }

  function hideLocator() {
    view.hidden = true;
    pcMain.hidden = false;
    btn.classList.remove("active");
  }

  function dotIcon(code, big) {
    return {
      path: google.maps.SymbolPath.CIRCLE,
      scale: big ? 8 : 4.5,
      fillColor: COUNTRY_COLORS[code.slice(0, 2)] || "#555",
      fillOpacity: 0.9,
      strokeColor: "#fff",
      strokeWeight: big ? 2 : 1,
      labelOrigin: new google.maps.Point(0, -3.2),
    };
  }

  function codeLabel(code) {
    return { text: code, fontSize: "10px", fontWeight: "600", color: "#222" };
  }

  function iwHtml(c) {
    const coords = `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`;
    return `<div class="loc-iw">
      <div class="loc-code">${esc(c.code)}</div>
      <div>${esc(c.place)}</div>
      <div>${coords}</div>
      <button type="button" data-copy="${esc(c.code)}">копировать код</button>
      <button type="button" data-copy="${coords}">копировать GPS</button>
    </div>`;
  }

  function openCodeInfo(c) {
    infoWindow.setContent(iwHtml(c));
    infoWindow.open({ map, anchor: codeMarkers[c.code] });
  }

  async function initLocatorMap() {
    map = new google.maps.Map(document.getElementById("locatorMap"), {
      center: { lat: 52, lng: 10 },
      zoom: 4,
      streetViewControl: false,
    });
    infoWindow = new google.maps.InfoWindow();

    // "копировать" внутри InfoWindow
    document.getElementById("locatorMap").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-copy]");
      if (!b) return;
      const text = b.dataset.copy;
      const done = () => { b.textContent = "скопировано ✓"; };
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, () => {});
    });

    try {
      const res = await fetch("/api/region-codes");
      const data = await res.json();
      (data.codes || []).forEach((c) => {
        const m = new google.maps.Marker({
          position: { lat: c.lat, lng: c.lng },
          map: map,
          icon: dotIcon(c.code, false),
          title: `${c.code} — ${c.place}`,
          optimized: true,
        });
        m._code = c;
        m.addListener("click", () => openCodeInfo(c));
        codeMarkers[c.code] = m;
      });
    } catch (e) {
      info.innerHTML = `<span class="loc-err">Не удалось загрузить коды регионов.</span>`;
    }

    map.addListener("zoom_changed", () => {
      const want = map.getZoom() >= LABEL_ZOOM;
      if (want === labelsOn) return;
      labelsOn = want;
      Object.values(codeMarkers).forEach((m) => m.setLabel(want ? codeLabel(m._code.code) : null));
    });

    if (pendingQuery) {
      const q = pendingQuery;
      pendingQuery = null;
      locate(q);
    }
  }

  async function locate(q) {
    if (!map) { pendingQuery = q; return; }
    info.textContent = "Ищу…";
    try {
      const res = await fetch("/api/locate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q }),
      });
      const d = await res.json();
      if (d.error) {
        info.innerHTML = `<span class="loc-err">${esc(d.error)}</span>`;
        return;
      }

      if (resultMarker) resultMarker.setMap(null);
      resultMarker = null;
      const codeM = codeMarkers[d.code];

      if (d.is_code) {
        info.innerHTML = `<b>${esc(d.code)}</b> — ${esc(d.code_place)}`;
      } else {
        resultMarker = new google.maps.Marker({
          position: { lat: d.lat, lng: d.lng },
          map: map,
          title: d.label,
          zIndex: 1000,
          label: d.is_truck ? { text: "🚚", fontSize: "16px" } : null,
        });
        info.innerHTML = `${esc(d.label)} &nbsp;→&nbsp; ближайший код <b>${esc(d.code)}</b> — ${esc(d.code_place)}`
          + ` <span style="color:#888">(${d.dist_km} км до центра зоны)</span>`;
      }

      map.setZoom(8);
      map.panTo({ lat: d.lat, lng: d.lng });
      if (codeM) {
        codeM.setIcon(dotIcon(d.code, true));
        setTimeout(() => codeM.setIcon(dotIcon(d.code, false)), 4000);
        openCodeInfo(codeM._code);
      }
    } catch (e) {
      info.innerHTML = `<span class="loc-err">Ошибка запроса. Попробуйте ещё раз.</span>`;
    }
  }

  btn.addEventListener("click", showLocator);
  // клик по стране — вернуть обычную карту страны
  pcTabs.addEventListener("click", (e) => { if (e.target.closest(".pc-tab")) hideLocator(); }, true);
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const q = input.value.trim();
    if (!q) return;
    showLocator();
    locate(q);
  });
})();
