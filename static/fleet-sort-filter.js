/*
fleet-sort-filter.js — сортировка Флота (L → O / O → L / руками) и фильтр L/O (v3.79, вынесено из app.js).
sortMode / manualOrder / displayOrder / loFilter (состояние из localStorage читается при загрузке), computeOrder, resort, orderedRows,
pointOf, firstOpenIdx, rowLoKind, stripeRow, rowPassesFilter. Переменные присваиваются и из app.js — общая область видимости скриптов страницы, как и раньше.
Опирается на глобалы app.js (rows, lastCalcText, renderRows, rowPassesOwn, parseDeliveryWindow), вызываемые во время работы. Грузится ДО app.js.
*/

// ---------- v1.53: сортировка Флота ----------
// LO / OL — погрузки/выгрузки первыми, внутри по срочности;
// manual — руками (перетаскивание ⠿, на телефоне ↑/↓ в меню ⋯; новые строки — в конец). Строки без L/O — в конце.
// v3.29: режима «как добавляли» больше нет — сохранённый (и умолчание) стал «руками» с порядком добавления.
// Пересортировка только при загрузке, "Обновить всё" и смене режима — не при автообновлении.
const SORT_MODES = ["LO", "OL", "manual"];
let sortMode = "manual";
let manualOrder = [];
try {
  const saved = localStorage.getItem("fleetSort");
  if (SORT_MODES.includes(saved)) {
    sortMode = saved;
    manualOrder = JSON.parse(localStorage.getItem("fleetManualOrder") || "[]");
  } else {
    // было «как добавляли» или ничего: старый ручной порядок не берём — таблица не сдвинется
    localStorage.setItem("fleetSort", "manual");
    localStorage.setItem("fleetManualOrder", "[]");
  }
} catch (e) { /* без localStorage — порядок по умолчанию */ }
let displayOrder = null;   // зафиксированный порядок id между пересортировками

function saveSortState() {
  try {
    localStorage.setItem("fleetSort", sortMode);
    localStorage.setItem("fleetManualOrder", JSON.stringify(manualOrder));
  } catch (e) { /* ignore */ }
}

// v3.10: ключ сортировки — TimeSlot первой непройденной точки (начало окна, иначе срок);
// без TimeSlot — null (такие строки в конце своей группы, в порядке добавления).
// Опаздывающие наверх не поднимаем.
function slotKey(row) {
  const k = firstOpenIdx(row);
  const p = k >= 0 ? pointOf(row, k) : null;
  const w = p ? parseDeliveryWindow(p.delivery) : null;
  const t = w ? (w.start || w.end) : null;
  return t ? t.getTime() : null;
}

function computeOrder() {
  if (sortMode === "manual") {
    const pos = new Map(manualOrder.map((id, i) => [id, i]));
    const known = rows.filter((r) => pos.has(r.id)).sort((a, b) => pos.get(a.id) - pos.get(b.id));
    const rest = rows.filter((r) => !pos.has(r.id));
    manualOrder = known.concat(rest).map((r) => r.id);
    saveSortState();
    return manualOrder.slice();
  }
  if (sortMode === "LO" || sortMode === "OL") {
    const rank = sortMode === "LO" ? { L: 0, O: 1 } : { O: 0, L: 1 };
    const idx = new Map(rows.map((r, i) => [r.id, i]));
    return rows.slice().sort((a, b) => {
      const la = rowLoKind(a), lb = rowLoKind(b);
      const ra = la in rank ? rank[la] : 2, rb = lb in rank ? rank[lb] : 2;
      if (ra !== rb) return ra - rb;
      if (ra === 2) return idx.get(a.id) - idx.get(b.id);
      const ka = slotKey(a), kb = slotKey(b);
      if (ka != null && kb != null && ka !== kb) return ka - kb;
      if ((ka == null) !== (kb == null)) return ka == null ? 1 : -1;
      return idx.get(a.id) - idx.get(b.id);
    }).map((r) => r.id);
  }
  return rows.map((r) => r.id);
}

function resort() {
  displayOrder = computeOrder();
  renderRows();
}

function orderedRows() {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out = [];
  const seen = new Set();
  (displayOrder || rows.map((r) => r.id)).forEach((id) => {
    if (byId.has(id)) { out.push(byId.get(id)); seen.add(id); }
  });
  rows.forEach((r) => { if (!seen.has(r.id)) out.push(r); });   // новые строки — в конец
  return out;
}

// ---------- v1.78: фильтр L/O во Флоте ----------
// v3.10: строка — по L/O первой НЕПРОЙДЕННОЙ точки; если у неё нет отметки — по следующей;
// иначе только в "Все". Пустые строки (без машины) видны всегда. v3.26: и на карте — спрятанные строки без машинок и целей.
// Тот же признак — полоска строки и сортировка L → O / O → L.
let loFilter = "all";
try { loFilter = localStorage.getItem("fleet-lo-filter") || "all"; } catch (e) {}
if (!["all", "L", "O"].includes(loFilter)) loFilter = "all";
// точка k: 0 — основная (row.lo / row.delivery), k ≥ 1 — row.extra[k - 1]
function pointOf(row, k) {
  return k === 0 ? { lo: row.lo, delivery: row.delivery } : (row.extra && row.extra[k - 1]) || null;
}
// индекс первой непройденной точки (ручные отметки row.done важнее авто), -1 — все пройдены
function firstOpenIdx(row) {
  const n = 1 + (row.extra ? row.extra.length : 0);
  const c = lastCalcText[row.id];
  const fl = c && c.doneFlags;
  const man = row.done || {};
  for (let k = 0; k < n; k++) {
    const d = man[k] === true ? true : man[k] === false ? false : !!(fl && fl[k] && fl[k].done);
    if (!d) return k;
  }
  return -1;
}
function rowLoKind(row) {
  const k = firstOpenIdx(row);
  if (k < 0) return "";
  const isLo = (p) => p && (p.lo === "L" || p.lo === "O");
  const p = pointOf(row, k);
  if (isLo(p)) return p.lo;
  const q = pointOf(row, k + 1);
  return isLo(q) ? q.lo : "";
}
function stripeRow(tr, row) {
  tr.classList.remove("lo-row-L", "lo-row-O");
  const kind = rowLoKind(row);
  if (kind) tr.classList.add(`lo-row-${kind}`);
}
function rowPassesFilter(row) {
  if (!row.unit) return true;
  if (!rowPassesOwn(row)) return false;   // v2.01 / v3.11
  if (loFilter === "all") return true;
  return rowLoKind(row) === loFilter;
}
