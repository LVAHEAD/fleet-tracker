/*
done-marks.js — пройденные точки ✓: хранение авто-✓ в строке, приезд, ручные отметки, разбор ответа сервера по точкам, подсветка точек (v3.78, вынесено из app.js).
doneSeenArray / doneArrArray / keepDoneSeen / doneManualArray, doneEtaHtml, remapDone, applyDoneClasses, toggleDone.
Только перенос кода, расчёт «пройдено» на сервере (domain/points.py) не менялся. Опирается на глобалы app.js (rows, lastCalcText, saveRows, calcRow, applyCorStrip, STOP_NUM, escapeHtml), вызываемые во время работы. Грузится ДО app.js.
*/

// ---------- v1.79: пройденные точки ✓ ----------
// row.done = {индекс точки: true|false} — ручные отметки (0 — точка ①); нет ключа — авто по Mapon
// v3.17: авто-✓ запоминаем в строке (по тексту точки) — иначе через 2–4 суток стоянка уходит
// из истории Mapon и точка снова «не пройдена»
function doneSeenArray(row) {
  const m = row.doneSeen || {};
  return [row.target || ""].concat((row.extra || []).map((x) => x.target || "")).map((t) => (t && m[t]) || null);
}
// v3.57: приезд к авто-✓ — отдельная карта doneArr (та же логика, что doneSeen)
function doneArrArray(row) {
  const m = row.doneArr || {};
  return [row.target || ""].concat((row.extra || []).map((x) => x.target || "")).map((t) => (t && m[t]) || null);
}
function keepDoneSeen(row, data) {
  const pts = [row.target || ""].concat((row.extra || []).map((x) => x.target || ""));
  const old = row.doneSeen || {};
  const oldA = row.doneArr || {};
  const next = {};
  const nextA = {};
  (data.points_done || []).forEach((x, i) => {
    const t = pts[i];
    if (!t) return;
    if (x && x.done && x.auto && x.at) next[t] = x.at;
    else if (old[t] && !(x && (x.manual === false || x.gated))) next[t] = old[t];   // v3.210: gated — точка идёт после непройденной, старую ✓ не храним
    if (x && x.done && x.auto && x.arr) nextA[t] = x.arr;
  });
  if (JSON.stringify(next) !== JSON.stringify(old) || JSON.stringify(nextA) !== JSON.stringify(oldA)) {
    if (Object.keys(next).length) row.doneSeen = next; else delete row.doneSeen;
    if (Object.keys(nextA).length) row.doneArr = nextA; else delete row.doneArr;
    saveRows();
  }
}
function doneManualArray(row) {
  const n = 1 + (row.extra ? row.extra.length : 0);
  const d = row.done || {};
  return Array.from({ length: n }, (_, i) => (d[i] === true || d[i] === false ? d[i] : null));
}
// v3.143: серая метка «лок.» — время показано в местном поясе страны точки (FI, PT, Балтия…), не по Берлину
function tzBadge(cc) { return cc ? ` <span class="tz-loc" title="Местное время страны ${cc} (не EU time / Берлин)">лок.</span>` : ""; }
function doneEtaHtml(x) {
  const at = x.done_at || x.at;
  const auto = x.done_auto != null ? x.done_auto : x.auto;
  const by = x.done_by != null ? x.done_by : x.by;
  // v3.29: ✓ по следующей точке — бледный, без времени
  if (by != null) {
    return `<span class="done-eta done-by" title="Пройдена следующая точка ${STOP_NUM[by + 1]} — значит, и эта">✓ по ${STOP_NUM[by + 1]}</span>`;
  }
  const zone = x.done_zone || x.zone;
  const arr = x.done_arr || x.arr;   // v3.57: приезд на точку (если трек его знает)
  const where = zone ? `в зоне Mapon «${zone}»` : "на точке";
  const msrc = x.done_msrc != null ? x.done_msrc : x.msrc;   // v3.172: ручная ✓ со временем: mapon — отъезд со стоянки, click — время нажатия
  const manualTip = msrc === "mapon" ? `Отмечено вручную · время — отъезд со стоянки Mapon рядом с точкой (до 100 м)${arr && at ? `, стояла с ${arr}` : ""}`
    : (msrc === "click" ? "Отмечено вручную · время — момент нажатия ✓ (стоянки Mapon в 100 м нет)" : "Отмечено вручную");
  const tip = auto ? (arr && at ? `Трак стоял ${where} с ${arr} до ${at} и уехал` : `Трак стоял ${where} и уехал`) : manualTip;
  const timed = at && (auto || msrc);
  const label = timed ? at : "пройдена";   // v3.81: в ячейке только время отъезда, «приехал – уехал» — в подсказке
  return `<span class="done-eta" title="${escapeHtml(tip + (x.done_tz ? " · местное время " + x.done_tz : ""))}">✓ ${escapeHtml(label)}${timed ? tzBadge(x.done_tz) : ""}</span>`;
}
// ответ сервера (① и extra — только непройденные) -> по исходным номерам точек
function remapDone(data) {
  const dn = data.points_done;
  if (!dn) return data;
  const act = data.active_idx || [];
  const doneItem = (i) => ({ done: true, done_at: dn[i].at_loc || dn[i].at, done_arr: dn[i].arr_loc || dn[i].arr || null, done_tz: dn[i].tz || null, done_auto: dn[i].auto, done_msrc: dn[i].msrc || null,   // v3.143: время — местное, если at_loc; v3.172: msrc — источник времени ручной ✓
    done_by: dn[i].by != null ? dn[i].by : null, done_zone: dn[i].zone || null,
    done_leg_km: dn[i].leg_km != null ? dn[i].leg_km : null,   // v3.122: плечо пройденной точки ②③…
    chain_geo: !!dn[i].chain_geo,                              // v3.226: точка в NO / в 200 км от Стокгольма
    badge: dn[i].badge || null, badge_hint: dn[i].badge_hint || null });
  const main = data.target_lat != null ? {
    dist_km: data.dist_km, leg_km: data.dist_km, eta_local: data.eta_local, eta_tacho: data.eta_tacho,
    tacho_weeklimit: data.tacho_weeklimit, eta_tz: data.eta_tz || null, badge: data.target_badge, badge_hint: data.target_code_hint, chain_geo: !!data.target_chain_geo,
    lat: data.target_lat, lng: data.target_lng, polyline: null, bans_route: null, from_truck: true,
    target_address: data.target_address,
  } : { error: "нет координат" };
  const activeItems = [main].concat(data.extra || []);
  const byIdx = {};
  act.forEach((idx, j) => { byIdx[idx] = activeItems[j]; });
  data.first_done = dn[0] && dn[0].done ? doneItem(0) : null;
  if (dn.length > 1) {
    data.extra = dn.slice(1).map((x, k) => (x.done ? doneItem(k + 1) : (byIdx[k + 1] || { empty: true })));
  }
  return data;
}
function applyDoneClasses(tr, row, c) {
  if (!tr) return;
  const flags = (c && c.doneFlags) || [];
  tr.classList.toggle("row-done", !!(c && c.allDone));
  // v3.22: все точки пройдены — строка серая и ждёт подтверждения хозяина / назначающего
  tr.classList.toggle("row-blink-done", typeof awaitsComplete === "function" && awaitsComplete(row));   // v3.81
  const cb = tr.querySelector(".cmpl-btn");
  if (cb) cb.hidden = !(c && c.allDone && window.fleetCanComplete && window.fleetCanComplete(row));
  // v1.81: трак на объекте точки k — её строка бледно-зелёная во всех колонках
  tr.querySelectorAll(".pt-here").forEach((el) => el.classList.remove("pt-here"));
  const h = c && c.hereIdx != null ? c.hereIdx : null;
  if (h != null) {
    const pick = (sel) => tr.querySelector(sel);
    [h === 0 ? pick(".target-wrap:not(.x-stop)") : pick(`.x-stop[data-k="${h}"]`),
     h === 0 ? pick(".delivery-input") : pick(`.xd-input[data-k="${h}"]`),
     tr.querySelectorAll(".dist-cell .sl")[h],
     tr.querySelectorAll(".eta-cell .sl")[h],
     h === 0 ? pick(".note-wrap:not(.xn-wrap)") : pick(`.xn-input[data-k="${h}"]`) && pick(`.xn-input[data-k="${h}"]`).closest(".xn-wrap"),
    ].forEach((el) => { if (el) el.classList.add("pt-here"); });
  }
  tr.querySelectorAll("#fleet-tbody .target-wrap, .target-wrap").forEach((w) => {
    const k = w.classList.contains("x-stop") ? Number(w.dataset.k) : 0;
    const f = flags[k];
    w.classList.toggle("pt-done", !!(f && f.done));
    // v3.81: окно Delivery пройденной точки — тоже зачёркнуто
    const dl = k === 0 ? tr.querySelector(".delivery-input") : tr.querySelector(`.xd-input[data-k="${k}"]`);
    if (dl) dl.classList.toggle("pt-done", !!(f && f.done));
    const chip = w.querySelector(".stop-n");
    if (chip) {
      const m = row.done && (row.done[k] === true || row.done[k] === false) ? row.done[k] : null;
      chip.title = (f && f.done ? (f.by != null ? `Пройдена (по следующей точке ${STOP_NUM[f.by + 1]})`
        : f.auto ? `Пройдена (авто: стоял ${f.zone ? "в зоне «" + f.zone + "»" : "здесь"}, уехал ${f.at})` : "Пройдена (вручную)")
        : (m === false ? "Не пройдена (вручную)" : "Не пройдена"))
        + (m != null && row.doneBy && row.doneBy[k] ? `\n${m === true ? "Пройдена" : "Не пройдена"} вручную · ${row.doneBy[k].who} · ${row.doneBy[k].at}` : "")
        + "\nДва клика — " + (m == null ? (f && f.done ? "отметить непройденной" : "отметить пройденной") : "вернуть автоопределение");
      chip.classList.add("stop-n-click");
      chip.classList.toggle("stop-n-manual", m != null);
    }
  });
  applyCorStrip(tr, row, c);   // v3.45
}

