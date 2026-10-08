/*
Fleet ETA Tracker — общий конфиг и стиль карт Google (v3.50).
MapsCommon.make(элемент, настройки) создаёт карту с общими настройками: старт (центр Европы, зум 4), кнопки + / − справа
сверху, без значков Google и Street View, точки интересов Google видны (v3.52), подписи транспорта скрыты,
цифра зума и зум колесом без Ctrl (ZoomBadge). Настройки карты переопределяют общие.
MapsCommon.ZOOM — пороги зума для слоя машин: cluster — ниже склеиваем, num — с него плашки номеров.
v3.51: MapsCommon.refreshBtn(map, onClick) — ↻ «Обновить позиции машин» справа сверху (над + / −) на всех картах;
onClick может вернуть Promise — пока он идёт, кнопка неактивна. Возвращает кнопку (hidden — спрятать).
*/
(function () {
  const ZOOM = { cluster: 9, num: 6 };
  const STYLES = [
    { featureType: "transit", elementType: "labels", stylers: [{ visibility: "off" }] },
  ];
  function make(el, opts) {
    const map = new google.maps.Map(el, Object.assign({
      center: { lat: 50.5, lng: 10.0 },   // примерно центр Европы
      zoom: 4,
      clickableIcons: false,
      streetViewControl: false,
      styles: STYLES,
      zoomControl: true,
      zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_TOP },
    }, opts || {}));
    if (window.ZoomBadge) window.ZoomBadge.attach(map);
    return map;
  }
  function refreshBtn(map, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "mc-rf";
    b.title = "Обновить позиции машин (Mapon)";
    b.textContent = "↻";
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      if (b.disabled) return;
      b.disabled = true;
      Promise.resolve(onClick && onClick()).catch(() => {}).then(() => { b.disabled = false; });
    });
    map.controls[google.maps.ControlPosition.RIGHT_TOP].push(b);
    return b;
  }
  window.MapsCommon = { make, ZOOM, refreshBtn };
})();
