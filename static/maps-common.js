/*
Fleet ETA Tracker — общий конфиг и стиль карт Google (v3.50).
MapsCommon.make(элемент, настройки) создаёт карту с общими настройками: старт (центр Европы, зум 4), кнопки + / − справа
сверху, без значков Google и Street View, приглушённые подписи магазинов и кафе (наши машины и маршруты виднее),
цифра зума и зум колесом без Ctrl (ZoomBadge). Настройки карты переопределяют общие.
MapsCommon.ZOOM — пороги зума для слоя машин: cluster — ниже склеиваем, num — с него плашки номеров.
*/
(function () {
  const ZOOM = { cluster: 9, num: 6 };
  const STYLES = [
    { featureType: "poi", stylers: [{ visibility: "off" }] },
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
  window.MapsCommon = { make, ZOOM };
})();
