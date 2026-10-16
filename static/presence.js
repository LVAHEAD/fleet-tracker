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

  // v3.132: тихое обновление. Версия страницы — из шапки (v3.131); сервер отдаёт свою в /api/presence.
  // Новее → маленькая плашка «Вышла vX.YY · обновить»; вкладка скрыта дольше 10 мин и без правок → обновляется сама.
  const PAGE_VER = ((document.querySelector(".title-version") || {}).textContent || "").replace(/^v/i, "").trim();
  const HIDDEN_RELOAD_MS = 600000;
  let newVer = "";
  let hiddenAt = 0;

  function verNum(v) {
    const m = /^(\d+)\.(\d+)/.exec(String(v || ""));
    return m ? Number(m[1]) * 100000 + Number(m[2]) : 0;
  }

  function showUpdate(ver) {
    newVer = ver;
    let b = document.getElementById("update-pill");
    if (!b) {
      const h1 = document.querySelector(".topbar h1");
      if (!h1) return;
      b = document.createElement("button");
      b.type = "button";
      b.id = "update-pill";
      b.className = "update-pill";
      b.addEventListener("click", () => location.reload());
      h1.appendChild(b);
    }
    b.textContent = `Вышла v${ver} · обновить`;
    b.title = "Нажмите, чтобы загрузить новую версию (страница перезагрузится)";
  }

  // «несохранённые правки»: фокус в поле ввода строки, открытый ⏱ с введёнными км, открытое окно правки
  function busyEditing() {
    const a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.closest("#fleet-tbody, .eta-calc, .side-panel, .modal")) return true;
    return false;
  }

  // скрытая вкладка: раз в 2 мин спрашиваем только версию (peek), через 10 мин скрытия — обновляемся, если не правят
  async function hiddenTick() {
    if (document.visibilityState === "visible") return;
    if (!hiddenAt) hiddenAt = Date.now();
    try {
      const d = await (await fetch("/api/presence?peek=1", { cache: "no-store" })).json();
      if (d && d.version && PAGE_VER && verNum(d.version) > verNum(PAGE_VER)) showUpdate(d.version);
    } catch (e) {
      return;
    }
    if (newVer && Date.now() - hiddenAt >= HIDDEN_RELOAD_MS && !busyEditing()) location.reload();
  }

  async function ping() {
    if (document.visibilityState !== "visible") return;
    try {
      const r = await fetch("/api/presence", { cache: "no-store" });
      const d = await r.json();
      if (d && d.ok) render(d.tags);
      if (d && d.version && PAGE_VER && verNum(d.version) > verNum(PAGE_VER)) showUpdate(d.version);
    } catch (e) {
      // сеть недоступна — оставляем прежний список, следующая попытка через минуту
    }
  }

  // v3.124: прогрев кешей Mapon — раз в 4 мин, пока вкладка видна (к ↻ тахограф и история уже свежие)
  async function warm() {
    if (document.visibilityState !== "visible") return;
    try {
      const list = (typeof rows !== "undefined" && Array.isArray(rows) ? rows : [])
        .filter(r => r && r.unit && !r.done).map(r => r.unit);
      if (!list.length) return;
      await fetch("/api/warm", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ units: list }) });
    } catch (e) {
      // не страшно: просто не прогрелось
    }
  }

  function start() {
    setInterval(warm, 240000);
    clearInterval(timer);
    timer = setInterval(ping, PING_MS);
    setInterval(hiddenTick, 120000);
    ping();
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") { hiddenAt = 0; ping(); }
    else hiddenAt = Date.now();
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
