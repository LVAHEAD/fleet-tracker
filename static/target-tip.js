/* target-tip.js — всплывашка у поля «Таргет» в стиле аппы вместо подсказки браузера (v3.250).
   Наведение 1 с (как у других всплывашек) — карточка адреса из базы «Адреса»: название, адрес, GPS, Open, тип · клиент · поставщик, заметка.
   Адреса нет в базе — текст прежней подсказки (координаты, перецеп). Подсказку браузера (title) на время наведения убираем. */
(function () {
  if (typeof document === "undefined") return;
  const SEL = 'input[list="points-list"]';
  let card = null, cur = null, tShow = 0, tHide = 0;
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
    const row = (k, v) => (v ? `<div class="tt-k">${k}</div><div>${esc(v)}</div>` : "");
    const gps = a.lat != null && a.lng != null ? `${Number(a.lat).toFixed(5)}, ${Number(a.lng).toFixed(5)}` : "";
    const kind = [(typeof ADDR_TYPE_RU !== "undefined" && ADDR_TYPE_RU[a.type]) || a.type, a.client, a.supplier].filter(Boolean).join(" · ");
    return `<div class="mtc-h"><b>${esc(a.name)}</b>${a.country ? ` <span class="tt-cc">${esc(a.country)}</span>` : ""}</div>`
      + `<div class="tt-g">${row("Адрес", a.full)}${row("GPS", gps)}${row("Open", a.open)}${row("Тип", kind)}${row("Заметка", a.notes)}</div>`
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
