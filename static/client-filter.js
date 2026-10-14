/* v3.114: фильтр по клиентам во Флоте. Клик по заголовку «Client» — окно со списком клиентов, которые сейчас есть
во Флоте (по алфавиту, `КЛИЕНТ · число трипов`), галочки (несколько сразу), поиск сверху, «Сбросить» внизу.
Пока фильтр включён, заголовок подсвечен синим. Складывается с «Мои / Все», диспетчером и L / O (rowPassesFilter в
fleet-sort-filter.js); порядок строк не меняет; запоминается после F5 (localStorage, как остальные фильтры).
Клиенты сравниваются без учёта регистра и пробелов; разные написания («STEF Italia spa» / «STEF Italia») — разные пункты.
Трипы, ждущие «✓ Завершён», видны при любом фильтре (awaitsComplete раньше проверки в rowPassesFilter).
Чистые функции — clientName, clientKey, clientList, rowPassesClient (тест на node: tests/test_v3114.py).
Опирается на глобалы app.js (rows, renderRows) — во время работы. Грузится ДО app.js. */

let clientFilter = [];   // ключи выбранных клиентов (clientKey)
try {
  const v = JSON.parse(localStorage.getItem("fleet-client-filter") || "[]");
  if (Array.isArray(v)) clientFilter = v.filter((x) => typeof x === "string" && x);
} catch (e) {}

function clientName(row) { return String((row && row.client) || "").trim().replace(/\s+/g, " "); }
function clientKey(name) { return String(name || "").toLowerCase().replace(/\s+/g, ""); }

// список для окна: клиенты строк с машиной (пустые строки без машины не считаем) + выбранные, которых сейчас нет (count 0)
function clientList(rowsArr, selected) {
  const by = new Map();
  (rowsArr || []).forEach((r) => {
    if (!r || !r.unit) return;
    const name = clientName(r), key = clientKey(name);
    if (!key) return;
    const it = by.get(key);
    if (it) it.count++;
    else by.set(key, { key, name, count: 1, on: false });
  });
  (selected || []).forEach((k) => {
    if (by.has(k)) by.get(k).on = true;
    else by.set(k, { key: k, name: k, count: 0, on: true });
  });
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name, "ru", { sensitivity: "base" }));
}

function rowPassesClient(row) {
  if (!clientFilter.length) return true;
  if (!row || !row.unit) return true;     // пустые строки видны всегда, как у остальных фильтров
  return clientFilter.includes(clientKey(clientName(row)));
}

(function () {
  if (typeof document === "undefined") return;
  const th = document.getElementById("client-flt-th");
  if (!th) return;
  let pop = null;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const save = () => { try { localStorage.setItem("fleet-client-filter", JSON.stringify(clientFilter)); } catch (e) {} };
  const mark = () => {
    th.classList.toggle("client-on", clientFilter.length > 0);
    th.title = clientFilter.length ? `Фильтр по клиентам: выбрано ${clientFilter.length} — клик, чтобы изменить`
      : "Фильтр по клиентам — клик";
  };
  const rerender = () => { mark(); if (typeof renderRows === "function") renderRows(); };

  function fillList() {
    const q = clientKey(pop.querySelector(".cf-search").value);
    const items = clientList(rows, clientFilter).filter((it) => !q || it.key.includes(q));
    pop.querySelector(".cf-list").innerHTML = items.length
      ? items.map((it) => `<label class="cf-item"><input type="checkbox" data-k="${esc(it.key)}"${it.on ? " checked" : ""}>`
        + `<span class="cf-name">${esc(it.name)}</span><span class="cf-n">${it.count}</span></label>`).join("")
      : '<div class="cf-empty">Клиентов нет</div>';
  }
  function close() { if (pop) { pop.remove(); pop = null; } }
  function open() {
    close();
    pop = document.createElement("div");
    pop.id = "client-flt-pop";
    pop.className = "client-flt-pop";
    pop.innerHTML = '<input type="search" class="cf-search" placeholder="Поиск клиента" autocomplete="off">'
      + '<div class="cf-list"></div><div class="cf-foot"><button type="button" class="cf-reset">Сбросить</button></div>';
    document.body.appendChild(pop);
    const r = th.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8)) + "px";
    pop.style.top = (r.bottom + 4) + "px";
    fillList();
    pop.querySelector(".cf-search").addEventListener("input", fillList);
    pop.querySelector(".cf-list").addEventListener("change", (e) => {
      const k = e.target && e.target.dataset && e.target.dataset.k;
      if (!k) return;
      clientFilter = e.target.checked ? [...new Set([...clientFilter, k])] : clientFilter.filter((x) => x !== k);
      save();
      rerender();
    });
    pop.querySelector(".cf-reset").addEventListener("click", () => {
      clientFilter = [];
      save();
      fillList();
      rerender();
    });
    pop.querySelector(".cf-search").focus();
  }

  th.addEventListener("click", (e) => { e.stopPropagation(); if (pop) close(); else open(); });
  document.addEventListener("click", (e) => { if (pop && !pop.contains(e.target) && !th.contains(e.target)) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  window.addEventListener("scroll", (e) => { if (pop && !pop.contains(e.target)) close(); }, true);
  mark();
})();
