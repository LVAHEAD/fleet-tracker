/*
ferry-menu.js — меню выбора линии парома у ETA точки после порта (v3.193). ferryMenu(anchor, ferry, current, onPick).
Опирается на глобалы app.js (escapeHtml, uiZoom); стили — .cor-pop / .cor-o (как у коридора). Грузится ДО app.js.
*/
let ferPop = null;
function closeFerryMenu() { if (ferPop) { ferPop.remove(); ferPop = null; } }
// ferry: {id, label, options: [{id, label, hours, auto}]}; current — ручной выбор или null; onPick(id | null)
function ferryMenu(anchor, ferry, current, onPick) {
  closeFerryMenu();
  const pop = document.createElement("div");
  pop.className = "cor-pop";
  const row = (id, label, extra) => `<button type="button" class="cor-o${(current || null) === id ? " on" : ""}" data-n="${escapeHtml(id || "")}">` +
    `<span class="cor-n">${(current || null) === id ? "✓ " : ""}${label}</span>${extra}</button>`;
  pop.innerHTML = `<div class="cor-h">Паром</div>` +
    row(null, "авто", `<span class="cor-k">${current ? "по правилу" : "сейчас " + escapeHtml(ferry.label)}</span>`) +
    (ferry.options || []).map((o) => row(o.id, escapeHtml(o.label),
      `<span class="cor-k">${o.hours} ч</span>` + (o.auto ? "" : `<span class="cor-t">только unaccompanied</span>`))).join("") +
    `<div class="cor-f">часы в пути + Gate-In 2 ч; отход — из «Даты» точки-порта</div>`;
  document.body.appendChild(pop);
  ferPop = pop;
  const r = anchor.getBoundingClientRect(), z = uiZoom();
  pop.style.left = Math.round((r.left + window.scrollX) / z) + "px";
  pop.style.top = Math.round((r.bottom + window.scrollY + 4) / z) + "px";
  pop.addEventListener("click", (e) => {
    const b = e.target.closest(".cor-o");
    if (!b) return;
    e.stopPropagation();
    closeFerryMenu();
    onPick(b.dataset.n || null);
  });
}
document.addEventListener("mousedown", (e) => { if (ferPop && !e.target.closest(".cor-pop, .fer-b")) closeFerryMenu(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeFerryMenu(); });
