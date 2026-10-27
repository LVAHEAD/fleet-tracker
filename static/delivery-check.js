/*
delivery-check.js — окна Delivery / TimeSlot и проверка опоздания (v3.72, вынесено из app.js).
Чистые функции без DOM: разбор текста окна, срок, «опоздает ли» по ETA. Грузится ДО app.js.
*/

const DT_T = "(\\d{1,2})(?:[:.](\\d{2}))?\\s*(am|pm|h)?";
function hmOf(h, m, ap, apFallback) {
  let hh = +h, mm = m ? +m : 0;
  const a = ap || apFallback;
  if (a === "pm" && hh < 12) hh += 12;
  if (a === "am" && hh === 12) hh = 0;
  if (hh > 24 || mm > 59) return null;
  return hh * 60 + mm;
}
function parseDeliveryWindow(txt) {
  const s = String(txt || "");
  // v3.10: окно «с–по» через даты: "03.10 22:00 – 04.10 06:00", "с 03/10 22 по 04/10 06"
  const DD = "(\\d{1,2})[\\/.](\\d{1,2})(?:[\\/.]\\d{2,4})?\\s+";
  const two = s.toLowerCase().match(new RegExp(DD + DT_T + "\\s*(?:-|–|—|to|till|until|до|по)\\s*" + DD + DT_T));
  if (two) {
    const a = hmOf(two[3], two[4], two[5], two[10]);
    const b = hmOf(two[8], two[9], two[10]);
    const okD = (d, m) => d >= 1 && d <= 31 && m >= 1 && m <= 12;
    if (a != null && b != null && okD(+two[1], +two[2]) && okD(+two[6], +two[7])) {
      const start = mkDate(+two[1], +two[2], Math.floor(a / 60), a % 60);
      const end = mkDate(+two[6], +two[7], Math.floor(b / 60), b % 60);
      if (end > start) return { start, end };
    }
  }
  let day, mon, rest;
  const iso = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})(.*)$/);
  const d = iso ? null : s.match(/(\d{1,2})[\/.](\d{1,2})(?:[\/.]\d{2,4})?(.*)$/);
  if (iso) { day = +iso[3]; mon = +iso[2]; rest = iso[4] || ""; }
  else if (d) { day = +d[1]; mon = +d[2]; rest = d[3] || ""; }
  // v1.68: только время ("22.00", "22:00", "09-15", "до 15", "after 10") — значит сегодня.
  // "22.00" похоже на дату 22/00 — если такая дата невалидна или далеко от сегодня
  // (раньше чем 2 дня назад / позже чем через 60 дней), читаем как время сегодня.
  const dateOk = day >= 1 && day <= 31 && mon >= 1 && mon <= 12 && (() => {
    const dd = mkDate(day, mon, 12, 0).getTime() - Date.now();
    return dd > -2 * 86400000 && dd < 60 * 86400000;
  })();
  const explicitDate = iso || /\d{1,2}\/\d{1,2}|\d{1,2}\.\d{1,2}\.\d{2,4}/.test(s);
  if (!dateOk && !explicitDate) {
    if (!/\d/.test(s)) return null;
    const now = new Date();
    day = now.getDate(); mon = now.getMonth() + 1; rest = s;
  }
  if (day < 1 || day > 31 || mon < 1 || mon > 12) return null;
  rest = rest.toLowerCase();
  const at = (min) => mkDate(day, mon, Math.floor(min / 60), min % 60);
  const range = rest.match(new RegExp(DT_T + "\\s*(?:-|–|—|to|till|until|and|до|по)\\s*" + DT_T));
  if (range) {
    const a = hmOf(range[1], range[2], range[3], range[6]);
    const b = hmOf(range[4], range[5], range[6]);
    if (a != null && b != null) {
      const start = at(a);
      let end = at(b);
      if (b <= a) end = new Date(end.getTime() + 86400000);   // окно через полночь
      return { start, end };
    }
  }
  const before = rest.match(new RegExp("(?:before|until|till|not later than|latest|до|do)\\s*" + DT_T));
  if (before) {
    const b = hmOf(before[1], before[2], before[3]);
    if (b != null) return { start: null, end: at(b) };
  }
  const after = rest.match(new RegExp("(?:after|from|после|от|с)\\s*" + DT_T));
  if (after) {
    const a = hmOf(after[1], after[2], after[3]);
    if (a != null) return { start: at(a), end: null };
  }
  // v3.105: «at 10:30» / «в 10:30» — фикс-время приёмки: окно из одного момента (позже — опоздание, раньше — будет ждать)
  // v3.229: «FIX 10:30» и «F 10:30» — то же, что at; одиночная «F» — только прямо перед временем и не внутри слова
  const fixed = rest.match(new RegExp("(?:^|[^a-zа-яё])(?:at|в|@)\\s*" + DT_T))
    || rest.match(new RegExp("(?:^|[^a-zа-яё\\d])(?:fix|f)\\s*" + DT_T));
  if (fixed) {
    const t = hmOf(fixed[1], fixed[2], fixed[3]);
    if (t != null) return { start: at(t), end: at(t), fixed: true };
  }
  const single = rest.match(new RegExp("(?:^|[^\\d])" + DT_T + "(?![\\d])"));
  if (single) {
    const t = hmOf(single[1], single[2], single[3]);
    if (t != null) return { start: null, end: at(t) };
  }
  return { start: null, end: at(23 * 60 + 59) };
}
// срок доставки (конец окна) — для совместимости
function parseDelivery(txt) {
  const w = parseDeliveryWindow(txt);
  return w ? w.end : null;
}
// v1.54: строки подсказки и флаг опоздания по окну Delivery
function deliveryCheck(row, etaStr) {
  const w = parseDeliveryWindow(row.delivery);
  const etaD = parseEta(etaStr);
  const out = { late: false, lines: [] };
  if (!w || !etaD) return out;
  // v1.59: дата Delivery сильно в прошлом — скорее опечатка, не красим, а предупреждаем
  const ref = w.end || w.start;
  if (ref && Date.now() - ref.getTime() > 2 * 86400000) {
    out.lines.push("⚠ Дата TimeSlot в прошлом — проверь (опечатка?)");
    return out;
  }
  const hm = (d) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (w.end && etaD > w.end) {
    out.late = true;
    out.lines.push(w.fixed ? `Позже фикс-времени TimeSlot (${row.delivery}) — ${hm(w.end)}`
      : `Позже TimeSlot (${row.delivery}) — ${w.start ? "окно до" : "срок"} ${hm(w.end)}`);
  } else if (w.start && etaD < w.start - FIX_EARLY_MS) {   // v3.229: раньше слота можно до 1 ч — раньше только ждёт
    out.lines.push(w.fixed ? `⏳ Раньше фикс-времени TimeSlot — ${hm(w.start)}, будет ждать`
      : `⏳ Раньше окна TimeSlot — с ${hm(w.start)}, будет ждать`);
  }
  return out;
}
// v3.229: фикс-время точки — раньше слота можно до 1 ч, после слота нужно ~2 ч рабочего времени (выгрузка + парковка)
const FIX_EARLY_MS = 60 * 60000;
const FIX_AFTER_SEC = 2 * 3600;
const FIX_PARK_DRIVE_SEC = 30 * 60;   // и хоть полчаса вождения (на поиск парковки)
// «не раньше» точки по её окну Delivery / TimeSlot (epoch, сек) — серверу для ожидания; нет начала окна — null
function fixNotBefore(txt) {
  let w = null;
  try { w = parseDeliveryWindow(txt); } catch (e) { return null; }
  return w && w.start ? Math.floor((w.start.getTime() - FIX_EARLY_MS) / 1000) : null;
}
function fixHm(sec) {
  const m = Math.max(0, Math.round(sec / 60));
  return m >= 60 ? `${Math.floor(m / 60)} ч${m % 60 ? " " + (m % 60) + " мин" : ""}` : `${m} мин`;
}
// Вердикт по фикс-точке (w.fixed): {kind: late|short|wait, text} или null, если успевает (текст у «успевает» — не решено).
// etaStr — ETA «дд/мм чч:мм»; left — {drive, shift} сек на приезде (сервер, tacho_left); wait — сек ожидания у сервера.
function fixVerdict(txt, etaStr, left) {
  let w = null;
  try { w = parseDeliveryWindow(txt); } catch (e) { return null; }
  const eta = parseEta(etaStr);
  if (!w || !w.fixed || !w.start || !eta) return null;
  const slot = w.start;
  if (Date.now() - slot.getTime() > 2 * 86400000) return null;           // дата в прошлом — это опечатка, её ловит deliveryCheck
  const diff = (eta.getTime() - slot.getTime()) / 1000;
  if (diff > 0) return { kind: "late", text: `Не успевает на ${fixHm(diff)}`, short: `опоздает на ${fixHm(diff)}` };
  const early = -diff;
  const waitSec = early;                                                    // приехал раньше слота — стоит до слота
  if (left && typeof left.shift === "number") {
    const shiftAtSlot = left.shift - waitSec;
    const driveLeft = typeof left.drive === "number" ? left.drive : Infinity;
    if (shiftAtSlot < FIX_AFTER_SEC || driveLeft < FIX_PARK_DRIVE_SEC) {
      return { kind: "short", text: `Не хватает на выгрузку и парковку: после слота ${fixHm(Math.max(0, Math.min(shiftAtSlot, FIX_AFTER_SEC)))} из 2 ч`, short: "нет 2 ч после слота" };
    }
  }
  if (early > FIX_EARLY_MS / 1000) return { kind: "wait", text: `Приедет раньше, ждёт ${fixHm(early)}`, short: `ждёт ${fixHm(early)}` };
  return null;
}
// v3.10: проверка по тексту TimeSlot (любая точка)
function slotCheck(txt, etaStr) { return deliveryCheck({ delivery: txt }, etaStr); }
// опаздывает ли хоть одна непройденная следующая точка (② и дальше)
function extrasLate(row, extra) {
  return (row.extra || []).some((x, i) => {
    const ce = extra && extra[i];
    return !!(ce && !ce.done && !ce.error && slotCheck(x.delivery, ce.eta_tacho || ce.eta_local).late);
  });
}
// "dd/mm HH:MM" (ETA с сервера) -> Date
function parseEta(txt) {
  const d = String(txt || "").match(/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/);
  return d ? mkDate(+d[1], +d[2], +d[3], +d[4]) : null;
}
function mkDate(day, mon, hh, mm) {
  const now = new Date();
  let y = now.getFullYear();
  if (mon - (now.getMonth() + 1) > 6) y -= 1;       // декабрь при январе
  else if ((now.getMonth() + 1) - mon > 6) y += 1;  // январь при декабре
  return new Date(y, mon - 1, day, hh, mm);
}
