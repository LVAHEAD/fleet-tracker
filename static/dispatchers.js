/*
dispatchers.js — диспетчер строки и фильтр «Мои / Все» (v3.80, вынесено из app.js).
ownFilter (читается из localStorage при загрузке), fleetMe, rowDisp, rowPassesOwn, список диспетчеров из листа (DISP_LIST, loadDispatchers),
цвета и инициалы (dispTag, dispLabel, applyDispColors, fillDispSelects), плашка / список диспетчера в строке (dispHtml), canAssign.
ownFilter присваивается и из app.js — общая область видимости скриптов страницы, как и раньше.
Опирается на глобалы app.js (rows, renderRows, refreshBadgeLooks, escapeHtml), вызываемые во время работы. Грузится ДО app.js.
*/

// ---------- v2.01: диспетчер строки + фильтр "Мои / Все" ----------
// disp — e-mail ответственного; у новой строки — кто создал; у старых без disp — создатель (мета сервера).
let ownFilter = "mine";   // v3.118: при первом открытии (ничего не сохранено) — свои трипы, см. resolveMine
try {
  const saved = localStorage.getItem("fleet-own-filter");
  if (saved) ownFilter = saved;
} catch (e) { ownFilter = "all"; }
if (!["all", "mine"].includes(ownFilter) && !String(ownFilter).includes("@")) ownFilter = "all";
// v3.11: фильтр диспетчера — "all" | "mine" | e-mail. Строки без диспетчера — только в "все".
// v3.25: кнопки «Все · VL · VJ …» вместо «все · мои · ▾ дисп»; старое "mine" — своя кнопка (resolveMine).
// Тот же фильтр — для карты: v3.26 — чужие машинки спрятаны (раньше бледные).
function rowPassesOwn(row) {
  if (ownFilter === "all") return true;
  const d = rowDisp(row);
  if (ownFilter === "mine") return !fleetMe() || !meInSheet() || d === fleetMe();   // v3.15: нет в листе — «мои» = все
  return d === ownFilter;
}
// v3.127: e-mail для сравнения — у Gmail точки и «+метка» не различаются (как canon_email на сервере)
function canonEmail(e) {
  const s = String(e || "").trim().toLowerCase();
  const i = s.lastIndexOf("@");
  if (i < 0) return s;
  const dom = s.slice(i + 1);
  return dom === "gmail.com" || dom === "googlemail.com" ? s.slice(0, i).split("+")[0].replace(/\./g, "") + "@gmail.com" : s;
}
function fleetMe() {
  const u = window.fleetSync && window.fleetSync.mode === "server" ? window.fleetSync.user : "";
  return u && u !== "local" ? canonEmail(u) : "";
}
function rowDisp(row) {
  if (row.disp) return canonEmail(row.disp);
  const m = window.fleetSync && window.fleetSync.meta[String(row.id)];
  return m && m.created_by && m.created_by !== "local" ? canonEmail(m.created_by) : "";
}
const dispShort = (u) => String(u || "").split("@")[0].split(".")[0].slice(0, 12);
function knownDispatchers() {
  const set = new Set(DISP_LIST.map((d) => d.email));   // v3.11: все из листа, даже кто ещё не заходил
  if (fleetMe()) set.add(fleetMe());
  rows.forEach((r) => { const d = rowDisp(r); if (d) set.add(d); });
  const meta = (window.fleetSync && window.fleetSync.meta) || {};
  Object.values(meta).forEach((m) => {
    [m.created_by, m.updated_by].forEach((u) => { if (u && u !== "local") set.add(canonEmail(u)); });
  });
  const order = new Map(DISP_LIST.map((d, i) => [d.email, i]));
  return Array.from(set).sort((a, b) => (order.has(a) ? order.get(a) : 99) - (order.has(b) ? order.get(b) : 99) || (a < b ? -1 : 1));
}
// v3.09: инициалы и цвет диспетчера (первая клетка строки); ключ — имя из e-mail до точки/@
// v3.11: диспетчеры — из листа «Диспетчеры» (/api/dispatchers); до загрузки — список по умолчанию
let DISP_LIST = [
  { email: "vladimirs.head@gmail.com", tag: "VL", color: "#ebebeb" }, { email: "vadims@gmail.com", tag: "VJ", color: "#fde6cc" },
  { email: "jzemesarajs@gmail.com", tag: "JZ", color: "#eceefc" }, { email: "jekaterina@gmail.com", tag: "JB", color: "#dcf1e0" },
  { email: "antons@gmail.com", tag: "AA", color: "#ffffff" }, { email: "ladins@gmail.com", tag: "VV", color: "#e8dcf7" },
];
function dispEntry(u) {
  const e = canonEmail(u);
  if (!e) return null;
  // v3.97: главный источник — лист «Диспетчеры»; сопоставление только по точному e-mail (без угадывания по короткому имени)
  return DISP_LIST.find((d) => d.email === e) || null;
}
function dispTag(u) { const d = dispEntry(u); return d ? d.tag : ""; }
// v3.15: вошедший есть в листе «Диспетчеры» (точное совпадение e-mail; до загрузки листа — считаем, что есть)
let DISP_LOADED = false;
function meInSheet() {
  const me = fleetMe();
  return !me || !DISP_LOADED || DISP_LIST.some((d) => String(d.email).toLowerCase() === me);
}
// v3.15: фон аппы — бледно в цвет вошедшего диспетчера; нет в листе — «мои» скрыт, подсказка под заголовком
function mixHex(hex, base, k) {
  const p = (h) => (String(h).match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i) || []).slice(1).map((x) => parseInt(x, 16));
  const a = p(hex), b = p(base);
  if (a.length !== 3 || b.length !== 3) return "";
  return "#" + a.map((x, i) => Math.round(x * k + b[i] * (1 - k)).toString(16).padStart(2, "0")).join("");
}
function applyMyDispLook() {
  const me = fleetMe();
  const mine = me ? DISP_LIST.find((d) => String(d.email).toLowerCase() === me) : null;
  // v3.18: фон приложения в цвет диспетчера убран — цвет только на плашке диспетчера в строке
  const missing = !meInSheet();
  document.body.classList.toggle("no-disp", missing);
  const hint = document.getElementById("disp-hint");
  if (hint) {
    hint.hidden = !missing;
    hint.textContent = missing ? `Тебя нет в листе «Диспетчеры» (${me}) — нет инициалов и цвета, своей кнопки в фильтре нет. Попроси админа добавить.` : "";
  }
}
function canAssign() { return !fleetMe() || !!(window.fleetSync && window.fleetSync.canAssign); }
// цвет рамки — тот же оттенок темнее; белый -> серый
function shadeHex(hex, k) {
  const m = String(hex || "").match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return "";
  return "#" + m.slice(1).map((x) => Math.round(parseInt(x, 16) * (1 - k)).toString(16).padStart(2, "0")).join("");
}
function applyDispColors() {
  let st = document.getElementById("disp-colors");
  if (!st) { st = document.createElement("style"); st.id = "disp-colors"; document.head.appendChild(st); }
  st.textContent = DISP_LIST.filter((d) => d.color).map((d) =>
    // v3.18: цвет из листа «Диспетчеры» — только плашка диспетчера (👤 VL), клетка строки без заливки
    `#fleet-tbody td.unit-cell[data-dc="${d.tag}"] .disp-lbl, #fleet-tbody td.unit-cell[data-dc="${d.tag}"] .disp-sel { background: ${d.color}; border-color: ${shadeHex(d.color, 0.18) || "#ccc"}; }`).join("\n");
}
// v3.25: кнопки диспетчеров в фильтре — из листа «Диспетчеры» (порядок листа), каждая в цвет диспетчера
function fillDispSelects() {
  document.querySelectorAll(".own-btns").forEach((box) => {
    box.innerHTML = DISP_LIST.map((d) => {
      const c = d.color || "#ffffff";
      const me = String(d.email).toLowerCase() === fleetMe();
      return `<button type="button" class="own-d" data-own="${escapeHtml(String(d.email).toLowerCase())}"`
        + ` style="--dc:${escapeHtml(c)};--dcb:${escapeHtml(shadeHex(c, 0.25) || "#bbb")}"`
        + ` title="Строки ${escapeHtml(d.tag)}${me ? " (мои)" : ""} — и его машины на карте">${escapeHtml(d.tag)}</button>`;
    }).join("");
  });
  if (window.fleetMarkBar) window.fleetMarkBar();
}
// v3.25: старое значение фильтра «мои» → своя кнопка (нет в листе — «Все»), как только известно, кто вошёл
function resolveMine() {
  if (ownFilter !== "mine" || !fleetMe() || !DISP_LOADED) return;
  ownFilter = meInSheet() ? fleetMe() : "all";
  try { localStorage.setItem("fleet-own-filter", ownFilter); } catch (e) {}
}
function loadDispatchers() {
  fetch("/api/dispatchers").then((r) => r.json()).then((d) => {
    if (!d || !d.ok) return;
    if (d.dispatchers && d.dispatchers.length) DISP_LIST = d.dispatchers.map((x) => Object.assign({}, x, { email: canonEmail(x.email) }));
    DISP_LOADED = true;
    if (window.fleetSync) window.fleetSync.canAssign = !!d.can_assign;
    applyDispColors();
    applyMyDispLook();
    fillDispSelects();
    renderRows();
    refreshBadgeLooks();
  }).catch(() => {});
}
function dispLabel(u) { return dispTag(u) || dispShort(u); }
function dispHtml(row) {
  if (!fleetMe()) return "";
  const d = rowDisp(row);
  const opts = knownDispatchers();
  if (d && !opts.includes(d)) opts.push(d);
  // v3.11: назначать диспетчера строки — только назначающий; остальным — просто метка
  if (!canAssign()) return d ? `<span class="disp-lbl${d !== fleetMe() ? " other" : ""}" title="Диспетчер строки (назначает админ)">🎧 ${escapeHtml(dispLabel(d))}</span>` : "";
  return `<select class="disp-sel${d && d !== fleetMe() ? " other" : ""}${d ? "" : " none"}" title="Диспетчер (ответственный за строку)">`
    + `<option value=""${d ? "" : " selected"}>🎧 —</option>`
    + opts.map((u) => `<option value="${escapeHtml(u)}"${u === d ? " selected" : ""}>🎧 ${escapeHtml(dispLabel(u))}</option>`).join("")
    + "</select>";
}
