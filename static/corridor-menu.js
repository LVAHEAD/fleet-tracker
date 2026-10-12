/*
corridor-menu.js — коридор ИТ ↔ Бенелюкс / восток FR: плашка ⛰ и меню выбора коридора (Флот и From → To) (v3.77, вынесено из app.js).
COR_TUNNEL, corridorChip, corridorMenu, closeCorridorMenu и слушатели страницы (клик мимо / Esc закрывают меню).
Опирается на глобалы app.js (escapeHtml, fmtKm, uiZoom), вызываемые во время работы. Используется в app.js и route-tab.js. Грузится ДО app.js.
*/

// ---------- v3.32: коридор ИТ ↔ Бенелюкс / восток FR — плашка и меню выбора (Флот и From → To) ----------
const COR_TUNNEL = { "Монблан": 261, "Фрежюс": 255 };
function corridorChip(row, c) {
  const k = c && c.corridor;
  if (!k || !k.used) return "";
  const man = !!row.corridor;
  const warn = k.swiss ? "\n⚠ Маршрут заходит в Швейцарию — проверь линию на карте" : "";   // v3.84
  const tip = `Коридор в обход Швейцарии: ${k.used}${man ? " (выбран вручную)" : " (авто)"}` +
    (COR_TUNNEL[k.used] ? ` · туннель ~${COR_TUNNEL[k.used]} €` : "") + ". Клик — выбрать другой" + warn;
  const eur = COR_TUNNEL[k.used] ? ` · туннель ~${COR_TUNNEL[k.used]} €` : "";   // v3.45: цена — в самой полоске
  return `<button type="button" class="cor-b${man ? " cor-man" : ""}${k.swiss ? " cor-warn" : ""}" title="${escapeHtml(tip)}">⛰ ${escapeHtml(k.used)}${eur}${k.swiss ? " ⚠" : ""}</button>`;
}
let corPop = null;
function closeCorridorMenu() { if (corPop) { corPop.remove(); corPop = null; } }
// info: {used, manual, names, leg, countries?}; current — ручной выбор или null; onPick(name | null)
function corridorMenu(anchor, info, current, onPick) {
  closeCorridorMenu();
  const pop = document.createElement("div");
  pop.className = "cor-pop";
  document.body.appendChild(pop);
  corPop = pop;
  let opts = (info.names || []).map((n) => ({ name: n, km: null, diff: null, tunnel_eur: COR_TUNNEL[n] || null }));
  let state = "load";
  const draw = () => {
    const row = (name, label, extra) => `<button type="button" class="cor-o${(current || null) === name ? " on" : ""}" data-n="${escapeHtml(name || "")}">` +
      `<span class="cor-n">${(current || null) === name ? "✓ " : ""}${label}</span>${extra}</button>`;
    pop.innerHTML = `<div class="cor-h">Коридор в обход Швейцарии</div>` +
      row(null, "авто", `<span class="cor-k">${current ? "по правилу" : "сейчас " + escapeHtml(info.used || "—")}</span>`) +
      opts.map((o) => row(o.name, escapeHtml(o.name),
        `<span class="cor-k">${o.km != null ? fmtKm(o.km) + (o.diff ? ` <i>+${Math.round(o.diff)}</i>` : "") : state === "load" ? "…" : "—"}</span>` +
        (o.tunnel_eur ? `<span class="cor-t">туннель +${o.tunnel_eur} €</span>` : ""))).join("") +
      `<div class="cor-f">${state === "load" ? "Считаю км через каждый коридор…" : state === "err" ? "Км не посчитать — выбор всё равно работает" : "км по дорогам от машины / точки до цели"}</div>`;
  };
  draw();
  const r = anchor.getBoundingClientRect(), z = uiZoom();
  pop.style.left = Math.round((r.left + window.scrollX) / z) + "px";
  pop.style.top = Math.round((r.bottom + window.scrollY + 4) / z) + "px";
  pop.addEventListener("click", (e) => {
    const b = e.target.closest(".cor-o");
    if (!b) return;
    e.stopPropagation();
    closeCorridorMenu();
    onPick(b.dataset.n || null);
  });
  fetch("/api/corridors", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ leg: info.leg, countries: info.countries || null }) })
    .then((res) => res.json())
    .then((d) => {
      if (corPop !== pop) return;
      if (d.error || !d.options) { state = "err"; draw(); return; }
      opts = d.options; state = "ok"; draw();
    })
    .catch(() => { if (corPop === pop) { state = "err"; draw(); } });
}
document.addEventListener("mousedown", (e) => { if (corPop && !e.target.closest(".cor-pop, .cor-b, .rt-cor-b")) closeCorridorMenu(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeCorridorMenu(); });
