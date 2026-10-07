/*
Fleet ETA Tracker — цифра зума Google Maps (0 — весь мир, 21 — здание) в левом нижнем углу карты (v3.47).
Заодно (v3.47) включает зум колесом без Ctrl на десктопе (gestureHandling greedy).
ZoomBadge.attach(map) — для карт Флота, From → To, Локатора и мини-карты ⏱.
*/
(function () {
  function attach(map) {
    if (!map || map.__zoomBadge) return;
    map.__zoomBadge = true;
    // колесо мыши зумит карту без Ctrl; на сенсорных экранах (телефон) — как было
    if (!window.matchMedia("(pointer: coarse)").matches) map.setOptions({ gestureHandling: "greedy" });
    const el = document.createElement("div");
    el.style.cssText = "margin:0 0 22px 8px;padding:2px 7px;background:rgba(255,255,255,.9);border-radius:4px;" +
      "font:600 12px/16px system-ui,sans-serif;color:#444;box-shadow:0 1px 3px rgba(0,0,0,.3);pointer-events:none";
    el.title = "Зум карты (0 — весь мир, 21 — здание)";
    const upd = () => { el.textContent = "зум " + (Math.round(map.getZoom() * 10) / 10); };
    map.controls[google.maps.ControlPosition.LEFT_BOTTOM].push(el);
    map.addListener("zoom_changed", upd);
    upd();
  }
  window.ZoomBadge = { attach };
})();
