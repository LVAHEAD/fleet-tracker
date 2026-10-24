/* v3.204: фильтр по машинам во Флоте. Клик по заголовку «Машина» — окно со списком машин, которые сейчас есть
во Флоте (по алфавиту, `НОМЕР · число трипов`), галочки (несколько сразу), поиск сверху, «Сбросить» справа от поиска.
Фильтруем только по номеру машины (тягач); прицеп не трогаем. Пока фильтр включён, заголовок подсвечен синим.
Складывается с «Мои / Все», диспетчером, L / O, клиентом и TimeSlot (rowPassesFilter в fleet-sort-filter.js, он же — Карта Флота);
порядок строк не меняет; запоминается после F5 (localStorage, как остальные фильтры). Строки без машины видны всегда.
Трипы, ждущие «✓ Завершён», видны при любом фильтре по машинам (awaitsComplete раньше rowPassesUnit).
Список в окне считает только трипы выбранного диспетчера («Все» — весь Флот).
Клик по заголовку отличается от перетаскивания колонки (col-order.js): drag не даёт click.
Чистые функции — unitKey, unitList, rowPassesUnit (тест на node: tests/test_v3204.py).
Опирается на глобалы app.js (rows, renderRows) — во время работы. Грузится ДО app.js. */

let unitFilter = [];   // ключи выбранных машин (unitKey)
try {
  const v = JSON.parse(localStorage.getItem("fleet-unit-filter") || "[]");
  if (Array.isArray(v)) unitFilter = v.filter((x) => typeof x === "string" && x);
} catch (e) {}

function unitKey(unit) { return String(unit || "").toUpperCase().replace(/\s+/g, ""); }

// список для окна: машины строк Флота + выбранные, которых сейчас нет (count 0)
function unitList(rowsArr, selected) {
  const by = new Map();
  (rowsArr || []).forEach((r) => {
    if (!r || !r.unit) return;
    const key = unitKey(r.unit);
    if (!key) return;
    const it = by.get(key);
    if (it) it.count++;
    else by.set(key, { key, name: String(r.unit).trim().replace(/\s+/g, " "), count: 1, on: false });
  });
  (selected || []).forEach((k) => {
    if (by.has(k)) by.get(k).on = true;
    else by.set(k, { key: k, name: k, count: 0, on: true });
  });
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name, "ru", { sensitivity: "base", numeric: true }));
}

function rowPassesUnit(row) {
  if (!unitFilter.length) return true;
  if (!row || !row.unit) return true;     // пустые строки видны всегда, как у остальных фильтров
  return unitFilter.includes(unitKey(row.unit));
}

(function () {
  if (typeof document === "undefined") return;
  const th = document.getElementById("unit-flt-th");
  if (!th) return;
  let pop = null;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const save = () => { try { localStorage.setItem("fleet-unit-filter", JSON.stringify(unitFilter)); } catch (e) {} };
  const mark = () => {
    th.classList.toggle("unit-on", unitFilter.length > 0);
    th.title = unitFilter.length ? `Фильтр по машинам: выбрано ${unitFilter.length} — клик, чтобы изменить`
      : "Фильтр по машинам — клик";
  };
  const rerender = () => { mark(); if (typeof renderRows === "function") renderRows(); };

  function fillList() {
    const q = unitKey(pop.querySelector(".cf-search").value);
    const items = unitList(rows.filter((r) => rowPassesOwn(r)), unitFilter).filter((it) => !q || it.key.includes(q));
    pop.querySelector(".cf-list").innerHTML = items.length
      ? items.map((it) => `<label class="cf-item"><input type="checkbox" data-k="${esc(it.key)}"${it.on ? " checked" : ""}>`
        + `<span class="cf-name">${esc(it.name)}</span><span class="cf-n">${it.count}</span></label>`).join("")
      : '<div class="cf-empty">Машин нет</div>';
  }
  function close() { if (pop) { pop.remove(); pop = null; } }
  function open() {
    close();
    document.dispatchEvent(new CustomEvent("fleet-popup-open", { detail: "unit" }));   // другое окно фильтра закрываем
    pop = document.createElement("div");
    pop.id = "unit-flt-pop";
    pop.className = "client-flt-pop unit-flt-pop";   // вид и разметка окна — как у фильтра по клиентам
    pop.innerHTML = '<div class="cf-top"><input type="search" class="cf-search" placeholder="Поиск машины" autocomplete="off">'
      + '<button type="button" class="cf-reset">Сбросить</button></div><div class="cf-list"></div>';
    document.body.appendChild(pop);
    const r = th.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8)) + "px";
    pop.style.top = (r.bottom + 4) + "px";
    fillList();
    pop.querySelector(".cf-search").addEventListener("input", fillList);
    pop.querySelector(".cf-list").addEventListener("change", (e) => {
      const k = e.target && e.target.dataset && e.target.dataset.k;
      if (!k) return;
      unitFilter = e.target.checked ? [...new Set([...unitFilter, k])] : unitFilter.filter((x) => x !== k);
      save();
      rerender();
    });
    pop.querySelector(".cf-reset").addEventListener("click", () => {
      unitFilter = [];
      save();
      fillList();
      rerender();
    });
    pop.querySelector(".cf-search").focus();
  }

  th.addEventListener("click", (e) => { e.stopPropagation(); if (pop) close(); else open(); });
  // слушаем в фазе перехвата — клик вне окна закрывает его, даже если ниже по дереву стоит stopPropagation
  document.addEventListener("click", (e) => { if (pop && !pop.contains(e.target) && !th.contains(e.target)) close(); }, true);
  document.addEventListener("fleet-popup-open", (e) => { if (e.detail !== "unit") close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  window.addEventListener("scroll", (e) => { if (pop && !pop.contains(e.target)) close(); }, true);
  mark();
})();
