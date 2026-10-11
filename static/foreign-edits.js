/*
foreign-edits.js — чужая правка: красная рамка «кто и когда» до клика хозяина трипа (v3.76, вынесено из app.js).
chgSel / chgName / chgWhen / chgWho, isTripOwner, clearChg, markForeign. Слушатели ставятся внутри markForeign при отрисовке строки.
Опирается на глобалы app.js (dispLabel, fleetMe, rowDisp, saveRows, renderRows, STOP_NUM), вызываемые во время работы. Грузится ДО app.js.
*/

// ---------- v3.20: чужая правка — красная рамка «кто и когда» до клика хозяина трипа ----------
function chgSel(key) {
  const m = key.match(/^x(\d+)\.(\w+)$/);
  if (m) {
    const k = m[1];
    return { target: `.xt-input[data-k="${k}"]`, lo: `.xlo-btn[data-k="${k}"]`, delivery: `.xd-input[data-k="${k}"]`,
             note: `.xn-input[data-k="${k}"]`, com: `.com-ic[data-k="${k}"]` }[m[2]] || null;
  }
  return { unit: ".unit-input", target: ".target-input", lo: ".target-wrap:not(.x-stop) .lo-btn:not(.xlo-btn)",
           delivery: ".delivery-input", note: ".note-input", com: '.com-ic[data-k="0"]', disp: ".disp-sel, .disp-lbl",
           client: ".cl-input", ref: ".ref-input",
           crew: ".crew-b" }[key] || null;
}
const CHG_NAMES = { unit: "машина", target: "таргет ①", lo: "L/O ①", delivery: "TimeSlot ①", note: "примечание", client: "Client", ref: "Reference",
  com: "комментарий", trailer: "прицеп", crew: "соло/экипаж", disp: "диспетчер", done: "✓ пройдено",
  fban: "запрет вручную", noban: "запреты", extra: "точки" };
function chgName(key) {
  const m = key.match(/^x(\d+)\.(\w+)$/);
  if (!m) return CHG_NAMES[key] || key;
  const sub = { target: "таргет", lo: "L/O", delivery: "TimeSlot", note: "примечание", com: "комментарий" }[m[2]] || m[2];
  return `${sub} ${STOP_NUM[Number(m[1]) + 1] || m[1]}`;
}
function chgWhen(ms) {
  const d = new Date(ms || 0);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function chgWho(c) { return (c && c.by ? dispLabel(String(c.by).toLowerCase()) : "?") + " " + chgWhen(c && c.at); }
function isTripOwner(row) { const me = fleetMe(); return !!me && me === rowDisp(row); }
function clearChg(row, keys) {
  if (!row.chg) return;
  keys.forEach((k) => { delete row.chg[k]; });
  if (!Object.keys(row.chg).length) delete row.chg;
  saveRows();
}
function markForeign(tr, row) {
  const chg = row.chg;
  if (!chg || typeof chg !== "object") return;
  const keys = Object.keys(chg);
  if (!keys.length) return;
  const owner = isTripOwner(row);
  keys.forEach((k) => {
    const sel = chgSel(k);
    if (!sel) return;
    tr.querySelectorAll(sel).forEach((el) => {
      el.classList.add("chg-mark");
      el.dataset.chgKey = k;
      el.title = `✎ Изменил ${chgWho(chg[k])}` + (owner ? " — клик снимет отметку" : "") + (el.title ? "\n" + el.title : "");
    });
  });
  // плашка в клетке машины: все чужие правки списком (и те, что не видны — прицеп, ✓, свёрнутые точки)
  const cell = tr.querySelector(".unit-cell");
  if (cell) {
    const who = Array.from(new Set(keys.map((k) => dispLabel(String((chg[k] || {}).by || "").toLowerCase())))).join(", ");
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chg-badge";
    b.textContent = "✎ " + who;
    b.title = "Чужие правки в трипе:\n" + keys.map((k) => `• ${chgName(k)} — ${chgWho(chg[k])}`).join("\n")
      + (owner ? "\n\nКлик — снять все отметки" : "\n\nСнять отметки может хозяин трипа");
    if (owner) b.addEventListener("click", (e) => { e.stopPropagation(); clearChg(row, keys); renderRows(); });
    cell.appendChild(b);
  }
  if (!owner) return;
  tr.querySelectorAll(".chg-mark").forEach((el) => {
    el.addEventListener("mousedown", () => {
      const k = el.dataset.chgKey;
      tr.querySelectorAll(`.chg-mark[data-chg-key="${k}"]`).forEach((x) => x.classList.remove("chg-mark"));
      clearChg(row, [k]);
      const rest = row.chg ? Object.keys(row.chg).length : 0;
      const bd = tr.querySelector(".chg-badge");
      if (bd && !rest) bd.remove();
    }, { once: true });
  });
}
