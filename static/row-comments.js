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

// ---------- v3.215: разметка комментария — как в WhatsApp: *жирный*, _курсив_; цвет — {r:красный}, {b:синий} ----------
// В поле `com` по-прежнему обычная строка (сервер и «чужие правки» не меняются); старые комментарии с *…* сразу видны жирными.
const COM_COLORS = { r: "#d93025", b: "#2f6fd6" };
function comMdToHtml(text) {
  let h = escapeHtml(String(text || ""));
  h = h.replace(/\{([rb]):([^{}]*)\}/g, (m, c, t) => `<span style="color:${COM_COLORS[c]}">${t}</span>`);
  h = h.replace(/(^|[^\p{L}\p{N}*])\*(?![\s*])([^*\n]+?)(?<!\s)\*(?![\p{L}\p{N}*])/gu, "$1<b>$2</b>");
  h = h.replace(/(^|[^\p{L}\p{N}_])_(?![\s_])([^_\n]+?)(?<!\s)_(?![\p{L}\p{N}_])/gu, "$1<i>$2</i>");
  return h;
}
// для копирования в WhatsApp: цвета там нет — остаётся *жирный* и _курсив_
function comPlain(text) {
  let t = String(text || ""), prev;
  do { prev = t; t = t.replace(/\{[rb]:([^{}]*)\}/g, "$1"); } while (t !== prev);
  return t;
}
// пробелы по краям выделения — за знаки (иначе WhatsApp не форматирует)
function comWrap(mark, inner) {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner);
  return m[2] ? m[1] + mark + m[2] + mark + m[3] : inner;
}
function comColorKey(el) {
  const raw = String((el.style && el.style.color) || (el.getAttribute && el.getAttribute("color")) || "").trim();
  let r, g, b, m;
  if ((m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(raw))) { r = +m[1]; g = +m[2]; b = +m[3]; }
  else if ((m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(raw))) { r = parseInt(m[1], 16); g = parseInt(m[2], 16); b = parseInt(m[3], 16); }
  else return "";
  if (r > g + 80 && r > b + 80) return "r";
  if (b > r + 80 && b > g + 40) return "b";
  return "";
}
function comKidsToMd(node) {
  let out = "", prevBlock = false;
  Array.from(node.childNodes || []).forEach((ch) => {
    const t = ch.nodeType === 1 ? String(ch.nodeName).toUpperCase() : "";
    const block = t === "DIV" || t === "P";
    if ((block || prevBlock) && out && !out.endsWith("\n")) out += "\n";
    out += comNodeToMd(ch);
    prevBlock = block;
  });
  return out;
}
function comNodeToMd(node) {
  if (node.nodeType === 3) return node.nodeValue || "";
  if (node.nodeType !== 1) return "";
  const tag = String(node.nodeName).toUpperCase();
  if (tag === "BR") return "\n";
  let inner = comKidsToMd(node);
  const st = node.style || {};
  if (tag === "I" || tag === "EM" || st.fontStyle === "italic") inner = comWrap("_", inner);
  if (tag === "B" || tag === "STRONG" || st.fontWeight === "bold" || Number(st.fontWeight) >= 600) inner = comWrap("*", inner);
  const c = (tag === "FONT" || tag === "SPAN") ? comColorKey(node) : "";
  if (c) {   // вложенный другой цвет остаётся за внутренним: внешний красит только куски между его тегами
    inner = inner.split(/(\{[rb]:[^{}]*\})/).map((part) => (!part || /^\{[rb]:/.test(part) || !part.trim()) ? part : `{${c}:${part}}`).join("");
  }
  return inner;
}
function comEditorToMd(ed) {
  return comKidsToMd(ed).replace(/ /g, " ").replace(/\s+$/, "");
}

function placeFloat(el, anchor, dx) {
  const a = anchor.getBoundingClientRect();
  const z = uiZoom();
  if (el.classList.contains("com-ed")) el.style.maxHeight = Math.max(200, Math.floor(window.innerHeight / z) - 16) + "px";   // v3.223: окно целиком в экране, поле ввода прокручивается
  const w = el.offsetWidth, h = el.offsetHeight;
  const W = w * z, H = h * z;
  el.style.left = Math.max(8, Math.min(window.innerWidth - W - 8, a.right - W + (dx || 0))) / z + "px";
  const top = a.bottom + 6 + H < window.innerHeight ? a.bottom + 6 : Math.max(8, a.top - 6 - H);
  el.style.top = Math.max(8, Math.min(top, window.innerHeight - H - 8)) / z + "px";   // v3.223: нижний край не уходит за экран
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
  comPop.innerHTML = `<div class="com-hd">${comHead(row, k)} · комментарий — клик, чтобы изменить</div>${comMdToHtml(comOf(row, k))}`;
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
  const val = comEditorToMd(comEd.querySelector(".com-body"));
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
  const ph = k ? "Адрес, контакты, окно, особенности точки…" : "Инструкция водителю, рефы, адрес, контакты…";
  comEd.innerHTML = `<div class="com-ed-hd">${comHead(row, k)} <span>· ${k ? "комментарий к точке" : "комментарий"}</span></div>
    <div class="com-tb">
      <button type="button" data-a="b" title="Жирный (Ctrl+B)"><b>Ж</b></button>
      <button type="button" data-a="i" title="Курсив (Ctrl+I)"><i>К</i></button>
      <span class="com-tsep"></span>
      <button type="button" data-a="c" data-c="#222222" class="com-col" style="--c:#222222" title="Чёрный"></button>
      <button type="button" data-a="c" data-c="${COM_COLORS.b}" class="com-col" style="--c:${COM_COLORS.b}" title="Синий"></button>
      <button type="button" data-a="c" data-c="${COM_COLORS.r}" class="com-col" style="--c:${COM_COLORS.r}" title="Красный"></button>
      <span class="com-tsep"></span>
      <button type="button" data-a="undo" title="Отменить (Ctrl+Z)">↶</button>
      <button type="button" data-a="redo" title="Повторить (Ctrl+Y)">↷</button>
    </div>
    <div class="com-body" contenteditable="true" role="textbox" aria-multiline="true" data-ph="${ph}"></div>
    <div class="com-ed-row">
      <button type="button" data-a="copy" title="Копирует текст для WhatsApp: *жирный*, _курсив_, без цветов">Скопировать</button>
      <button type="button" data-a="del" class="com-del">Удалить</button>
      <span class="com-sp"></span><span class="com-hint">Esc — отмена</span>
      <button type="button" data-a="ok" class="com-ok">Готово</button>
    </div>`;
  document.body.appendChild(comEd);
  const ed = comEd.querySelector(".com-body");
  ed.innerHTML = comMdToHtml(comOf(row, k));
  try { document.execCommand("styleWithCSS", false, false); } catch (err) { /* не критично */ }
  placeFloat(comEd, anchor);
  ed.focus();
  try {
    const rg = document.createRange();
    rg.selectNodeContents(ed);
    rg.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(rg);
  } catch (err) { /* курсор в конец — не критично */ }
  // кнопки панели не забирают фокус и выделение у поля
  comEd.querySelector(".com-tb").addEventListener("mousedown", (e) => e.preventDefault());
  // вставка — как простой текст; разметка WhatsApp (*…*, _…_) сразу становится видимой
  ed.addEventListener("paste", (e) => {
    e.preventDefault();
    const t = ((e.clipboardData || window.clipboardData).getData("text/plain") || "").replace(/\r\n?/g, "\n");
    document.execCommand("insertHTML", false, comMdToHtml(t).replace(/\n/g, "<br>"));
  });
  comEd.addEventListener("click", (e) => {
    e.stopPropagation();
    const btn = e.target.closest && e.target.closest("[data-a]");
    const a = btn && btn.dataset.a;
    if (a === "b") document.execCommand("bold");
    else if (a === "i") document.execCommand("italic");
    else if (a === "c") document.execCommand("foreColor", false, btn.dataset.c);
    else if (a === "undo") document.execCommand("undo");
    else if (a === "redo") document.execCommand("redo");
    else if (a === "copy") {
      const txt = comPlain(comEditorToMd(ed));
      try {
        navigator.clipboard.writeText(txt).catch(() => {});
      } catch (err) { /* без буфера — ничего */ }
      btn.textContent = "Скопировано ✓";
      setTimeout(() => { if (btn) btn.textContent = "Скопировать"; }, 1200);
    } else if (a === "del") {
      ed.innerHTML = "";
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
