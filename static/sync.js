// v2.00: общий Флот на сервере (Firestore). Грузится ДО app.js; работает с его глобальными
// rows / saveRows / renderRows / calcRow / calcAllRows / dropRow.
// Правка — по полям: отправляем только изменённые поля строки, чужие правки других полей не затираем.
// Браузер раз в 15 с спрашивает сервер "что изменилось". Копия Флота остаётся и в localStorage.
(function () {
  const PULL_MS = 15000;
  const BACKUP_KEY = "fleet-rows-local-backup";
  const IMPORTED_KEY = "fleet-imported";
  const RECALC_FIELDS = ["unit", "target", "extra", "lo", "done", "trailer"];
  const PERSONAL = ["open"];   // свёрнуто/развёрнуто — у каждого своё, на сервер не шлём

  const S = {
    mode: "init",          // init | server | local
    synced: new Map(),     // id -> {поле: JSON} — что, по нашим данным, лежит на сервере
    meta: {},              // id -> {created_by, created_at, updated_by, updated_at}
    since: 0,
    user: null,
    pushing: false,
    again: false,
    timer: null,
    pendingRender: false,
    pendingRecalc: new Set(),
  };
  window.fleetSync = S;

  // Уникальный id строки на всех: мс * 1000 + случайное (влезает в безопасное целое JS)
  window.newRowId = function () {
    return Date.now() * 1000 + Math.floor(Math.random() * 1000);
  };

  function fieldsOf(row) {
    const o = {};
    Object.keys(row || {}).forEach((k) => {
      if (k === "id" || k.charAt(0) === "_" || row[k] === undefined || PERSONAL.includes(k)) return;
      o[k] = JSON.stringify(row[k]);
    });
    return o;
  }
  function isBlank(row) {
    return !row.unit && !row.target && !row.note && !row.delivery && !row.com && !(row.extra && row.extra.length);
  }
  const key = (id) => String(id);
  const shortUser = (u) => String(u || "").split("@")[0];

  function fmtTs(ms) {
    if (!ms) return "";
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  // Подсказка на номере машины: кто создал / кто последний менял
  window.fleetMetaTitle = function (id) {
    const m = S.meta[key(id)];
    if (!m) return "";
    const out = [];
    if (m.created_by) out.push(`Создал: ${shortUser(m.created_by)}, ${fmtTs(m.created_at)}`);
    if (m.updated_by && m.updated_at && m.updated_at !== m.created_at) out.push(`Изменил: ${shortUser(m.updated_by)}, ${fmtTs(m.updated_at)}`);
    return out.join("\n");
  };

  // ---------- индикатор в шапке ----------
  function statusEl() {
    let el = document.getElementById("sync-status");
    if (!el) {
      const h1 = document.querySelector("h1");
      if (!h1) return null;
      el = document.createElement("span");
      el.id = "sync-status";
      el.className = "sync-status";
      h1.appendChild(el);
    }
    return el;
  }
  function setStatus(st, msg) {
    const el = statusEl();
    if (!el) return;
    const T = {
      loading: ["⏳", "Загружаю общий Флот…"],
      ok: ["☁", "Общий Флот: изменения видят все, обновление раз в 15 с"],
      saving: ["☁…", "Сохраняю…"],
      error: ["⚠☁", "Не удалось сохранить на сервер — повторю сам. " + (msg || "")],
      local: ["⚠ локально", "Сервер Флота недоступен — работаю только в этом браузере. " + (msg || "")],
    }[st] || ["", ""];
    el.textContent = T[0];
    el.title = T[1];
    el.dataset.st = st;
  }

  // ---------- отправка изменений ----------
  S.schedule = function () {
    if (S.mode !== "server") return;
    clearTimeout(S.timer);
    S.timer = setTimeout(push, 500);
  };

  async function push() {
    if (S.mode !== "server") return;
    if (S.pushing) { S.again = true; return; }
    const ops = [];
    const next = new Map();
    const seen = new Set();
    rows.forEach((row) => {
      const id = key(row.id);
      seen.add(id);
      const cur = fieldsOf(row);
      const old = S.synced.get(id);
      if (!old) {
        if (isBlank(row)) return;            // пустую строку не шлём, пока в неё ничего не ввели
        const set = {};
        Object.keys(cur).forEach((k) => { set[k] = JSON.parse(cur[k]); });
        ops.push({ id: row.id, new: true, set });
        next.set(id, cur);
        return;
      }
      const set = {};
      const unset = [];
      Object.keys(cur).forEach((k) => { if (cur[k] !== old[k]) set[k] = JSON.parse(cur[k]); });
      Object.keys(old).forEach((k) => { if (!(k in cur)) unset.push(k); });
      if (Object.keys(set).length || unset.length) {
        ops.push({ id: row.id, set, unset });
        next.set(id, cur);
      }
    });
    S.synced.forEach((_, id) => {
      if (!seen.has(id)) { ops.push({ id, delete: true }); next.set(id, null); }
    });
    if (!ops.length) return;

    S.pushing = true;
    setStatus("saving");
    try {
      const r = await fetch("/api/fleet/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ops }),
      });
      const d = await r.json();
      if (!r.ok && r.status !== 207) throw new Error(d.error || (d.errors && d.errors[0] && d.errors[0].error) || r.status);
      const bad = new Set((d.errors || []).map((e) => key(e.id)));
      next.forEach((v, id) => {
        if (bad.has(id)) return;
        if (v === null) { S.synced.delete(id); delete S.meta[id]; return; }
        S.synced.set(id, v);
        const m = S.meta[id] || {};
        if (!m.created_by) { m.created_by = S.user; m.created_at = d.now; }
        m.updated_by = S.user;
        m.updated_at = d.now;
        S.meta[id] = m;
      });
      if (bad.size) { setStatus("error", d.errors[0].error); setTimeout(S.schedule, 10000); }
      else setStatus("ok");
    } catch (e) {
      setStatus("error", e.message);
      setTimeout(S.schedule, 10000);
    } finally {
      S.pushing = false;
      if (S.again) { S.again = false; S.schedule(); }
    }
  }

  // ---------- получение чужих изменений ----------
  function typing() {
    const a = document.activeElement;
    return !!(a && a.closest && a.closest("#fleet-tbody") && (a.tagName === "INPUT" || a.tagName === "TEXTAREA"))
      || !!document.querySelector(".com-ed");
  }
  function flush() {
    if (!S.pendingRender || typing()) return;
    S.pendingRender = false;
    renderRows();
    const ids = Array.from(S.pendingRecalc);
    S.pendingRecalc.clear();
    ids.forEach((id) => { if (rows.some((r) => r.id === id && r.unit)) calcRow(id); });
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(rows)); } catch (e) { /* ignore */ }
  }
  document.addEventListener("focusout", () => setTimeout(flush, 50));

  async function pull() {
    if (S.mode !== "server" || document.hidden) return;
    let d;
    try {
      const r = await fetch("/api/fleet?since=" + S.since);
      d = await r.json();
      if (!d.ok) throw new Error(d.error);
    } catch (e) {
      setStatus("error", e.message);
      return;
    }
    S.since = d.now;
    let changed = false;
    (d.changes || []).forEach((ch) => {
      const id = key(ch.row.id);
      const idx = rows.findIndex((r) => key(r.id) === id);
      if (ch.deleted) {
        if (idx >= 0 && S.synced.has(id)) { dropRow(rows[idx].id); changed = true; }
        S.synced.delete(id);
        delete S.meta[id];
        return;
      }
      S.meta[id] = ch.meta;
      const remote = fieldsOf(ch.row);
      if (idx < 0) {
        if (S.synced.has(id)) return;          // мы её только что удалили — удаление уйдёт с push
        rows.push(JSON.parse(JSON.stringify(ch.row)));
        S.synced.set(id, remote);
        S.pendingRecalc.add(ch.row.id);
        changed = true;
        return;
      }
      const row = rows[idx];
      const old = S.synced.get(id) || {};
      const local = fieldsOf(row);
      let rc = false;
      new Set([...Object.keys(remote), ...Object.keys(old)]).forEach((k) => {
        if (remote[k] === old[k]) return;                           // это поле никто не менял
        if (local[k] !== old[k] && local[k] !== remote[k]) return;  // своя неотправленная правка — главнее
        if (local[k] === remote[k]) return;
        if (k in remote) row[k] = JSON.parse(remote[k]); else delete row[k];
        changed = true;
        if (RECALC_FIELDS.includes(k)) rc = true;
      });
      S.synced.set(id, remote);
      if (rc) S.pendingRecalc.add(row.id);
    });
    // пустая строка-заглушка, если другой удалил всё
    if (!rows.length) { rows.push(emptyRow()); changed = true; }
    if (changed) { S.pendingRender = true; flush(); }
    if (!S.pushing) setStatus("ok");
  }

  // ---------- перенос Флота из браузера ----------
  function importBanner(localRows) {
    let el = document.getElementById("fleet-import");
    if (el) el.remove();
    const cand = localRows.filter((r) => !isBlank(r));
    let imported = false;
    try { imported = localStorage.getItem(IMPORTED_KEY) === "1"; } catch (e) { /* ignore */ }
    if (!cand.length || imported) return;
    const tbl = document.getElementById("fleet-table");
    if (!tbl) return;
    el = document.createElement("div");
    el.id = "fleet-import";
    el.className = "fleet-import";
    el.innerHTML = `☁ Флот теперь общий. В этом браузере осталось <b>${cand.length}</b> строк(и) из старого Флота.
      <button class="fi-go">📤 Перенести на сервер</button>
      <button class="fi-no" title="Старые строки останутся только в копии браузера">Не переносить</button>
      <span class="fi-msg"></span>`;
    tbl.parentNode.insertBefore(el, tbl);
    el.querySelector(".fi-no").addEventListener("click", () => {
      try { localStorage.setItem(IMPORTED_KEY, "1"); } catch (e) { /* ignore */ }
      el.remove();
    });
    el.querySelector(".fi-go").addEventListener("click", async () => {
      const msg = el.querySelector(".fi-msg");
      msg.textContent = "переношу…";
      try {
        const payload = cand.map((r) => { const o = JSON.parse(JSON.stringify(r)); delete o.id; return o; });
        const r = await fetch("/api/fleet/import", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows: payload }),
        });
        const d = await r.json();
        if (!d.ok) throw new Error(d.error);
        try { localStorage.setItem(IMPORTED_KEY, "1"); } catch (e) { /* ignore */ }
        msg.textContent = `перенесено ${d.added}` + (d.skipped ? `, пропущено ${d.skipped} (уже есть на сервере / пустые)` : "");
        await loadAll();
        setTimeout(() => el.remove(), 6000);
      } catch (e) {
        msg.textContent = "ошибка: " + e.message;
      }
    });
  }

  async function loadAll() {
    const r = await fetch("/api/fleet");
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || r.status);
    S.user = d.user;
    S.since = d.now;
    S.synced.clear();
    S.meta = {};
    const mine = {};
    rows.forEach((row) => { PERSONAL.forEach((k) => { if (row[k] !== undefined) (mine[key(row.id)] = mine[key(row.id)] || {})[k] = row[k]; }); });
    rows.slice().forEach((row) => dropRow(row.id));   // убрать маркеры старых строк
    rows = d.rows.map((x) => Object.assign(x.row, mine[key(x.row.id)] || {}));
    d.rows.forEach((x) => {
      S.synced.set(key(x.row.id), fieldsOf(x.row));
      S.meta[key(x.row.id)] = x.meta;
    });
    if (!rows.length) rows.push(emptyRow());
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(rows)); } catch (e) { /* ignore */ }
    renderRows();
    calcAllRows();
  }

  S.start = async function () {
    setStatus("loading");
    const localRows = rows.slice();
    try {
      if (localRows.some((r) => !isBlank(r)) && !localStorage.getItem(BACKUP_KEY)) {
        localStorage.setItem(BACKUP_KEY, JSON.stringify(localRows));   // страховочная копия старого Флота
      }
    } catch (e) { /* ignore */ }
    try {
      S.mode = "server";
      await loadAll();
    } catch (e) {
      S.mode = "local";
      rows = localRows;
      renderRows();
      calcAllRows();
      setStatus("local", e.message);
      return;
    }
    setStatus("ok");
    let backup = localRows;
    try { backup = JSON.parse(localStorage.getItem(BACKUP_KEY) || "null") || localRows; } catch (e) { /* ignore */ }
    importBanner(backup);
    setInterval(pull, PULL_MS);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) pull(); });
  };
})();
