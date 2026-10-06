/*
Fleet ETA Tracker — блокнот ФЕТАТ (v3.08).
Язычок 📓 у правого края на всех вкладках (на телефоне — пункт в меню ⋯) открывает панель:
форма (категория, Где, приоритет, название, описание, скриншот) и последние записи.
Карточка записи: просмотр, полное редактирование (включая скриншот), комментарии, удаление.
«📋 Для Claude» — копирует записи текстом. Вся таблица — страница /notebook (notebook-page.js).
Скриншот сжимается здесь же: JPEG до 1280 px + миниатюра 200 px. Закрыть: ×, язычок, Esc, клик мимо.
*/
const Notebook = (() => {
  const CATS = [["Bug", "Баг"], ["Feature", "Фича"], ["Design", "Дизайн"], ["Rule", "Правило"], ["Data", "Данные"], ["Discuss", "Обсудить"]];
  const CAT_LABEL = Object.fromEntries(CATS);
  const STATUSES = [["new", "новое"], ["work", "в работе"], ["done", "готово"], ["later", "отложено"], ["rejected", "отклонено"]];
  const isClosed = (s) => s === "done" || s === "rejected";   // v3.15: серые; v3.22: внизу, свёрнуты
  const STATUS_LABEL = Object.fromEntries(STATUSES);
  const WHERE = ["Флот", "From → To", "GF построитель", "Карты стран", "Локатор", "Запреты", "Паромы", "Truck Info", "[.]", "Общее"];
  const TAB_WHERE = { fleet: "Флот", route: "From → To", gf: "GF построитель", maps: "Карты стран", bans: "Запреты",
    ferries: "Паромы", truckinfo: "Truck Info", notes: "[.]" };
  const IMG_MAX_PX = 1280;
  const IMG_MAX_CHARS = 700000;
  const THUMB_PX = 200;
  let panel, tab, isOpen = false, shot = null;   // shot = {image, thumb}
  const listeners = [];                          // кому сообщить, что записи изменились

  const $ = (sel) => panel.querySelector(sel);

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
  }

  function fmtDate(iso, withTime) {
    const d = new Date(iso);
    if (isNaN(d)) return "";
    const p = (n) => String(n).padStart(2, "0");
    const s = `${p(d.getDate())}.${p(d.getMonth() + 1)}`;
    return withTime ? `${s} ${p(d.getHours())}:${p(d.getMinutes())}` : s;
  }

  function who(email) { return String(email || "").split("@")[0]; }

  function catChip(c) { return `<span class="nb-cat nb-cat-${esc(c)}">${esc(CAT_LABEL[c] || c)}</span>`; }
  function statusChip(s) { return `<span class="nb-st nb-st-${esc(s)}">${esc(STATUS_LABEL[s] || s)}</span>`; }
  function prioChip(p) { return p ? `<span class="nb-prio${p >= 8 ? " hot" : ""}" title="Приоритет">${p}/10</span>` : ""; }

  function options(list, sel) {
    return list.map(([v, l]) => `<option value="${esc(v)}"${v === sel ? " selected" : ""}>${esc(l)}</option>`).join("");
  }
  function whereOptions(sel) {
    const list = WHERE.includes(sel) || !sel ? WHERE : [sel, ...WHERE];
    return options(list.map((w) => [w, w]), sel);
  }
  function prioOptions(sel) {
    return options([["", "приоритет —"], ...Array.from({ length: 10 }, (_, i) => [String(10 - i), `${10 - i}/10`])],
      sel == null ? "" : String(sel));
  }

  // где я сейчас: активная вкладка (в Картах стран — Локатор, если он открыт)
  function currentWhere() {
    if (document.body.dataset.page === "notebook") return "Общее";
    const act = document.querySelector(".main-tab-btn.active");
    const t = act && act.dataset.tab;
    if (t === "maps") {
      const lv = document.getElementById("locatorView");
      if (lv && !lv.hidden) return "Локатор";
    }
    return TAB_WHERE[t] || "Общее";
  }

  async function api(url, opts) {
    let r;
    try { r = await fetch(url, opts); } catch (e) { throw new Error("Нет связи с сервером"); }
    const js = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(js.error || `Ошибка ${r.status}`);
    return js;
  }
  const jsonOpts = (method, body) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  function changed() { listeners.forEach((f) => { try { f(); } catch (e) { /* ignore */ } }); }

  // ---------- скриншот ----------
  function loadImg(src) {
    return new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error("не удалось прочитать картинку"));
      im.src = src;
    });
  }

  function toJpeg(im, maxPx, quality) {
    const k = Math.min(1, maxPx / Math.max(im.naturalWidth, im.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(im.naturalWidth * k));
    c.height = Math.max(1, Math.round(im.naturalHeight * k));
    const g = c.getContext("2d");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(im, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", quality);
  }

  async function compress(f) {
    if (!f || !f.type.startsWith("image/")) throw new Error("Это не картинка");
    const url = URL.createObjectURL(f);
    try {
      const im = await loadImg(url);
      let image = null;
      for (const [px, q] of [[IMG_MAX_PX, 0.82], [IMG_MAX_PX, 0.65], [1024, 0.6], [800, 0.55]]) {
        image = toJpeg(im, px, q);
        if (image.length <= IMG_MAX_CHARS) break;
      }
      if (image.length > IMG_MAX_CHARS) throw new Error("Скриншот слишком большой");
      return { image, thumb: toJpeg(im, THUMB_PX, 0.7) };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // зона скриншота: Ctrl+V (пока зона «активна»), перетащить, клик — выбрать файл, × — убрать
  function shotZone(zone, onPick, onClear) {
    const file = document.createElement("input");
    file.type = "file"; file.accept = "image/*"; file.hidden = true;
    zone.appendChild(file);
    zone.addEventListener("click", (e) => { if (!e.target.closest(".nb-shot-x")) file.click(); });
    file.addEventListener("change", () => { if (file.files[0]) onPick(file.files[0]); file.value = ""; });
    zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("hover"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("hover"));
    zone.addEventListener("drop", (e) => {
      e.preventDefault(); zone.classList.remove("hover");
      const f = e.dataTransfer && e.dataTransfer.files[0];
      if (f) onPick(f);
    });
    zone.querySelector(".nb-shot-x").addEventListener("click", (e) => { e.stopPropagation(); onClear(); });
  }

  function showShot(zone, src) {
    const img = zone.querySelector(".nb-shot-img");
    img.hidden = !src;
    img.src = src || "";
    zone.querySelector(".nb-shot-hint").hidden = !!src;
    zone.querySelector(".nb-shot-x").hidden = !src;
  }

  const SHOT_HTML = `
    <span class="nb-shot-hint">Скриншот: Ctrl+V, перетащить или клик</span>
    <img class="nb-shot-img" alt="" hidden>
    <button type="button" class="nb-shot-x" title="Убрать скриншот" hidden>×</button>`;

  function imageFromPaste(e) {
    if (!e.clipboardData) return null;
    for (const it of e.clipboardData.items) if (it.type.startsWith("image/")) return it.getAsFile();
    return null;
  }

  // ---------- «📋 Для Claude» ----------
  function forClaude(items, title) {
    const lines = [`Блокнот ФЕТАТ — ${title || "записи"}: ${items.length}`];
    items.forEach((it, i) => {
      const head = [CAT_LABEL[it.category] || it.category, it.where, STATUS_LABEL[it.status] || it.status,
        it.priority ? `приоритет ${it.priority}/10` : ""].filter(Boolean).join(" · ");
      lines.push("", `${i + 1}. [${head}] ${it.title}`);
      lines.push(`   ${fmtDate(it.created_at, true)}, ${who(it.author)}${it.has_image ? ", есть скриншот" : ""}`);
      if (it.description) lines.push(...it.description.split("\n").map((l) => "   " + l));
      (it.comments || []).forEach((c) => lines.push(`   — ${who(c.author)} ${fmtDate(c.at, true)}: ${c.text.replace(/\n/g, " ")}`));
    });
    return lines.join("\n");
  }

  async function copyText(text, btn) {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch (e) {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { ok = document.execCommand("copy"); } catch (e2) { ok = false; }
      ta.remove();
    }
    if (btn) {
      const was = btn.textContent;
      btn.textContent = ok ? "✓ скопировано" : "не скопировалось";
      setTimeout(() => { btn.textContent = was; }, 1800);
    }
    return ok;
  }

  // ---------- панель ----------
  function build() {
    tab = document.createElement("button");
    tab.type = "button";
    tab.className = "nb-tab";
    tab.title = "Блокнот: баги, фичи, правила, данные";
    tab.textContent = "📓";
    tab.addEventListener("click", (e) => { e.stopPropagation(); toggle(); });
    document.body.appendChild(tab);

    panel = document.createElement("aside");
    panel.className = "nb-panel";
    panel.setAttribute("aria-hidden", "true");
    panel.innerHTML = `
      <div class="nb-resize"></div>
      <div class="w-label"></div>
      <div class="nb-head">
        <b>📓 Блокнот</b>
        <span class="nb-head-acts">
          <a href="/notebook" target="_blank" rel="noopener" title="Вся таблица в новой вкладке">все записи ↗</a>
          <button type="button" class="nb-x" title="Закрыть (Esc)">×</button>
        </span>
      </div>
      <div class="nb-form">
        <div class="nb-cats">${CATS.map(([v, l]) => `<button type="button" data-cat="${v}"${v === "Bug" ? ' class="on"' : ""}>${l}</button>`).join("")}</div>
        <div class="nb-row2">
          <select class="nb-where" title="Где">${whereOptions("Флот")}</select>
          <select class="nb-prio-sel" title="Приоритет">${prioOptions(null)}</select>
        </div>
        <input type="text" class="nb-title" maxlength="200" placeholder="Коротко: что и где">
        <textarea class="nb-desc" maxlength="4000" placeholder="Подробности (необязательно)"></textarea>
        <div class="nb-shot" tabindex="0" title="Ctrl+V — вставить скриншот, или перетащите файл, или кликните">${SHOT_HTML}</div>
        <div class="nb-actions">
          <span class="nb-msg"></span>
          <button type="button" class="nb-save">Добавить</button>
        </div>
      </div>
      <div class="nb-list-head">
        <b>Последние</b>
        <span>
          <select class="nb-filter">
            <option value="">все</option>
            ${CATS.map(([v, l]) => `<option value="${v}">${l.toLowerCase()}</option>`).join("")}
          </select>
          <button type="button" class="nb-claude" title="Скопировать показанные записи текстом — вставить в чат с Claude">📋 Для Claude</button>
        </span>
      </div>
      <div class="nb-list"></div>`;
    document.body.appendChild(panel);
    wire();
  }

  let lastItems = [];

  function wire() {
    $(".nb-x").addEventListener("click", close);
    // v3.34: ширина тянется за левый край — одна на все боковые панели (sidePanelW в app.js; на /notebook его нет)
    if (window.sidePanelW) {
      $(".nb-resize").addEventListener("mousedown", (e) => window.sidePanelW.drag(e, "nb-resizing"));
      window.sidePanelW.set(window.sidePanelW.get());
    } else {
      $(".nb-resize").remove();
    }
    $(".nb-filter").addEventListener("change", loadList);
    $(".nb-save").addEventListener("click", save);
    $(".nb-title").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); save(); } });
    $(".nb-claude").addEventListener("click", (e) => {
      const f = $(".nb-filter");
      copyText(forClaude(lastItems, f.value ? f.options[f.selectedIndex].text : "последние"), e.currentTarget);
    });

    panel.querySelectorAll(".nb-cats button").forEach((b) => b.addEventListener("click", () => {
      panel.querySelectorAll(".nb-cats button").forEach((x) => x.classList.toggle("on", x === b));
    }));

    const zone = $(".nb-shot");
    shotZone(zone, takeImage, () => setShot(null));

    // Ctrl+V картинки — пока панель открыта и карточка записи не в режиме правки
    document.addEventListener("paste", (e) => {
      if (!isOpen || document.querySelector(".nb-modal-bg")) return;
      const f = imageFromPaste(e);
      if (f) { e.preventDefault(); takeImage(f); }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !isOpen) return;
      if (document.querySelector(".nb-modal-bg")) return;   // сначала закрывается карточка
      close();
    });

    // клик мимо панели — закрыть. v3.31: в аппе — общий для всех боковых панелей (app.js, строки трипов
    // не закрывают); здесь — только на странице /notebook, где app.js нет
    document.addEventListener("mousedown", (e) => {
      if (!isOpen || typeof SIDE_KEEP !== "undefined") return;
      if (panel.contains(e.target) || tab.contains(e.target) || e.target.closest(".nb-modal-bg, .tabs-more-wrap")) return;
      close();
    });
  }

  async function takeImage(f) {
    msg("Сжимаю скриншот…");
    try {
      const s = await compress(f);
      setShot(s);
      msg(`Скриншот ${Math.round(s.image.length * 0.75 / 1024)} КБ`);
    } catch (e) { msg(e.message, true); }
  }

  function setShot(s) {
    shot = s;
    showShot($(".nb-shot"), s && s.image);
    if (!s) msg("");
  }

  function msg(text, isErr) {
    const m = $(".nb-msg");
    m.textContent = text || "";
    m.classList.toggle("err", !!isErr);
  }

  async function save() {
    const title = $(".nb-title").value.trim();
    if (!title) { msg("Нужно название", true); $(".nb-title").focus(); return; }
    const cat = panel.querySelector(".nb-cats button.on");
    const btn = $(".nb-save");
    btn.disabled = true;
    msg("Сохраняю…");
    try {
      await api("/api/notebook", jsonOpts("POST", {
        title,
        category: cat ? cat.dataset.cat : "Bug",
        where: $(".nb-where").value,
        priority: $(".nb-prio-sel").value || null,
        description: $(".nb-desc").value.trim(),
        image: shot ? shot.image : null,
        thumb: shot ? shot.thumb : null,
      }));
      $(".nb-title").value = "";
      $(".nb-desc").value = "";
      $(".nb-prio-sel").value = "";
      setShot(null);
      msg("✓ Добавлено");
      setTimeout(() => { if ($(".nb-msg").textContent === "✓ Добавлено") msg(""); }, 2500);
      loadList();
      changed();
    } catch (e) {
      msg(e.message, true);
    } finally {
      btn.disabled = false;
    }
  }

  async function loadList() {
    const box = $(".nb-list");
    const cat = $(".nb-filter").value;
    try {
      // v3.22: все открытые + закрытые до 30
      const js = await api("/api/notebook?limit=30&open_first=1" + (cat ? "&category=" + encodeURIComponent(cat) : ""));
      lastItems = js.items || [];
      renderList(lastItems, js.closed_total);
    } catch (e) {
      box.innerHTML = `<div class="nb-empty err">${esc(e.message)}</div>`;
    }
  }

  // v3.22: сверху открытые (новое, в работе, отложено — бледнее), ниже «Закрыто (N) ▸» — свёрнуто, клик раскрывает
  const FOLD_KEY = "fetatNbClosedOpen";
  function closedOpen() { try { return localStorage.getItem(FOLD_KEY) === "1"; } catch (e) { return false; } }
  function itemHtml(it) {
    const cls = isClosed(it.status) ? " done" : it.status === "later" ? " later" : "";
    return `
      <div class="nb-item${cls}" data-id="${esc(it.id)}">
        ${it.thumb ? `<img class="nb-thumb" src="${esc(it.thumb)}" alt="">` : '<div class="nb-thumb nb-thumb-empty"></div>'}
        <div class="nb-item-body">
          <div class="nb-item-title">${esc(it.title)}</div>
          <div class="nb-item-meta">
            ${catChip(it.category)}${it.status !== "new" ? statusChip(it.status) : ""}${prioChip(it.priority)}
            ${esc(it.where || "")}${it.where ? " · " : ""}${esc(fmtDate(it.created_at))} · ${esc(who(it.author))}${it.comments.length ? ` · 💬 ${it.comments.length}` : ""}
          </div>
        </div>
      </div>`;
  }
  function renderList(items, closedTotal) {
    const box = $(".nb-list");
    if (!items.length) { box.innerHTML = '<div class="nb-empty">Записей пока нет</div>'; return; }
    const opened = items.filter((it) => !isClosed(it.status));
    const closed = items.filter((it) => isClosed(it.status));
    const total = Math.max(closedTotal || 0, closed.length);
    const show = closedOpen();
    box.innerHTML = (opened.length ? opened.map(itemHtml).join("") : '<div class="nb-empty">Открытых записей нет</div>') +
      (closed.length ? `<button type="button" class="nb-closed-head" title="Готово и отклонено">Закрыто (${total}) ${show ? "▾" : "▸"}</button>
        <div class="nb-closed"${show ? "" : " hidden"}>${closed.map(itemHtml).join("")}${total > closed.length
          ? `<div class="nb-empty">ещё ${total - closed.length} — на <a href="/notebook" target="_blank" rel="noopener">странице блокнота</a></div>` : ""}</div>` : "");
    box.querySelectorAll(".nb-item").forEach((el) => el.addEventListener("click", () => showItem(el.dataset.id)));
    const head = box.querySelector(".nb-closed-head");
    if (head) head.addEventListener("click", () => {
      try { localStorage.setItem(FOLD_KEY, closedOpen() ? "0" : "1"); } catch (e) { /* ignore */ }
      renderList(items, closedTotal);
    });
  }

  // ---------- карточка записи ----------
  async function showItem(id) {
    let it;
    try { it = await api("/api/notebook/" + encodeURIComponent(id)); } catch (e) { alert(e.message); return; }

    const bg = document.createElement("div");
    bg.className = "nb-modal-bg";
    bg.innerHTML = '<div class="nb-modal"></div>';
    document.body.appendChild(bg);
    const box = bg.querySelector(".nb-modal");
    let editing = false, newShot;   // newShot: undefined — не трогали, null — убрать, {image, thumb} — заменить

    const shut = () => {
      bg.remove();
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("paste", onPaste, true);
    };
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (editing) { editing = false; render(); } else shut();
    };
    const onPaste = (e) => {
      if (!editing) return;
      const f = imageFromPaste(e);
      if (f) { e.preventDefault(); e.stopPropagation(); pick(f); }
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("paste", onPaste, true);
    bg.addEventListener("mousedown", (e) => { if (e.target === bg && !editing) shut(); });

    async function pick(f) {
      const m = box.querySelector(".nb-ed-msg");
      if (m) m.textContent = "Сжимаю скриншот…";
      try {
        newShot = await compress(f);
        showShot(box.querySelector(".nb-shot"), newShot.image);
        if (m) m.textContent = "";
      } catch (e) { if (m) m.textContent = e.message; }
    }

    function commentsHtml() {
      const list = it.comments.map((c) => `
        <div class="nb-com" data-cid="${esc(c.id)}">
          <div class="nb-com-meta">${esc(who(c.author))} · ${esc(fmtDate(c.at, true))}
            ${c.can_delete ? '<button type="button" class="nb-com-del" title="Удалить комментарий">×</button>' : ""}</div>
          <div class="nb-com-text">${esc(c.text).replace(/\n/g, "<br>")}</div>
        </div>`).join("");
      return `
        <div class="nb-coms">
          <div class="nb-coms-title">Комментарии${it.comments.length ? ` (${it.comments.length})` : ""}</div>
          ${list}
          <div class="nb-com-add">
            <textarea class="nb-com-input" maxlength="2000" placeholder="Комментарий… (Ctrl+Enter — отправить)"></textarea>
            <button type="button" class="nb-com-send">Отправить</button>
          </div>
        </div>`;
    }

    // v3.15: категория и статус — ряды тегов, переключаются кликом (автор и админ), без «✎ Редактировать»
    function tagsHtml() {
      const dis = it.can_edit ? "" : " disabled";
      const tip = it.can_edit ? "" : ' title="Менять может автор или админ"';
      return `<div class="nb-cats nb-v-cats"${tip}>${CATS.map(([v, l]) =>
          `<button type="button" data-cat="${v}"${v === it.category ? ' class="on"' : ""}${dis}>${l}</button>`).join("")}</div>
        <div class="nb-sts"${tip}>${STATUSES.map(([v, l]) =>
          `<button type="button" data-st="${v}"${v === it.status ? ' class="on"' : ""}${dis}>${l}</button>`).join("")}</div>`;
    }

    function viewHtml() {
      return `
        <button type="button" class="nb-x" title="Закрыть (Esc)">×</button>
        <div class="nb-modal-meta">
          ${prioChip(it.priority)}
          ${esc(it.where || "")}${it.where ? " · " : ""}${esc(fmtDate(it.created_at, true))} · ${esc(it.author)}
          ${it.updated_by && it.updated_at !== it.created_at ? `<span class="nb-upd">· изм. ${esc(who(it.updated_by))} ${esc(fmtDate(it.updated_at, true))}</span>` : ""}
        </div>
        ${tagsHtml()}
        <h3>${esc(it.title)}</h3>
        ${it.description ? `<div class="nb-modal-desc">${esc(it.description).replace(/\n/g, "<br>")}</div>` : ""}
        ${it.image ? `<img class="nb-modal-img" src="${esc(it.image)}" alt="" title="Клик — крупнее / мельче">` : ""}
        ${it.can_edit ? '<div class="nb-modal-acts"><button type="button" class="nb-edit">✎ Редактировать</button><button type="button" class="nb-del">🗑 Удалить</button></div>' : ""}
        ${commentsHtml()}`;
    }

    function editHtml() {
      return `
        <div class="nb-ed">
          <div class="nb-cats">${CATS.map(([v, l]) => `<button type="button" data-cat="${v}"${v === it.category ? ' class="on"' : ""}>${l}</button>`).join("")}</div>
          <div class="nb-row3">
            <select class="nb-ed-where" title="Где">${whereOptions(it.where || "Общее")}</select>
            <select class="nb-ed-status" title="Статус">${options(STATUSES, it.status)}</select>
            <select class="nb-ed-prio" title="Приоритет">${prioOptions(it.priority)}</select>
          </div>
          <input type="text" class="nb-ed-title" maxlength="200" value="${esc(it.title)}">
          <textarea class="nb-ed-desc" maxlength="4000" placeholder="Подробности">${esc(it.description || "")}</textarea>
          <div class="nb-shot" tabindex="0" title="Ctrl+V — заменить скриншот, или перетащите файл, или кликните">${SHOT_HTML}</div>
          <div class="nb-actions">
            <span class="nb-msg nb-ed-msg"></span>
            <button type="button" class="nb-ed-cancel">Отмена</button>
            <button type="button" class="nb-save nb-ed-save">Сохранить</button>
          </div>
        </div>`;
    }

    function render() {
      box.classList.toggle("editing", editing);
      box.innerHTML = editing ? editHtml() : viewHtml();
      if (editing) wireEdit(); else wireView();
    }

    function wireView() {
      box.querySelector(".nb-x").addEventListener("click", shut);
      const big = box.querySelector(".nb-modal-img");
      if (big) big.addEventListener("click", () => box.classList.toggle("wide"));
      if (it.can_edit) {
        const quick = async (field, value, btn) => {
          if (it[field] === value) return;
          box.querySelectorAll(".nb-v-cats button, .nb-sts button").forEach((b) => { b.disabled = true; });
          try {
            const fresh = await api("/api/notebook/" + encodeURIComponent(id), jsonOpts("PATCH", { [field]: value }));
            it = Object.assign({}, it, fresh);
            render();
            if (panel && isOpen) loadList();
            changed();
          } catch (e) { alert(e.message); render(); }
        };
        box.querySelectorAll(".nb-v-cats button").forEach((b) => b.addEventListener("click", () => quick("category", b.dataset.cat, b)));
        box.querySelectorAll(".nb-sts button").forEach((b) => b.addEventListener("click", () => quick("status", b.dataset.st, b)));
      }
      const ed = box.querySelector(".nb-edit");
      if (ed) ed.addEventListener("click", () => { editing = true; newShot = undefined; render(); });
      const del = box.querySelector(".nb-del");
      if (del) del.addEventListener("click", async () => {
        if (!confirm(`Удалить запись «${it.title}»?`)) return;
        del.disabled = true;
        try {
          await api("/api/notebook/" + encodeURIComponent(id), { method: "DELETE" });
          shut();
          if (panel && isOpen) loadList();
          changed();
        } catch (e) { alert(e.message); del.disabled = false; }
      });
      const input = box.querySelector(".nb-com-input");
      const send = async () => {
        const text = input.value.trim();
        if (!text) return;
        const sb = box.querySelector(".nb-com-send");
        sb.disabled = true;
        try {
          const js = await api(`/api/notebook/${encodeURIComponent(id)}/comments`, jsonOpts("POST", { text }));
          it.comments = js.comments;
          render();
          if (panel && isOpen) loadList();
          changed();
        } catch (e) { alert(e.message); sb.disabled = false; }
      };
      box.querySelector(".nb-com-send").addEventListener("click", send);
      input.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } });
      box.querySelectorAll(".nb-com-del").forEach((b) => b.addEventListener("click", async () => {
        if (!confirm("Удалить комментарий?")) return;
        const cid = b.closest(".nb-com").dataset.cid;
        try {
          const js = await api(`/api/notebook/${encodeURIComponent(id)}/comments/${encodeURIComponent(cid)}`, { method: "DELETE" });
          it.comments = js.comments;
          render();
          changed();
        } catch (e) { alert(e.message); }
      }));
    }

    function wireEdit() {
      box.querySelectorAll(".nb-cats button").forEach((b) => b.addEventListener("click", () => {
        box.querySelectorAll(".nb-cats button").forEach((x) => x.classList.toggle("on", x === b));
      }));
      const zone = box.querySelector(".nb-shot");
      showShot(zone, it.image);
      shotZone(zone, pick, () => { newShot = null; showShot(zone, null); });
      box.querySelector(".nb-ed-cancel").addEventListener("click", () => { editing = false; render(); });
      box.querySelector(".nb-ed-title").focus();
      box.querySelector(".nb-ed-save").addEventListener("click", async () => {
        const m = box.querySelector(".nb-ed-msg");
        const title = box.querySelector(".nb-ed-title").value.trim();
        if (!title) { m.textContent = "Нужно название"; return; }
        const cat = box.querySelector(".nb-cats button.on");
        const body = {
          title,
          category: cat ? cat.dataset.cat : it.category,
          where: box.querySelector(".nb-ed-where").value,
          status: box.querySelector(".nb-ed-status").value,
          priority: box.querySelector(".nb-ed-prio").value || null,
          description: box.querySelector(".nb-ed-desc").value.trim(),
        };
        if (newShot !== undefined) {
          body.image = newShot ? newShot.image : null;
          body.thumb = newShot ? newShot.thumb : null;
        }
        const sb = box.querySelector(".nb-ed-save");
        sb.disabled = true;
        m.textContent = "Сохраняю…";
        try {
          it = await api("/api/notebook/" + encodeURIComponent(id), jsonOpts("PATCH", body));
          editing = false;
          render();
          if (panel && isOpen) loadList();
          changed();
        } catch (e) { m.textContent = e.message; sb.disabled = false; }
      });
    }

    render();
  }

  // ---------- открыть / закрыть ----------
  function open() {
    if (!panel) build();
    if (window.fleetMapPanel) window.fleetMapPanel.close();
    if (window.etaCalc) window.etaCalc.close();
    if (typeof sideMarginFix === "function") sideMarginFix();       // v3.32: левый край не скачет
    isOpen = true;
    panel.classList.add("open");
    tab.classList.add("open");
    document.body.classList.add("nb-open");                         // v3.26: открыта одна панель (карта и ⏱ закрыты выше)
    panel.setAttribute("aria-hidden", "false");
    $(".nb-where").innerHTML = whereOptions(currentWhere());
    loadList();
    setTimeout(() => $(".nb-title").focus(), 250);
  }

  function close() {
    if (!panel) return;
    isOpen = false;
    panel.classList.remove("open");
    tab.classList.remove("open");
    document.body.classList.remove("nb-open");
    panel.setAttribute("aria-hidden", "true");
  }

  function toggle() { isOpen ? close() : open(); }

  return {
    init: () => { if (!panel) build(); }, open, close, toggle, showItem,
    onChange: (f) => listeners.push(f),
    api, esc, fmtDate, who, catChip, statusChip, prioChip, forClaude, copyText,
    CATS, STATUSES, CAT_LABEL, STATUS_LABEL, WHERE, isClosed,
  };
})();

document.addEventListener("DOMContentLoaded", () => Notebook.init());
