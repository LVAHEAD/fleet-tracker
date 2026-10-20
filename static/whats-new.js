/* v3.175: поп-ап «Что нового». Показывает строки «Для диспетчеров:» из CHANGELOG.md (/api/changelog, поле disp; нет её — заголовок записи).
Два случая: (1) клик по плашке «Вышла vX.YY · обновить» — карточка у плашки с изменениями от версии страницы до новой, «Обновить» / «Позже»;
(2) после обновления — один раз «Что нового в vX.YY» (последняя виденная версия — localStorage `fleet-seen-ver`; первый запуск — молча запоминаем).
Закрытие: «Позже» / «Понятно», Esc, клик вне карточки. Грузится ДО presence.js. */
(function () {
  "use strict";
  const KEY = "fleet-seen-ver";
  const MAX = 8;
  let pop = null;

  function verNum(v) {
    const m = /^(\d+)\.(\d+)/.exec(String(v || ""));
    return m ? Number(m[1]) * 100000 + Number(m[2]) : 0;
  }
  const pageVer = () => ((document.querySelector(".title-version") || {}).textContent || "").replace(/^v/i, "").trim();
  function close() { if (pop) { pop.remove(); pop = null; } }

  async function load(from, to) {
    const d = await (await fetch("/api/changelog", { cache: "no-store" })).json();
    return (d.items || []).filter((it) => verNum(it.ver) > verNum(from) && verNum(it.ver) <= verNum(to));
  }

  function show(items, opts) {
    close();
    pop = document.createElement("div");
    pop.className = "wn-pop";
    const h = document.createElement("div");
    h.className = "wn-h";
    h.textContent = opts.title;
    pop.appendChild(h);
    const list = document.createElement("div");
    list.className = "wn-list";
    items.slice(0, MAX).forEach((it) => {
      const row = document.createElement("div");
      row.className = "wn-item";
      const v = document.createElement("b");
      v.textContent = "v" + it.ver;
      row.appendChild(v);
      row.appendChild(document.createTextNode(" " + (it.disp || it.title)));
      list.appendChild(row);
    });
    pop.appendChild(list);
    if (items.length > MAX) {
      const more = document.createElement("div");
      more.className = "wn-more";
      more.textContent = `и ещё ${items.length - MAX} — во вкладке [.]`;
      pop.appendChild(more);
    }
    const foot = document.createElement("div");
    foot.className = "wn-foot";
    opts.buttons.forEach((b) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "wn-btn";
      el.textContent = b.text;
      el.addEventListener("click", (e) => { e.stopPropagation(); close(); if (b.fn) b.fn(); });
      foot.appendChild(el);
    });
    pop.appendChild(foot);
    document.body.appendChild(pop);
    const r = opts.anchor.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8)) + "px";
    pop.style.top = (r.bottom + 6) + "px";
  }

  // клик по плашке «Вышла …»: что нового + «Обновить» / «Позже»; не получилось загрузить — просто обновляем
  window.fleetWhatsNew = async function (newVer, anchor) {
    const reload = () => { try { localStorage.setItem(KEY, newVer); } catch (e) { /* ignore */ } location.reload(); };
    try {
      const items = await load(pageVer(), newVer);
      if (!items.length) { reload(); return; }
      show(items, { title: `Вышла v${newVer} — что нового`, anchor, buttons: [{ text: "Обновить", fn: reload }, { text: "Позже" }] });
    } catch (e) { reload(); }
  };

  document.addEventListener("click", (e) => { if (pop && !pop.contains(e.target)) close(); }, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

  // после обновления — один раз
  (async function afterUpdate() {
    const cur = pageVer();
    if (!cur) return;
    let seen = "";
    try { seen = localStorage.getItem(KEY) || ""; localStorage.setItem(KEY, cur); } catch (e) { return; }
    if (!seen || verNum(seen) >= verNum(cur)) return;   // первый запуск или версия не менялась
    try {
      const items = await load(seen, cur);
      const anchor = document.querySelector(".topbar h1") || document.body;
      if (items.length) show(items, { title: `Что нового в v${cur}`, anchor, buttons: [{ text: "Понятно" }] });
    } catch (e) { /* без поп-апа */ }
  })();
})();
