/* cc-tip.js — всплывашка у значка страны в столбце «Статус» Флота в стиле аппы вместо подсказки браузера (v3.255).
   Наведение 0,5 с — карточка с текстом подсказки (например «NO · около NO15»); подсказку браузера (title) на время наведения убираем.
   Вариант содержимого пока простой (текст title) — выберем в проде. Таргет — отдельно (target-tip.js). */
(function () {
  if (typeof document === "undefined") return;
  const SEL = ".status-cell .cc-badge";
  let card = null, cur = null, tShow = 0;
  function hide() { clearTimeout(tShow); if (card) { card.remove(); card = null; } }
  function restore() {
    if (cur && cur.dataset.ccTitle !== undefined) { if (!cur.title) cur.title = cur.dataset.ccTitle; delete cur.dataset.ccTitle; }
    cur = null;
  }
  function show(b) {
    hide();
    const t = (b.dataset.ccTitle || "").trim();
    if (!b.isConnected || !t) return;
    card = document.createElement("div");
    card.className = "mt-card tt-card cc-tip";
    card.innerHTML = '<div class="tt-l">' + (typeof escapeHtml === "function" ? escapeHtml(t) : t).replace(/\n/g, "<br>") + "</div>";
    document.body.appendChild(card);
    const r = b.getBoundingClientRect(), z = typeof uiZoom === "function" ? uiZoom() : 1;
    const top = r.bottom + card.offsetHeight * z + 8 > window.innerHeight ? Math.max(8, r.top - card.offsetHeight * z - 4) : r.bottom + 4;
    card.style.left = Math.max(8, Math.min(r.left, window.innerWidth - card.offsetWidth * z - 8)) / z + "px";
    card.style.top = top / z + "px";
  }
  document.addEventListener("mouseover", (e) => {
    const b = e.target.closest && e.target.closest(SEL);
    if (!b || b === cur) return;
    restore();
    cur = b;
    b.dataset.ccTitle = b.title || "";
    b.title = "";
    clearTimeout(tShow);
    tShow = setTimeout(() => show(b), 500);
  });
  document.addEventListener("mouseout", (e) => {
    const b = e.target.closest && e.target.closest(SEL);
    if (!b || (e.relatedTarget && b.contains(e.relatedTarget))) return;
    restore();
    hide();
  });
  document.addEventListener("mousedown", hide);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
  window.addEventListener("scroll", hide, true);
})();
