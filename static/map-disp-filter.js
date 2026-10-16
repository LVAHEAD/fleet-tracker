/*
map-disp-filter.js — свой фильтр диспетчеров у Карты Флота (после v3.132; хотелка «Выбор диспетчеров на Карте Флота»).
Кнопки поверх карты вверху по центру (элемент управления самой карты Google — видны и в ⛶ на весь экран):
«Таблица» (как раньше — карта следует фильтру диспетчера из таблицы), «Все» и диспетчеры из листа «Диспетчеры» (мультивыбор: клик включает / выключает;
выключен последний — «Все»). Выбор помнится после F5 ("fleet-map-disp"). Фильтры L / O и по клиентам по-прежнему общие с таблицей.
Опирается на глобалы dispatchers.js (DISP_LIST, rowDisp, rowPassesOwn, fleetMe, escapeHtml, shadeHex) и map-core.js (fleetMapSync).
*/
(function () {
  const KEY = "fleet-map-disp";
  let sel = "table";   // "table" | "all" | массив e-mail (канонических)
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "table" || saved === "all") sel = saved;
    else if (saved) {
      const arr = JSON.parse(saved);
      if (Array.isArray(arr) && arr.length) sel = arr.map(String);
    }
  } catch (e) { sel = "table"; }

  let box = null;

  // строка проходит фильтр диспетчера карты (для rowPassesFilterWith)
  function pass(row) {
    if (sel === "table") return rowPassesOwn(row);
    if (sel === "all") return true;
    const d = rowDisp(row);
    return !!d && sel.includes(d);   // строки без диспетчера — только в «Все», как в таблице
  }

  function save() {
    try { localStorage.setItem(KEY, Array.isArray(sel) ? JSON.stringify(sel) : sel); } catch (e) { /* ignore */ }
  }

  function apply() {
    save();
    render();
    if (typeof window.fleetMapSync === "function") window.fleetMapSync();
  }

  function render() {
    if (!box) return;
    const on = (v) => (sel === v ? " on" : "");
    const list = (typeof DISP_LIST !== "undefined" && DISP_LIST) || [];
    const me = typeof fleetMe === "function" ? fleetMe() : "";
    box.innerHTML = `<button type="button" class="mdf-b${on("table")}" data-mdf="table" title="Карта следует фильтру диспетчера из таблицы">Таблица</button>`
      + `<button type="button" class="mdf-b${on("all")}" data-mdf="all" title="Все диспетчеры на карте">Все</button>`
      + list.map((d) => {
        const email = String(d.email).toLowerCase();
        const c = d.color || "#ffffff";
        const isOn = Array.isArray(sel) && sel.includes(email) ? " on" : "";
        return `<button type="button" class="mdf-b mdf-d${isOn}" data-mdf="${escapeHtml(email)}"`
          + ` style="--dc:${escapeHtml(c)};--dcb:${escapeHtml((typeof shadeHex === "function" && shadeHex(c, 0.25)) || "#bbb")}"`
          + ` title="${escapeHtml(d.tag)}${email === me ? " (мои)" : ""} — включить / выключить на карте">${escapeHtml(d.tag)}</button>`;
      }).join("");
  }

  function onClick(e) {
    const b = e.target.closest("button[data-mdf]");
    if (!b) return;
    e.stopPropagation();
    const v = b.dataset.mdf;
    if (v === "table" || v === "all") sel = v;
    else {
      const cur = Array.isArray(sel) ? sel.slice() : [];
      const i = cur.indexOf(v);
      if (i >= 0) cur.splice(i, 1); else cur.push(v);
      sel = cur.length ? cur : "all";
    }
    apply();
  }

  // кнопки — элемент управления карты (вверху по центру), чтобы работали и в ⛶
  function attach(map) {
    if (!map || !window.google) return;
    box = document.createElement("div");
    box.className = "mdf";
    box.addEventListener("click", onClick);
    box.addEventListener("mousedown", (e) => e.stopPropagation());
    render();
    map.controls[google.maps.ControlPosition.TOP_CENTER].push(box);
  }

  window.MapDispFilter = { attach, pass, render, get: () => sel };
})();
