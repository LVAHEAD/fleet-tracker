/* stop-insert.js — вставка точки ВЫШЕ данной (Ctrl+клик по «+», v3.351).
   Чистая функция (без DOM): точки ниже сдвигаются вместе со своими полями (дата, примечание, комментарий, перецеп, ручные ✓).
   Точка ① хранится в самой строке (lo / target / delivery / note / com / swap), ②+ — в row.extra:
   при вставке выше ① старая ① переезжает в extra[0], в строке остаётся пустая новая ①. */
const STOP_MOVE_KEYS = ["lo", "target", "delivery", "note", "com", "swap"];

function shiftIndexKeyed(obj, from, delta) {
  // ключи-номера точек >= from сдвигаются на delta (ручные done / doneBy)
  if (!obj) return obj;
  const out = {};
  Object.keys(obj).forEach((key) => {
    const j = Number(key);
    out[j >= from ? j + delta : j] = obj[key];
  });
  return out;
}

// k — номер точки (0 — ①), выше которой вставляем пустую; возвращает k (номер новой точки)
function insertStopAbove(row, k) {
  const ex = row.extra || [];
  k = Math.max(0, Math.min(Number(k) || 0, ex.length));
  if (k === 0) {
    const moved = { lo: row.lo || "", target: row.target || "", delivery: row.delivery || "", note: row.note || "" };
    if (row.com) moved.com = row.com;
    if (row.swap) moved.swap = row.swap;
    STOP_MOVE_KEYS.forEach((key) => { delete row[key]; });
    row.lo = ""; row.target = ""; row.delivery = ""; row.note = "";
    ex.unshift(moved);
  } else {
    ex.splice(k - 1, 0, { lo: "", target: "", delivery: "", note: "" });
  }
  row.extra = ex;
  if (row.done) row.done = shiftIndexKeyed(row.done, k, 1);
  if (row.doneBy) row.doneBy = shiftIndexKeyed(row.doneBy, k, 1);
  return k;
}
