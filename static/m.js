// Лёгкая мобильная страница /m (просмотр). Один запрос /api/m/trips; последний снимок — в localStorage, чтобы карточки были сразу.
(function () {
  const KEY = "fetat_m_v1", POLL_MS = 60000;
  const list = document.getElementById("m-list"), updEl = document.getElementById("m-upd");
  const allBtn = document.getElementById("m-all"), refBtn = document.getElementById("m-ref");
  const NUM = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];
  let showAll = false, busy = false, openIds = new Set();
  try { showAll = localStorage.getItem(KEY + "_all") === "1"; } catch (e) { /* ignore */ }

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // опаздывает ли точка: окно Delivery из delivery-check.js против её ETA
  function isLate(p) {
    try { return !!(p.w && p.eta && !p.done && deliveryCheck({ delivery: p.w }, p.eta).late); } catch (e) { return false; }
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
    return `<div class="mc${late ? " late" : ""}${openIds.has(t.id) ? " open" : ""}" data-id="${esc(t.id)}">${head}${eta}${next}${more}</div>`;
  }

  function render(d, stale) {
    allBtn.textContent = showAll ? "Все" : "Мои";
    allBtn.classList.toggle("on", showAll);
    list.innerHTML = d.trips.length ? d.trips.map(card).join("") : '<p class="m-empty">Трипов нет</p>';
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
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
  setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
  load();
})();
