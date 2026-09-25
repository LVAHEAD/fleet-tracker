/*
Fleet ETA Tracker — вкладка [.] (блокнот)
Версия: 1.28
  - свободный текст, автосохранение в localStorage браузера ("notes-text");
  - ссылки из текста выводятся ниже кликабельным списком;
  - справа — состояние адресной базы (Google-таблица) и кнопка "обновить базу".
*/
(function () {
  const KEY = "notes-text";
  const DEFAULT_TEXT =
    "Таблица данных (адреса, фрахты):\n" +
    "https://docs.google.com/spreadsheets/d/1m0oM8cNixVDM1kgQKCZKPgF-aSQN-0loqdLc-dWkD7g/edit\n";

  const ta = document.getElementById("notesText");
  const linksEl = document.getElementById("notesLinks");
  const savedEl = document.getElementById("notesSaved");
  const statusEl = document.getElementById("addrStatus");
  const problemsEl = document.getElementById("addrProblems");
  const refreshBtn = document.getElementById("addrRefreshBtn");
  if (!ta) return;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function renderLinks() {
    const urls = [...new Set(ta.value.match(/https?:\/\/[^\s<>"']+/g) || [])];
    linksEl.innerHTML = urls.length
      ? urls.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a>`).join("")
      : `<span style="color:#aaa">— нет —</span>`;
  }

  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) { saved = null; }
  ta.value = saved == null ? DEFAULT_TEXT : saved;
  renderLinks();

  let t = null;
  ta.addEventListener("input", () => {
    renderLinks();
    clearTimeout(t);
    t = setTimeout(() => {
      try {
        localStorage.setItem(KEY, ta.value);
        savedEl.textContent = "сохранено ✓";
        setTimeout(() => { savedEl.textContent = ""; }, 1500);
      } catch (e) {
        savedEl.textContent = "не удалось сохранить";
      }
    }, 400);
  });

  // --- состояние адресной базы ---
  function showStatus(d) {
    if (!d) { statusEl.innerHTML = `<span class="err">Не удалось получить состояние базы.</span>`; return; }
    const n = (d.addresses || []).length;
    let html = `Точек: <b>${n}</b>`;
    if (d.loaded_at) html += `<br>Обновлено: ${esc(d.loaded_at)}`;
    if (d.error) html += `<br><span class="err">${esc(d.error)}</span>`;
    statusEl.innerHTML = html;
    const pr = d.problems || [];
    problemsEl.innerHTML = pr.length
      ? `Пропущены (${pr.length}):<br>` + pr.map(esc).join("<br>")
      : "";
  }
  window.onAddressStatus = showStatus;
  if (window.addressStatus) showStatus(window.addressStatus);

  refreshBtn.addEventListener("click", async () => {
    refreshBtn.disabled = true;
    refreshBtn.textContent = "Обновляю…";
    const d = await window.loadAddressList(true);
    showStatus(d);
    refreshBtn.disabled = false;
    refreshBtn.textContent = "↻ Обновить базу";
  });
})();
