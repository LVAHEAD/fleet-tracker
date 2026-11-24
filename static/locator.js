/*
Fleet ETA Tracker — Локатор (вкладка "Карты стран")
Версия: 1.26 — поиск по Enter, по кнопке "Локатор" и по выбору из подсказок.
Ранее 1.25 — точки рисуются одним canvas-слоем (раньше 1096 маркеров Google — тормозило)

Кнопка "Локатор" вместо картинки страны показывает интерактивную Google-карту
Европы со всеми кодами регионов (GET /api/region-codes):
  - точки раскрашены по странам, подписи кодов появляются при приближении;
  - клик по точке — код, место, координаты и кнопка "копировать";
  - поле ввода принимает код / город / GPS / машину (POST /api/locate):
    карта летит к точке, показывается ближайший код региона.
Точки — центры почтовых зон (границ в данных нет), поэтому у границ зон
"ближайший код" может оказаться соседним.
*/

(function () {
  const COUNTRY_COLORS = {
    BE: "#E4572E", CZ: "#17BEBB", DE: "#2E86AB", DK: "#C1292E", ES: "#F18F01",
    FI: "#6A4C93", FR: "#1B4965", IT: "#3BB273", LV: "#8D6A9F", NL: "#FF7F11",
    NO: "#D1495B", PL: "#EDAE49", PT: "#00798C", SE: "#3066BE", SK: "#9C6644",
    // v1.27: страны из GeoNames
    AT: "#B5179E", CH: "#E63946", LI: "#7209B7", LU: "#4361EE", HU: "#2A9D8F",
    SI: "#588157", HR: "#1D3557", BG: "#8338EC", RO: "#FB8500", LT: "#606C38",
    EE: "#0077B6", GR: "#48CAE4", RS: "#9D0208", BA: "#6D597A", MK: "#BC6C25",
    MD: "#DDA15E", IE: "#52B788", TR: "#C9184A",
  };
  const LABEL_ZOOM = 7; // с этого масштаба показываем подписи кодов

  const btn = document.getElementById("locatorBtn");
  const input = document.getElementById("locatorInput");
  const view = document.getElementById("locatorView");
  const info = document.getElementById("locatorInfo");
  const pcMain = document.getElementById("pcMain");
  const pcTabs = document.getElementById("pcTabs");
  if (!btn || !view) return;

  let map = null;
  let infoWindow = null;
  let codes = [];          // [{code, lat, lng, place, latLng}]
  let codeByKey = {};      // code -> объект из codes
  let overlay = null;      // canvas-слой со всеми точками
  let highlightCode = null;
  let resultMarker = null;
  let pendingQuery = null;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function showLocator() {
    view.hidden = false;
    pcMain.hidden = true;
    btn.classList.add("active");
    [...pcTabs.children].forEach((t) => t.setAttribute("aria-selected", "false"));
    if (!map) window.whenGoogleMaps(initLocatorMap);
    else {
      google.maps.event.trigger(map, "resize");
      if (window.UnitsLayer) window.UnitsLayer.refreshOnShow();   // v3.38: свежие позиции машин
    }
  }

  function hideLocator() {
    view.hidden = true;
    pcMain.hidden = false;
    btn.classList.remove("active");
  }

  function iwHtml(c) {
    const coords = `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`;
    return `<div class="loc-iw">
      <div class="loc-code">${esc(c.code)}</div>
      <div>${esc(c.place)}</div>
      <div>${coords}</div>
      <button type="button" data-copy="${esc(c.code)}">копировать код</button>
      <button type="button" data-copy="${coords}">копировать GPS</button>
    </div>`;
  }

  function openCodeInfo(c) {
    infoWindow.setContent(iwHtml(c));
    infoWindow.setPosition(c.latLng);
    infoWindow.setOptions({ pixelOffset: new google.maps.Size(0, -6) });
    infoWindow.open(map);
  }

  // v1.25: все точки рисуются одним canvas-слоем вместо 1096 отдельных
  // маркеров Google — иначе карта сильно тормозила при сдвиге и зуме.
  function makeDotsOverlay() {
    class DotsOverlay extends google.maps.OverlayView {
      onAdd() {
        this.canvas = document.createElement("canvas");
        this.canvas.style.position = "absolute";
        this.canvas.style.pointerEvents = "none";
        this.getPanes().overlayLayer.appendChild(this.canvas);
        this._raf = null;
        this._listener = map.addListener("bounds_changed", () => this.scheduleDraw());
      }
      onRemove() {
        google.maps.event.removeListener(this._listener);
        this.canvas.remove();
      }
      scheduleDraw() {
        if (this._raf) return;
        this._raf = requestAnimationFrame(() => { this._raf = null; this.draw(); });
      }
      draw() {
        const proj = this.getProjection();
        const bounds = map.getBounds();
        if (!proj || !bounds || !this.canvas) return;
        const mapDiv = map.getDiv();
        const w = mapDiv.clientWidth, h = mapDiv.clientHeight;
        const ne = bounds.getNorthEast(), sw = bounds.getSouthWest();
        const tl = proj.fromLatLngToDivPixel(new google.maps.LatLng(ne.lat(), sw.lng()));
        const dpr = window.devicePixelRatio || 1;
        const c = this.canvas;
        c.style.left = `${tl.x}px`;
        c.style.top = `${tl.y}px`;
        c.style.width = `${w}px`;
        c.style.height = `${h}px`;
        if (c.width !== w * dpr || c.height !== h * dpr) { c.width = w * dpr; c.height = h * dpr; }
        const ctx = c.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        const zoom = map.getZoom();
        const r = zoom >= 8 ? 5.5 : zoom >= 6 ? 4.5 : 3.5;
        const labels = zoom >= LABEL_ZOOM;
        ctx.font = "600 10px -apple-system, Segoe UI, Roboto, Arial, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";

        for (const p of codes) {
          const px = proj.fromLatLngToDivPixel(p.latLng);
          const x = px.x - tl.x, y = px.y - tl.y;
          if (x < -20 || y < -20 || x > w + 20 || y > h + 20) continue;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fillStyle = COUNTRY_COLORS[p.code.slice(0, 2)] || "#555";
          ctx.fill();
          ctx.lineWidth = 1;
          ctx.strokeStyle = "#fff";
          ctx.stroke();
          if (labels) {
            ctx.lineWidth = 3;
            ctx.strokeStyle = "rgba(255,255,255,0.85)";
            ctx.strokeText(p.code, x, y - r - 1);
            ctx.fillStyle = "#222";
            ctx.fillText(p.code, x, y - r - 1);
          }
        }

        // подсвеченный код (результат поиска)
        const hl = highlightCode && codeByKey[highlightCode];
        if (hl) {
          const px = proj.fromLatLngToDivPixel(hl.latLng);
          ctx.beginPath();
          ctx.arc(px.x - tl.x, px.y - tl.y, r + 6, 0, Math.PI * 2);
          ctx.lineWidth = 3;
          ctx.strokeStyle = "#E24B4A";
          ctx.stroke();
        }
      }
      // ближайшая точка к пикселю контейнера (для клика и курсора)
      hitTest(latLng, maxPx) {
        const proj = this.getProjection();
        if (!proj) return null;
        const t = proj.fromLatLngToContainerPixel(latLng);
        let best = null, bestD = maxPx * maxPx;
        for (const p of codes) {
          const q = proj.fromLatLngToContainerPixel(p.latLng);
          const d = (q.x - t.x) ** 2 + (q.y - t.y) ** 2;
          if (d <= bestD) { bestD = d; best = p; }
        }
        return best;
      }
    }
    return new DotsOverlay();
  }

  async function initLocatorMap() {
    map = MapsCommon.make(document.getElementById("locatorMap"), { center: { lat: 52, lng: 10 } });   // v3.50
    if (window.ObjLayer) ObjLayer.attach(map);   // v3.55: объекты Mapon — 🏭
    infoWindow = new google.maps.InfoWindow();
    if (window.UnitsLayer) window.UnitsLayer.attach(map);   // v3.38: все машины HEAD TRUCK

    // "копировать" внутри InfoWindow
    document.getElementById("locatorMap").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-copy]");
      if (!b) return;
      const done = () => { b.textContent = "скопировано ✓"; };
      if (navigator.clipboard) navigator.clipboard.writeText(b.dataset.copy).then(done, () => {});
    });

    try {
      const res = await fetch("/api/region-codes");
      const data = await res.json();
      codes = (data.codes || []).map((c) => ({ ...c, latLng: new google.maps.LatLng(c.lat, c.lng) }));
      codes.forEach((c) => { codeByKey[c.code] = c; });
    } catch (e) {
      info.innerHTML = `<span class="loc-err">Не удалось загрузить коды регионов.</span>`;
    }

    overlay = makeDotsOverlay();
    overlay.setMap(map);

    map.addListener("click", (e) => {
      const p = overlay.hitTest(e.latLng, 10);
      if (p) openCodeInfo(p);
    });
    // курсор-"рука" над точками (с троттлингом через rAF)
    let moveRaf = null, lastMove = null;
    map.addListener("mousemove", (e) => {
      lastMove = e.latLng;
      if (moveRaf) return;
      moveRaf = requestAnimationFrame(() => {
        moveRaf = null;
        const hit = overlay.hitTest(lastMove, 10);
        map.setOptions({ draggableCursor: hit ? "pointer" : null });
      });
    });

    if (pendingQuery) {
      const q = pendingQuery;
      pendingQuery = null;
      locate(q);
    }
  }

  // v3.61: попап на найденной точке — название и текст из «Full address» адресной базы
  function openPointInfo(d, marker) {
    const a = d.address || {};
    const gpsLine = /^-?\d+[.,]\d+\s*,\s*-?\d+[.,]\d+$/;
    const full = String(a.full || "").split("\n").map((x) => x.trim()).filter((x) => x && !gpsLine.test(x)).join(", ");
    const gps = `${Number(d.lat).toFixed(5)}, ${Number(d.lng).toFixed(5)}`;
    const wrap = document.createElement("div");
    wrap.style.cssText = "font-size:13px;line-height:1.4;max-width:260px";
    const add = (html) => { const el = document.createElement("div"); el.innerHTML = html; wrap.appendChild(el); };
    add(`<b>${esc(d.label)}</b>`);
    if (full) add(esc(full));
    add(gps);
    if (a.open) add("🕒 " + esc(a.open));
    if (a.notes) add("📝 " + esc(a.notes));
    const btns = document.createElement("div");
    btns.style.cssText = "margin-top:6px;display:flex;gap:6px;flex-wrap:wrap";
    [["Скопировать адрес", full && full + "\n" + gps], ["Скопировать GPS", gps]].forEach(([t, v]) => {
      if (!v) return;
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = t;
      b.style.cssText = "font-size:12px;padding:3px 8px;border:1px solid #d6dbe3;border-radius:5px;background:#fff;cursor:pointer";
      b.addEventListener("click", () => copyText(v, b));
      btns.appendChild(b);
    });
    wrap.appendChild(btns);
    infoWindow.setContent(wrap);
    infoWindow.open({ map: map, anchor: marker });
  }

  // копирование в буфер обмена; запасной путь, если буфер недоступен (не HTTPS)
  function copyText(t, btn) {
    const old = btn.textContent;
    const done = () => {
      btn.textContent = "✓ скопировано";
      setTimeout(() => { btn.textContent = old; }, 1200);
    };
    const fallback = () => {
      const ta = document.createElement("textarea");
      ta.value = t;
      ta.style.cssText = "position:fixed;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); done(); } catch (e) { /* ничего */ }
      ta.remove();
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(t).then(done, fallback);
    else fallback();
  }

  // v3.368: стоянки по зоне / городу — где чаще паркуются (история Mapon, копится с v3.368): итог, топ мест, метки на карте
  let stopMarks = [], stopDays = "90", stopMinH = "9", stopFrom = "";
  function clearStops() {
    stopMarks.forEach((m) => m.setMap(null));
    stopMarks = [];
    const b = document.getElementById("loc-stops");
    if (b) b.innerHTML = "";
    setTwoCol(false);
    const np = document.getElementById("loc-note-pop"); if (np) np.remove();
  }
  // таблица стоянок слева, карта справа (на узком экране — друг под другом, см. style.css)
  function setTwoCol(on) {
    if (view.classList.contains("loc-2col") === on) return;
    view.classList.toggle("loc-2col", on);
    if (map && window.google) setTimeout(() => google.maps.event.trigger(map, "resize"), 50);
  }
  async function showStops(d, q) {
    clearStops();
    if (d.is_truck) return;
    let box = document.getElementById("loc-stops");
    if (!box) { box = document.createElement("div"); box.id = "loc-stops"; info.insertAdjacentElement("afterend", box); }
    const byCode = d.is_code || !!d.code;
    const key = byCode ? `code=${encodeURIComponent(d.code)}` : `city=${encodeURIComponent(q)}`;
    const what = d.is_code ? `зона ${esc(d.code)}` : byCode ? `«${esc(q)}» → зона ${esc(d.code)}` : `«${esc(q)}» в адресах`;
    box.innerHTML = `<div class="loc-stops-h">Стоянки: загрузка…</div>`;
    setTwoCol(true);
    try {
      const r = await fetch(`/api/stops-where?${key}&days=${stopDays === "all" ? "" : stopDays}&min_h=${stopMinH}${stopFrom ? "&from_side=" + encodeURIComponent(stopFrom) : ""}`);
      const j = await r.json();
      if (j.error) { box.innerHTML = `<div class="loc-err">Стоянки: ${esc(j.error)}</div>`; return; }
      if (j.stops && resultMarker) { resultMarker.setMap(null); resultMarker = null; }   // красная булавка города не нужна, когда есть стоянки
      const dirTxt = (o) => { const e = Object.entries(o || {}).sort((a, b) => b[1] - a[1]); return e.slice(0, 2).map(([k, v]) => `${k}${v > 1 ? "×" + v : ""}`).join(" ") + (e.length > 2 ? " …" : "") || "—"; };
      const NOTE_TAGS = { fuel: ["⛽", "Сливы топлива"], guard: ["🛡", "Охраняется"], shower: ["🚿", "Душ"], wc: ["🚻", "Туалет"], tight: ["⚠", "Мало мест"] };
      const colorOf = (n) => (n && n.ok === "yes" ? "#1b7f45" : n && n.ok === "no" ? "#d64545" : "#2f6fd6");
      const noteHtml = (n) => {
        if (!n || !(n.ok || n.pay || (n.tags && n.tags.length) || n.text)) return `<span class="loc-note-add">＋</span>`;
        return (n.ok === "yes" ? `<b class="ln-ok">✓</b>` : n.ok === "no" ? `<b class="ln-no">✗</b>` : "") +
          (n.pay === "paid" ? `<span title="Платный">💶</span>` : n.pay === "free" ? `<span title="Бесплатный">🆓</span>` : "") +
          (n.tags || []).map((k) => NOTE_TAGS[k] ? `<span title="${NOTE_TAGS[k][1]}">${NOTE_TAGS[k][0]}</span>` : "").join("") +
          (n.text ? ` <i>${esc(n.text.length > 22 ? n.text.slice(0, 22) + "…" : n.text)}</i>` : "");
      };
      const since = j.from ? new Date(j.from * 1000).toLocaleDateString("ru-RU") : "";
      const sidesHtml = `<div class="loc-sides">Еду с: ` + [["", "любой"], ["С", "С"], ["СВ", "СВ"], ["В", "В"], ["ЮВ", "ЮВ"], ["Ю", "Ю"], ["ЮЗ", "ЮЗ"], ["З", "З"], ["СЗ", "СЗ"]].map(([v, t]) => `<button type="button" data-side="${v}"${v === stopFrom ? ' class="on"' : ""}>${t}</button>`).join("") + `</div>`;
      box.innerHTML = `<div class="loc-stops-h"><b>Стоянки</b> (${what}) ` +
 `<span class="loc-stops-s">за 90 сут, от 9 ч</span>` +
        `</div>` +
        sidesHtml + (j.stops ? `<div class="loc-stops-s">${j.stops} стоянок · ${Math.round(j.hours)} ч · ${j.units} машин${since ? ` · с ${since}` : ""}</div><div class="loc-stops-s">Направление: откуда приехали → куда уехали (по соседним длинным стоянкам машины)</div>` +
          `<table class="loc-stops-t">` + j.top.map((t, i) => `<tr data-i="${i}"><td>${t.n}×</td><td>${Math.round(t.hours)} ч</td><td>${t.units} ${t.units === 1 ? "машина" : "машин"}</td><td class="loc-gps">${t.lat}, ${t.lng}</td><td class="loc-dir">${dirTxt(t.from)} → ${dirTxt(t.to)}</td><td>${esc(t.address || t.lat + ", " + t.lng)}</td><td class="loc-note">${noteHtml(t.note)}</td></tr>`).join("") + `</table>`
          : `<div class="loc-stops-s">Стоянок нет${stopFrom ? " с этого направления" : " — история копится с момента запуска сбора (раз в 6 ч)"}.</div>`);
      const tr_clear = () => box.querySelectorAll(".loc-stops-t tr.hl").forEach((x) => x.classList.remove("hl"));
      j.top.forEach((t, i) => {
        const m = new google.maps.Marker({ position: { lat: t.lat, lng: t.lng }, map, zIndex: 900,
          label: { text: String(t.n), color: "#fff", fontSize: "11px", fontWeight: "600" },
          icon: { path: google.maps.SymbolPath.CIRCLE, scale: 11, fillColor: colorOf(t.note), fillOpacity: 0.9, strokeColor: "#fff", strokeWeight: 2 },
          title: `${t.n} стоянок · ${Math.round(t.hours)} ч · ${t.address || ""}` });
        m.addListener("click", () => {   // клик по метке — копирует GPS места (как клик по GPS в таблице)
          const td = box.querySelector(`.loc-stops-t tr[data-i="${i}"] .loc-gps`); if (td) copyGps(td);
        });
        // наоборот: наведение на метку подсвечивает строку таблицы (и прокручивает к ней)
        m.addListener("mouseover", () => {
          const tr = box.querySelector(`.loc-stops-t tr[data-i="${i}"]`); if (!tr) return;
          box.querySelectorAll(".loc-stops-t tr.hl").forEach((x) => x.classList.remove("hl"));
          tr.classList.add("hl");
          if (tr.offsetTop < box.scrollTop || tr.offsetTop + tr.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = Math.max(0, tr.offsetTop - 60);
        });
        m.addListener("mouseout", () => tr_clear());
        stopMarks.push(m);
      });
      const tip = document.createElement("div");
      tip.className = "loc-stops-tip"; tip.hidden = true; box.appendChild(tip);
      const fd = (ts) => { const x = new Date(ts * 1000); return x.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" }) + " " + x.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }); };
      box.querySelectorAll(".loc-stops-t tr").forEach((tr) => {
        tr.addEventListener("mouseenter", () => {
          const t = j.top[+tr.dataset.i];
          tip.innerHTML = t.list.map((r) => `<div><b>${esc(r.u)}</b> · ${r.f || "—"} → ${r.t || "—"} · ${fd(r.s)} → ${fd(r.e)} · ${Math.round((r.e - r.s) / 360) / 10} ч</div>`).join("") +
            (t.n > t.list.length ? `<div class="loc-stops-more">…и ещё ${t.n - t.list.length}</div>` : "");
          tip.hidden = false;
          blink(+tr.dataset.i);
        });
        tr.addEventListener("mousemove", (e) => {
          const b = box.getBoundingClientRect();
          tip.style.left = Math.max(0, Math.min(e.clientX - b.left + 14, b.width - tip.offsetWidth)) + "px";
          tip.style.top = (e.clientY - b.top + 30) + "px";
        });
        tr.addEventListener("mouseleave", () => { tip.hidden = true; blink(-1); });
      });
      box.querySelectorAll(".loc-sides button").forEach((b) => b.addEventListener("click", () => { stopFrom = b.dataset.side; showStops(d, q); }));
      let blinkT = null;
      const blink = (i) => {   // метка места моргает зелёным: при наведении на строку, до ухода курсора (~3 с)
        clearInterval(blinkT);
        stopMarks.forEach((m, k) => m.setIcon(Object.assign({}, m.getIcon(), { fillColor: colorOf(j.top[k].note) })));
        const m = stopMarks[i]; if (!m) return;
        let k = 0;
        const step = () => { m.setIcon(Object.assign({}, m.getIcon(), { fillColor: k % 2 ? colorOf(j.top[i].note) : "#1fbf4a" })); m.setZIndex(k % 2 ? 900 : 1200); };
        step();
        blinkT = setInterval(() => { k++; step(); if (k >= 9) { clearInterval(blinkT); m.setIcon(Object.assign({}, m.getIcon(), { fillColor: colorOf(j.top[i].note) })); m.setZIndex(900); } }, 350);
      };
      const copyGps = (td) => {
        const txt = td.dataset.gps || td.textContent;
        td.dataset.gps = txt;
        const done = () => { td.textContent = "скопировано"; setTimeout(() => { td.textContent = txt; }, 1000); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, () => {});
        else { const a = document.createElement("textarea"); a.value = txt; document.body.appendChild(a); a.select(); document.execCommand("copy"); a.remove(); done(); }
      };
      box.querySelectorAll(".loc-gps").forEach((td) => td.addEventListener("click", (e) => {
        e.stopPropagation();
        const t = j.top[+td.parentNode.dataset.i]; map.panTo({ lat: t.lat, lng: t.lng }); blink(+td.parentNode.dataset.i);
        copyGps(td);
      }));
      // заметка о паркинге: клик по ячейке — карточка у места клика, сохраняется сама
      const closeNote = () => { const o = document.getElementById("loc-note-pop"); if (o) o.remove(); document.removeEventListener("mousedown", outNote, true); };
      const outNote = (e) => { const o = document.getElementById("loc-note-pop"); if (o && !o.contains(e.target)) closeNote(); };
      box.querySelectorAll(".loc-note").forEach((td) => td.addEventListener("click", (e) => {
        e.stopPropagation();
        closeNote();
        const i = +td.parentNode.dataset.i, t = j.top[i];
        const st = Object.assign({ ok: "", pay: "", tags: [], text: "" }, t.note || {});
        const pop = document.createElement("div");
        pop.id = "loc-note-pop"; pop.className = "loc-note-pop";
        const btn = (grp, v, txt, on) => `<button type="button" data-g="${grp}" data-v="${v}"${on ? ' class="on"' : ""}>${txt}</button>`;
        const draw = () => {
          pop.innerHTML = `<div class="lnp-h">${esc(t.address || t.lat + ", " + t.lng)}<span class="lnp-x">×</span></div>` +
            `<div class="lnp-r">${btn("ok", "yes", "Норм", st.ok === "yes")}${btn("ok", "no", "Нет", st.ok === "no")}</div>` +
            `<div class="lnp-r">${btn("pay", "paid", "Платный", st.pay === "paid")}${btn("pay", "free", "Бесплатный", st.pay === "free")}</div>` +
            `<div class="lnp-r">${Object.entries(NOTE_TAGS).map(([k, v]) => btn("tag", k, v[0] + " " + v[1], st.tags.includes(k))).join("")}</div>` +
            `<textarea rows="2" maxlength="300" placeholder="Заметка (цена, охрана, как заехать…)">${esc(st.text)}</textarea>` +
            `<div class="lnp-s">${t.note && t.note.by ? "Менял: " + esc(t.note.by) : ""}</div>`;
        };
        const save = async () => {
          try {
            const r = await fetch("/api/parking-note", { method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ lat: t.lat, lng: t.lng, ok: st.ok, pay: st.pay, tags: st.tags, text: st.text }) });
            const jj = await r.json();
            if (jj.note) {
              t.note = jj.note; td.innerHTML = noteHtml(t.note);
              if (stopMarks[i]) stopMarks[i].setIcon(Object.assign({}, stopMarks[i].getIcon(), { fillColor: colorOf(t.note) }));
              const sEl = pop.querySelector(".lnp-s"); if (sEl) sEl.textContent = "Сохранено";
            }
          } catch (err) { const sEl = pop.querySelector(".lnp-s"); if (sEl) sEl.textContent = "Не удалось сохранить"; }
        };
        draw();
        pop.addEventListener("click", (ev) => {
          if (ev.target.closest(".lnp-x")) { closeNote(); return; }
          const bt = ev.target.closest("button"); if (!bt) return;
          const g = bt.dataset.g, v = bt.dataset.v;
          if (g === "ok" || g === "pay") st[g] = st[g] === v ? "" : v;
          else st.tags = st.tags.includes(v) ? st.tags.filter((x) => x !== v) : st.tags.concat(v);
          draw(); save();
        });
        pop.addEventListener("focusout", (ev) => { if (ev.target.tagName === "TEXTAREA" && ev.target.value !== st.text) { st.text = ev.target.value; save(); } });
        document.body.appendChild(pop);
        const w = pop.offsetWidth, h = pop.offsetHeight;
        pop.style.left = Math.max(8, Math.min(e.clientX - 20, window.innerWidth - w - 8)) + "px";
        pop.style.top = Math.max(8, Math.min(e.clientY + 12, window.innerHeight - h - 8)) + "px";
        document.addEventListener("mousedown", outNote, true);
      }));
      box.querySelectorAll(".loc-stops-t tr").forEach((tr) => tr.addEventListener("click", () => {
        const t = j.top[+tr.dataset.i]; map.panTo({ lat: t.lat, lng: t.lng }); map.setZoom(15); blink(+tr.dataset.i);
      }));
    } catch (e) {
      box.innerHTML = `<div class="loc-err">Стоянки: не удалось загрузить.</div>`;
    }
  }

  async function locate(q) {
    if (!map) { pendingQuery = q; return; }
    clearStops();
    stopFrom = "";
    info.textContent = "Ищу…";
    try {
      const res = await fetch("/api/locate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q }),
      });
      const d = await res.json();
      if (d.error) {
        info.innerHTML = `<span class="loc-err">${esc(d.error)}</span>`;
        return;
      }

      if (resultMarker) resultMarker.setMap(null);
      resultMarker = null;
      const codeP = codeByKey[d.code];

      if (d.is_code) {
        info.innerHTML = `<b>${esc(d.code)}</b> — ${esc(d.code_place)}`;
      } else {
        resultMarker = new google.maps.Marker({
          position: { lat: d.lat, lng: d.lng },
          map: map,
          title: d.label,
          zIndex: 1000,
          label: d.is_truck ? { text: "🚚", fontSize: "16px" } : null,
        });
        info.innerHTML = `${esc(d.label)} &nbsp;→&nbsp; ближайший код <b>${esc(d.code)}</b> — ${esc(d.code_place)}`
          + ` <span style="color:#888">(${d.dist_km} км до центра зоны)</span>`;
        if (d.address) {
          // v3.53: полный адрес и ГПС из адресной базы (если есть в таблице)
          const a = d.address;
          const gpsLine = /^-?\d+[.,]\d+\s*,\s*-?\d+[.,]\d+$/;
          const full = String(a.full || "").split("\n").map((x) => x.trim()).filter((x) => x && !gpsLine.test(x)).join(", ");
          const bits = [full && `📍 ${full}`, `${Number(d.lat).toFixed(5)}, ${Number(d.lng).toFixed(5)}`,
            a.open && `🕒 ${a.open}`, a.notes && `📝 ${a.notes}`].filter(Boolean).map(esc);
          info.innerHTML += `<div class="loc-addr">${bits.join("<br>")}</div>`;
        }
      }

      map.setZoom(d.is_truck ? 16 : 8);   // v3.61: машина — зум 16
      map.panTo({ lat: d.lat, lng: d.lng });
      highlightCode = d.code;
      if (overlay) overlay.scheduleDraw();
      if (!d.is_code && !d.is_truck && resultMarker) openPointInfo(d, resultMarker);   // точка по названию — свой попап
      else if (codeP) openCodeInfo(codeP);
      showStops(d, q);
    } catch (e) {
      info.innerHTML = `<span class="loc-err">Ошибка запроса. Попробуйте ещё раз.</span>`;
    }
  }

  // v1.26: поиск тремя способами — Enter, кнопка "Локатор" (если поле заполнено),
  // выбор значения из выпадающих подсказок
  btn.addEventListener("click", () => {
    showLocator();
    const q = input.value.trim();
    if (q) locate(q);
  });
  input.addEventListener("input", (e) => {
    // выбор из datalist: Chrome/Edge — inputType "insertReplacementText", Firefox — без inputType
    const picked = e.inputType === "insertReplacementText" || e.inputType === undefined;
    if (!picked) return;
    const q = input.value.trim();
    if (!q) return;
    const inList = [...document.querySelectorAll("#points-list option")].some((o) => o.value === q);
    if (!inList) return;
    showLocator();
    locate(q);
  });
  // клик по стране — вернуть обычную карту страны
  pcTabs.addEventListener("click", (e) => { if (e.target.closest(".pc-tab")) hideLocator(); }, true);
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const q = input.value.trim();
    if (!q) return;
    showLocator();
    locate(q);
  });
})();
