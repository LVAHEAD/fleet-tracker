/*
Fleet ETA Tracker — вкладка "From → To"
Версия: 1.13

Отдельная Google Map (window.routeMap), создаётся лениво при первом открытии
вкладки (initRouteTab, вызывается из app.js). Использует те же приёмы, что и
карта на вкладке "Флот": расстояние/полилиния — через /api/route (Routes API
на сервере), линия рисуется декодированием encodedPolyline на клиенте.
*/

let routeFromMarker = null;
let routeToMarker = null;
let routeLine = null;

function initRouteTab() {
  if (window.routeMap) return; // уже создана
  window.routeMap = new google.maps.Map(document.getElementById("route-map"), {
    center: { lat: 50.5, lng: 10.0 },
    zoom: 4,
  });

  document.getElementById("route-calc-btn").addEventListener("click", calcRouteTab);
  [document.getElementById("route-from"), document.getElementById("route-to")].forEach((input) => {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") calcRouteTab();
    });
  });
}

function routeMarkerIcon(fill) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26">
    <circle cx="13" cy="13" r="10" fill="${fill}" stroke="white" stroke-width="2"/>
  </svg>`;
  return {
    url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
    scaledSize: new google.maps.Size(26, 26),
    anchor: new google.maps.Point(13, 13),
  };
}

async function calcRouteTab() {
  const fromVal = document.getElementById("route-from").value.trim();
  const toVal = document.getElementById("route-to").value.trim();
  const resultEl = document.getElementById("route-result");
  const errorEl = document.getElementById("route-error");
  const btn = document.getElementById("route-calc-btn");

  errorEl.hidden = true;
  resultEl.hidden = true;

  if (!fromVal || !toVal) {
    errorEl.textContent = "Заполните оба поля — From и To.";
    errorEl.hidden = false;
    return;
  }

  btn.disabled = true;
  btn.textContent = "Считаю…";

  try {
    const res = await fetch("/api/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: fromVal, to: toVal }),
    });
    const data = await res.json();

    if (data.error) {
      errorEl.textContent = data.error;
      errorEl.hidden = false;
      return;
    }

    document.getElementById("route-from-label").textContent = data.from_label;
    document.getElementById("route-to-label").textContent = data.to_label;
    document.getElementById("route-dist").textContent = data.dist_km.toFixed(1);
    document.getElementById("route-duration").textContent = data.duration_h.toFixed(1);
    resultEl.hidden = false;

    drawRouteOnMap(data);
  } catch (e) {
    errorEl.textContent = "Ошибка запроса. Попробуйте ещё раз.";
    errorEl.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = "Рассчитать";
  }
}

function drawRouteOnMap(data) {
  const map = window.routeMap;

  if (routeFromMarker) routeFromMarker.setMap(null);
  if (routeToMarker) routeToMarker.setMap(null);
  if (routeLine) routeLine.setMap(null);

  routeFromMarker = new google.maps.Marker({
    position: { lat: data.from_lat, lng: data.from_lng },
    map: map,
    icon: routeMarkerIcon("#4285F4"),
    label: { text: "A", fontSize: "12px", fontWeight: "600", color: "#fff" },
    title: data.from_label,
  });
  routeToMarker = new google.maps.Marker({
    position: { lat: data.to_lat, lng: data.to_lng },
    map: map,
    icon: routeMarkerIcon("#1D9E75"),
    label: { text: "B", fontSize: "12px", fontWeight: "600", color: "#fff" },
    title: data.to_label,
  });

  const bounds = new google.maps.LatLngBounds();
  bounds.extend(routeFromMarker.getPosition());
  bounds.extend(routeToMarker.getPosition());

  if (data.route_polyline) {
    const path = google.maps.geometry.encoding.decodePath(data.route_polyline);
    routeLine = new google.maps.Polyline({
      path: path,
      strokeColor: "#4285F4",
      strokeOpacity: 0.85,
      strokeWeight: 4,
      map: map,
    });
    path.forEach((p) => bounds.extend(p));
  }

  map.fitBounds(bounds, 40);
}

window.initRouteTab = initRouteTab;
