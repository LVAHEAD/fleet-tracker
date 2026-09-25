/*
Fleet ETA Tracker — Локатор (вкладка "Карты стран")
Версия: 1.26 — поиск по Enter, по кнопке "Локатор" и по выбору из подсказок.
Ранее 1.25 — точки рисуются одним canvas-слоем (раньше 1096 маркеров Google — тормозило)

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
    // v1.27: страны из GeoNames
    AT: "#B5179E", CH: "#E63946", LI: "#7209B7", LU: "#4361EE", HU: "#2A9D8F",
    SI: "#588157", HR: "#1D3557", BG: "#8338EC", RO: "#FB8500", LT: "#606C38",
    EE: "#0077B6", GR: "#48CAE4", RS: "#9D0208", BA: "#6D597A", MK: "#BC6C25",
    MD: "#DDA15E", IE: "#52B788", TR: "#C9184A",
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
  let codes = [];          // [{code, lat, lng, place, latLng}]
  let codeByKey = {};      // code -> объект из codes
  let overlay = null;      // canvas-слой со всеми точками
  let highlightCode = null;
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
    infoWindow.setPosition(c.latLng);
    infoWindow.setOptions({ pixelOffset: new google.maps.Size(0, -6) });
    infoWindow.open(map);
  }

  // v1.25: все точки рисуются одним canvas-слоем вместо 1096 отдельных
  // маркеров Google — иначе карта сильно тормозила при сдвиге и зуме.
  function makeDotsOverlay() {
    class DotsOverlay extends google.maps.OverlayView {
      onAdd() {
        this.canvas = document.createElement("canvas");
        this.canvas.style.position = "absolute";
        this.canvas.style.pointerEvents = "none";
        this.getPanes().overlayLayer.appendChild(this.canvas);
        this._raf = null;
        this._listener = map.addListener("bounds_changed", () => this.scheduleDraw());
      }
      onRemove() {
        google.maps.event.removeListener(this._listener);
        this.canvas.remove();
      }
      scheduleDraw() {
        if (this._raf) return;
        this._raf = requestAnimationFrame(() => { this._raf = null; this.draw(); });
      }
      draw() {
        const proj = this.getProjection();
        const bounds = map.getBounds();
        if (!proj || !bounds || !this.canvas) return;
        const mapDiv = map.getDiv();
        const w = mapDiv.clientWidth, h = mapDiv.clientHeight;
        const ne = bounds.getNorthEast(), sw = bounds.getSouthWest();
        const tl = proj.fromLatLngToDivPixel(new google.maps.LatLng(ne.lat(), sw.lng()));
        const dpr = window.devicePixelRatio || 1;
        const c = this.canvas;
        c.style.left = `${tl.x}px`;
        c.style.top = `${tl.y}px`;
        c.style.width = `${w}px`;
        c.style.height = `${h}px`;
        if (c.width !== w * dpr || c.height !== h * dpr) { c.width = w * dpr; c.height = h * dpr; }
        const ctx = c.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        const zoom = map.getZoom();
        const r = zoom >= 8 ? 5.5 : zoom >= 6 ? 4.5 : 3.5;
        const labels = zoom >= LABEL_ZOOM;
        ctx.font = "600 10px -apple-system, Segoe UI, Roboto, Arial, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";

        for (const p of codes) {
          const px = proj.fromLatLngToDivPixel(p.latLng);
          const x = px.x - tl.x, y = px.y - tl.y;
          if (x < -20 || y < -20 || x > w + 20 || y > h + 20) continue;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fillStyle = COUNTRY_COLORS[p.code.slice(0, 2)] || "#555";
          ctx.fill();
          ctx.lineWidth = 1;
          ctx.strokeStyle = "#fff";
          ctx.stroke();
          if (labels) {
            ctx.lineWidth = 3;
            ctx.strokeStyle = "rgba(255,255,255,0.85)";
            ctx.strokeText(p.code, x, y - r - 1);
            ctx.fillStyle = "#222";
            ctx.fillText(p.code, x, y - r - 1);
          }
        }

        // подсвеченный код (результат поиска)
        const hl = highlightCode && codeByKey[highlightCode];
        if (hl) {
          const px = proj.fromLatLngToDivPixel(hl.latLng);
          ctx.beginPath();
          ctx.arc(px.x - tl.x, px.y - tl.y, r + 6, 0, Math.PI * 2);
          ctx.lineWidth = 3;
          ctx.strokeStyle = "#E24B4A";
          ctx.stroke();
        }
      }
      // ближайшая точка к пикселю контейнера (для клика и курсора)
      hitTest(latLng, maxPx) {
        const proj = this.getProjection();
        if (!proj) return null;
        const t = proj.fromLatLngToContainerPixel(latLng);
        let best = null, bestD = maxPx * maxPx;
        for (const p of codes) {
          const q = proj.fromLatLngToContainerPixel(p.latLng);
          const d = (q.x - t.x) ** 2 + (q.y - t.y) ** 2;
          if (d <= bestD) { bestD = d; best = p; }
        }
        return best;
      }
    }
    return new DotsOverlay();
  }

  async function initLocatorMap() {
    map = new google.maps.Map(document.getElementById("locatorMap"), {
      center: { lat: 52, lng: 10 },
      zoom: 4,
      streetViewControl: false,
      clickableIcons: false,
    });
    infoWindow = new google.maps.InfoWindow();

    // "копировать" внутри InfoWindow
    document.getElementById("locatorMap").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-copy]");
      if (!b) return;
      const done = () => { b.textContent = "скопировано ✓"; };
      if (navigator.clipboard) navigator.clipboard.writeText(b.dataset.copy).then(done, () => {});
    });

    try {
      const res = await fetch("/api/region-codes");
      const data = await res.json();
      codes = (data.codes || []).map((c) => ({ ...c, latLng: new google.maps.LatLng(c.lat, c.lng) }));
      codes.forEach((c) => { codeByKey[c.code] = c; });
    } catch (e) {
      info.innerHTML = `<span class="loc-err">Не удалось загрузить коды регионов.</span>`;
    }

    overlay = makeDotsOverlay();
    overlay.setMap(map);

    map.addListener("click", (e) => {
      const p = overlay.hitTest(e.latLng, 10);
      if (p) openCodeInfo(p);
    });
    // курсор-"рука" над точками (с троттлингом через rAF)
    let moveRaf = null, lastMove = null;
    map.addListener("mousemove", (e) => {
      lastMove = e.latLng;
      if (moveRaf) return;
      moveRaf = requestAnimationFrame(() => {
        moveRaf = null;
        const hit = overlay.hitTest(lastMove, 10);
        map.setOptions({ draggableCursor: hit ? "pointer" : null });
      });
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
      const codeP = codeByKey[d.code];

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
      highlightCode = d.code;
      if (overlay) overlay.scheduleDraw();
      if (codeP) openCodeInfo(codeP);
    } catch (e) {
      info.innerHTML = `<span class="loc-err">Ошибка запроса. Попробуйте ещё раз.</span>`;
    }
  }

  // v1.26: поиск тремя способами — Enter, кнопка "Локатор" (если поле заполнено),
  // выбор значения из выпадающих подсказок
  btn.addEventListener("click", () => {
    showLocator();
    const q = input.value.trim();
    if (q) locate(q);
  });
  input.addEventListener("input", (e) => {
    // выбор из datalist: Chrome/Edge — inputType "insertReplacementText", Firefox — без inputType
    const picked = e.inputType === "insertReplacementText" || e.inputType === undefined;
    if (!picked) return;
    const q = input.value.trim();
    if (!q) return;
    const inList = [...document.querySelectorAll("#units-list option")].some((o) => o.value === q);
    if (!inList) return;
    showLocator();
    locate(q);
  });
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
