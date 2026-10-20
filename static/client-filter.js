/* v3.114: фильтр по клиентам во Флоте. Клик по заголовку «Client» — окно со списком клиентов, которые сейчас есть
во Флоте (по алфавиту, `КЛИЕНТ · число трипов`), галочки (несколько сразу), поиск сверху.
v3.170: «Сбросить» — вверху, справа от поля поиска.
Пока фильтр включён, заголовок подсвечен синим. Складывается с «Мои / Все», диспетчером и L / O (rowPassesFilter в
fleet-sort-filter.js); порядок строк не меняет; запоминается после F5 (localStorage, как остальные фильтры).
Клиенты сравниваются без учёта регистра и пробелов; разные написания («STEF Italia spa» / «STEF Italia») — разные пункты.
Трипы, ждущие «✓ Завершён», видны при любом L / O и фильтре по клиентам, но не при чужом диспетчере (rowPassesOwn раньше awaitsComplete).
v3.118: список клиентов в окне считает только трипы выбранного диспетчера («Все» — весь Флот).
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
// v3.173: «топ-3» сверху по диспетчеру (решение Владимира 21.10), остальные по алфавиту; закреплённого без трипов не показываем
const TOP_CLIENTS = {
  VL: ["Bama", "GreenFood", "Kesko"], VJ: ["Bama", "GreenFood", "Kesko"],
  JZ: ["SeaBorn", "Mowi Markets Norway AS", "DSV"], JB: ["SeaBorn", "Mowi Markets Norway AS", "DSV"],
};

function clientList(rowsArr, selected, tag) {
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
  const alpha = [...by.values()].sort((a, b) => a.name.localeCompare(b.name, "ru", { sensitivity: "base" }));
  const top = (TOP_CLIENTS[String(tag || "").toUpperCase()] || []).map(clientKey);
  if (!top.length) return alpha;
  const pinned = top.map((k) => by.get(k)).filter(Boolean);
  pinned.forEach((it) => { it.top = true; });
  return pinned.concat(alpha.filter((it) => !it.top));
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
    const who = ownFilter === "mine" ? fleetMe() : ownFilter;
    const tag = !q && typeof dispTag === "function" && String(who).includes("@") ? dispTag(who) : "";   // при поиске — обычный порядок
    const items = clientList(rows.filter((r) => rowPassesOwn(r)), clientFilter, tag).filter((it) => !q || it.key.includes(q));
    const lastTop = items.reduce((n, it, i) => (it.top ? i : n), -1);
    pop.querySelector(".cf-list").innerHTML = items.length
      ? items.map((it, i) => `<label class="cf-item${i === lastTop && lastTop < items.length - 1 ? " cf-top-last" : ""}"><input type="checkbox" data-k="${esc(it.key)}"${it.on ? " checked" : ""}>`
        + `<span class="cf-name">${esc(it.name)}</span><span class="cf-n">${it.count}</span></label>`).join("")
      : '<div class="cf-empty">Клиентов нет</div>';
  }
  function close() { if (pop) { pop.remove(); pop = null; } }
  function open() {
    close();
    document.dispatchEvent(new CustomEvent("fleet-popup-open", { detail: "client" }));   // другое окно фильтра закрываем
    pop = document.createElement("div");
    pop.id = "client-flt-pop";
    pop.className = "client-flt-pop";
    pop.innerHTML = '<div class="cf-top"><input type="search" class="cf-search" placeholder="Поиск клиента" autocomplete="off">'
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
  // v3.173: слушаем в фазе перехвата — клик вне окна закрывает его, даже если ниже по дереву стоит stopPropagation
  document.addEventListener("click", (e) => { if (pop && !pop.contains(e.target) && !th.contains(e.target)) close(); }, true);
  document.addEventListener("fleet-popup-open", (e) => { if (e.detail !== "client") close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  window.addEventListener("scroll", (e) => { if (pop && !pop.contains(e.target)) close(); }, true);
  mark();
})();
