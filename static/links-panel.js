/*
Fleet ETA Tracker — раздел Links левой выезжалки: группы и ссылки из листа «Ссылки» (/api/links).
Стиль — как у ⏱ калькулятора: белые секции-группы (подпись и число ссылок), строка: иконка сайта (favicon через Google s2, у mailto — ✉), название, адрес справа.
Грузится после left-panel.js; перечитывает не чаще раза в минуту при открытии панели.
Кнопка ↻ внизу слева — перечитать лист сразу (/api/links?refresh=1); рядом — время обновления или «лист не прочитан».
*/
(function () {
  const root = document.getElementById("links-root");
  if (!root) return;
  const btn = document.getElementById("links-refresh");
  const stat = document.getElementById("links-stat");
  let loadedAt = 0, busy = false;

  function icon(url) {
    const span = document.createElement("span");
    span.className = "lnk-ico";
    if (/^mailto:/i.test(url)) { span.textContent = "✉"; return span; }
    let host = "";
    try { host = new URL(url).hostname; } catch (e) { /* без иконки */ }
    if (!host) { span.textContent = "🔗"; return span; }
    const img = document.createElement("img");
    img.src = "https://www.google.com/s2/favicons?domain=" + encodeURIComponent(host) + "&sz=32";
    img.width = 16; img.height = 16; img.alt = ""; img.loading = "lazy";
    img.addEventListener("error", () => { span.textContent = "🔗"; img.remove(); });
    span.appendChild(img);
    return span;
  }

  function subText(url) {
    if (/^mailto:/i.test(url)) return url.slice(7);
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch (e) { return ""; }
  }

  function render(groups) {
    root.textContent = "";
    groups.forEach((g) => {
      const box = document.createElement("div");
      box.className = "links-group";
      if (g.title) {
        const h = document.createElement("div");
        h.className = "links-h";
        const t = document.createElement("span"); t.textContent = g.title;
        const n = document.createElement("span"); n.textContent = String(g.items.length);
        h.appendChild(t); h.appendChild(n);
        box.appendChild(h);
      }
      g.items.forEach((it) => {
        const mail = /^mailto:/i.test(it.url);
        const a = document.createElement("a");
        a.className = "lnk";
        a.href = it.url;
        a.title = mail ? it.url.slice(7) : it.url;
        if (!mail) { a.target = "_blank"; a.rel = "noopener"; }
        const name = document.createElement("span"); name.className = "lnk-name"; name.textContent = it.name;
        const sub = document.createElement("span"); sub.className = "lnk-sub"; sub.textContent = subText(it.url);
        a.appendChild(icon(it.url)); a.appendChild(name); a.appendChild(sub);
        box.appendChild(a);
      });
      root.appendChild(box);
    });
  }

  function setStat(text, bad) {
    if (!stat) return;
    stat.textContent = text;
    stat.classList.toggle("bad", !!bad);
  }

  // force — игнорировать минутную паузу; refresh — попросить сервер перечитать лист (кнопка ↻), а не взять из кеша
  async function load(force, refresh) {
    if (busy || (!force && Date.now() - loadedAt < 60000 && loadedAt)) return;
    busy = true;
    if (btn) { btn.disabled = true; btn.textContent = "↻ …"; }
    try {
      const r = await fetch("/api/links" + (refresh ? "?refresh=1" : ""));
      const j = await r.json();
      if (!j.ok || !Array.isArray(j.groups)) throw new Error("bad response");
      render(j.groups);
      loadedAt = Date.now();
      const hm = new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
      if (j.source === "sheet") setStat("обновлено " + hm);
      else setStat("лист не прочитан — запасной список", true);
    } catch (e) {
      if (!loadedAt) { root.textContent = ""; const d = document.createElement("div"); d.className = "links-note"; d.textContent = "Не удалось загрузить ссылки"; root.appendChild(d); }
      setStat("не удалось обновить", true);
    } finally {
      busy = false;
      if (btn) { btn.disabled = false; btn.textContent = "↻ Обновить"; }
    }
  }

  window.addEventListener("left-panel:open", () => load(false));
  if (btn) btn.addEventListener("click", () => load(true, true));
  load(true, false);
})();
