// v1.73: мобильная версия (экран до 767 px).
// Вкладки: Флот · From → To · Локатор, остальные — в меню "⋯";
// Флот — карточки, по умолчанию "просмотр" (✎ — правка); тап по карточке — маршрут на карте во весь экран;
// плавающие кнопки: ↻ обновить всё, 🗺 карта, + строка (в режиме правки).
(function () {
  const mq = window.matchMedia("(max-width: 767px)");
  const isMobile = () => mq.matches;
  const body = document.body;

  // ---------- режим просмотр / правка ----------
  const editBtn = document.getElementById("m-edit-btn");
  const fabAdd = document.getElementById("m-fab-add");
  let editMode = false;
  try { editMode = localStorage.getItem("fleetMobileEdit") === "1"; } catch (e) { /* ignore */ }
  function applyEdit() {
    body.classList.toggle("m-view", !editMode);
    if (editBtn) {
      editBtn.classList.toggle("on", editMode);
      editBtn.textContent = editMode ? "✓ готово" : "✎ правка";
    }
    if (fabAdd) fabAdd.hidden = !editMode;
  }
  applyEdit();
  if (editBtn) editBtn.addEventListener("click", () => {
    editMode = !editMode;
    try { localStorage.setItem("fleetMobileEdit", editMode ? "1" : "0"); } catch (e) { /* ignore */ }
    if (!editMode && document.activeElement && document.activeElement.blur) document.activeElement.blur();
    applyEdit();
  });

  // ---------- карта Флота во весь экран ----------
  function openMap() {
    body.classList.add("m-map-open");
    // v1.76: map объявлена в app.js через let — это не window.map
    const m = (typeof map !== "undefined" && map) ? map : null;
    if (window.google && m) {
      const c = m.getCenter();
      google.maps.event.trigger(m, "resize");
      if (c) m.setCenter(c);
    }
    try { history.pushState({ mMap: 1 }, ""); } catch (e) { /* ignore */ }
  }
  function closeMap(fromPop) {
    if (!body.classList.contains("m-map-open")) return;
    body.classList.remove("m-map-open");
    if (!fromPop && history.state && history.state.mMap) history.back();
  }
  // кнопка "назад" на Android закрывает карту, а не уходит со страницы
  window.addEventListener("popstate", () => closeMap(true));
  const fabMap = document.getElementById("m-fab-map");
  if (fabMap) fabMap.addEventListener("click", openMap);
  const mapClose = document.getElementById("m-map-close");
  if (mapClose) mapClose.addEventListener("click", () => closeMap(false));

  // тап по карточке (в режиме просмотра) — маршрут уже строит app.js, мы только открываем карту
  const tbody = document.getElementById("fleet-tbody");
  if (tbody) tbody.addEventListener("click", (e) => {
    if (!isMobile() || editMode) return;
    const t = e.target;
    if (t.closest("button, input, a, .row-menu, .com-tri")) return;
    const tr = t.closest("tr[data-id]");
    if (!tr) return;
    setTimeout(openMap, 0);
  });

  // ---------- плавающие ↻ и + ----------
  const fabRefresh = document.getElementById("m-fab-refresh");
  if (fabRefresh) fabRefresh.addEventListener("click", () => {
    if (fabRefresh.classList.contains("busy")) return;
    fabRefresh.classList.add("busy");
    let p = null;
    try { p = (typeof calcAllRows === "function") ? calcAllRows() : null; } catch (e) { p = null; }
    const done = () => fabRefresh.classList.remove("busy");
    if (p && p.finally) p.finally(done); else setTimeout(done, 1500);
  });
  if (fabAdd) fabAdd.addEventListener("click", () => {
    const b = document.getElementById("add-row-btn");
    if (b) b.click();
    setTimeout(() => {
      const last = document.querySelector("#fleet-tbody tr:last-child");
      if (last) {
        last.scrollIntoView({ behavior: "smooth", block: "center" });
        const inp = last.querySelector(".unit-input");
        if (inp) inp.focus();
      }
    }, 50);
  });

  // ---------- вкладки: "Локатор" и меню "⋯" ----------
  const nav = document.querySelector(".main-tabs");
  const locTab = document.querySelector(".main-tab-btn[data-locator]");
  if (locTab) locTab.addEventListener("click", () => {
    const lb = document.getElementById("locatorBtn");
    const view = document.getElementById("locatorView");
    if (lb && view && view.hidden) lb.click();
    setTimeout(() => {
      const inp = document.getElementById("locatorInput");
      if (inp && !inp.value) inp.focus();
    }, 50);
  });

  if (nav) {
    const hiddenTabs = [...nav.querySelectorAll(".main-tab-btn.ref-tab, .main-tab-btn[data-tab='gf']")];
    const wrap = document.createElement("span");
    wrap.className = "tabs-more-wrap";
    wrap.innerHTML = '<button type="button" class="tabs-more-btn" title="Ещё разделы">⋯</button><div class="tabs-more-menu" hidden></div>';
    nav.appendChild(wrap);
    const moreBtn = wrap.querySelector(".tabs-more-btn");
    const menu = wrap.querySelector(".tabs-more-menu");
    hiddenTabs.forEach((orig) => {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.tab = orig.dataset.tab;
      b.textContent = orig.dataset.tab === "notes" ? "Блокнот [.]" : orig.textContent.trim();
      b.addEventListener("click", () => { menu.hidden = true; orig.click(); markMore(); });
      menu.appendChild(b);
    });
    if (typeof Notebook !== "undefined") {
      const nb = document.createElement("button");
      nb.type = "button";
      nb.textContent = "📓 Блокнот ФЕТАТ";
      nb.addEventListener("click", () => { menu.hidden = true; Notebook.open(); });
      menu.appendChild(nb);
    }
    const usage = nav.querySelector(".g-usage");
    if (usage) {
      const a = document.createElement("a");
      a.href = usage.href; a.target = "_blank"; a.rel = "noopener";
      a.textContent = "Google — расходы ↗";
      menu.appendChild(a);
    }
    function markMore() {
      const active = nav.querySelector(".main-tab-btn.active");
      const inMenu = active && hiddenTabs.includes(active);
      moreBtn.classList.toggle("active", !!inMenu);
      menu.querySelectorAll("button").forEach((b) => b.classList.toggle("active", !!(inMenu && b.dataset.tab === active.dataset.tab)));
    }
    moreBtn.addEventListener("click", (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; markMore(); });
    document.addEventListener("click", (e) => { if (!wrap.contains(e.target)) menu.hidden = true; });
    nav.querySelectorAll(".main-tab-btn").forEach((b) => b.addEventListener("click", () => {
      markMore();
      if (b.dataset.tab !== "fleet") closeMap(false);
    }));
  }
})();
