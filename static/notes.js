/*
Fleet ETA Tracker — вкладка [.] (блокнот)
Версия: 1.29 (+ состояние базы фрахтов)
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

  // --- v1.29: состояние базы фрахтов ---
  const frtEl = document.getElementById("frtStatus");
  const frtBtn = document.getElementById("frtRefreshBtn");
  async function loadFrt(refresh) {
    try {
      const res = await fetch("/api/freights" + (refresh ? "?refresh=1" : ""));
      const d = await res.json();
      const s = d.stats || {};
      let html = `Рейсов разобрано: <b>${s.ok || 0}</b> из ${s.rows || 0}`;
      if (s.no_price || s.no_region) html += `<br><span style="color:#a05a00">пропущено: без цены ${s.no_price || 0}, без региона ${s.no_region || 0}</span>`;
      if (d.loaded_at) html += `<br>Обновлено: ${esc(d.loaded_at)}`;
      if (d.error) html += `<br><span class="err">${esc(d.error)}</span>`;
      const cc = d.contract_clients || [];
      html += `<br>Контрактные клиенты (лист «Настройки»): ${cc.length ? esc(cc.join(", ")) : "—"}`;
      if (d.settings_error) html += `<br><span class="err">${esc(d.settings_error)}</span>`;
      frtEl.innerHTML = html;
    } catch (e) {
      frtEl.innerHTML = `<span class="err">Не удалось получить состояние базы фрахтов.</span>`;
    }
  }
  // грузим лениво — при первом открытии вкладки [.]
  let frtLoaded = false;
  const notesTabBtn = document.querySelector('.main-tab-btn[data-tab="notes"]');
  notesTabBtn.addEventListener("click", () => {
    if (!frtLoaded) { frtLoaded = true; loadFrt(false); }
  });

  // v3.06: интеграция с Notebook (блокнот с синхронизацией)
  const notebookBtn = document.createElement("button");
  notebookBtn.textContent = "📓 Блокнот";
  notebookBtn.title = "Открыть панель быстрого добавления записей";
  notebookBtn.style.cssText = "margin-left: 12px; padding: 8px 12px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; font-weight: 600;";
  notebookBtn.addEventListener("click", () => {
    Notebook.open();
  });
  const notesHead = document.querySelector(".notes-head");
  if (notesHead) {
    notesHead.appendChild(notebookBtn);
  }
  frtBtn.addEventListener("click", async () => {
    frtBtn.disabled = true; frtBtn.textContent = "Обновляю…";
    await loadFrt(true);
    frtBtn.disabled = false; frtBtn.textContent = "↻ Обновить фрахты";
  });

  refreshBtn.addEventListener("click", async () => {
    refreshBtn.disabled = true;
    refreshBtn.textContent = "Обновляю…";
    const d = await window.loadAddressList(true);
    showStatus(d);
    refreshBtn.disabled = false;
    refreshBtn.textContent = "↻ Обновить базу";
  });
})();
