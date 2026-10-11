/*
row-comments.js — комментарий строки и точек (жёлтый уголок, всплывашка, редактор) (v3.75, вынесено из app.js).
comBtnHtml / comOf / comHead, placeFloat, showComPop / hideComPop, openComEditor / closeComEditor и слушатели таблицы и страницы.
Опирается на глобалы app.js (rows, STOP_NUM, escapeHtml, uiZoom, saveRows, renderRows…), вызываемые во время работы.
Грузится ДО app.js (таблица #fleet-tbody к этому моменту уже в DOM). «Чужая правка» (chgSel…markForeign) осталась в app.js.
*/

// ---------- v1.56: комментарий строки (как заметка в Google Таблицах) ----------
// Жёлтый уголок у Примечания; наведение — всплывает текст; клик по уголку/окошку или
// ⋯ → "📝 Комментарий" — правка. Клик мимо / "Готово" — сохранить, Esc — отмена.
let comPop = null, comEd = null, comHideT = null;

// v3.11: комментарий точки — k = 0 общий (строка), k ≥ 1 — своя точка extra[k - 1]
function comBtnHtml(com, k) {
  return `${com ? `<span class="com-tri" data-k="${k}" title="Комментарий"></span>` : ""}`
    + `<button class="com-ic${com ? " has" : ""}" data-k="${k}" title="${com ? "Комментарий — клик, чтобы изменить" : (k ? "Добавить комментарий к точке " + STOP_NUM[k + 1] : "Добавить комментарий")}">${COM_SVG(!!com)}</button>`;
}
function comOf(row, k) {
  if (!k) return row.com || "";
  const x = row.extra && row.extra[k - 1];
  return (x && x.com) || "";
}
function comHead(row, k) {
  return escapeHtml(row.unit || "строка") + (k ? " · " + STOP_NUM[k + 1] : "");
}

function placeFloat(el, anchor, dx) {
  const a = anchor.getBoundingClientRect();
  const w = el.offsetWidth, h = el.offsetHeight;
  const z = uiZoom();
  const W = w * z, H = h * z;
  el.style.left = Math.max(8, Math.min(window.innerWidth - W - 8, a.right - W + (dx || 0))) / z + "px";
  el.style.top = (a.bottom + 6 + H < window.innerHeight ? a.bottom + 6 : Math.max(8, a.top - 6 - H)) / z + "px";
}

function hideComPop() {
  if (comPop) { comPop.remove(); comPop = null; }
}

function showComPop(tri) {
  if (comEd) return;
  clearTimeout(comHideT);
  hideComPop();
  const tr = tri.closest("tr");
  const row = rows.find((r) => r.id === Number(tr.dataset.id));
  const k = Number(tri.dataset.k || 0);
  if (!row || !comOf(row, k)) return;
  comPop = document.createElement("div");
  comPop.className = "com-pop";
  comPop.innerHTML = `<div class="com-hd">${comHead(row, k)} · комментарий — клик, чтобы изменить</div>${escapeHtml(comOf(row, k))}`;
  document.body.appendChild(comPop);
  placeFloat(comPop, tri, 6);
  comPop.addEventListener("mouseenter", () => clearTimeout(comHideT));
  comPop.addEventListener("mouseleave", () => { comHideT = setTimeout(hideComPop, 250); });
  // v3.18: клик по полосе прокрутки — просто прокрутка, редактор не открываем
  const onBar = (e) => e.offsetX > comPop.clientWidth || e.offsetY > comPop.clientHeight;
  comPop.addEventListener("mousedown", (e) => { if (onBar(e)) e.stopPropagation(); });
  comPop.addEventListener("click", (e) => { e.stopPropagation(); if (onBar(e)) return; openComEditor(row.id, tri, k); });
}

function closeComEditor(save) {
  if (!comEd) return;
  const id = Number(comEd.dataset.id);
  const k = Number(comEd.dataset.k || 0);
  const val = comEd.querySelector("textarea").value.replace(/\s+$/, "");
  comEd.remove();
  comEd = null;
  if (save) {
    const row = rows.find((r) => r.id === id);
    if (row && comOf(row, k) !== val) {
      if (!k) row.com = val;
      else if (row.extra && row.extra[k - 1]) {
        if (val) row.extra[k - 1].com = val; else delete row.extra[k - 1].com;
      }
      saveRows();
      renderRows();
    }
  }
}

function openComEditor(id, anchor, k) {
  hideComPop();
  closeComEditor(true);
  const row = rows.find((r) => r.id === id);
  if (!row) return;
  k = Number(k || 0);
  if (k && !(row.extra && row.extra[k - 1])) return;
  comEd = document.createElement("div");
  comEd.className = "com-ed";
  comEd.dataset.id = id;
  comEd.dataset.k = k;
  comEd.innerHTML = `<div class="com-ed-hd">${comHead(row, k)} <span>· ${k ? "комментарий к точке" : "комментарий"}</span></div>
    <textarea placeholder="${k ? "Адрес, контакты, окно, особенности точки…" : "Инструкция водителю, рефы, адрес, контакты…"}">${escapeHtml(comOf(row, k))}</textarea>
    <div class="com-ed-row">
      <button type="button" data-a="copy">Скопировать</button>
      <button type="button" data-a="del" class="com-del">Удалить</button>
      <span class="com-sp"></span><span class="com-hint">Esc — отмена</span>
      <button type="button" data-a="ok" class="com-ok">Готово</button>
    </div>`;
  document.body.appendChild(comEd);
  placeFloat(comEd, anchor);
  const ta = comEd.querySelector("textarea");
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
  comEd.addEventListener("click", (e) => {
    e.stopPropagation();
    const a = e.target.dataset && e.target.dataset.a;
    if (a === "copy") {
      try {
        navigator.clipboard.writeText(ta.value).catch(() => ta.select());
      } catch (err) { ta.select(); }
      e.target.textContent = "Скопировано ✓";
      setTimeout(() => { if (e.target) e.target.textContent = "Скопировать"; }, 1200);
    } else if (a === "del") {
      ta.value = "";
      closeComEditor(true);
    } else if (a === "ok") {
      closeComEditor(true);
    }
  });
}

(function () {
  const tbody = document.getElementById("fleet-tbody");
  tbody.addEventListener("mouseover", (e) => {
    const t = e.target.closest && e.target.closest(".com-tri, .com-ic.has");
    if (t) showComPop(t);
  });
  tbody.addEventListener("mouseout", (e) => {
    if (e.target.closest && e.target.closest(".com-tri, .com-ic.has")) comHideT = setTimeout(hideComPop, 250);
  });
  tbody.addEventListener("click", (e) => {
    const t = e.target.closest && e.target.closest(".com-tri");
    if (!t) return;
    e.stopPropagation();
    openComEditor(Number(t.closest("tr").dataset.id), t, Number(t.dataset.k || 0));
  });
  document.addEventListener("mousedown", (e) => {
    if (comEd && !comEd.contains(e.target)) closeComEditor(true);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && comEd) closeComEditor(false);
  });
  // v3.19: прокрутка внутри попапа/редактора комментария его не закрывает
  window.addEventListener("scroll", (e) => {
    const t = e.target;
    if (t && t.nodeType === 1 && t.closest && t.closest(".com-pop, .com-ed")) return;
    hideComPop();
  }, true);
})();
