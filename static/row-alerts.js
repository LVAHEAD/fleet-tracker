/*
row-alerts.js — тревоги строки Флота: мало топлива (⛽) и реф (❄) — мигание до клика «увидел» (v3.73, вынесено из app.js).
Состояние «увидел» и задержка рефа — в localStorage браузера. Опирается на глобалы app.js (lastCalcText, fmtT), вызываемые во время работы. Грузится ДО app.js.
*/

// v3.30: мало топлива (реф < 40 л, тягач < 100 л) — строка мигает янтарным до клика; «увидел» помним
// в браузере (у каждого диспетчера свой клик), пока топливо не поднимется выше порога
let fuelSeen = {};
try { fuelSeen = JSON.parse(localStorage.getItem("fleet-fuel-seen") || "{}") || {}; } catch (e) { fuelSeen = {}; }
function saveFuelSeen() {
  try { localStorage.setItem("fleet-fuel-seen", JSON.stringify(fuelSeen)); } catch (e) { /* ignore */ }
}
function fuelLowOf(data) {
  const lines = [];
  if (data.truck_fuel && data.truck_fuel.low) lines.push(`⛽ Тягач: ${data.truck_fuel.l} л — мало (< 100 л)`);
  const rf = data.is_trailer ? data.reefer : data.linked_trailer && data.linked_trailer.reefer;
  if (rf && rf.fuel_low) lines.push(`⛽ Реф: ${Math.round(rf.fuel_l)} л — мало (< 40 л)`);
  return lines.length ? lines : null;
}
// v3.130: чужая строка — без мигания (класс гасит анимацию), значок алерта в ячейке машины горит статично
function quietSync(tr, id) {
  if (!tr) return;
  const row = typeof rows !== "undefined" ? rows.find((r) => r.id === id) : null;
  tr.classList.toggle("row-quiet", !!row && typeof rowIsMine === "function" && !rowIsMine(row));
}
function applyFuelBlink(tr, id) {
  if (!tr) return;
  quietSync(tr, id);
  const c = lastCalcText[id];
  if (!c) return;
  const low = c.fuelLow;
  if (!low && fuelSeen[id]) { delete fuelSeen[id]; saveFuelSeen(); }   // заправились — в следующий раз снова мигать
  const on = !!low && !fuelSeen[id];
  tr.classList.toggle("row-blink-fuel", on);
  alertTitle(tr, id);
}
function fuelSeenClick(tr, id) {
  if (!tr.classList.contains("row-blink-fuel")) return;
  tr.classList.remove("row-blink-fuel");
  fuelSeen[id] = true;
  saveFuelSeen();
  alertTitle(tr, id);
}

