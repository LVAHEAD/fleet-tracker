/*
Fleet ETA Tracker — блокнот ФЕТАТ (v3.07).
Язычок 📓 у правого края на всех вкладках (на телефоне — пункт в меню ⋯) открывает панель:
форма (название, категория, описание, скриншот Ctrl+V / перетащить / выбрать файл) и последние записи.
Скриншот сжимается здесь же: JPEG до 1280 px + миниатюра 200 px. Закрыть: ×, язычок, Esc, клик мимо.
*/
const Notebook = (() => {
  const CAT_LABEL = { Bug: "Баг", Feature: "Фича", Thought: "Мысль" };
  const IMG_MAX_PX = 1280;
  const IMG_MAX_CHARS = 700000;
  const THUMB_PX = 200;
  let panel, tab, isOpen = false, shot = null;   // shot = {image, thumb}

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

  // ---------- разметка ----------
  function build() {
    tab = document.createElement("button");
    tab.type = "button";
    tab.className = "nb-tab";
    tab.title = "Блокнот: баги, фичи, мысли";
    tab.textContent = "📓";
    tab.addEventListener("click", (e) => { e.stopPropagation(); toggle(); });
    document.body.appendChild(tab);

    panel = document.createElement("aside");
    panel.className = "nb-panel";
    panel.setAttribute("aria-hidden", "true");
    panel.innerHTML = `
      <div class="nb-head">
        <b>📓 Блокнот</b>
        <button type="button" class="nb-x" title="Закрыть (Esc)">×</button>
      </div>
      <div class="nb-form">
        <div class="nb-cats">
          <button type="button" data-cat="Bug">Баг</button>
          <button type="button" data-cat="Feature">Фича</button>
          <button type="button" data-cat="Thought" class="on">Мысль</button>
        </div>
        <input type="text" class="nb-title" maxlength="200" placeholder="Коротко: что и где">
        <textarea class="nb-desc" maxlength="4000" placeholder="Подробности (необязательно)"></textarea>
        <div class="nb-shot" tabindex="0" title="Ctrl+V — вставить скриншот, или перетащите файл, или кликните">
          <span class="nb-shot-hint">Скриншот: Ctrl+V, перетащить или клик</span>
          <img class="nb-shot-img" alt="" hidden>
          <button type="button" class="nb-shot-x" title="Убрать скриншот" hidden>×</button>
        </div>
        <input type="file" class="nb-file" accept="image/*" hidden>
        <div class="nb-actions">
          <span class="nb-msg"></span>
          <button type="button" class="nb-save">Добавить</button>
        </div>
      </div>
      <div class="nb-list-head">
        <b>Последние</b>
        <select class="nb-filter">
          <option value="">все</option>
          <option value="Bug">баги</option>
          <option value="Feature">фичи</option>
          <option value="Thought">мысли</option>
        </select>
      </div>
      <div class="nb-list"></div>`;
    document.body.appendChild(panel);
    wire();
  }

  // ---------- события ----------
  function wire() {
    $(".nb-x").addEventListener("click", close);
    $(".nb-filter").addEventListener("change", loadList);
    $(".nb-save").addEventListener("click", save);
    $(".nb-title").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); save(); } });

    panel.querySelectorAll(".nb-cats button").forEach((b) => b.addEventListener("click", () => {
      panel.querySelectorAll(".nb-cats button").forEach((x) => x.classList.toggle("on", x === b));
    }));

    const zone = $(".nb-shot"), file = $(".nb-file");
    zone.addEventListener("click", (e) => { if (!e.target.closest(".nb-shot-x")) file.click(); });
    file.addEventListener("change", () => { if (file.files[0]) takeImage(file.files[0]); file.value = ""; });
    zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("hover"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("hover"));
    zone.addEventListener("drop", (e) => {
      e.preventDefault(); zone.classList.remove("hover");
      const f = e.dataTransfer && e.dataTransfer.files[0];
      if (f) takeImage(f);
    });
    $(".nb-shot-x").addEventListener("click", (e) => { e.stopPropagation(); setShot(null); });

    // Ctrl+V картинки — только пока панель открыта
    document.addEventListener("paste", (e) => {
      if (!isOpen || !e.clipboardData) return;
      for (const it of e.clipboardData.items) {
        if (it.type.startsWith("image/")) { e.preventDefault(); takeImage(it.getAsFile()); return; }
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !isOpen) return;
      if (document.querySelector(".nb-modal-bg")) return;   // сначала закрывается карточка
      close();
    });

    // клик мимо панели — закрыть (карточку записи и язычок не считаем)
    document.addEventListener("mousedown", (e) => {
      if (!isOpen) return;
      if (panel.contains(e.target) || tab.contains(e.target) || e.target.closest(".nb-modal-bg, .tabs-more-wrap")) return;
      close();
    });
  }

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

  async function takeImage(f) {
    if (!f || !f.type.startsWith("image/")) { msg("Это не картинка", true); return; }
    msg("Сжимаю скриншот…");
    const url = URL.createObjectURL(f);
    try {
      const im = await loadImg(url);
      let image = null;
      for (const [px, q] of [[IMG_MAX_PX, 0.82], [IMG_MAX_PX, 0.65], [1024, 0.6], [800, 0.55]]) {
        image = toJpeg(im, px, q);
        if (image.length <= IMG_MAX_CHARS) break;
      }
      if (image.length > IMG_MAX_CHARS) { msg("Скриншот слишком большой", true); return; }
      setShot({ image, thumb: toJpeg(im, THUMB_PX, 0.7) });
      msg(`Скриншот ${Math.round(image.length * 0.75 / 1024)} КБ`);
    } catch (e) {
      msg(e.message, true);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function setShot(s) {
    shot = s;
    const img = $(".nb-shot-img");
    img.hidden = !s;
    img.src = s ? s.image : "";
    $(".nb-shot-hint").hidden = !!s;
    $(".nb-shot-x").hidden = !s;
    if (!s) msg("");
  }

  function msg(text, isErr) {
    const m = $(".nb-msg");
    m.textContent = text || "";
    m.classList.toggle("err", !!isErr);
  }

  // ---------- сохранение ----------
  async function save() {
    const title = $(".nb-title").value.trim();
    if (!title) { msg("Нужно название", true); $(".nb-title").focus(); return; }
    const cat = (panel.querySelector(".nb-cats button.on") || {}).dataset;
    const btn = $(".nb-save");
    btn.disabled = true;
    msg("Сохраняю…");
    try {
      const r = await fetch("/api/notebook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          category: cat ? cat.cat : "Thought",
          description: $(".nb-desc").value.trim(),
          image: shot ? shot.image : null,
          thumb: shot ? shot.thumb : null,
        }),
      });
      const js = await r.json().catch(() => ({}));
      if (!r.ok) { msg(js.error || `Ошибка ${r.status}`, true); return; }
      $(".nb-title").value = "";
      $(".nb-desc").value = "";
      setShot(null);
      msg("✓ Добавлено");
      setTimeout(() => { if ($(".nb-msg").textContent === "✓ Добавлено") msg(""); }, 2500);
      loadList();
    } catch (e) {
      msg("Нет связи с сервером", true);
    } finally {
      btn.disabled = false;
    }
  }

  // ---------- список ----------
  async function loadList() {
    const box = $(".nb-list");
    const cat = $(".nb-filter").value;
    try {
      const r = await fetch("/api/notebook?limit=30" + (cat ? "&category=" + encodeURIComponent(cat) : ""));
      const js = await r.json().catch(() => ({}));
      if (!r.ok) { box.innerHTML = `<div class="nb-empty err">${esc(js.error || "Ошибка " + r.status)}</div>`; return; }
      renderList(js.items || []);
    } catch (e) {
      box.innerHTML = '<div class="nb-empty err">Нет связи с сервером</div>';
    }
  }

  function renderList(items) {
    const box = $(".nb-list");
    if (!items.length) { box.innerHTML = '<div class="nb-empty">Записей пока нет</div>'; return; }
    box.innerHTML = items.map((it) => `
      <div class="nb-item" data-id="${esc(it.id)}">
        ${it.thumb ? `<img class="nb-thumb" src="${esc(it.thumb)}" alt="">` : '<div class="nb-thumb nb-thumb-empty"></div>'}
        <div class="nb-item-body">
          <div class="nb-item-title">${esc(it.title)}</div>
          <div class="nb-item-meta">
            <span class="nb-cat nb-cat-${esc(it.category)}">${esc(CAT_LABEL[it.category] || it.category)}</span>
            ${esc(fmtDate(it.created_at))} · ${esc(who(it.author))}
          </div>
        </div>
      </div>`).join("");
    box.querySelectorAll(".nb-item").forEach((el) => el.addEventListener("click", () => showItem(el.dataset.id)));
  }

  // ---------- карточка записи ----------
  async function showItem(id) {
    let it;
    try {
      const r = await fetch("/api/notebook/" + encodeURIComponent(id));
      it = await r.json();
      if (!r.ok) { msg(it.error || `Ошибка ${r.status}`, true); return; }
    } catch (e) { msg("Нет связи с сервером", true); return; }

    const bg = document.createElement("div");
    bg.className = "nb-modal-bg";
    bg.innerHTML = `
      <div class="nb-modal">
        <button type="button" class="nb-x" title="Закрыть (Esc)">×</button>
        <div class="nb-modal-meta">
          <span class="nb-cat nb-cat-${esc(it.category)}">${esc(CAT_LABEL[it.category] || it.category)}</span>
          ${esc(fmtDate(it.created_at, true))} · ${esc(it.author)}
        </div>
        <h3>${esc(it.title)}</h3>
        ${it.description ? `<div class="nb-modal-desc">${esc(it.description).replace(/\n/g, "<br>")}</div>` : ""}
        ${it.image ? `<img class="nb-modal-img" src="${esc(it.image)}" alt="" title="Клик — крупнее / мельче">` : ""}
        ${it.can_edit ? '<div class="nb-modal-acts"><button type="button" class="nb-del">🗑 Удалить</button></div>' : ""}
      </div>`;
    document.body.appendChild(bg);
    const shut = () => { bg.remove(); document.removeEventListener("keydown", onKey, true); };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); shut(); } };
    document.addEventListener("keydown", onKey, true);
    bg.addEventListener("click", (e) => { if (e.target === bg || e.target.closest(".nb-x")) shut(); });
    const big = bg.querySelector(".nb-modal-img");
    if (big) big.addEventListener("click", () => bg.querySelector(".nb-modal").classList.toggle("wide"));
    const del = bg.querySelector(".nb-del");
    if (del) del.addEventListener("click", async () => {
      if (!confirm(`Удалить запись «${it.title}»?`)) return;
      del.disabled = true;
      try {
        const r = await fetch("/api/notebook/" + encodeURIComponent(id), { method: "DELETE" });
        const js = await r.json().catch(() => ({}));
        if (!r.ok) { alert(js.error || `Ошибка ${r.status}`); del.disabled = false; return; }
        shut();
        loadList();
      } catch (e) { alert("Нет связи с сервером"); del.disabled = false; }
    });
  }

  // ---------- открыть / закрыть ----------
  function open() {
    if (!panel) build();
    isOpen = true;
    panel.classList.add("open");
    tab.classList.add("open");
    panel.setAttribute("aria-hidden", "false");
    loadList();
    setTimeout(() => $(".nb-title").focus(), 250);
  }

  function close() {
    if (!panel) return;
    isOpen = false;
    panel.classList.remove("open");
    tab.classList.remove("open");
    panel.setAttribute("aria-hidden", "true");
  }

  function toggle() { isOpen ? close() : open(); }

  return { init: () => { if (!panel) build(); }, open, close, toggle };
})();

document.addEventListener("DOMContentLoaded", () => Notebook.init());
