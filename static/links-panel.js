/*
Fleet ETA Tracker — раздел Links левой выезжалки: группы и ссылки из листа «Ссылки» (/api/links).
Стиль — как у ⏱ калькулятора: белые секции-группы (подпись и число ссылок), строка: иконка сайта (favicon через Google s2, у mailto — ✉), название, адрес справа.
Грузится после left-panel.js; перечитывает не чаще раза в минуту при открытии панели.
*/
(function () {
  const root = document.getElementById("links-root");
  if (!root) return;
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

  async function load(force) {
    if (busy || (!force && Date.now() - loadedAt < 60000 && loadedAt)) return;
    busy = true;
    try {
      const r = await fetch("/api/links");
      const j = await r.json();
      if (!j.ok || !Array.isArray(j.groups)) throw new Error("bad response");
      render(j.groups);
      loadedAt = Date.now();
    } catch (e) {
      if (!loadedAt) { root.textContent = ""; const d = document.createElement("div"); d.className = "links-note"; d.textContent = "Не удалось загрузить ссылки"; root.appendChild(d); }
    } finally { busy = false; }
  }

  window.addEventListener("left-panel:open", () => load(false));
  load(true);
})();
