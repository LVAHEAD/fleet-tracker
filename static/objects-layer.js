/*
Fleet ETA Tracker — объекты Mapon на картах (v3.55): полигоны зон при Zoom 15–18, подпись у зоны.
Кнопка 🏭 под ↻ на каждой карте (Флот, From → To, мини-карта ⏱, Локатор): список групп с галочками, «все / ни».
Выбор общий для всех карт и запоминается (localStorage "mapon-obj-groups"). Стартовый набор — пилот 8 групп.
Данные — /api/mapon-objects (поле poly — вершины зоны; сервер кеширует список 10 минут). Рисуем только то, что в видимой области.
*/
(function () {
  const KEY = "mapon-obj-groups";
  const PILOT = ["Bama Supliers", "GFI Clients (GreenFood)", "BNX DSL 2025", "BNX - Secured Parkings",
    "Fish Clients (SB/FSF/NSS/Polar/BWS)", "Lad TEMP", "LAD ES vgt frt", "PARKING"];
  const ZMIN = 15, ZMAX = 18, CAP = 400;
  const BLANK = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
  let objs = null, loading = null, groupInfo = [], selected = null;
  const maps = [];

  function loadSelected() {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || "null");
      if (Array.isArray(v)) return new Set(v);
    } catch (e) { /* нет хранилища — пилот */ }
    return new Set(PILOT);
  }
  function saveSelected() {
    try { localStorage.setItem(KEY, JSON.stringify([...selected])); } catch (e) { /* ignore */ }
  }

  function load() {
    if (objs) return Promise.resolve(objs);
    if (!loading) {
      loading = fetch("/api/mapon-objects").then((r) => r.json()).then((d) => {
        objs = (d.objects || []).filter((o) => o.poly && o.poly.length >= 3)
          .map((o) => ({ name: o.name || "", group: o.group || "", poly: o.poly }));
        const cnt = {};
        objs.forEach((o) => { cnt[o.group] = (cnt[o.group] || 0) + 1; });
        groupInfo = Object.keys(cnt).map((g) => ({ name: g, count: cnt[g] })).sort((a, b) => b.count - a.count);
        return objs;
      }).catch(() => { loading = null; objs = objs || []; return objs; });
    }
    return loading;
  }

  function bounds(o) {
    let a = 90, b = -90, c = 180, d = -180;
    o.poly.forEach(([la, ln]) => { a = Math.min(a, la); b = Math.max(b, la); c = Math.min(c, ln); d = Math.max(d, ln); });
    return { a, b, c, d };
  }
  function inView(o, vb) {
    const r = bounds(o);
    return r.b >= vb.getSouthWest().lat() && r.a <= vb.getNorthEast().lat()
      && r.d >= vb.getSouthWest().lng() && r.c <= vb.getNorthEast().lng();
  }
  function centroid(o) {
    const n = o.poly.length;
    return { lat: o.poly.reduce((s, p) => s + p[0], 0) / n, lng: o.poly.reduce((s, p) => s + p[1], 0) / n };
  }

  function clearMap(m) {
    m.polys.forEach((p) => p.setMap(null));
    m.labels.forEach((l) => l.setMap(null));
    m.polys = []; m.labels = [];
  }

  function drawMap(m) {
    clearMap(m);
    if (!objs || !selected || !selected.size) return;
    const z = m.map.getZoom();
    if (z == null || z < ZMIN || z > ZMAX) return;
    const vb = m.map.getBounds();
    if (!vb) return;
    let n = 0;
    for (const o of objs) {
      if (!selected.has(o.group) || !inView(o, vb)) continue;
      if (++n > CAP) break;
      m.polys.push(new google.maps.Polygon({
        map: m.map, clickable: false, paths: o.poly.map(([la, ln]) => ({ lat: la, lng: ln })),
        strokeColor: "#2f6fd6", strokeOpacity: 0.8, strokeWeight: 1,
        fillColor: "#2f6fd6", fillOpacity: 0.15,
      }));
      m.labels.push(new google.maps.Marker({
        map: m.map, clickable: false, position: centroid(o), zIndex: 1,
        icon: { url: BLANK, anchor: new google.maps.Point(0, 0) },
        label: { text: o.name, color: "#1d3f7a", fontSize: "11px", fontWeight: "600" },
      }));
    }
  }
  function drawAll() { maps.forEach(drawMap); }

  function renderPop(m) {
    m.pop.textContent = "";
    const head = document.createElement("div");
    head.className = "ob-head";
    head.textContent = "Объекты Mapon — зоны при зуме 15–18";
    m.pop.appendChild(head);
    if (!groupInfo.length) {
      const e = document.createElement("div");
      e.className = "ob-empty";
      e.textContent = objs ? "Нет объектов с зонами." : "Загрузка…";
      m.pop.appendChild(e);
      return;
    }
    const list = document.createElement("div");
    list.className = "ob-list";
    groupInfo.forEach((g) => {
      const row = document.createElement("label");
      row.className = "ob-row";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = selected.has(g.name);
      cb.addEventListener("change", () => {
        if (cb.checked) selected.add(g.name); else selected.delete(g.name);
        saveSelected(); drawAll();
      });
      const name = document.createElement("span");
      name.className = "ob-name";
      name.textContent = g.name || "без группы";
      const cnt = document.createElement("span");
      cnt.className = "ob-n";
      cnt.textContent = String(g.count);
      row.append(cb, name, cnt);
      list.appendChild(row);
    });
    m.pop.appendChild(list);
    const bar = document.createElement("div");
    bar.className = "ob-bar";
    const all = document.createElement("button");
    all.type = "button"; all.textContent = "все";
    all.addEventListener("click", () => { groupInfo.forEach((g) => selected.add(g.name)); saveSelected(); refreshPops(); drawAll(); });
    const none = document.createElement("button");
    none.type = "button"; none.textContent = "ни";
    none.addEventListener("click", () => { selected.clear(); saveSelected(); refreshPops(); drawAll(); });
    bar.append(all, none);
    m.pop.appendChild(bar);
  }
  function refreshPops() { maps.forEach((m) => { if (!m.pop.hidden) renderPop(m); }); }

  function attach(map) {
    if (!window.google || !google.maps || !map) return;
    if (!selected) selected = loadSelected();
    const wrap = document.createElement("div");
    wrap.className = "ob-wrap";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ob-btn";
    btn.title = "Объекты Mapon на картах — группы (зум 15–18)";
    btn.textContent = "🏭";
    const pop = document.createElement("div");
    pop.className = "ob-pop";
    pop.hidden = true;
    wrap.append(btn, pop);
    pop.addEventListener("click", (e) => e.stopPropagation());
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = pop.hidden;
      maps.forEach((x) => { x.pop.hidden = true; });
      if (open) { pop.hidden = false; load().then(() => renderPop(m)); renderPop(m); }
    });
    map.controls[google.maps.ControlPosition.RIGHT_TOP].push(wrap);
    const m = { map, pop, polys: [], labels: [] };
    maps.push(m);
    map.addListener("idle", () => drawMap(m));
    load().then(() => { drawAll(); });
  }

  document.addEventListener("click", () => maps.forEach((m) => { m.pop.hidden = true; }));

  window.ObjLayer = { attach };
})();
