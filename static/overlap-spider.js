/*
Fleet ETA Tracker — слипшиеся маркеры машин (v3.58): машины в одной точке экрана показываются счётчиком
(подпись при наведении — номера). Клик по счётчику — веер: маркеры разводятся по кругу, пока карта не отдалят
или не приблизят. Координаты данных не меняются, только позиции маркеров на время веера.
Общий для 🗺 Флот (app.js), Локатор и From → To (units-layer.js).
*/
(function () {
  const OVERLAP_PX = 14;   // точки ближе этого (в px экрана) — одна кучка
  const SPIDER_PX = 22;    // радиус веера

  function px(lat, lng, zoom) {
    const scale = 256 * Math.pow(2, zoom);
    const s = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999);
    return { x: ((lng + 180) / 360) * scale, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale };
  }
  function badgeIcon(n) {
    const r = 11;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${2 * r + 2}" height="${2 * r + 2}">`
      + `<circle cx="${r + 1}" cy="${r + 1}" r="${r}" fill="#c0392b" stroke="#fff" stroke-width="2"/>`
      + `<text x="${r + 1}" y="${r + 5}" text-anchor="middle" font-family="Arial" font-size="12" font-weight="700" fill="#fff">${n}</text></svg>`;
    return { url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
             scaledSize: new google.maps.Size(2 * r + 2, 2 * r + 2), anchor: new google.maps.Point(r + 1, r + 1) };
  }
  // кучки: точки, которые на экране легли почти друг на друга
  function groupItems(items, z) {
    const pts = items.map((it) => ({ it, p: px(it.lat, it.lng, z) }));
    const used = new Set();
    const out = [];
    pts.forEach((a, i) => {
      if (used.has(i)) return;
      used.add(i);
      const g = [a.it];
      pts.forEach((b, j) => {
        if (!used.has(j) && Math.abs(a.p.x - b.p.x) < OVERLAP_PX && Math.abs(a.p.y - b.p.y) < OVERLAP_PX) {
          used.add(j);
          g.push(b.it);
        }
      });
      if (g.length > 1) out.push(g);
    });
    return out;
  }
  // позиции веера: по кругу вокруг центра кучки, в градусах на текущем зуме
  function spreadPos(g, z) {
    const deg = 360 / (256 * Math.pow(2, z));   // градусов долготы на 1 px
    const res = new Map();
    g.forEach((it, i) => {
      const ang = (2 * Math.PI * i) / g.length - Math.PI / 2;
      const dx = Math.cos(ang) * SPIDER_PX;
      const dy = Math.sin(ang) * SPIDER_PX;
      const cos = Math.max(0.2, Math.cos((it.lat * Math.PI) / 180));
      res.set(it.id, { lat: it.lat - (dy * deg) / cos, lng: it.lng + dx * deg });
    });
    return res;
  }

  // create(map, { refresh, move }) -> { apply(items) }; move(id, lat, lng) — сдвинуть доп. элементы машины
  // items: [{ id, lat, lng, marker, title }] — реальные позиции и маркеры машин, которые сейчас на карте
  function create(map, opts) {
    opts = opts || {};
    let spiderKey = null;
    let badges = [];
    let spread = new Map();     // id -> { marker, lat, lng } — сдвинутые веером (вернём на место)
    let lastItems = [];

    map.addListener("zoom_changed", () => {
      spiderKey = null;
      if (opts.refresh) opts.refresh();
    });

    // сдвиг маркера (и доп. элементов машины, например плашки — через opts.move)
    function move(id, marker, lat, lng) {
      if (marker) marker.setPosition({ lat, lng });
      if (opts.move) opts.move(id, lat, lng);
    }

    function apply(items) {
      if (items) lastItems = items;
      spread.forEach((v) => move(v.id, v.marker, v.lat, v.lng));
      spread = new Map();
      badges.forEach((b) => b.setMap(null));
      badges = [];
      if (!lastItems.length) return;
      const z = map.getZoom() || 0;
      groupItems(lastItems, z).forEach((g) => {
        const key = g.map((it) => String(it.id)).sort().join("|");
        if (spiderKey === key) {
          const pos = spreadPos(g, z);
          g.forEach((it) => {
            if (!it.marker && !opts.move) return;
            spread.set(it.id, { id: it.id, marker: it.marker, lat: it.lat, lng: it.lng });
            const p = pos.get(it.id);
            move(it.id, it.marker, p.lat, p.lng);
          });
          return;
        }
        const lat = g.reduce((a, it) => a + it.lat, 0) / g.length;
        const lng = g.reduce((a, it) => a + it.lng, 0) / g.length;
        const b = new google.maps.Marker({ position: { lat, lng }, map, icon: badgeIcon(g.length), zIndex: 30,
          title: g.map((it) => it.title || String(it.id)).join("\n") + "\nКлик — развести" });
        b.addListener("click", () => { spiderKey = key; apply(); });
        badges.push(b);
      });
    }
    return { apply };
  }

  window.OverlapSpider = { create };
})();