// v3.159: отметка ✓ в два клика — первый взводит кружок с номером точки, второй ставит / снимает.
// Уход мыши с кружка сбрасывает взвод. -> true, если это первый клик (ничего не переключаем).
let doneArmKey = null, doneArmAt = 0;
const DONE_ARM_PAUSE_MS = 500;   // второй клик засчитывается только через паузу: быстрый двойной клик ничего не ставит
function armDoneClick(chip, id, k) {
  const key = id + ":" + k;
  const armedNow = doneArmKey === key && chip.classList.contains("armed");
  if (armedNow && Date.now() - doneArmAt < DONE_ARM_PAUSE_MS) return true;   // двойной клик — взвод остаётся, отметка не меняется
  document.querySelectorAll(".stop-n.armed").forEach((c) => c.classList.remove("armed"));
  if (armedNow) { doneArmKey = null; return false; }
  doneArmKey = key;
  doneArmAt = Date.now();
  chip.classList.add("armed");
  chip.addEventListener("mouseleave", () => {
    chip.classList.remove("armed");
    if (doneArmKey === key) doneArmKey = null;
  }, { once: true });
  return true;
}

// v3.164: время отметки для подсказки, «20/10 06:55»
function doneNowStr() {
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// v3.172: время нажатия по Берлину «dd/mm HH:MM» — как все времена сервера (потом он переводит в местное время страны точки)
function nowEuStr() {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
    const g = (t) => (parts.find((p) => p.type === t) || {}).value || "";
    return `${g("day")}/${g("month")} ${g("hour")}:${g("minute")}`;
  } catch (e) { return ""; }
}
// v3.172: время нажатия у ручных ✓ (по индексам точек, только у «пройдена») — сервер берёт его, если рядом нет стоянки Mapon
function doneClickArray(row) {
  const n = 1 + (row.extra ? row.extra.length : 0);
  const d = row.done || {}, by = row.doneBy || {};
  return Array.from({ length: n }, (_, i) => (d[i] === true && by[i] && by[i].eu ? by[i].eu : null));
}

function toggleDone(id, k) {
  const row = rows.find((r) => r.id === id);
  if (!row) return;
  const c = lastCalcText[id];
  const f = c && c.doneFlags && c.doneFlags[k];
  row.done = row.done || {};
  row.doneBy = row.doneBy || {};   // v3.164: кто и когда поставил ручную отметку
  if (row.done[k] === true || row.done[k] === false) { delete row.done[k]; delete row.doneBy[k]; }
  else {
    row.done[k] = !(f && f.done);
    const me = fleetMe();
    row.doneBy[k] = { who: (me && dispTag(me)) || me || "local", at: doneNowStr(), eu: nowEuStr() };   // v3.172: eu — время нажатия для ✓
  }
  if (!Object.keys(row.doneBy).length) delete row.doneBy;
  saveRows();
  calcRow(id);
}