// v3.34: тревоги рефа — строка мигает синим до клика «увидел»; снова — после возврата в норму и новой беды.
// (1) температура ушла от уставки дальше порога (заморозка 5°, охлаждёнка 3° — порог даёт сервер) дольше 30 мин;
// (2) реф выключен, а прицеп гружён (вес с CAN тягача; вес не решает — отметки L / O и ✓ точек) — тоже 30 мин;
// (3) данные рефа не обновлялись ≥ 2 ч, а машина едет — сразу. Задержку и «увидел» помнит браузер.
const RF_DELAY_MS = 30 * 60e3;
let rfState = {};   // id -> { first: {temp, off, stale: мс}, seen: bool }
try { rfState = JSON.parse(localStorage.getItem("fleet-reefer-alert") || "{}") || {}; } catch (e) { rfState = {}; }
function saveRfState() {
  try { localStorage.setItem("fleet-reefer-alert", JSON.stringify(rfState)); } catch (e) { /* ignore */ }
}
// гружён по отметкам L / O: пройдена L и после неё есть непройденная O; нет отметок — null (не знаем)
function loadedByLO(row, data) {
  if (!row) return null;
  const lo = [row.lo || ""].concat((row.extra || []).map((x) => (x && x.lo) || ""));
  if (!lo.some((v) => v === "L" || v === "O")) return null;
  const done = (data.points_done || []).map((x) => !!(x && x.done));
  let lastL = -1;
  lo.forEach((v, i) => { if (v === "L" && done[i]) lastL = i; });
  if (lastL < 0) return false;
  return lo.some((v, i) => i > lastL && v === "O" && !done[i]);
}
const tn = (kg) => (kg / 1000).toFixed(1).replace(".", ",") + " т";
function reeferLoaded(row, data) {
  const w = data.truck_weight;
  if (w && w.state === "loaded") return { v: true, why: `вес состава ${tn(w.comb)}` + (w.trl != null ? `, на оси прицепа ${tn(w.trl)}` : "") };
  if (w && w.state === "notrailer") return { v: false };
  const lo = loadedByLO(row, data);
  return { v: lo, why: lo ? "по отметкам L / O" : "" };
}
// условия тревоги сейчас (без задержки): [{k: temp | off | stale, text}]
function reeferAlertsOf(data, row) {
  if (row && row.noTemp) return [];   // v3.119: NoTemp — груз без температуры, тревоги рефа выключены
  const rf = data.is_trailer ? data.reefer : data.linked_trailer && data.linked_trailer.reefer;
  const comps = (rf && rf.compartments) || [];
  if (!comps.length) return [];
  const out = [];
  const bad = comps.filter((c) => c.on && c.dev != null && !c.stale && Math.abs(c.dev) > (c.lim || 3));
  if (bad.length) out.push({ k: "temp", text: "❄ Температура ушла: " + bad.map((c) =>
    `отсек ${c.n} — возврат ${fmtT(c.ret)} при уставке ${fmtT(c.set)} (${c.dev > 0 ? "+" : ""}${c.dev}°, допуск ${c.lim || 3}°)`).join("; ") });
  if (!comps.some((c) => c.on) && !comps.some((c) => c.stale)) {
    const ld = reeferLoaded(row, data);
    if (ld.v) out.push({ k: "off", text: `❄ Реф выключен, а прицеп гружён (${ld.why})` });
  }
  if (data.status === "driving" && comps.some((c) => c.stale) && comps.some((c) => c.on)) {   // v3.119: реф «выкл» — устаревшие данные не тревога
    const at = comps.map((c) => c.at).filter(Boolean)[0];
    out.push({ k: "stale", text: "❄ Данные рефа не обновлялись больше 2 ч" + (at ? ` (последние — ${at})` : "") + ", а машина едет" });
  }
  return out;
}
// включённые сейчас тревоги (задержка выдержана) -> строки подсказки или null
function reeferActive(id) {
  const c = lastCalcText[id];
  const st = rfState[id];
  if (!c || !c.rfAlerts || !st) return null;
  const now = Date.now();
  const on = c.rfAlerts.filter((a) => a.k === "stale" || (st.first[a.k] && now - st.first[a.k] >= RF_DELAY_MS));
  return on.length ? on.map((a) => a.text) : null;
}
function applyReeferBlink(tr, id) {
  if (!tr) return;
  quietSync(tr, id);
  const c = lastCalcText[id];
  if (!c || !c.rfAlerts) return;
  const now = Date.now();
  const st = rfState[id] || (rfState[id] = { first: {}, seen: false });
  const ks = c.rfAlerts.map((a) => a.k);
  Object.keys(st.first).forEach((k) => { if (!ks.includes(k)) delete st.first[k]; });
  ks.forEach((k) => { if (!st.first[k]) st.first[k] = now; });
  const act = reeferActive(id);
  if (!act) st.seen = false;          // всё в норме — следующая беда снова мигнёт
  if (!ks.length && !st.seen) delete rfState[id];
  saveRfState();
  tr.classList.toggle("row-blink-rf", !!act && !st.seen);
  alertTitle(tr, id);
}
function reeferSeenClick(tr, id) {
  if (!tr.classList.contains("row-blink-rf")) return;
  tr.classList.remove("row-blink-rf");
  if (rfState[id]) { rfState[id].seen = true; saveRfState(); }
  alertTitle(tr, id);
}
// задержка 30 мин выдерживается и без пересчёта строки (автообновление может быть выключено)
setInterval(() => {
  document.querySelectorAll("#fleet-tbody tr[data-id]").forEach((tr) => {
    const id = Number(tr.dataset.id);
    if (rfState[id] && lastCalcText[id]) applyReeferBlink(tr, id);
  });
}, 60e3);
// v3.95: значки слева в ячейке машины — показываются CSS-ом по классу строки (красное важнее рефа, реф важнее топлива)
function blinkIcoHtml() {
  return '<span class="blink-ico" data-k="late" title="Опаздывает">!</span>'
    + '<span class="blink-ico" data-k="rf" title="Тревога рефа">❄</span>'
    + '<span class="blink-ico" data-k="fuel" title="Мало топлива">⛽</span>';
}
// подсказка строки, пока она мигает топливом / рефом
function alertTitle(tr, id) {
  const c = lastCalcText[id] || {};
  const lines = [];
  if (tr.classList.contains("row-blink-rf")) lines.push(...(reeferActive(id) || []));
  if (tr.classList.contains("row-blink-fuel")) lines.push(...(c.fuelLow || []));
  // v3.95: иконки слева в строке — подсказка по тому, что мигает
  const rfIco = tr.querySelector('.blink-ico[data-k="rf"]');
  if (rfIco) rfIco.title = (reeferActive(id) || []).join("\n") || "Тревога рефа";
  const fuelIco = tr.querySelector('.blink-ico[data-k="fuel"]');
  if (fuelIco) fuelIco.title = (c.fuelLow || []).join("\n") || "Мало топлива";
  if (lines.length) tr.title = lines.join("\n") + "\nКлик по строке — «увидел»";
  else if (tr.title && (tr.title.indexOf("⛽") === 0 || tr.title.indexOf("❄") === 0)) tr.title = "";
}
