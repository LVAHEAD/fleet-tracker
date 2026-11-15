// Лёгкая мобильная страница /m (просмотр). Один запрос /api/m/trips; последний снимок — в localStorage, чтобы карточки были сразу.
(function () {
  const KEY = "fetat_m_v1", POLL_MS = 60000;
  const list = document.getElementById("m-list"), updEl = document.getElementById("m-upd");
  const allBtn = document.getElementById("m-all"), refBtn = document.getElementById("m-ref");
  const NUM = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];
  let showAll = false, busy = false, openIds = new Set(), cur = null;
  let loF = "all", days = [];   // фильтр L/O и сдвиги дней (0 = T, 1 = +1, 2 = +2)
  try {
    showAll = localStorage.getItem(KEY + "_all") === "1";
    loF = localStorage.getItem(KEY + "_lo") || "all";
    days = JSON.parse(localStorage.getItem(KEY + "_days") || "[]");
  } catch (e) { /* ignore */ }
  if (!["all", "L", "O"].includes(loF)) loF = "all";
  if (!Array.isArray(days)) days = [];

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // опаздывает ли точка: окно Delivery из delivery-check.js против её ETA
  function isLate(p) {
    try { return !!(p.w && p.eta && !p.done && deliveryCheck({ delivery: p.w }, p.eta).late); } catch (e) { return false; }
  }

  // та же логика, что на десктопе (fleet-sort-filter.js): тип строки — L / O первой непройденной точки с отметкой
  const firstOpen = (t) => (t.pts || []).findIndex((p) => !p.done);
  function loKind(t) {
    const pts = t.pts || [];
    for (let i = firstOpen(t); i >= 0 && i < pts.length; i++) if (pts[i].lo === "L" || pts[i].lo === "O") return pts[i].lo;
    return "";
  }
  const dayKey = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  function winDays(txt) {   // дни окна TimeSlot точки
    let w = null;
    try { w = parseDeliveryWindow(txt); } catch (e) { /* ignore */ }
    if (!w) return [];
    const a = w.start || w.end, b = w.end || w.start;
    if (!a || !b) return [];
    const d = new Date(a.getFullYear(), a.getMonth(), a.getDate()), last = new Date(b.getFullYear(), b.getMonth(), b.getDate()), out = [];
    for (let i = 0; i < 14 && d <= last; i++) { out.push(dayKey(d)); d.setDate(d.getDate() + 1); }
    return out;
  }
  function passDays(t) {
    if (!days.length) return true;
    const k = firstOpen(t);
    if (k < 0) return true;
    const set = new Set();
    t.pts.slice(k).forEach((p) => winDays(p.w).forEach((x) => set.add(x)));
    if (!set.size) return true;   // даты нет — не прячем
    return days.some((n) => { const d = new Date(); d.setDate(d.getDate() + n); return set.has(dayKey(d)); });
  }
  function loadKey(t) {   // «Загрузка»: дата Delivery первой точки ①
    let w = null;
    try { w = t.pts[0] && t.pts[0].w ? parseDeliveryWindow(t.pts[0].w) : null; } catch (e) { /* ignore */ }
    const x = w ? (w.start || w.end) : null;
    return x ? { day: new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(), t: x.getTime() } : null;
  }
  function view(trips) {
    const keyed = trips.map((t, i) => ({ t, i, k: loadKey(t) }));
    keyed.sort((x, y) => {
      if ((x.k == null) !== (y.k == null)) return x.k == null ? 1 : -1;
      if (x.k && x.k.day !== y.k.day) return x.k.day - y.k.day;
      const c = String(x.t.cl || "").localeCompare(String(y.t.cl || ""), "ru", { sensitivity: "base" });
      if (c) return c;
      if (x.k && x.k.t !== y.k.t) return x.k.t - y.k.t;
      return x.i - y.i;
    });
    return keyed.map((x) => x.t).filter((t) => (loF === "all" || loKind(t) === loF) && passDays(t));
  }

  function card(t) {
    const pts = t.pts || [];
    let k = pts.findIndex((p) => !p.done);
    const allDone = k < 0;
    if (allDone) k = pts.length - 1;
    const nx = pts[k] || {};
    const late = pts.some(isLate);
    const st = t.st === "driving" ? '<span class="go">▶</span>' : (t.st ? '<span class="stop">■</span>' : "");
    const km = nx.km != null ? ` · ${Math.round(nx.km)} км` : "";
    const chips = (t.wk ? '<span class="chip">56</span>' : "") + (late ? '<span class="chip">⚠ опоздает</span>' : "") + (t.out ? '<span class="chip">аутсорс</span>' : "");
    const head = `<div class="mc-h"><span class="mc-unit">${esc(t.unit)}</span>${t.disp ? `<span class="mc-disp">${esc(t.disp)}</span>` : ""}${chips}<span class="mc-st">${esc(t.cc || "")} ${st} ${esc(t.dur || "")}</span></div>`;
    const eta = t.error ? `<div class="mc-err">${esc(t.error)}</div>`
      : `<div class="mc-eta">${allDone ? "все точки ✓" : esc(nx.eta || "—")}${allDone ? "" : ` <small>${NUM[k] || k + 1}${km}</small>`}</div>`;
    const next = allDone ? "" : `<div class="mc-next">${esc(nx.t)}</div>`;
    const rows = pts.map((p, i) => `<div class="pt${p.done ? " done" : ""}"><span class="pt-n">${p.done ? "✓" : NUM[i] || i + 1}</span><span class="pt-t">${esc(p.t)}${p.w ? `<span class="pt-w">${esc(p.w)}</span>` : ""}</span><span class="pt-r">${p.done ? "" : esc(p.eta || "")}${!p.done && p.km != null && i ? `<br>${Math.round(p.km)} км` : ""}</span></div>`).join("");
    const dest = nx.t ? `<a href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(nx.t)}" target="_blank" rel="noopener">🧭 Маршрут</a>` : "";
    const more = `<div class="mc-more">${rows}${t.trailer ? `<div class="mc-com">Прицеп: ${esc(t.trailer)}</div>` : ""}${t.comment ? `<div class="mc-com">${esc(t.comment)}</div>` : ""}<div class="mc-act">${dest}</div></div>`;
    const lk = loKind(t);
    return `<div class="mc${lk ? " lo-" + lk : ""}${late ? " late" : ""}${openIds.has(t.id) ? " open" : ""}" data-id="${esc(t.id)}">${head}${eta}${next}${more}</div>`;
  }

  function render(d, stale) {
    allBtn.textContent = showAll ? "Все" : "Мои";
    allBtn.classList.toggle("on", showAll);
    cur = d;
    document.querySelectorAll("[data-lo]").forEach((b) => b.classList.toggle("on", b.dataset.lo === loF));
    document.querySelectorAll("[data-day]").forEach((b) => b.classList.toggle("on", days.includes(+b.dataset.day)));
    const v = view(d.trips);
    list.innerHTML = v.length ? v.map(card).join("") : '<p class="m-empty">Трипов нет</p>';
    const t = new Date(d.at || Date.now());
    updEl.textContent = (stale ? "из памяти · " : "") + String(t.getHours()).padStart(2, "0") + ":" + String(t.getMinutes()).padStart(2, "0");
  }

  async function load() {
    if (busy) return;
    busy = true; refBtn.classList.add("on");
    try {
      const r = await fetch("/api/m/trips" + (showAll ? "?all=1" : ""), { credentials: "same-origin" });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || "ошибка");
      d.at = Date.now();
      try { localStorage.setItem(KEY + (showAll ? "_a" : "_m"), JSON.stringify(d)); } catch (e) { /* ignore */ }
      render(d, false);
    } catch (e) {
      updEl.textContent = "нет связи";
    } finally { busy = false; refBtn.classList.remove("on"); }
  }

  // мгновенно — последний снимок, потом свежие данные
  try {
    const s = JSON.parse(localStorage.getItem(KEY + (showAll ? "_a" : "_m")) || "null");
    if (s && s.trips) render(s, true);
  } catch (e) { /* ignore */ }

  list.addEventListener("click", (ev) => {
    if (ev.target.closest("a")) return;
    const c = ev.target.closest(".mc");
    if (!c) return;
    const id = c.dataset.id;
    c.classList.toggle("open");
    if (c.classList.contains("open")) openIds.add(id); else openIds.delete(id);
  });
  allBtn.addEventListener("click", () => {
    showAll = !showAll;
    try { localStorage.setItem(KEY + "_all", showAll ? "1" : "0"); } catch (e) { /* ignore */ }
    list.innerHTML = '<p class="m-empty">Загрузка…</p>';
    load();
  });
  refBtn.addEventListener("click", load);
  document.querySelector(".mfl").addEventListener("click", (ev) => {
    const b = ev.target.closest("button");
    if (!b || !cur) return;
    if (b.dataset.lo) loF = b.dataset.lo;
    if (b.dataset.day) { const n = +b.dataset.day; days = days.includes(n) ? days.filter((x) => x !== n) : days.concat(n); }
    try { localStorage.setItem(KEY + "_lo", loF); localStorage.setItem(KEY + "_days", JSON.stringify(days)); } catch (e) { /* ignore */ }
    render(cur, false);
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
  setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
  load();
})();
// v3.317: PWA — service worker (оболочка без сети)
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw-m.js", { scope: "/m" }).catch(() => { /* не критично */ });
