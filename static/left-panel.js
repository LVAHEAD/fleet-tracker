/*
Fleet ETA Tracker — левая выезжалка (v3.56): как правая — на всю высоту, свой ярлык у края на каждый раздел
(Запреты 🚫, Links 🔗, Как работает ❔). Оверлей поверх страницы, ничего не сдвигает.
Ярлык открывает свой раздел; тот же ярлык или ✕ / Esc — закрывают; другой ярлык — переключает раздел.
Клик мимо не закрывает (как правые панели с v3.53). Открыта и раздел — помнит ("left-panel-open", "left-panel-sec").
При открытии шлёт "left-panel:open" — Запреты грузят данные.
*/
(function () {
  const panel = document.getElementById("left-panel");
  const tabs = Array.from(document.querySelectorAll(".left-tab[data-lp]"));
  const title = document.getElementById("left-title");
  if (!panel || !tabs.length) return;
  const body = document.body;
  const KEY = "left-panel-open";
  const SEC_KEY = "left-panel-sec";
  const TITLES = { bans: "Запреты", links: "Links", help: "Как работает", addr: "Адреса" };
  const isOpen = () => body.classList.contains("left-open");
  let section = "bans";

  function showSection(name) {
    section = name;
    tabs.forEach((t) => t.classList.toggle("on", t.dataset.lp === name && isOpen()));
    panel.querySelectorAll(".left-pane").forEach((p) => { p.hidden = p.id !== "lp-" + name; });
    if (title) title.textContent = TITLES[name] || "";
    try { localStorage.setItem(SEC_KEY, name); } catch (e) { /* режим без хранилища */ }
  }

  // v3.228: переключение раздела — как у правых панелей: старая панель уезжает, новая выезжает одновременно (250 мс),
  // ярлыки стоят на месте. Одна панель на все разделы — старый вид уезжает «призраком» (копия панели), настоящая выезжает с новым разделом.
  let swapTimer = null, ghost = null;
  function endGhost() {
    clearTimeout(swapTimer); swapTimer = null;
    if (ghost) { ghost.remove(); ghost = null; }
    panel.classList.remove("lp-from");
  }
  function switchSection(name) {
    if (!isOpen()) { section = name; set(true); return; }
    if (name === section) return;
    if (ghost) { endGhost(); showSection(name); return; }   // частые клики — без анимации
    ghost = panel.cloneNode(true);
    ghost.removeAttribute("id");
    ghost.querySelectorAll("[id]").forEach((e) => e.removeAttribute("id"));
    ghost.setAttribute("aria-hidden", "true");
    ghost.inert = true;
    ghost.classList.add("lp-ghost");
    const top = panel.scrollTop;
    panel.after(ghost);
    ghost.scrollTop = top;
    panel.classList.add("lp-from");
    showSection(name);
    panel.scrollTop = 0;
    void panel.offsetWidth;                                  // зафиксировать стартовые положения
    requestAnimationFrame(() => { panel.classList.remove("lp-from"); if (ghost) ghost.classList.add("lp-out"); });
    swapTimer = setTimeout(endGhost, 300);
  }

  function set(open) {
    endGhost();
    body.classList.toggle("left-open", open);
    panel.setAttribute("aria-hidden", open ? "false" : "true");
    showSection(section);
    try { localStorage.setItem(KEY, open ? "1" : "0"); } catch (e) { /* режим без хранилища */ }
    if (open) window.dispatchEvent(new Event("left-panel:open"));
  }

  tabs.forEach((t) => t.addEventListener("click", () => {
    const name = t.dataset.lp;
    if (isOpen() && section === name) { set(false); return; }
    switchSection(name);
  }));
  const close = panel.querySelector(".left-close");
  if (close) close.addEventListener("click", () => set(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen()) set(false);
  });

  // v3.163: открыть нужный раздел из кода (Ctrl+клик по полю таргета → Адреса)
  window.leftPanelOpen = (name) => {
    section = name;
    if (!isOpen()) set(true); else switchSection(name);
  };

  try { const s = localStorage.getItem(SEC_KEY); section = s === "links" || s === "help" || s === "addr" ? s : "bans"; } catch (e) { /* ignore */ }
  showSection(section);
  try { if (localStorage.getItem(KEY) === "1") set(true); } catch (e) { /* ignore */ }
})();
