/*
Fleet ETA Tracker — история изменений в блокноте [.] (v1.58)
Берётся с сервера (/api/changelog — история версий из app.py), свежие версии сверху.
Грузится при первом открытии вкладки [.].
*/
(function () {
  const box = document.getElementById("changelog");
  const cnt = document.getElementById("changelogCount");
  const tab = document.querySelector('.main-tab-btn[data-tab="notes"]');
  if (!box) return;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let loaded = false;
  async function load() {
    if (loaded) return;
    loaded = true;
    try {
      const r = await fetch("/api/changelog");
      const d = await r.json();
      const items = d.items || [];
      if (cnt) cnt.textContent = `${items.length} версий, сейчас v${d.version}`;
      let lastDate = null;
      box.innerHTML = items.map((it) => {
        const day = it.date !== lastDate ? `<div class="cl-day">${esc(it.date)}</div>` : "";
        lastDate = it.date;
        const body = [it.title, it.text].filter(Boolean).join("\n");
        return `${day}<details class="cl-item"><summary><span class="cl-ver">v${esc(it.ver)}</span> ${esc(it.title)}</summary>` +
          `<div class="cl-text">${esc(body)}</div></details>`;
      }).join("");
    } catch (e) {
      loaded = false;
      box.textContent = "Не удалось загрузить историю изменений.";
    }
  }
  if (tab) tab.addEventListener("click", load);
})();
