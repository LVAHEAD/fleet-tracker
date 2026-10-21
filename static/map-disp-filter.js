/*
map-disp-filter.js — свой фильтр диспетчеров у Карты Флота (v3.133, компактный вид с v3.134; хотелка «Выбор диспетчеров на Карте Флота»).
Одна кнопка «Дисп.: … ▾» вверху по центру карты (элемент управления Google-карты — виден и в ⛶ на весь экран); по клику — список с галочками:
«Таблица» (как раньше — карта следует фильтру диспетчера из таблицы), «Все» и диспетчеры из листа «Диспетчеры» (мультивыбор: клик включает / выключает;
выключен последний — «Все»). Закрывается кликом мимо и по Esc. Выбор помнится после F5 ("fleet-map-disp"). Фильтры L / O и по клиентам — общие с таблицей.
Опирается на глобалы dispatchers.js (DISP_LIST, rowDisp, rowPassesOwn, fleetMe, escapeHtml, shadeHex) и map-core.js (fleetMapSync).
*/
(function () {
  const KEY = window.MAP_DISP_KEY || "fleet-map-disp";   // у откреплённого окна карты — свой ключ (map-window.js)
  let sel = "table";   // "table" | "mapon" (v3.180: все машины Mapon + трипы всех) | "all" (трипы всех диспетчеров) | массив e-mail (канонических)
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "table" || saved === "all" || saved === "mapon") sel = saved;
    else if (saved) {
      const arr = JSON.parse(saved);
      if (Array.isArray(arr) && arr.length) sel = arr.map(String);
    }
  } catch (e) { sel = "table"; }

  let box = null;
  let isOpen = false;

  // строка проходит фильтр диспетчера карты (для rowPassesFilterWith)
  function pass(row) {
    if (sel === "table") return rowPassesOwn(row);
    if (sel === "all" || sel === "mapon") return true;
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
    if (window.fleetMapUnits) window.fleetMapUnits.draw();   // v3.180: «Все» — показать все машины Mapon
  }

  function list() { return (typeof DISP_LIST !== "undefined" && DISP_LIST) || []; }

  // подпись на кнопке: «Таблица», «Все», «VL, JZ» (больше трёх — «4 дисп.»)
  function label() {
    if (sel === "table") return "Таблица";
    if (sel === "mapon") return "ВСЕ";
    if (sel === "all") return "ВСЕ дисп";
    const tags = sel.map((e) => {
      const d = list().find((x) => String(x.email).toLowerCase() === e);
      return d ? d.tag : e.split("@")[0].slice(0, 3).toUpperCase();
    });
    return tags.length > 3 ? `${tags.length} дисп.` : tags.join(", ");
  }

  function render() {
    if (!box) return;
    const me = typeof fleetMe === "function" ? fleetMe() : "";
    const row = (v, text, on, title, style) =>
      `<button type="button" class="mdf-i${on ? " on" : ""}" data-mdf="${escapeHtml(v)}"${style ? ` style="${style}"` : ""} title="${escapeHtml(title)}">`
      + `<span class="mdf-ck">${on ? "✓" : ""}</span>${escapeHtml(text)}</button>`;
    const items = row("table", "Таблица", sel === "table", "Карта следует фильтру диспетчера из таблицы")
      + row("mapon", "ВСЕ", sel === "mapon", "Все машины Mapon и трипы всех диспетчеров")
      + row("all", "ВСЕ дисп", sel === "all", "Трипы всех диспетчеров (без чужих машин)")
      + list().map((d) => {
        const email = String(d.email).toLowerCase();
        const c = d.color || "#ffffff";
        const on = Array.isArray(sel) && sel.includes(email);
        return row(email, d.tag, on, `${d.tag}${email === me ? " (мои)" : ""} — включить / выключить на карте`,
          `--dc:${escapeHtml(c)}`);
      }).join("");
    const pop = (window.MapMirror && window.MapMirror.open && !window.IS_MAP_WINDOW && !window.matchMedia("(max-width: 767px)").matches)
      ? `<button type="button" class="mdf-pop" data-mdf-pop="1" title="Открепить карту в отдельное окно (например, на второй монитор)">⧉</button>` : "";
    box.innerHTML = `<span class="mdf-row"><button type="button" class="mdf-btn" data-mdf-toggle="1" aria-expanded="${isOpen}" title="Чьи машины показывать на карте">Дисп.: ${escapeHtml(label())} ▾</button>${pop}</span>`
      + `<div class="mdf-menu"${isOpen ? "" : " hidden"}>${items}</div>`;
  }

  function setOpen(v) {
    isOpen = !!v;
    render();
  }

  function onClick(e) {
    e.stopPropagation();
    if (e.target.closest("[data-mdf-pop]")) { if (window.MapMirror) window.MapMirror.open(); return; }
    if (e.target.closest("[data-mdf-toggle]")) { setOpen(!isOpen); return; }
    const b = e.target.closest("button[data-mdf]");
    if (!b) return;
    const v = b.dataset.mdf;
    if (v === "table" || v === "all" || v === "mapon") { sel = v; isOpen = false; }
    else {
      const cur = Array.isArray(sel) ? sel.slice() : [];
      const i = cur.indexOf(v);
      if (i >= 0) cur.splice(i, 1); else cur.push(v);
      sel = cur.length ? cur : "all";
    }
    apply();
  }

  // кнопка — элемент управления карты (вверху по центру), чтобы работала и в ⛶
  function attach(map) {
    if (!map || !window.google) return;
    box = document.createElement("div");
    box.className = "mdf";
    box.addEventListener("click", onClick);
    box.addEventListener("mousedown", (e) => e.stopPropagation());
    render();
    map.controls[google.maps.ControlPosition.TOP_CENTER].push(box);
    map.addListener("click", () => { if (isOpen) setOpen(false); });
    document.addEventListener("click", (e) => { if (isOpen && box && !box.contains(e.target)) setOpen(false); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && isOpen) setOpen(false); });
  }

  window.MapDispFilter = { attach, pass, render, get: () => sel };
})();
