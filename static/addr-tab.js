// v3.152: вкладка «Адреса» (📍) — поиск по базе, карточка, проверка дубля и форма нового адреса.
// Отправка на аппрув пока не подключена (лист «Предложения» — BACKLOG.md). Весь текст — через textContent.
(function () {
  "use strict";
  if (!document.getElementById("addrQuery")) return;

  const SEARCH_DELAY_MS = 180;
  const SHOW_MAX = 30;
  const DUP_RADIUS_M = 150;
  const DUP_MAX = 5;
  const TYPE_RU = { load: "погрузка", unload: "выгрузка", port: "порт", customs: "таможня", misc: "прочее" };

  const $ = (id) => document.getElementById(id);

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function norm(s) {
    return String(s || "").toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").trim();
  }

  function parseGps(text) {
    const m = String(text || "").match(/(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/);
    if (!m) return null;
    const lat = Number(m[1]), lng = Number(m[2]);
    return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat: lat, lng: lng } : null;
  }

  function distM(a, b) {
    const R = 6371000, t = Math.PI / 180;
    const dLat = (b.lat - a.lat) * t, dLng = (b.lng - a.lng) * t;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function baseList() {
    return Array.isArray(window.addressList) ? window.addressList : [];
  }

  function addrGps(a) {
    return a && a.lat != null && a.lng != null ? { lat: a.lat, lng: a.lng } : null;
  }

  function gpsText(g) {
    return g ? g.lat + ", " + g.lng : "";
  }

  function matches(a, q) {
    return [a.name, a.alias, a.full, a.city, a.supplier].some((f) => norm(f).includes(q));
  }

  function describe(a) {
    return [a.country, a.city, TYPE_RU[a.type] || a.type].filter(Boolean).join(" · ");
  }

  // ---------- поиск ----------
  let searchTimer = null;

  function runSearch() {
    const q = norm($("addrQuery").value);
    const res = $("addrResults"), info = $("addrSearchInfo");
    res.textContent = "";
    if (!q) { info.textContent = ""; return; }
    const list = baseList();
    if (!list.length) { info.textContent = "База ещё загружается…"; return; }
    const found = list.filter((a) => matches(a, q));
    if (!found.length) info.textContent = "Ничего не нашли. Можно добавить новый адрес.";
    else if (found.length > SHOW_MAX) info.textContent = "Найдено " + found.length + ", показаны первые " + SHOW_MAX + " — уточните запрос.";
    else info.textContent = "Найдено: " + found.length;
    found.slice(0, SHOW_MAX).forEach((a) => res.appendChild(addressRow(a)));
  }

  function addressRow(a) {
    const b = el("button", "addr-row", null);
    b.type = "button";
    b.appendChild(el("div", "addr-row-name", a.name));
    b.appendChild(el("div", "addr-row-meta", describe(a)));
    b.addEventListener("click", () => showCard(a));
    return b;
  }

  // ---------- карточка найденного адреса ----------
  function showCard(a) {
    const card = $("addrCard");
    card.textContent = "";
    card.appendChild(el("div", "addr-card-name", a.name));
    const rows = [
      ["Адрес", a.full], ["Страна", a.country], ["Тип", TYPE_RU[a.type] || a.type],
      ["GPS", gpsText(addrGps(a))], ["Клиент", a.client], ["Поставщик", a.supplier], ["Заметка", a.notes],
    ];
    rows.forEach(([k, v]) => {
      if (!v) return;
      const r = el("div", "addr-card-row");
      r.appendChild(el("span", "addr-card-key", k));
      r.appendChild(el("span", "addr-card-val", v));
      card.appendChild(r);
    });
    const bar = el("div", "addr-actions");
    const fix = el("button", "addr-btn-primary", "Предложить правку");
    fix.type = "button";
    fix.addEventListener("click", () => openForm("edit", a));
    const other = el("button", "addr-btn", "Это другая площадка");
    other.type = "button";
    other.addEventListener("click", () => openForm("new", null));
    bar.appendChild(fix);
    bar.appendChild(other);
    card.appendChild(bar);
    card.hidden = false;
  }

  // ---------- форма ----------
  let editSource = null;

  function setVal(id, v) {
    $(id).value = v == null ? "" : String(v);
  }

  function openForm(mode, a) {
    editSource = mode === "edit" ? a : null;
    $("addrFormTitle").textContent = mode === "edit" ? "Правка: " + a.name : "Новый адрес";
    setVal("af-name", a ? a.name : "");
    setVal("af-country", a ? a.country : "");
    setVal("af-gps", a ? gpsText(addrGps(a)) : "");
    setVal("af-full", a ? a.full : "");
    setVal("af-type", a ? a.type : "");
    setVal("af-client", a ? a.client : "");
    setVal("af-supplier", a ? a.supplier : "");
    setVal("af-notes", a ? a.notes : "");
    document.querySelectorAll("#addrForm .addr-err").forEach((e) => { e.textContent = ""; });
    $("addrFormMsg").textContent = "";
    $("addrForm").hidden = false;
    checkDup();
    $("addrForm").scrollIntoView({ block: "nearest" });
  }

  function readForm() {
    const gpsRaw = $("af-gps").value.trim();
    return {
      name: $("af-name").value.trim(),
      country: $("af-country").value.trim().toUpperCase(),
      gpsRaw: gpsRaw,
      gps: parseGps(gpsRaw),
    };
  }

  // проверка дубля: тот же Name или GPS в радиусе DUP_RADIUS_M (сама редактируемая запись не в счёт)
  function checkDup() {
    const box = $("addrDup");
    box.textContent = "";
    box.hidden = true;
    const f = readForm();
    const n = norm(f.name);
    const hits = baseList().filter((a) => {
      if (editSource && a === editSource) return false;
      const g = addrGps(a);
      const sameName = n && norm(a.name) === n;
      const near = f.gps && g && distM(f.gps, g) <= DUP_RADIUS_M;
      return sameName || near;
    }).slice(0, DUP_MAX);
    if (!hits.length) return;
    box.hidden = false;
    box.appendChild(el("div", "addr-dup-title", "Похоже, это уже есть в базе:"));
    hits.forEach((a) => {
      const g = addrGps(a);
      const d = f.gps && g ? Math.round(distM(f.gps, g)) : null;
      const row = addressRow(a);
      const meta = row.querySelector(".addr-row-meta");
      if (d != null) meta.textContent = meta.textContent + " · " + d + " м от введённых координат";
      box.appendChild(row);
    });
  }

  function setErr(id, msg) {
    const e = document.querySelector('#addrForm .addr-err[data-for="' + id + '"]');
    if (e) e.textContent = msg || "";
  }

  function validate(f) {
    let ok = true;
    setErr("af-name", "");
    setErr("af-country", "");
    setErr("af-gps", "");
    if (!f.name) { setErr("af-name", "Введите Name"); ok = false; }
    if (!/^[A-Z]{2}$/.test(f.country)) { setErr("af-country", "Две латинские буквы, например LV"); ok = false; }
    if (!f.gps) { setErr("af-gps", "Координаты вида 51.48302, 4.72959"); ok = false; }
    return ok;
  }

  // ---------- подключение ----------
  $("addrQuery").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, SEARCH_DELAY_MS);
  });

  $("addrNewBtn").addEventListener("click", () => openForm("new", null));

  // v3.163: Ctrl+клик по полю таргета — вкладка «Адреса» с текстом поля и карточкой найденного адреса
  // v3.164: если в тексте ГПС — список адресов в радиусе 150 м (ближайшие сверху); иначе — поиск по названию
  window.addrOpenFor = (text) => {
    if (window.leftPanelOpen) window.leftPanelOpen("addr");
    const raw = String(text || "").trim();
    $("addrQuery").value = raw;
    const g = parseGps(raw);
    if (g) { nearbyByGps(g); return; }
    runSearch();
    const q = norm(raw);
    if (!q) return;
    const list = baseList();
    const hit = list.find((a) => norm(a.name) === q) || list.find((a) => matches(a, q));
    if (hit) showCard(hit);
  };

  function nearbyByGps(g) {
    const res = $("addrResults"), info = $("addrSearchInfo");
    res.textContent = "";
    const near = baseList()
      .map((a) => ({ a: a, d: addrGps(a) ? distM(g, addrGps(a)) : Infinity }))
      .filter((x) => x.d <= DUP_RADIUS_M)
      .sort((x, y) => x.d - y.d);
    if (!near.length) { info.textContent = "В радиусе " + DUP_RADIUS_M + " м по ГПС адресов в базе нет."; return; }
    info.textContent = "Рядом с ГПС (до " + DUP_RADIUS_M + " м): " + near.length;
    near.slice(0, SHOW_MAX).forEach((x) => {
      const r = addressRow(x.a);
      r.querySelector(".addr-row-meta").textContent = Math.round(x.d) + " м · " + describe(x.a);
      res.appendChild(r);
    });
  }

  $("addrCancelBtn").addEventListener("click", () => {
    $("addrForm").hidden = true;
    editSource = null;
  });

  ["af-name", "af-gps"].forEach((id) => $(id).addEventListener("input", checkDup));

  document.querySelectorAll("#addrForm .addr-input").forEach((i) => {
    i.addEventListener("input", () => setErr(i.id, ""));
  });

  $("addrForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const msg = $("addrFormMsg");
    if (!validate(readForm())) { msg.textContent = ""; return; }
    msg.textContent = "Поля заполнены верно. Отправка на аппрув ещё не подключена: данные пока никуда не сохраняются.";
  });

  // v3.165: ГПС в поле точки → Name ближайшего адреса из базы в радиусе 150 м. Срабатывает при уходе из поля и по Enter.
  // v3.166: все адреса в радиусе, по имени без повторов, ближайшие сверху
  function gpsCandidates(g) {
    const seen = new Set(), out = [];
    baseList().forEach((a) => {
      const ag = addrGps(a);
      if (!ag || !a.name || seen.has(a.name)) return;
      const d = distM(g, ag);
      if (d <= DUP_RADIUS_M) { seen.add(a.name); out.push({ a: a, d: d }); }
    });
    return out.sort((x, y) => x.d - y.d);
  }

  function applyPoint(inp, name) {
    inp.value = name;
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    inp.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // один адрес — подставляем сразу; несколько — выбор у поля (v3.166)
  function gpsSubstitute(inp) {
    const g = parseGps(inp.value);
    if (!g) return false;
    const list = gpsCandidates(g);
    if (!list.length) return false;
    if (list.length === 1) { applyPoint(inp, list[0].a.name); return true; }
    showGpsPick(inp, list);
    return true;
  }

  let gpsPickEl = null;
  function closeGpsPick() {
    if (gpsPickEl) { gpsPickEl.remove(); gpsPickEl = null; }
  }

  function showGpsPick(inp, list) {
    closeGpsPick();
    const box = el("div", "gps-pick");
    box.appendChild(el("div", "gps-pick-head", "Рядом несколько адресов — выберите:"));
    list.slice(0, 8).forEach((x) => {
      const b = el("button", "gps-pick-row", null);
      b.type = "button";
      b.appendChild(el("span", "gps-pick-name", x.a.name));
      b.appendChild(el("span", "gps-pick-d", Math.round(x.d) + " м"));
      b.addEventListener("click", () => { closeGpsPick(); applyPoint(inp, x.a.name); });
      box.appendChild(b);
    });
    const r = inp.getBoundingClientRect();
    box.style.left = (r.left + window.scrollX) + "px";
    box.style.top = (r.bottom + window.scrollY + 4) + "px";
    box.style.minWidth = Math.max(r.width, 260) + "px";
    document.body.appendChild(box);
    gpsPickEl = box;
  }

  document.addEventListener("mousedown", (e) => {
    if (gpsPickEl && !gpsPickEl.contains(e.target)) closeGpsPick();
  }, true);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeGpsPick();
  }, true);
  const isPointInput = (t) => t && t.matches && t.matches('input[list="points-list"]');
  document.addEventListener("focusout", (e) => {
    if (isPointInput(e.target)) gpsSubstitute(e.target);
  }, true);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && isPointInput(e.target)) gpsSubstitute(e.target);
  }, true);

  // v3.164: Ctrl/Cmd+клик по любому полю ввода точки (таргет, From / To, From → To, Локатор) — «Адреса».
  // Поля таргета во Флоте обрабатывает app.js (там же строка трипа); здесь — все остальные.
  document.addEventListener("click", (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const inp = e.target && e.target.closest && e.target.closest('input[list="points-list"]');
    if (!inp || inp.closest("#fleet-tbody")) return;
    e.preventDefault();
    window.addrOpenFor(inp.value);
  }, true);
})();
