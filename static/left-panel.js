/*
Fleet ETA Tracker — левая выезжалка (v3.54): оверлей поверх страницы, ничего не сдвигает.
Язычок ▤ у левого края; разделы: Запреты (переехали из шапки), Links (пока пусто).
Открыта / закрыта — помнит ("left-panel-open"). Закрывает ✕ или Esc; клик мимо и смена вкладки не закрывают
(как правые панели с v3.53). При открытии шлёт "left-panel:open" — Запреты грузят данные.
*/
(function () {
  const panel = document.getElementById("left-panel");
  const tab = document.getElementById("left-tab");
  if (!panel || !tab) return;
  const body = document.body;
  const KEY = "left-panel-open";
  const isOpen = () => body.classList.contains("left-open");

  function set(open) {
    body.classList.toggle("left-open", open);
    panel.setAttribute("aria-hidden", open ? "false" : "true");
    try { localStorage.setItem(KEY, open ? "1" : "0"); } catch (e) { /* режим без хранилища */ }
    if (open) window.dispatchEvent(new Event("left-panel:open"));
  }

  tab.addEventListener("click", () => set(!isOpen()));
  const close = panel.querySelector(".left-close");
  if (close) close.addEventListener("click", () => set(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen()) set(false);
  });

  try { if (localStorage.getItem(KEY) === "1") set(true); } catch (e) { /* ignore */ }
})();
