// v3.110: онлайн-диспетчеры в шапке — ☁ (🎧 JZ, VL). Пинг GET /api/presence раз в минуту, пока вкладка видна.
(function () {
  const PING_MS = 60000;
  let timer = null;

  function el() {
    let span = document.getElementById("online-tags");
    if (!span) {
      span = document.createElement("span");
      span.id = "online-tags";
      span.className = "online-tags";
      const anchor = document.getElementById("sync-status");
      const h1 = document.querySelector(".topbar h1");
      if (!h1) return null;
      if (anchor && anchor.parentNode === h1) anchor.after(span);
      else h1.appendChild(span);
    }
    return span;
  }

  function render(tags) {
    const span = el();
    if (!span) return;
    if (!tags || !tags.length) {
      span.hidden = true;
      span.textContent = "";
      return;
    }
    const text = ` (🎧 ${tags.join(", ")})`;
    span.hidden = false;
    if (span.textContent !== text) span.textContent = text;
    span.title = "Сейчас в аппе (кроме вас)";
  }

  async function ping() {
    if (document.visibilityState !== "visible") return;
    try {
      const r = await fetch("/api/presence", { cache: "no-store" });
      const d = await r.json();
      if (d && d.ok) render(d.tags);
    } catch (e) {
      // сеть недоступна — оставляем прежний список, следующая попытка через минуту
    }
  }

  function start() {
    clearInterval(timer);
    timer = setInterval(ping, PING_MS);
    ping();
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") ping();
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
