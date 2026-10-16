/*
map-mirror.js — основное окно: «зеркало» карты Флота для откреплённого окна (⧉ рядом с кнопкой «Дисп.: …», после v3.134).
Окно карты (/map-window, map-window.js) — отдельная страница, она сама ничего не считает: состояние карты приходит отсюда через
BroadcastChannel "fleet-map-win" (одно окно браузера → другое). Здесь записываем последние аргументы вызовов map-core
(updateMarker, updateTargetMarker, updateTrailerLink и удаления), строку выбора и маршруты (rowPositions) и раз в ~0,4 с после изменений шлём снимок,
но только пока окно карты живо (пинг раз в 5 с). Окно карты — только «таблица → карта»: клик там ничего не выбирает в этом окне.
Грузится ПОСЛЕ app.js и map-panel.js; оборачивает глобальные функции карты (как renderRows в app.js).
*/
(function () {
  if (typeof BroadcastChannel === "undefined") return;
  const ch = new BroadcastChannel("fleet-map-win");
  const POS_KEY = "fleet-map-win-pos";
  const U = {};    // rowId -> аргументы updateMarker
  const T = {};    // ключ ("id" или "id_k") -> аргументы updateTargetMarker
  const TL = {};   // rowId -> аргументы updateTrailerLink
  let aliveAt = 0;
  let timer = null;
  let last = "";
  let win = null;

  const verEl = document.querySelector(".title-version");
  const APP_VER = ((verEl && verEl.textContent) || "").replace(/^v/i, "").trim();
  const isAlive = () => Date.now() - aliveAt < 12000;

  function dropExtras(id, fromK) {
    const pre = String(id) + "_";
    Object.keys(T).forEach((key) => {
      if (!key.startsWith(pre)) return;
      if (fromK != null && Number(key.slice(pre.length)) < fromK) return;
      delete T[key];
    });
  }

  // обёртка: записать вызов, выполнить оригинал, запланировать снимок
  function wrap(name, rec) {
    const orig = window[name];
    if (typeof orig !== "function") return;
    window[name] = function () {
      try { rec.apply(null, arguments); } catch (e) { /* запись не должна ломать карту */ }
      const r = orig.apply(this, arguments);
      schedule();
      return r;
    };
  }
  wrap("updateMarker", (id, ...a) => { U[id] = [id, ...a]; });
  wrap("removeMarker", (id) => { delete U[id]; delete TL[id]; });
  wrap("updateTargetMarker", (key, ...a) => { T[key] = [key, ...a]; });
  wrap("recolorTargetMarker", (key, label, lo) => { if (T[key]) T[key][4] = lo; });
  wrap("removeTargetMarker", (id) => { delete T[id]; dropExtras(id); });
  wrap("removeExtraTargets", (id, fromK) => dropExtras(id, fromK));
  wrap("updateTrailerLink", (id, la, lo, lt) => { TL[id] = [id, la, lo, lt]; });
  wrap("removeTrailerLink", (id) => { delete TL[id]; });
  wrap("drawRoute", () => {});
  wrap("renderRows", () => {});          // сменился фильтр / порядок / строки
  wrap("fillDispSelects", () => {});     // загрузился лист «Диспетчеры»

  function snapshot() {
    const rs = (typeof rows !== "undefined" && Array.isArray(rows) ? rows : []).filter((r) => r && r.unit).map((r) => ({
      id: r.id, unit: r.unit, disp: rowDisp(r),
      own: !!rowPassesOwn(r),                          // фильтр диспетчера таблицы — для режима «Таблица»
      nd: !!rowPassesFilterWith(r, () => true),        // остальные фильтры (L / O, клиент) без диспетчера
      pass: !!rowPassesFilter(r),
    }));
    const pos = {};
    Object.keys(rowPositions).forEach((k) => { pos[k] = rowPositions[k]; });
    return {
      ver: APP_VER, rows: rs, me: fleetMe(),
      disp: DISP_LIST.map((d) => ({ email: d.email, tag: d.tag, color: d.color })),
      sel: selectedRowId, U, T, TL, pos,
    };
  }

  function push(force) {
    if (!force && !isAlive()) return;
    let s;
    try { s = JSON.stringify(snapshot()); } catch (e) { return; }
    if (!force && s === last) return;
    last = s;
    ch.postMessage({ t: "snap", s });
  }
  function schedule() {
    if (!isAlive()) return;
    clearTimeout(timer);
    timer = setTimeout(() => push(false), 400);
  }

  ch.onmessage = (e) => {
    const m = e.data || {};
    if (m.t === "hello") { aliveAt = Date.now(); last = ""; push(true); }
    else if (m.t === "ping") aliveAt = Date.now();
    else if (m.t === "bye") aliveAt = 0;
  };

  // открыть (или вернуть на передний план) окно карты; размер и положение — как закрыли в прошлый раз
  function open() {
    if (win && !win.closed) { win.focus(); return; }
    let p = {};
    try { p = JSON.parse(localStorage.getItem(POS_KEY) || "{}") || {}; } catch (e) { p = {}; }
    const w = p.w > 300 ? p.w : 1000, h = p.h > 300 ? p.h : 760;
    const pos = p.x != null && p.y != null ? `,left=${Math.round(p.x)},top=${Math.round(p.y)}` : "";
    win = window.open("/map-window", "fleetMapWin", `popup=yes,width=${Math.round(w)},height=${Math.round(h)}${pos}`);
    if (win) win.focus();
  }

  window.MapMirror = { open, push, isOpen: isAlive };
  // кнопка ⧉ могла быть нарисована до загрузки этого модуля
  if (window.MapDispFilter) window.MapDispFilter.render();
})();
