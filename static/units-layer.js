/*
Fleet ETA Tracker — слой «все машины» (v3.38) для карт Локатора и From → To.
Все тягачи группы HEAD TRUCK из /api/units (координаты, едет / стоит, курс — тот же запрос к Mapon, Google не нужен).
Кружок — как на карте Флота: заливка цветом диспетчера трипа, где эта машина (без трипа — серый), обводка — едет
(зелёная) / стоит (красная), у едущей — стрелка курса; при отдалении близкие — кружок с числом (клик приближает).
Номер — в подсказке при наведении и (v3.40) плашкой над кружком с зума 6 (v3.44); кнопка «№» прячет / показывает плашки. Позиции — при открытии вкладки и по кнопке ↻. Слой вкл / выкл — помнит браузер.
UnitsLayer.attach(map, { onPick(number) }) — onPick: клик по машине (From → To ставит её в From1).
*/
(function () {
  const VIS_KEY = "units-layer";
  const NUM_KEY = "units-layer-num";
  const CLUSTER_MAX_ZOOM = (window.MapsCommon && MapsCommon.ZOOM.cluster) || 9;   // как на карте Флота
  const CLUSTER_PX = 34;
  const NUM_MIN_ZOOM = (window.MapsCommon && MapsCommon.ZOOM.num) || 6;       // v3.44: плашка с номером — у любой не склеенной машины с зума 6 (уровень страны)
  const GRP_KEY = "units-layer-group";
  function groupSaved() {      // v3.50: «Группировать» — по умолчанию выкл
    try { return localStorage.getItem(GRP_KEY) === "1"; } catch (e) { return false; }
  }
  function saveGroup(v) {
    try { localStorage.setItem(GRP_KEY, v ? "1" : "0"); } catch (e) { /* ignore */ }
  }
  const layers = [];
  let units = [];
  let loading = null;

  const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const digits = (s) => String(s || "").replace(/\D/g, "");

  function visibleSaved() {
    try { return localStorage.getItem(VIS_KEY) !== "0"; } catch (e) { return true; }
  }
  function saveVisible(v) {
    try { localStorage.setItem(VIS_KEY, v ? "1" : "0"); } catch (e) { /* ignore */ }
  }
  function numsSaved() {
    try { return localStorage.getItem(NUM_KEY) !== "0"; } catch (e) { return true; }
  }
  function saveNums(v) {
    try { localStorage.setItem(NUM_KEY, v ? "1" : "0"); } catch (e) { /* ignore */ }
  }

  // трип во Флоте с этой машиной
  function fleetRow(number) {
    if (typeof rows === "undefined") return null;
    const n = norm(number), d = digits(number);
    return rows.find((r) => r.unit && (norm(r.unit) === n || (d && digits(r.unit) === d && norm(r.unit).length <= d.length))) || null;
  }
  // цвет диспетчера трипа
  function dispColor(number) {
    if (typeof rowDisp !== "function" || typeof dispEntry !== "function") return "";
    const row = fleetRow(number);
    const e = row ? dispEntry(rowDisp(row)) : null;
    return e && e.color ? e.color : "";
  }
  // «3 ч 20 мин», «45 мин», «2 д 4 ч»
  function fmtDur(sec) {
    if (sec == null || isNaN(sec)) return "";
    const m = Math.floor(sec / 60);
    if (m < 60) return Math.max(m, 1) + " мин";
    const h = Math.floor(m / 60);
    if (h < 24) return h + " ч" + (m % 60 ? " " + (m % 60) + " мин" : "");
    return Math.floor(h / 24) + " д" + (h % 24 ? " " + (h % 24) + " ч" : "");
  }
  // подсказка при наведении: едет — скорость и куда (таргет трипа во Флоте); стоит — сколько и где (код региона)
  function unitTitle(u) {
    if (u.st === "driving") {
      const row = fleetRow(u.number);
      const tg = row && row.target ? String(row.target).trim() : "";
      return u.number + " · едет" + (u.spd != null ? " " + Math.round(u.spd) + " км/ч" : "") + (tg ? "\n→ " + tg : "");
    }
    const dur = fmtDur(u.dur);
    return u.number + " · стоит" + (dur ? " " + dur : "") + (u.code ? "\n" + u.code : "");
  }

  function unitIcon(u) {
    const fill = dispColor(u.number) || "#c9ced6";
    const st = u.st === "driving" ? "#1D9E75" : "#E24B4A";
    const arrow = u.st === "driving" && u.dir != null
      ? `<path d="M12 0.5 L15.6 6 L8.4 6 Z" fill="${st}" stroke="#fff" stroke-width="0.8" transform="rotate(${Math.round(u.dir)} 12 12)"/>` : "";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">${arrow}`
      + `<circle cx="12" cy="12" r="6.2" fill="${fill}" stroke="${st}" stroke-width="2.6"/>`
      + `<circle cx="12" cy="12" r="7.9" fill="none" stroke="rgba(0,0,0,.45)" stroke-width="1"/></svg>`;
    return { url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
             scaledSize: new google.maps.Size(24, 24), anchor: new google.maps.Point(12, 12), labelOrigin: new google.maps.Point(12, -9) };
  }
  function clusterIcon(n) {
    const r = n < 10 ? 13 : 15;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${2 * r + 2}" height="${2 * r + 2}">`
      + `<circle cx="${r + 1}" cy="${r + 1}" r="${r}" fill="#5f6b7a" stroke="#fff" stroke-width="2"/>`
      + `<text x="${r + 1}" y="${r + 5}" text-anchor="middle" font-family="Arial" font-size="12" font-weight="700" fill="#fff">${n}</text></svg>`;
    return { url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
             scaledSize: new google.maps.Size(2 * r + 2, 2 * r + 2), anchor: new google.maps.Point(r + 1, r + 1) };
  }
  function px(lat, lng, zoom) {
    const scale = 256 * Math.pow(2, zoom);
    const s = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999);
    return { x: ((lng + 180) / 360) * scale, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale };
  }

  async function load(fresh) {
    if (loading && !fresh) return loading;
    loading = fetch("/api/units" + (fresh ? "?t=" + Date.now() : ""))
      .then((r) => r.json())
      .then((d) => { units = (d.units || []).filter((u) => u.kind === "truck" && u.lat != null && u.lng != null); })
      .catch(() => {});
    await loading;
    layers.forEach((L) => L.draw());
  }

  function attach(map, opts) {
    opts = opts || {};
    const L = { map, on: visibleSaved(), nums: numsSaved(), group: groupSaved(), marks: [] };

    // кнопки на карте: «🚚 Машины» (вкл / выкл) и ↻ (обновить позиции)
    const box = document.createElement("div");
    box.className = "ul-ctl";
    box.innerHTML = '<button type="button" class="ul-tg" title="Все машины HEAD TRUCK на карте — показать / спрятать">🚚 Машины</button>'
      + '<button type="button" class="ul-nm" title="Номера машин плашками (с зума 6) — показать / спрятать">№</button>'
      + '<button type="button" class="ul-gr" title="Группировать близкие машины в кружок с числом (ниже зума 9) — вкл / выкл">Группировать</button>'
      + '<button type="button" class="ul-rf" title="Обновить позиции машин">↻</button>';
    const tg = box.querySelector(".ul-tg"), rf = box.querySelector(".ul-rf"), nm = box.querySelector(".ul-nm"), gr = box.querySelector(".ul-gr");
    const ui = () => { tg.classList.toggle("on", L.on); rf.hidden = !L.on; nm.hidden = !L.on; gr.hidden = !L.on; nm.classList.toggle("on", L.nums); gr.classList.toggle("on", L.group); };
    tg.addEventListener("click", () => { L.on = !L.on; saveVisible(L.on); ui(); if (L.on && !units.length) load(true); else L.draw(); });
    gr.addEventListener("click", () => { L.group = !L.group; saveGroup(L.group); ui(); L.draw(); });
    nm.addEventListener("click", () => { L.nums = !L.nums; saveNums(L.nums); ui(); L.draw(); });
    rf.addEventListener("click", () => { rf.disabled = true; load(true).then(() => { rf.disabled = false; }); });
    ui();
    map.controls[google.maps.ControlPosition.TOP_LEFT].push(box);

    L.clear = () => { L.marks.forEach((m) => m.setMap(null)); L.marks = []; };
    L.draw = () => {
      L.clear();
      if (!L.on || !units.length) return;
      const z = map.getZoom() || 0;
      const groups = [];
      if (L.group && z < CLUSTER_MAX_ZOOM) {
        units.forEach((u) => {
          const p = px(u.lat, u.lng, z);
          const g = groups.find((x) => Math.abs(x.p.x - p.x) < CLUSTER_PX && Math.abs(x.p.y - p.y) < CLUSTER_PX);
          if (g) g.items.push(u); else groups.push({ p, items: [u] });
        });
      } else units.forEach((u) => groups.push({ items: [u] }));
      groups.forEach((g) => {
        if (g.items.length === 1) {
          const u = g.items[0];
          const opt = { position: { lat: u.lat, lng: u.lng }, map, icon: unitIcon(u), zIndex: 15,
            title: unitTitle(u) + (opts.onPick ? "\nКлик — поставить в From1" : "") };
          if (L.nums && z >= NUM_MIN_ZOOM) {
            opt.label = { text: String(u.number), className: u.st === "driving" ? "ul-lab ul-drv" : "ul-lab ul-std", color: "#1a1a1a", fontSize: "12px", fontWeight: "600" };
            opt.zIndex = 17;
          }
          const m = new google.maps.Marker(opt);
          if (opts.onPick) m.addListener("click", () => opts.onPick(u.number));
          L.marks.push(m);
        } else {
          const lat = g.items.reduce((a, u) => a + u.lat, 0) / g.items.length;
          const lng = g.items.reduce((a, u) => a + u.lng, 0) / g.items.length;
          const m = new google.maps.Marker({ position: { lat, lng }, map, icon: clusterIcon(g.items.length), zIndex: 16,
            title: g.items.map((u) => u.number).join(", ") });
          m.addListener("click", () => { map.setCenter({ lat, lng }); map.setZoom(Math.min(CLUSTER_MAX_ZOOM, z + 2)); });
          L.marks.push(m);
        }
      });
    };
    map.addListener("zoom_changed", () => L.draw());
    layers.push(L);
    if (L.on) load(true);
    return { refresh: () => load(true), draw: () => L.draw() };
  }

  // при открытии вкладки — свежие позиции (если слой где-то включён)
  function refreshOnShow() {
    if (layers.some((L) => L.on)) load(true);
  }

  window.UnitsLayer = { attach, refreshOnShow };
})();
