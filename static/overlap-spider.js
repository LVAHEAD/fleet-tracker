/*
Fleet ETA Tracker — слипшиеся маркеры машин (v3.58): машины в одной точке экрана показываются счётчиком
(v3.61: плашка с номерами на виду — 1–2 машины строка на машину, 3–4 — две строки через запятую, 5+ — «+N»).
Клик по плашке — веер: маркеры разводятся по кругу, пока карта не отдалят или не приблизят. Координаты данных не меняются, только позиции маркеров на время веера.
Общий для 🗺 Флот (app.js), Локатор и From → To (units-layer.js).
*/
(function () {
  const SPIDER_PX = 22;    // радиус веера
  // v3.65: плашки не перекрываются — точки ближе размера плашки (≈ 90×50 px) сводятся в одну, цепочкой
  const PLATE_SEP_X = 90;
  const PLATE_SEP_Y = 50;

  function px(lat, lng, zoom) {
    const scale = 256 * Math.pow(2, zoom);
    const s = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999);
    return { x: ((lng + 180) / 360) * scale, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale };
  }
  // v3.61: номера машин на виду в плашке кластера
  function plateLines(names) {
    names = Array.from(new Set(names));   // v3.65: одна машина с двумя строками Флота — имя один раз
    const n = names.length;
    if (n >= 5) return ["+" + n];
    if (n <= 2) return names;
    const h = Math.ceil(n / 2);
    return [names.slice(0, h).join(", "), names.slice(h).join(", ")];
  }
  function esc(t) {
    return String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }
  function plateIcon(lines) {
    const lh = 15, padX = 6, padY = 4;
    const w = Math.ceil(Math.max(...lines.map((l) => l.length)) * 7.4 + 2 * padX);
    const h = lines.length * lh + 2 * padY;
    const texts = lines.map((l, i) => `<text x="${w / 2}" y="${padY + (i + 1) * lh - 3}" text-anchor="middle" font-family="Arial" font-size="12" font-weight="700" fill="#1a1a1a">${esc(l)}</text>`).join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">`
      + `<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="5" fill="#fff" stroke="#c0392b" stroke-width="2"/>${texts}</svg>`;
    return { url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
             scaledSize: new google.maps.Size(w, h), anchor: new google.maps.Point(w / 2, h / 2) };
  }
  // кучки: точки на экране ближе размера плашки — одна кучка; связность транзитивная (цепочкой),
  // чтобы две плашки не лежали одна на другой; только машины одного статуса (стоящая и едущая — отдельно)
  function groupItems(items, z) {
    const pts = items.map((it) => ({ it, p: px(it.lat, it.lng, z) }));
    const seen = new Array(pts.length).fill(false);
    const out = [];
    pts.forEach((start, i) => {
      if (seen[i]) return;
      seen[i] = true;
      const comp = [i];
      for (let k = 0; k < comp.length; k++) {
        const a = pts[comp[k]];
        pts.forEach((b, j) => {
          if (!seen[j] && a.it.st === b.it.st
            && Math.abs(a.p.x - b.p.x) < PLATE_SEP_X && Math.abs(a.p.y - b.p.y) < PLATE_SEP_Y) {
            seen[j] = true;
            comp.push(j);
          }
        });
      }
      if (comp.length > 1) out.push(comp.map((j) => pts[j].it));
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
        const names = g.map((it) => it.title || String(it.id));   // имена — уникальные (plateLines)
        const b = new google.maps.Marker({ position: { lat, lng }, map, icon: plateIcon(plateLines(names)), zIndex: 30,
          title: g.map((it) => it.title || String(it.id)).join("\n") + "\nКлик — развести" });
        b.addListener("click", () => { spiderKey = key; apply(); });
        badges.push(b);
      });
    }
    return { apply };
  }

  window.OverlapSpider = { create };
})();
