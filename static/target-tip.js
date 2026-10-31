/* target-tip.js — всплывашка у поля «Таргет» в стиле аппы вместо подсказки браузера (v3.250).
   Наведение 1 с (как у других всплывашек) — карточка адреса из базы «Адреса»: название, адрес, GPS (с кнопкой «копировать»), Open, тип · клиент · поставщик, заметка.
   Адреса нет в базе — текст прежней подсказки (координаты, перецеп). Подсказку браузера (title) на время наведения убираем. */
(function () {
  if (typeof document === "undefined") return;
  const SEL = 'input[list="points-list"]';
  let card = null, cur = null, tShow = 0, tHide = 0;
  // значок «копировать» — как в карточке «Адреса» (addr-tab.js)
  const COPY_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15V6a2 2 0 0 1 2-2h9"></path></svg>';
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise((ok, bad) => {
      const t = document.createElement("textarea");
      t.value = text; t.style.position = "fixed"; t.style.opacity = "0";
      document.body.appendChild(t); t.select();
      let r = false; try { r = document.execCommand("copy"); } catch (e) {}
      t.remove(); r ? ok() : bad();
    });
  }
  const esc = (s) => (typeof escapeHtml === "function" ? escapeHtml(s) : String(s));

  function findAddr(v) {
    const q = String(v || "").trim().toLowerCase();
    if (!q) return null;
    return (window.addressList || []).find((x) =>
      String(x.name || "").trim().toLowerCase() === q || String(x.alias || "").trim().toLowerCase() === q) || null;
  }
  function html(inp) {
    const a = findAddr(inp.value), tip = inp.dataset.ttTitle || "";
    const extra = tip.split("\n").filter((l) => /^Перецеп: /.test(l));   // строки других модулей (swap-chain.js)
    if (!a) return tip.trim() ? `<div class="tt-l">${esc(tip).replace(/\n/g, "<br>")}</div>` : "";
    const cp = (lbl, v) => `<button type="button" class="addr-copy" data-cp="${esc(v)}" title="Копировать: ${lbl}" aria-label="Копировать: ${lbl}">${COPY_SVG}</button>`;
    const row = (k, v, c) => (v ? `<div class="tt-k">${k}</div><div${c ? ' class="tt-cp"' : ""}>${esc(v)}${c ? cp(k.toLowerCase(), v) : ""}</div>` : "");
    const gps = a.lat != null && a.lng != null ? `${Number(a.lat).toFixed(5)}, ${Number(a.lng).toFixed(5)}` : "";
    const kind = [(typeof ADDR_TYPE_RU !== "undefined" && ADDR_TYPE_RU[a.type]) || a.type, a.client, a.supplier].filter(Boolean).join(" · ");
    return `<div class="mtc-h tt-cp"><b>${esc(a.name)}</b>${a.country ? ` <span class="tt-cc">${esc(a.country)}</span>` : ""}${cp("название", a.name)}</div>`
      + `<div class="tt-g">${row("Адрес", a.full, 1)}${row("GPS", gps, 1)}${row("Open", a.open)}${row("Тип", kind)}${row("Заметка", a.notes)}</div>`
      + extra.map((l) => `<div class="tt-l">${esc(l)}</div>`).join("");
  }
  function hide() {
    clearTimeout(tShow);
    if (card) { card.remove(); card = null; }
  }
  function show(inp) {
    hide();
    if (!inp.isConnected || document.activeElement === inp) return;
    const h = html(inp);
    if (!h) return;
    card = document.createElement("div");
    card.className = "mt-card tt-card";
    card.innerHTML = h;
    document.body.appendChild(card);
    const r = inp.getBoundingClientRect(), z = typeof uiZoom === "function" ? uiZoom() : 1;
    const top = r.bottom + card.offsetHeight * z + 8 > window.innerHeight ? Math.max(8, r.top - card.offsetHeight * z - 4) : r.bottom + 4;
    card.style.left = Math.max(8, Math.min(r.left, window.innerWidth - card.offsetWidth * z - 8)) / z + "px";
    card.style.top = top / z + "px";
    card.addEventListener("mouseenter", () => clearTimeout(tHide));
    card.addEventListener("mouseleave", () => { tHide = setTimeout(hide, 250); });
    card.addEventListener("click", (ev) => {
      const b = ev.target.closest(".addr-copy");
      if (!b) return;
      copyText(b.dataset.cp).then(() => { b.classList.add("ok"); setTimeout(() => b.classList.remove("ok"), 1500); }).catch(() => {});
    });
  }
  function restore() {
    if (cur && cur.dataset.ttTitle !== undefined) { if (!cur.title) cur.title = cur.dataset.ttTitle; delete cur.dataset.ttTitle; }
    cur = null;
  }
  // слушатель app.js (подставляет title из базы) подключён раньше — к этому моменту title уже свежий
  document.addEventListener("mouseover", (e) => {
    const inp = e.target.closest && e.target.closest(SEL);
    if (!inp || inp === cur) return;
    restore();
    cur = inp;
    inp.dataset.ttTitle = inp.title || "";
    inp.title = "";   // без подсказки браузера
    clearTimeout(tHide);
    clearTimeout(tShow);
    if (document.activeElement !== inp) tShow = setTimeout(() => show(inp), 1000);
  });
  document.addEventListener("mouseout", (e) => {
    const inp = e.target.closest && e.target.closest(SEL);
    if (!inp || (e.relatedTarget && inp.contains(e.relatedTarget))) return;
    clearTimeout(tShow);
    restore();
    tHide = setTimeout(hide, 250);
  });
  document.addEventListener("mousedown", (e) => { if (card && !card.contains(e.target)) hide(); });
  document.addEventListener("focusin", (e) => { if (e.target.matches && e.target.matches(SEL)) hide(); });   // начали печатать
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
  window.addEventListener("scroll", (e) => { if (card && !card.contains(e.target)) hide(); }, true);
})();
