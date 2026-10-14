/*
trailer-swap.js — перецеп: смена тягача у прицепа (v3.108).
Точка, у которой цель — трак из Флота, — встреча. По ✓ (клик по номеру точки) спрашиваем «Передать прицеп → трак?»:
«Да» — в строке меняется тягач (row.unit), прицеп и точки остаются, в точке запоминается след point.swap = {from, to, at}
(у ① — row.swap), точка ✓ вручную, вместо буквы L/O — значок ⇄; «Нет» — обычный ✓. Повторный клик по номеру такой точки — отмена перецепа.
До ✓ у точки с траком в цели тип нейтральный «L/O» (ptLo), на сортировку L→O, фильтр и цвет строки она не влияет.
Опирается на глобалы trailer-link.js и app.js (rows, findUnitNo, normNo, saveRows, renderRows, calcRow, dropRow, removeMarker, toggleDone,
lastCalcText, loText / loClass / loTitle, escapeHtml, uiZoom), вызываемые во время работы. Грузится ДО app.js.
*/

// ---------- чистые функции (без DOM — их гоняет tests/test_v3108.py через node) ----------
// точка k: 0 — основная (сама строка), k ≥ 1 — row.extra[k - 1]
function swapPoint(row, k) {
  return k === 0 ? row : (row.extra && row.extra[k - 1]) || null;
}
// номер тягача из Флота, если цель точки — трак (иначе null)
function ptTruckNo(p) {
  if (!p || !p.target) return null;
  return findUnitNo(p.target, "truck");
}
// тип точки для показа / сортировки: у встречи с траком и у перецепа — пусто («L/O»)
function ptLo(p) {
  if (!p) return "";
  if (p.swap || ptTruckNo(p)) return "";
  return p.lo || "";
}
// у точки k можно спросить про перецеп: цель — чужой трак, перецепа ещё не было → номер трака
function swapCandidate(row, k) {
  const p = swapPoint(row, k);
  if (!p || p.swap) return null;
  const no = ptTruckNo(p);
  return no && normNo(no) !== normNo(row.unit) ? no : null;
}
// «Да»: тягач строки → toNo; точка k ✓ вручную; след — в точке; режим экипажа и «+1 ч» были про старый тягач
function applyTransfer(row, k, toNo, nowMs) {
  const p = swapPoint(row, k);
  if (!p || !toNo || p.swap) return false;
  p.swap = { from: row.unit, to: toNo, at: nowMs };
  row.unit = toNo;
  row.done = row.done || {};
  row.done[k] = true;
  delete row.crew;
  delete row.x10;
  return true;
}
// отмена: вернуть прежний тягач, снять след и ✓ точки
function undoTransfer(row, k) {
  const p = swapPoint(row, k);
  if (!p || !p.swap) return false;
  row.unit = p.swap.from;
  delete p.swap;
  if (row.done) delete row.done[k];
  return true;
}
function rowIsEmpty(r) {
  return !String(r.target || "").trim() && !(r.extra || []).some((x) => String(x.target || "").trim());
}
function swapWhen(ms) {
  const d = new Date(ms), p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ---------- вид кнопки типа точки ----------
function ptBtnText(p) { return p && p.swap ? "⇄" : loText(ptLo(p)); }
function ptBtnClass(p) { return p && p.swap ? "lo-swap" : loClass(ptLo(p)); }
function ptBtnTitle(p) {
  if (p && p.swap) return `Перецеп: ${p.swap.from} → ${p.swap.to}, ${swapWhen(p.swap.at)}\nКлик по номеру точки — отменить перецеп`;
  const no = ptTruckNo(p);
  if (no) return `Встреча с ${no}. По ✓ спросит, перецеп ли это`;
  return loTitle(p && p.lo);
}

// ---------- вопрос по ✓ ----------
let swapPop = null;
function closeSwapPop() { if (swapPop) { swapPop.remove(); swapPop = null; } }
function openSwapPop(anchor, title, note, buttons) {
  closeSwapPop();
  swapPop = document.createElement("div");
  swapPop.className = "trl-ed swap-pop";
  swapPop.innerHTML = `<div class="trl-ed-t">${title}</div>${note ? `<div class="trl-ed-err swap-note">${note}</div>` : ""}
    <div class="trl-ed-b">${buttons.map((b, i) => `<button data-i="${i}" class="${b.ok ? "trl-ed-ok" : "trl-ed-cancel"}">${b.text}</button>`).join("")}</div>`;
  document.body.appendChild(swapPop);
  const r = anchor.getBoundingClientRect();
  const z = uiZoom();
  swapPop.style.width = "260px";
  swapPop.style.top = Math.min(window.innerHeight - swapPop.offsetHeight * z - 8, r.bottom + 4) / z + "px";
  swapPop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - swapPop.offsetWidth * z - 8)) / z + "px";
  swapPop.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    const fn = buttons[Number(b.dataset.i)].fn;
    closeSwapPop();
    if (fn) fn();
  }));
  swapPop.addEventListener("mousedown", (e) => e.stopPropagation());
}
document.addEventListener("mousedown", () => closeSwapPop());

function doTransfer(id, k) {
  const row = rows.find((r) => r.id === id);
  const to = row && swapCandidate(row, k);
  if (!to || !applyTransfer(row, k, to, Date.now())) return;
  // пустая строка нового тягача больше не нужна (со своими точками — не трогаем)
  rows.filter((r) => r.id !== id && normNo(r.unit) === normNo(to) && rowIsEmpty(r)).forEach((r) => dropRow(r.id));
  if (typeof removeMarker === "function") removeMarker(id);
  saveRows();
  renderRows();
  calcRow(id, "edit");
}
function doUndoTransfer(id, k) {
  const row = rows.find((r) => r.id === id);
  if (!row || !undoTransfer(row, k)) return;
  if (typeof removeMarker === "function") removeMarker(id);
  saveRows();
  renderRows();
  calcRow(id, "edit");
}

// клик по номеру точки k строки id; true — клик разобран здесь (дальше обычный ✓ не нужен)
function swapChipClick(id, k, anchor) {
  const row = rows.find((r) => r.id === id);
  if (!row) return false;
  const p = swapPoint(row, k);
  if (p && p.swap) {
    openSwapPop(anchor, `Перецеп ${escapeHtml(p.swap.from)} → ${escapeHtml(p.swap.to)}, ${swapWhen(p.swap.at)}`,
      `Отмена вернёт ${escapeHtml(p.swap.from)} в строку и снимет ✓ с точки.`,
      [{ text: "Отменить перецеп", ok: true, fn: () => doUndoTransfer(id, k) }, { text: "Закрыть" }]);
    return true;
  }
  const to = swapCandidate(row, k);
  if (!to) return false;
  const c = lastCalcText[id];
  const f = c && c.doneFlags && c.doneFlags[k];
  const m = row.done && (row.done[k] === true || row.done[k] === false) ? row.done[k] : null;
  if (m != null || (f && f.done)) return false;   // клик не поставил бы ✓ — обычное поведение
  const dup = rows.find((r) => r.id !== id && normNo(r.unit) === normNo(to) && !rowIsEmpty(r));
  openSwapPop(anchor, `Передать ${row.trailer ? "прицеп " + escapeHtml(row.trailer) : "рейс"} → ${escapeHtml(to)}?`,
    dup ? `В Флоте уже есть строка ${escapeHtml(to)} с точками — она останется, удалите её сами.` : "",
    [{ text: "Да, перецеп", ok: true, fn: () => doTransfer(id, k) },
     { text: "Нет, просто встреча", fn: () => toggleDone(id, k) }]);
  return true;
}
