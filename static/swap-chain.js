/*
swap-chain.js — цепочка перецепа у пройденной точки (v3.211). Только вид: текст поля таргета не меняется
(по нему считаются позиция, ✓, код точки и ключи doneSeen / doneArr).
Строится по следам point.swap = {from, to} (trailer-swap.js; у ① — row.swap): у точки k — «новый тягач ↔ прежний ↔ ещё прежний…»,
например после перецепа 1234 → 2222 у точки: «2222 ↔ 1234», после второго на 3333: «3333 ↔ 2222 ↔ 1234».
Рисуется серым хвостом поверх пустой части поля (position: absolute, клики насквозь, размеры строки не меняются);
не влезает — «↔ … ↔ 1234»; полная цепочка — в подсказке поля. Отмена перецепа убирает след, и хвост пропадает.
Опирается на глобалы app.js / trailer-link.js (rows, normNo). Грузится ПОСЛЕ app.js.
*/

// точка 0 — сама строка (row.swap), k ≥ 1 — row.extra[k - 1]; -> [новый, прежний, …] или null, если у точки нет следа перецепа
function swapChain(row, k) {
  const pts = [row].concat((row && row.extra) || []);
  const p = pts[k];
  if (!p || !p.swap || !p.swap.from || !p.swap.to) return null;
  const list = [p.swap.to, p.swap.from];
  let cur = p.swap.from;
  for (let j = k - 1; j >= 0; j--) {
    const q = pts[j] && pts[j].swap;
    if (q && q.from && q.to && normNo(q.to) === normNo(cur)) { list.push(q.from); cur = q.from; }
  }
  return list;
}

(function () {
  if (typeof document === "undefined") return;
  const ARROW = " ↔ ";
  let ctx = null;
  const textW = (el, s) => {
    ctx = ctx || document.createElement("canvas").getContext("2d");
    ctx.font = getComputedStyle(el).font;
    return ctx.measureText(s).width;
  };
  function clearTail(w) {
    const t = w.querySelector(":scope > .chain-tail");
    if (t) t.remove();
    delete w.dataset.chain;
  }
  function draw(w, list) {
    const inp = w.querySelector(".target-input, .xt-input");
    if (!inp) return;
    const full = list.join(ARROW);
    if (!inp.title.includes("Перецеп: ")) inp.title = (inp.title ? inp.title + "\n" : "") + "Перецеп: " + full;
    if (!inp.offsetWidth) { clearTail(w); return; }              // свёрнутая точка
    const rest = list.slice(1), orig = rest[rest.length - 1];
    let tail = "↔ " + rest.join(ARROW);
    const left = inp.offsetLeft + parseFloat(getComputedStyle(inp).paddingLeft) + textW(inp, inp.value) + 10;
    const room = inp.offsetLeft + inp.offsetWidth - 6 - left;
    if (textW(inp, tail) > room && rest.length > 1) tail = "↔ … ↔ " + orig;
    if (textW(inp, tail) > room) { clearTail(w); return; }       // совсем нет места — только подсказка
    const key = tail + "|" + Math.round(left) + "|" + Math.round(room);
    if (w.dataset.chain === key) return;
    let t = w.querySelector(":scope > .chain-tail");
    if (!t) { t = document.createElement("span"); t.className = "chain-tail"; w.appendChild(t); }
    t.textContent = tail;
    t.style.left = left + "px";
    t.style.maxWidth = room + "px";
    t.style.font = getComputedStyle(inp).font;
    w.dataset.chain = key;
  }
  let queued = false;
  function pass() {
    queued = false;
    const body = document.getElementById("fleet-tbody");
    if (!body || typeof rows === "undefined") return;
    body.querySelectorAll("tr[data-id]").forEach((tr) => {
      const row = rows.find((r) => r.id === Number(tr.dataset.id));
      if (!row) return;
      tr.querySelectorAll(".target-wrap").forEach((w, k) => {
        const list = swapChain(row, k);
        if (list) draw(w, list);
        else if (w.querySelector(":scope > .chain-tail")) clearTail(w);
      });
    });
  }
  const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(pass); } };
  function init() {
    const body = document.getElementById("fleet-tbody");
    if (!body) return;
    new MutationObserver(schedule).observe(body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    window.addEventListener("resize", schedule);
    schedule();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
