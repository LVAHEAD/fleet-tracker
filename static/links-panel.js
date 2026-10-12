/*
Fleet ETA Tracker — раздел Links левой выезжалки: группы и ссылки из листа «Ссылки» (/api/links).
Заголовок группы — как «Наша аппа» в Справке; у ссылки — иконка сайта (favicon через Google s2), у mailto — ✉.
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

  function render(groups) {
    root.textContent = "";
    groups.forEach((g) => {
      const box = document.createElement("div");
      box.className = "links-group";
      if (g.title) {
        const h = document.createElement("div");
        h.className = "fixed-links-sub";
        h.textContent = g.title;
        box.appendChild(h);
      }
      g.items.forEach((it) => {
        const a = document.createElement("a");
        a.className = "lnk";
        a.href = it.url;
        a.title = /^mailto:/i.test(it.url) ? it.url.slice(7) : it.url;
        if (!/^mailto:/i.test(it.url)) { a.target = "_blank"; a.rel = "noopener"; }
        a.appendChild(icon(it.url));
        a.appendChild(document.createTextNode(it.name));
        box.appendChild(a);
      });
      root.appendChild(box);
    });
  }

  async function load(force) {
    if (busy || (!force && Date.now() - loadedAt < 60000 && root.childElementCount)) return;
    busy = true;
    try {
      const r = await fetch("/api/links");
      const j = await r.json();
      if (!j.ok || !Array.isArray(j.groups)) throw new Error("bad response");
      render(j.groups);
      loadedAt = Date.now();
    } catch (e) {
      if (!root.childElementCount) root.textContent = "Не удалось загрузить ссылки";
    } finally { busy = false; }
  }

  window.addEventListener("left-panel:open", () => load(false));
  load(true);
})();
