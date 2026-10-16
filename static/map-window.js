/*
map-window.js — откреплённая Карта Флота (/map-window, после v3.134): отдельное окно, например на второй монитор.
Карта рисуется тем же map-core.js, что и встроенная; данные — снимки от основного окна (map-mirror.js) через BroadcastChannel "fleet-map-win".
Связь только «таблица → карта»: выбор строки в основном окне подсвечивает машину и маршрут здесь; клик по машинке здесь подсвечивает её
только на этой карте. Фильтр диспетчеров — свой ("fleet-map-disp-win"): «Таблица» следует таблице основного окна. Расчётов нет — Mapon и Google не нагружаем.
Здесь заглушки глобалов, которых map-core.js ждёт от страницы Флота (rows, DISP_LIST, escapeHtml, фильтры строк).
*/
let rows = [];
let DISP_LIST = [];

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
function canonEmail(e) {
  const s = String(e || "").trim().toLowerCase();
  const i = s.lastIndexOf("@");
  if (i < 0) return s;
  const dom = s.slice(i + 1);
  return dom === "gmail.com" || dom === "googlemail.com" ? s.slice(0, i).split("+")[0].replace(/\./g, "") + "@gmail.com" : s;
}
function shadeHex(hex, k) {
  const m = String(hex || "").match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return "";
  return "#" + m.slice(1).map((x) => Math.round(parseInt(x, 16) * (1 - k)).toString(16).padStart(2, "0")).join("");
}
function dispEntry(u) {
  const e = canonEmail(u);
  return e ? (DISP_LIST.find((d) => canonEmail(d.email) === e) || null) : null;
}
function rowDisp(row) { return row && row.disp ? canonEmail(row.disp) : ""; }
function fleetMe() { return window.__me || ""; }
// фильтры строк: результаты считает основное окно (map-mirror.js) — own (диспетчер таблицы), nd (L / O и клиент), pass (всё вместе)
function rowPassesOwn(row) { return !!row._own; }
function rowPassesFilter(row) { return !!row._pass; }
function rowPassesFilterWith(row, ownPass) { return !!row._nd && ownPass(row); }

(function () {
  const ch = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("fleet-map-win") : null;
  const status = document.getElementById("mw-status");
  const POS_KEY = "fleet-map-win-pos";
  const curU = {}, curT = {}, curTL = {};   // ключ -> последний применённый JSON аргументов
  let latest = null;     // последний снимок (применяем, когда карта готова)
  let ready = false;
  let lastSel;           // последний выбор основного окна
  let lastPosSig = "";   // подпись маршрута выбранной строки — чтобы перерисовать без сдвига карты
  let gotFirst = false;

  const verNum = (v) => { const m = /^(\d+)\.(\d+)/.exec(String(v || "")); return m ? Number(m[1]) * 100000 + Number(m[2]) : 0; };

  function syncSet(cur, next, upd, rem) {
    Object.keys(next).forEach((k) => {
      const j = JSON.stringify(next[k]);
      if (cur[k] === j) return;
      cur[k] = j;
      try { upd(next[k]); } catch (e) { console.error("map-window", k, e); }
    });
    Object.keys(cur).forEach((k) => {
      if (k in next) return;
      delete cur[k];
      try { rem(k); } catch (e) { console.error("map-window", k, e); }
    });
  }

  function apply(s) {
    rows = (s.rows || []).map((r) => ({ id: r.id, unit: r.unit, disp: r.disp, _own: r.own, _nd: r.nd, _pass: r.pass }));
    DISP_LIST = s.disp || [];
    window.__me = s.me || "";
    Object.keys(rowPositions).forEach((k) => delete rowPositions[k]);
    Object.assign(rowPositions, s.pos || {});

    syncSet(curT, s.T || {}, (a) => updateTargetMarker.apply(null, a), (k) => removeTargetMarker(k));
    syncSet(curU, s.U || {}, (a) => updateMarker.apply(null, a), (k) => removeMarker(k));
    syncSet(curTL, s.TL || {}, (a) => updateTrailerLink.apply(null, a), (k) => removeTrailerLink(k));

    refreshBadgeLooks();                                   // цвета диспетчеров после смены rows / DISP_LIST
    if (window.MapDispFilter) window.MapDispFilter.render();

    if (s.sel !== lastSel) {                               // в таблице выбрали другую строку — подсвечиваем здесь
      lastSel = s.sel;
      if (s.sel != null) drawRoute(Number(s.sel));
      lastPosSig = s.sel != null ? JSON.stringify(rowPositions[s.sel] || null) : "";
    } else if (selectedRowId != null) {                    // маршрут выбранной строки пересчитан — перерисовать без сдвига карты
      const sig = JSON.stringify(rowPositions[selectedRowId] || null);
      if (sig !== lastPosSig) { lastPosSig = sig; drawRoute(Number(selectedRowId), true); }
    }
    syncMapVisibility();
  }

  function onSnap(s) {
    if (s.ver && window.APP_VER && verNum(s.ver) > verNum(window.APP_VER)) { location.reload(); return; }   // основное окно новее
    latest = s;
    if (!gotFirst) { gotFirst = true; if (status) status.hidden = true; }
    if (ready) apply(s);
  }

  // карта создана (initMap в map-core.js) — применяем накопленное
  window.onGoogleMapsReady = () => { ready = true; if (latest) apply(latest); };

  if (ch) {
    ch.onmessage = (e) => {
      const m = e.data || {};
      if (m.t !== "snap") return;
      try { onSnap(JSON.parse(m.s)); } catch (err) { console.error("map-window snap", err); }
    };
    // здороваемся, пока основное окно не ответит (оно могло ещё не слушать), потом — пинг раз в 5 с
    const hello = () => ch.postMessage({ t: gotFirst ? "ping" : "hello" });
    hello();
    setInterval(hello, 2000);
  } else if (status) {
    status.textContent = "Браузер не поддерживает связь между окнами (BroadcastChannel).";
  }

  // размер и положение окна — запомнить, чтобы в следующий раз открылось там же (второй монитор)
  function saveGeom() {
    try {
      localStorage.setItem(POS_KEY, JSON.stringify({ w: window.outerWidth, h: window.outerHeight, x: window.screenX, y: window.screenY }));
    } catch (e) { /* ignore */ }
  }
  let geomTimer = null;
  window.addEventListener("resize", () => { clearTimeout(geomTimer); geomTimer = setTimeout(saveGeom, 500); });
  window.addEventListener("beforeunload", () => { saveGeom(); if (ch) ch.postMessage({ t: "bye" }); });
})();
