/*
Fleet ETA Tracker — страница /notebook (v3.08): вся таблица блокнота.
Фильтры (категория, статус, Где, поиск), сортировка по клику на заголовок, клик по строке — карточка
(та же, что в панели: правка, комментарии, удаление). Фильтры и сортировка помнятся в браузере.
*/
(function () {
  const N = Notebook;
  const STATUS_ORDER = { new: 0, work: 1, later: 2, done: 3, rejected: 4 };
  const KEY = "fetatNotebookPage";
  let items = [];
  let st = { cat: "", status: "open", where: "", q: "", sort: "created_at", asc: false };
  try { Object.assign(st, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch (e) { /* ignore */ }

  const $ = (id) => document.getElementById(id);
  const cat = $("nbpCat"), status = $("nbpStatus"), where = $("nbpWhere"), search = $("nbpSearch");

  N.CATS.forEach(([v, l]) => cat.add(new Option(l, v)));
  N.STATUSES.forEach(([v, l]) => status.add(new Option(l, v)));

  function remember() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* ignore */ } }

  function fillWhere() {
    const seen = new Set(items.map((i) => i.where).filter(Boolean));
    const list = [...N.WHERE.filter((w) => seen.has(w)), ...[...seen].filter((w) => !N.WHERE.includes(w))];
    where.length = 1;
    list.forEach((w) => where.add(new Option(w, w)));
    where.value = list.includes(st.where) ? st.where : "";
  }

  function shown() {
    const q = st.q.trim().toLowerCase();
    let out = items.filter((it) =>
      (!st.cat || it.category === st.cat) &&
      (!st.status || (st.status === "open" ? !N.isClosed(it.status) : it.status === st.status)) &&
      (!st.where || it.where === st.where) &&
      (!q || [it.title, it.description, ...(it.comments || []).map((c) => c.text)].join(" ").toLowerCase().includes(q)));
    const val = (it) => {
      switch (st.sort) {
        case "priority": return it.priority || 0;
        case "status": return STATUS_ORDER[it.status] ?? 9;
        case "comments": return (it.comments || []).length;
        case "category": return N.CAT_LABEL[it.category] || "";
        default: return String(it[st.sort] || "").toLowerCase();
      }
    };
    // v3.22: закрытые (готово, отклонено) всегда ниже открытых; сортировка по колонке — внутри группы
    const grp = (it) => (N.isClosed(it.status) ? 1 : 0);
    out.sort((a, b) => {
      if (grp(a) !== grp(b)) return grp(a) - grp(b);
      const x = val(a), y = val(b);
      const r = x < y ? -1 : x > y ? 1 : 0;
      return (st.asc ? r : -r) || String(b.created_at).localeCompare(String(a.created_at));
    });
    return out;
  }

  function render() {
    const list = shown();
    $("nbpCount").textContent = `${list.length} из ${items.length}`;
    document.querySelectorAll(".nbp-table th[data-sort]").forEach((th) => {
      th.classList.toggle("sorted", th.dataset.sort === st.sort);
      th.classList.toggle("asc", th.dataset.sort === st.sort && st.asc);
    });
    const body = $("nbpBody");
    if (!list.length) { body.innerHTML = '<tr><td colspan="9" class="nbp-empty">Ничего не найдено</td></tr>'; return; }
    body.innerHTML = list.map((it) => `
      <tr data-id="${N.esc(it.id)}"${N.isClosed(it.status) ? ' class="done"' : it.status === "later" ? ' class="later"' : ""}>
        <td>${N.esc(N.fmtDate(it.created_at, true))}</td>
        <td>${N.catChip(it.category)}</td>
        <td>${N.esc(it.where || "")}</td>
        <td><div class="nbp-title">${N.esc(it.title)}</div>${it.description ? `<div class="nbp-desc">${N.esc(it.description)}</div>` : ""}</td>
        <td>${N.statusChip(it.status)}</td>
        <td>${N.prioChip(it.priority)}</td>
        <td>${N.esc(N.who(it.author))}</td>
        <td>${(it.comments || []).length || ""}</td>
        <td>${it.thumb ? `<img class="nb-thumb" src="${N.esc(it.thumb)}" alt="">` : ""}</td>
      </tr>`).join("");
    body.querySelectorAll("tr[data-id]").forEach((tr) => tr.addEventListener("click", () => N.showItem(tr.dataset.id)));
  }

  async function load() {
    try {
      const js = await N.api("/api/notebook?limit=1000");
      items = js.items || [];
      fillWhere();
      render();
    } catch (e) {
      $("nbpBody").innerHTML = `<tr><td colspan="9" class="nbp-empty">${N.esc(e.message)}</td></tr>`;
    }
  }

  cat.value = st.cat; status.value = st.status; search.value = st.q;
  cat.addEventListener("change", () => { st.cat = cat.value; remember(); render(); });
  status.addEventListener("change", () => { st.status = status.value; remember(); render(); });
  where.addEventListener("change", () => { st.where = where.value; remember(); render(); });
  search.addEventListener("input", () => { st.q = search.value; remember(); render(); });
  document.querySelectorAll(".nbp-table th[data-sort]").forEach((th) => th.addEventListener("click", () => {
    if (st.sort === th.dataset.sort) st.asc = !st.asc; else { st.sort = th.dataset.sort; st.asc = false; }
    remember(); render();
  }));
  $("nbpAdd").addEventListener("click", (e) => { e.stopPropagation(); N.open(); });
  $("nbpClaude").addEventListener("click", (e) => {
    const parts = [cat.value && cat.options[cat.selectedIndex].text, status.value && status.options[status.selectedIndex].text,
      where.value, st.q && `«${st.q}»`].filter(Boolean);
    N.copyText(N.forClaude(shown(), parts.join(", ") || "все записи"), e.currentTarget);
  });
  N.onChange(load);
  load();
})();
