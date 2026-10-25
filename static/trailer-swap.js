/*
trailer-swap.js — перецеп: смена тягача у прицепа (v3.108; v3.109 — обмен тягачами с чужой строкой, без автоудаления строк).
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
function applyTransfer(row, k, toNo, nowMs, pair) {
  const p = swapPoint(row, k);
  if (!p || !toNo || p.swap) return false;
  p.swap = { from: row.unit, to: toNo, at: nowMs };
  if (pair) p.swap.pair = pair;   // v3.109: обмен — {rid, p}: в какой строке и на каком месте вставлена встречная точка
  row.unit = toNo;
  row.done = row.done || {};
  row.done[k] = true;
  delete row.crew;
  delete row.x10;
  return true;
}
// отмена: вернуть прежний тягач, снять след и ✓ точки
// v3.198: запомненные авто-✓ (doneSeen / doneArr, по тексту точки) у точек ПОСЛЕ k — их набрал другой тягач после перецепа;
// при отмене строка возвращается прежнему тягачу, и эти ✓ не должны остаться «пройденными» (точки, чей текст есть и до k, не трогаем)
function dropSeenAfter(row, k) {
  const pts = [row.target || ""].concat((row.extra || []).map((x) => x.target || ""));
  const keep = new Set(pts.slice(0, k + 1));
  ["doneSeen", "doneArr"].forEach((key) => {
    if (!row[key]) return;
    pts.slice(k + 1).forEach((t) => { if (t && !keep.has(t)) delete row[key][t]; });
    if (!Object.keys(row[key]).length) delete row[key];
  });
}
function undoTransfer(row, k) {
  const p = swapPoint(row, k);
  if (!p || !p.swap) return false;
  row.unit = p.swap.from;
  delete p.swap;
  if (row.done) delete row.done[k];
  dropSeenAfter(row, k);
  return true;
}
// v3.109: обмен тягачами. Место встречной точки в чужой строке: перед первой непройденной (openIdx ≥ 1),
// в конец, если пройдены все (-1); null — пройденных точек нет, вставить встречу нельзя (перед ① точку не вставить)
function exchangeSlot(other, openIdx) {
  if (openIdx === -1) return 1 + (other.extra || []).length;
  return openIdx >= 1 ? openIdx : null;
}
// v3.211: подсказка в диалоге — куда встанет встреча в чужой строке: перед первой непройденной точкой (slot) или в конец
function exchangeWhere(other, slot) {
  const pts = [other.target || ""].concat((other.extra || []).map((x) => x.target || ""));
  if (slot >= pts.length) return `в конец трипа, точкой ${pts.length + 1}`;
  const t = String(pts[slot] || "").trim();
  return `точкой ${slot + 1}, перед «${t || "пусто"}»`;
}
// в строке other вместо yNo встаёт mineNo; перед точкой p вставляется ✓-встреча с mineNo со следом ⇄ (парой к моей строке pairRid)
// v3.213: если на месте p уже стоит непройденная точка-машина с нашим номером (диспетчер ввёл встречу заранее) —
// встречей становится она сама, новая не вставляется (иначе дубль «машина → сама к себе»)
function exchangeReuses(other, p, mineNo) {
  const q = p >= 1 ? (other.extra || [])[p - 1] : null;
  if (!q || q.swap) return false;
  const n = ptTruckNo(q);
  return !!n && normNo(n) === normNo(mineNo);
}
function applyExchange(other, p, mineNo, yNo, nowMs, pairRid) {
  const ex = other.extra || (other.extra = []);
  const sw = { from: yNo, to: mineNo, at: nowMs, pair: { rid: pairRid } };
  if (exchangeReuses(other, p, mineNo)) {
    sw.reuse = true;
    ex[p - 1].swap = sw;
    other.done = Object.assign({}, other.done, { [p]: true });
  } else {
    const pt = { lo: "", target: mineNo, delivery: "", note: "", swap: sw };
    if (p >= 1 + ex.length) ex.push(pt); else ex.splice(p - 1, 0, pt);
    const nd = {};   // ручные ✓ — по новым номерам (как при вставке точки в середину)
    Object.keys(other.done || {}).forEach((j) => { nd[Number(j) >= p ? Number(j) + 1 : Number(j)] = other.done[j]; });
    nd[p] = true;
    other.done = nd;
  }
  other.unit = mineNo;
  other.open = true;
  delete other.crew;
  delete other.x10;
  return true;
}
// отмена обмена в чужой строке: убрать встречу (если на месте p та самая — по времени at), вернуть прежний тягач
function undoExchange(other, p, at) {
  const ex = other.extra || [];
  const pt = ex[p - 1];
  if (!pt || !pt.swap || pt.swap.at !== at) return false;
  const yNo = pt.swap.from;
  dropSeenAfter(other, p);   // v3.198: ✓ после встречи набрал другой тягач
  const nd = {};
  if (pt.swap.reuse) {   // v3.213: точка была введена до обмена — остаётся на месте, снимаем только след и ✓
    delete pt.swap;
    Object.keys(other.done || {}).forEach((j) => { if (Number(j) !== p) nd[j] = other.done[j]; });
  } else {
    ex.splice(p - 1, 1);
    Object.keys(other.done || {}).forEach((j) => { const n = Number(j); if (n !== p) nd[n > p ? n - 1 : n] = other.done[j]; });
  }
  other.done = nd;
  other.unit = yNo;
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
// chk — необязательная галочка {text}; fn кнопки получает её состояние
function openSwapPop(anchor, title, note, buttons, chk) {
  closeSwapPop();
  swapPop = document.createElement("div");
  swapPop.className = "trl-ed swap-pop";
  swapPop.innerHTML = `<div class="trl-ed-t">${title}</div>${note ? `<div class="trl-ed-err swap-note">${note}</div>` : ""}
    ${chk ? `<label class="swap-chk"><input type="checkbox" class="swap-chk-in"> ${chk.text}</label>` : ""}
    <div class="trl-ed-b">${buttons.map((b, i) => `<button data-i="${i}" class="${b.ok ? "trl-ed-ok" : "trl-ed-cancel"}">${b.text}</button>`).join("")}</div>`;
  document.body.appendChild(swapPop);
  const r = anchor.getBoundingClientRect();
  const z = uiZoom();
  swapPop.style.width = "280px";
  swapPop.style.top = Math.min(window.innerHeight - swapPop.offsetHeight * z - 8, r.bottom + 4) / z + "px";
  swapPop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - swapPop.offsetWidth * z - 8)) / z + "px";
  swapPop.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    const fn = buttons[Number(b.dataset.i)].fn;
    const box = swapPop.querySelector(".swap-chk-in");
    const on = !!(box && box.checked);
    closeSwapPop();
    if (fn) fn(on);
  }));
  swapPop.addEventListener("mousedown", (e) => e.stopPropagation());
}
document.addEventListener("mousedown", () => closeSwapPop());

// другие строки Флота с тем же тягачом: чужая строка для обмена — первая непустая, место встречи в ней
function swapDupInfo(row, to) {
  const dups = rows.filter((r) => r.id !== row.id && normNo(r.unit) === normNo(to));
  const ex = dups.find((r) => !rowIsEmpty(r)) || null;
  const slot = ex ? exchangeSlot(ex, firstOpenIdx(ex)) : null;
  const lab = (r) => {
    const d = typeof rowDisp === "function" && typeof dispLabel === "function" ? dispLabel(rowDisp(r)) : "";
    return d ? ` (${escapeHtml(d)})` : "";
  };
  return { dups, ex, slot, lab };
}
function afterSwapChange(ids) {
  ids.forEach((i) => { if (typeof removeMarker === "function") removeMarker(i); });
  saveRows();
  renderRows();
  ids.forEach((i) => calcRow(i, "edit"));
}
function doTransfer(id, k, exchange) {
  const row = rows.find((r) => r.id === id);
  const to = row && swapCandidate(row, k);
  if (!to) return;
  const mineNo = row.unit;
  const at = Date.now();
  let other = null, slot = null;
  if (exchange) {
    const inf = swapDupInfo(row, to);
    other = inf.slot != null ? inf.ex : null;
    slot = inf.slot;
  }
  if (!applyTransfer(row, k, to, at, other ? { rid: other.id, p: slot } : null)) return;
  if (other) applyExchange(other, slot, mineNo, to, at, row.id);
  afterSwapChange(other ? [id, other.id] : [id]);
}
function doUndoTransfer(id, k) {
  const row = rows.find((r) => r.id === id);
  const p = row && swapPoint(row, k);
  if (!p || !p.swap) return;
  const sw = p.swap;
  const other = sw.pair && sw.pair.p != null ? rows.find((r) => r.id === sw.pair.rid) : null;
  const undoneOther = !!(other && undoExchange(other, sw.pair.p, sw.at));
  if (!undoTransfer(row, k)) return;
  afterSwapChange(undoneOther ? [id, other.id] : [id]);
}
// у строки со встречей, вставленной обменом чужим диспетчером: убрать встречу и вернуть прежний тягач (только в этой строке)
function doUndoInserted(id, k) {
  const row = rows.find((r) => r.id === id);
  const p = row && swapPoint(row, k);
  if (!p || !p.swap || !undoExchange(row, k, p.swap.at)) return;
  afterSwapChange([id]);
}

// клик по номеру точки k строки id; true — клик разобран здесь (дальше обычный ✓ не нужен)
function swapChipClick(id, k, anchor) {
  const row = rows.find((r) => r.id === id);
  if (!row) return false;
  const p = swapPoint(row, k);
  if (p && p.swap) {
    const inserted = !!(p.swap.pair && p.swap.pair.p == null);   // встреча вставлена обменом из чужой строки
    openSwapPop(anchor, `Перецеп ${escapeHtml(p.swap.from)} → ${escapeHtml(p.swap.to)}, ${swapWhen(p.swap.at)}`,
      inserted ? `Это обмен, начатый в другой строке. Отмена уберёт встречу и вернёт ${escapeHtml(p.swap.from)} в эту строку.`
        : `Отмена вернёт ${escapeHtml(p.swap.from)} в строку и снимет ✓ с точки${p.swap.pair ? ", а в строке обмена — тоже" : ""}.`,
      [{ text: inserted ? "Отменить обмен здесь" : "Отменить перецеп", ok: true, fn: () => (inserted ? doUndoInserted(id, k) : doUndoTransfer(id, k)) },
       { text: "Закрыть" }]);
    return true;
  }
  const to = swapCandidate(row, k);
  if (!to) return false;
  const c = lastCalcText[id];
  const f = c && c.doneFlags && c.doneFlags[k];
  const m = row.done && (row.done[k] === true || row.done[k] === false) ? row.done[k] : null;
  if (m != null || (f && f.done)) return false;   // клик не поставил бы ✓ — обычное поведение
  const inf = swapDupInfo(row, to);
  let note = "";
  if (inf.dups.length) {
    note = `В Флоте уже есть строка ${escapeHtml(to)}${inf.lab(inf.dups[0])}${inf.dups.length > 1 ? " и ещё " + (inf.dups.length - 1) : ""} — удалите её сами${inf.ex && inf.slot != null ? ", если это не обмен" : ""}.`;
    if (inf.ex && inf.slot == null) note += " В её трипе нет пройденных точек — обмен там автоматически не сделать.";
  }
  const chk = inf.ex && inf.slot != null
    ? { text: `Обмен: в строке ${escapeHtml(to)}${inf.lab(inf.ex)} поставить ${escapeHtml(row.unit)} и ${exchangeReuses(inf.ex, inf.slot, row.unit) ? "отметить встречу" : "вставить встречу"}` } : null;
  openSwapPop(anchor, `Передать ${row.trailer ? "прицеп " + escapeHtml(row.trailer) : "рейс"} → ${escapeHtml(to)}?`, note,
    [{ text: "Да, перецеп", ok: true, fn: (on) => doTransfer(id, k, on) },
     { text: "Нет, просто встреча", fn: () => toggleDone(id, k) }], chk);
  return true;
}
