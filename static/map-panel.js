/*
Fleet ETA Tracker — «Карта 2.0» (v3.26): карта Флота в выезжающей панели справа.
Язычок 🗺 над 📓; открыта одна панель за раз (карта или Блокнот); ширина тянется за левый край
(v3.34: одна на все боковые панели — sidePanelW в app.js), открыта / закрыта — помнит ("fleet-map-open"); Esc — закрыть.
⛶ на весь экран — кнопка самой карты Google. На телефоне (до 768 px) панели нет: карта во весь экран по 🗺, как раньше.
Карта создаётся при загрузке страницы (initMap в app.js) и в закрытой панели: по ней же оживают From → To и Локатор.
*/
(function () {
  const panel = document.getElementById("map-panel");
  const tab = document.getElementById("map-tab");
  if (!panel || !tab) return;
  const body = document.body;
  const OPEN_KEY = "fleet-map-open";
  const isMobile = () => window.matchMedia("(max-width: 767px)").matches;

  // v3.30: ширина на виду — подпись при перетаскивании и подсказка ручки
  const handleEl = panel.querySelector(".map-resize");
  const wLabel = document.createElement("div");
  wLabel.className = "w-label";
  panel.appendChild(wLabel);
  // v3.34: ширина общая для всех боковых панелей — sidePanelW (app.js)
  sidePanelW.set(sidePanelW.get());

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
    if (typeof sideMarginFix === "function") sideMarginFix();       // v3.32: левый край не скачет
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
  if (handle) handle.addEventListener("mousedown", (e) => sidePanelW.drag(e, "map-resizing", refreshMap));

  let wasOpen = false;
  try { wasOpen = localStorage.getItem(OPEN_KEY) === "1"; } catch (e) { /* ignore */ }
  if (wasOpen) open();
})();
