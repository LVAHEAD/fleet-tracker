/* cc-tip.js — всплывашка у значка страны в столбце «Статус» Флота в стиле аппы вместо подсказки браузера (v3.255).
   Наведение 0,5 с — карточка. v3.261: вариант D — код зоны, метка состояния, объект Mapon (если стоит), ГПС с кнопкой «копировать»;
   данные приходят в data-cc-tip (fleet_calc: unit_cc_tip). Без данных — текст title, как раньше.
   Карточка живёт, пока курсор на значке или на карточке (можно нажать «копировать»). Таргет — отдельно (target-tip.js). */
(function () {
  if (typeof document === "undefined") return;
  const SEL = ".status-cell .cc-badge";
  const STATE_TAG = { obj: "на объекте Mapon", none: "стоит, объекта нет", move: "в движении" };
  const COPY_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15V6a2 2 0 0 1 2-2h9"></path></svg>';
  let card = null, cur = null, tShow = 0, tHide = 0;
  const esc = (s) => (typeof escapeHtml === "function" ? escapeHtml(String(s)) : String(s).replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";"));

  function restore() {
    if (cur && cur.dataset.ccTitle !== undefined) { if (!cur.title) cur.title = cur.dataset.ccTitle; delete cur.dataset.ccTitle; }
    cur = null;
  }
  function hide() { clearTimeout(tShow); clearTimeout(tHide); if (card) { card.remove(); card = null; } }
  function tipData(b) { try { return JSON.parse(b.dataset.ccTip || "null"); } catch (e) { return null; } }
  function cp(v) {
    return '<button type="button" class="addr-copy" data-cp="' + esc(v) + '" title="Копировать: ГПС" aria-label="Копировать: ГПС">' + COPY_SVG + "</button>";
  }
  function tipHtml(d) {
    const obj = d.obj ? '<div class="tt-k">Объект</div><div>' + esc(d.obj) + "</div>" : "";
    return '<div class="mtc-h"><span class="tt-cc tip-code">' + esc(d.zone) + '</span> <span class="tip-tag">' + esc(STATE_TAG[d.state] || "") + "</span></div>" +
      '<div class="tt-g">' + obj + '<div class="tt-k">ГПС</div><div class="tt-cp">' + esc(d.gps) + cp(d.gps) + "</div></div>";
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise((ok, bad) => {
      const t = document.createElement("textarea"); t.value = text; t.style.cssText = "position:fixed;opacity:0";
      document.body.appendChild(t); t.select();
      let r = false; try { r = document.execCommand("copy"); } catch (e) {}
      t.remove(); r ? ok() : bad();
    });
  }
  function show(b) {
    hide();
    if (!b.isConnected) return;
    const d = tipData(b);
    let inner;
    if (d && d.zone) {
      inner = tipHtml(d);
    } else {
      const t = (b.dataset.ccTitle || "").trim();
      if (!t) return;
      inner = '<div class="tt-l">' + esc(t).replace(/\n/g, "<br>") + "</div>";
    }
    card = document.createElement("div");
    card.className = "mt-card tt-card cc-tip";
    card.innerHTML = inner;
    document.body.appendChild(card);
    const r = b.getBoundingClientRect(), z = typeof uiZoom === "function" ? uiZoom() : 1;
    const top = r.bottom + card.offsetHeight * z + 8 > window.innerHeight ? Math.max(8, r.top - card.offsetHeight * z - 4) : r.bottom + 4;
    card.style.left = Math.max(8, Math.min(r.left, window.innerWidth - card.offsetWidth * z - 8)) / z + "px";
    card.style.top = top / z + "px";
    card.addEventListener("mouseenter", () => clearTimeout(tHide));
    card.addEventListener("mouseleave", () => { tHide = setTimeout(hide, 250); });
    card.addEventListener("click", (ev) => {
      const c = ev.target.closest && ev.target.closest(".addr-copy");
      if (!c) return;
      copyText(c.dataset.cp).then(() => { c.classList.add("ok"); setTimeout(() => c.classList.remove("ok"), 1500); }).catch(() => {});
    });
  }
  document.addEventListener("mouseover", (e) => {
    const b = e.target.closest && e.target.closest(SEL);
    if (!b) return;
    clearTimeout(tHide);
    if (b === cur) return;
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
    clearTimeout(tShow);
    restore();
    tHide = setTimeout(hide, 250);
  });
  document.addEventListener("mousedown", (e) => { if (card && !card.contains(e.target)) hide(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
  window.addEventListener("scroll", hide, true);
})();
