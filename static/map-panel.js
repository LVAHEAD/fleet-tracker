/*
Fleet ETA Tracker — «Карта 2.0» (v3.26): карта Флота в выезжающей панели справа.
Язычок 🗺 над 📓; открыта одна панель за раз (карта или Блокнот); ширина тянется за левый край
и запоминается (localStorage "fleet-map-w"), открыта / закрыта — тоже ("fleet-map-open"); Esc — закрыть.
⛶ на весь экран — кнопка самой карты Google. На телефоне (до 768 px) панели нет: карта во весь экран по 🗺, как раньше.
Карта создаётся при загрузке страницы (initMap в app.js) и в закрытой панели: по ней же оживают From → To и Локатор.
*/
(function () {
  const panel = document.getElementById("map-panel");
  const tab = document.getElementById("map-tab");
  if (!panel || !tab) return;
  const body = document.body;
  const W_KEY = "fleet-map-w", OPEN_KEY = "fleet-map-open";
  const MIN_W = 320;
  const isMobile = () => window.matchMedia("(max-width: 767px)").matches;
  const zoom = () => (typeof uiZoom === "function" ? uiZoom() : 1);
  const maxW = () => Math.round((window.innerWidth / zoom()) * 0.85);
  const clampW = (w) => Math.max(MIN_W, Math.min(maxW(), Math.round(w)));

  // v3.30: ширина на виду — подпись при перетаскивании и подсказка ручки (подобрать удобную)
  // v3.31: общая ширина панелей по умолчанию — 500 (--sidew в style.css), сохранённая — сброс один раз
  const DEF_W = 500;
  sideWidthReset();
  const handleEl = panel.querySelector(".map-resize");
  const wLabel = document.createElement("div");
  wLabel.className = "w-label";
  panel.appendChild(wLabel);
  function setWidth(w) {
    const v = clampW(w);
    document.documentElement.style.setProperty("--mapw", v + "px");
    wLabel.textContent = v + " px";
    if (handleEl) handleEl.title = `Ширина ${v} px (по умолчанию ${DEF_W}) — потянуть шире / уже; шире ${DEF_W} — наползает на таблицу`;
  }
  let saved = DEF_W;
  try { saved = Number(localStorage.getItem(W_KEY)) || DEF_W; } catch (e) { /* ignore */ }
  setWidth(saved);

  function mapObj() { return (typeof map !== "undefined" && map) ? map : null; }
  function refreshMap() {
    const m = mapObj();
    if (!m || !window.google) return;
    const c = m.getCenter();
    google.maps.event.trigger(m, "resize");
    if (c) m.setCenter(c);
    if (typeof window.fleetMapSync === "function") window.fleetMapSync();
  }

  function open() {
    if (isMobile()) return;
    if (typeof Notebook !== "undefined" && Notebook.close) Notebook.close();
    if (window.etaCalc) window.etaCalc.close();                     // v3.28: и ETA-калькулятор
    panel.classList.add("open");
    panel.setAttribute("aria-hidden", "false");
    body.classList.add("map-open");
    try { localStorage.setItem(OPEN_KEY, "1"); } catch (e) { /* ignore */ }
    setTimeout(refreshMap, 280);
  }
  function close() {
    if (!panel.classList.contains("open")) return;
    panel.classList.remove("open");
    panel.setAttribute("aria-hidden", "true");
    body.classList.remove("map-open");
    try { localStorage.setItem(OPEN_KEY, "0"); } catch (e) { /* ignore */ }
  }
  const isOpen = () => panel.classList.contains("open");
  window.fleetMapPanel = { open, close, isOpen };

  tab.addEventListener("click", (e) => { e.stopPropagation(); isOpen() ? close() : open(); });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !isOpen()) return;
    if (document.fullscreenElement) return;          // Esc сначала выходит из ⛶
    close();
  });

  // ширина — тянуть за левый край панели
  const handle = handleEl;
  if (handle) handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    body.classList.add("map-resizing");
    const z = zoom();
    const move = (ev) => setWidth((window.innerWidth - ev.clientX) / z);
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      body.classList.remove("map-resizing");
      const w = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--mapw"), 10);
      try { localStorage.setItem(W_KEY, String(w)); } catch (err) { /* ignore */ }
      refreshMap();
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  });
  window.addEventListener("resize", () => {
    const w = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--mapw"), 10);
    if (w) setWidth(w);
  });

  let wasOpen = false;
  try { wasOpen = localStorage.getItem(OPEN_KEY) === "1"; } catch (e) { /* ignore */ }
  if (wasOpen) open();
})();
