// v2.00: общий Флот на сервере (Firestore). Грузится ДО app.js; работает с его глобальными
// rows / saveRows / renderRows / calcRow / calcAllRows / dropRow.
// Правка — по полям: отправляем только изменённые поля строки, чужие правки других полей не затираем.
// Браузер раз в 15 с спрашивает сервер "что изменилось". Копия Флота остаётся и в localStorage.
(function () {
  const PULL_MS = 15000;
  const BACKUP_KEY = "fleet-rows-local-backup";
  const IMPORTED_KEY = "fleet-imported";
  const RECALC_FIELDS = ["unit", "target", "extra", "lo", "done", "trailer", "crew", "corridor"];   // v3.15: crew — соло/экипаж; v3.32: коридор
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
    completed: new Set(),  // v3.23: id, завершённые в этой вкладке за последнюю минуту
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
    const ed = m.edited_at || m.updated_at;   // v2.02: время правки, а не блокировки
    if (m.updated_by && ed && ed !== m.created_at) out.push(`Изменил: ${shortUser(m.updated_by)}, ${fmtTs(ed)}`);
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
        if (v === null || S.completed.has(id)) { S.synced.delete(id); delete S.meta[id]; return; }   // v3.23
        S.synced.set(id, v);
        const m = S.meta[id] || {};
        if (!m.created_by) { m.created_by = S.user; m.created_at = d.now; }
        m.updated_by = S.user;
        m.updated_at = d.now;
        S.meta[id] = m;
      });
      const denied = (d.errors || []).filter((e) => /может только/.test(e.error || ""));
      if (denied.length) {                       // v2.02: удалить нельзя — вернуть строку с сервера
        toast((/диспетчер/.test(denied[0].error) ? "👤 " : "🗑 ") + denied[0].error);
        loadAll().catch(() => {});
      } else if (bad.size) { setStatus("error", d.errors[0].error); setTimeout(S.schedule, 10000); }
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
    ids.forEach((id) => { if (rows.some((r) => r.id === id && r.unit)) calcRow(id, "sync"); });
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
    S.skew = d.now - Date.now();
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
    const sig = lockSig();                      // v2.02: чья-то 🔒 появилась / снялась / истекла
    if (sig !== S.lockSig) { S.lockSig = sig; changed = true; }
    if (changed) { S.pendingRender = true; flush(); }
    if (!S.pushing) setStatus("ok");
  }

  // ---------- v2.02: 🔒 блокировка строки, права на удаление, корзина ----------
  S.skew = 0;
  S.lockedId = null;
  S.lockTimer = null;
  S.lockSig = "";
  S.admin = false;
  const serverNow = () => Date.now() + (S.skew || 0);
  const me = () => String(S.user || "").toLowerCase();

  window.fleetLockedBy = function (id) {
    if (S.mode !== "server") return "";
    const m = S.meta[key(id)];
    if (!m || !m.lock_by || String(m.lock_by).toLowerCase() === me()) return "";
    return (m.lock_until || 0) > serverNow() ? m.lock_by : "";
  };
  function lockSig() {
    return rows.filter((r) => window.fleetLockedBy(r.id)).map((r) => key(r.id) + ":" + window.fleetLockedBy(r.id)).join(",");
  }
  window.fleetCanDelete = function (row) {
    if (S.mode !== "server" || S.admin) return true;
    const m = S.meta[key(row.id)];
    const created = String((m && m.created_by) || "").toLowerCase();
    if (!created || created === "local") return true;
    const disp = String(row.disp || created).toLowerCase();
    return me() === created || me() === disp;
  };

  function toast(msg) {
    const t = document.createElement("div");
    t.className = "fleet-toast";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 4500);
  }
  window.fleetToast = toast;

  async function lockReq(id, release) {
    try {
      const r = await fetch("/api/fleet/lock", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: key(id), release: !!release }),
      });
      return { status: r.status, d: await r.json() };
    } catch (e) {
      return { status: 0, d: {} };
    }
  }
  async function acquire(id) {
    if (S.mode !== "server" || S.lockedId === key(id)) return;
    if (S.lockedId) release();
    S.lockedId = key(id);
    const { status, d } = await lockReq(id, false);
    if (status === 409) {
      S.meta[key(id)] = Object.assign(S.meta[key(id)] || {}, { lock_by: d.locked_by, lock_until: d.lock_until });
      if (S.lockedId === key(id)) S.lockedId = null;
      const a = document.activeElement;
      if (a && a.blur) a.blur();
      S.lockSig = lockSig();
      renderRows();
      toast(`🔒 Эту строку сейчас правит ${shortUser(d.locked_by)} — подождите`);
      return;
    }
    clearInterval(S.lockTimer);
    S.lockTimer = setInterval(() => { if (S.lockedId) lockReq(S.lockedId, false); }, 25000);
  }
  function release() {
    if (!S.lockedId) return;
    const id = S.lockedId;
    S.lockedId = null;
    clearInterval(S.lockTimer);
    lockReq(id, true);
  }
  document.addEventListener("focusin", (e) => {
    const tr = e.target && e.target.closest && e.target.closest("#fleet-tbody tr");
    if (tr && tr.dataset.id) acquire(tr.dataset.id);
  });
  document.addEventListener("focusout", () => {
    setTimeout(() => {
      const a = document.activeElement;
      const tr = a && a.closest && a.closest("#fleet-tbody tr");
      if (!tr && !document.querySelector(".com-ed, .trl-ed")) release();
    }, 400);
  });
  window.addEventListener("pagehide", () => {
    if (!S.lockedId) return;
    try {
      navigator.sendBeacon("/api/fleet/lock", new Blob([JSON.stringify({ id: S.lockedId, release: true })], { type: "application/json" }));
    } catch (e) { /* ignore */ }
  });

  // корзина
  function closeTrash() { const el = document.getElementById("trash-pop"); if (el) el.remove(); }
  async function openTrash(btn) {
    closeTrash();
    const pop = document.createElement("div");
    pop.id = "trash-pop";
    pop.className = "trash-pop";
    pop.innerHTML = '<div class="tp-h"><span>Корзина <span class="tp-sub">— удалённое за 7 дней</span></span><button class="tp-x" title="Закрыть">×</button></div><div class="tp-b">загружаю…</div>';
    document.body.appendChild(pop);
    const r = btn.getBoundingClientRect();
    pop.style.top = (window.scrollY + r.bottom + 4) + "px";
    pop.style.left = Math.max(8, window.scrollX + r.right - 360) + "px";
    pop.querySelector(".tp-x").addEventListener("click", closeTrash);
    const body = pop.querySelector(".tp-b");
    try {
      const res = await fetch("/api/fleet/trash");
      const d = await res.json();
      if (!d.ok) throw new Error(d.error);
      if (!d.rows.length) { body.innerHTML = '<div class="tp-empty">пусто</div>'; return; }
      body.innerHTML = d.rows.map((x) => {
        const w = x.row;
        const pts = [w.target].concat((w.extra || []).map((e) => e.target)).filter(Boolean).join(" → ");
        return `<div class="tp-r" data-id="${escapeHtml(String(w.id))}"><div class="tp-t">`
          + `<div class="tp-l"><b>${escapeHtml(w.unit || "—")}</b> <span class="tp-pts" title="${escapeHtml(pts)}">${escapeHtml(pts)}</span></div>`
          + `<div class="tp-m">удалил ${escapeHtml(shortUser(x.meta.deleted_by))}, ${fmtTs(x.meta.deleted_at)}</div></div>`
          + '<button class="tp-back" title="Вернуть строку во Флот">↩ вернуть</button></div>';
      }).join("");
      body.querySelectorAll(".tp-back").forEach((b) => b.addEventListener("click", async () => {
        const row = b.closest(".tp-r");
        b.disabled = true;
        try {
          const rr = await fetch("/api/fleet/restore", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: row.dataset.id }),
          });
          const dd = await rr.json();
          if (!dd.ok) throw new Error(dd.error);
          row.remove();
          await pull();
          toast("↩ Строка возвращена");
        } catch (e) {
          b.disabled = false;
          toast("Не удалось вернуть: " + e.message);
        }
      }));
    } catch (e) {
      body.textContent = "ошибка: " + e.message;
    }
  }
  function addTrashButton() {
    const bar = document.getElementById("sort-bar");
    if (!bar || document.getElementById("trash-btn")) return;
    const b = document.createElement("button");
    b.type = "button";
    b.id = "trash-btn";
    b.className = "trash-btn";
    b.title = "Удалённые строки за последние 7 дней — можно вернуть";
    b.textContent = "корзина";
    bar.appendChild(b);
    // v3.09: такая же кнопка в нижней панели (под таблицей)
    const bottom = document.getElementById("sort-bar-bottom");
    const bb = bottom ? b.cloneNode(true) : null;
    if (bb) { bb.removeAttribute("id"); bottom.appendChild(bb); }
    [b, bb].filter(Boolean).forEach((btn) => btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (document.getElementById("trash-pop")) closeTrash(); else openTrash(btn);
    }));
    document.addEventListener("click", (e) => { if (!e.target.closest("#trash-pop, .trash-btn")) closeTrash(); });
  }

  // ---------- v3.22: «✓ Завершён» — архив завершённых трипов (хранится всегда) ----------
  // Завершать и возвращать: хозяин трипа (диспетчер строки, иначе создатель) или назначающий.
  window.fleetCanComplete = function (row) {
    if (S.mode !== "server" || !row) return false;
    if (S.admin || S.canAssign) return true;
    const m = S.meta[key(row.id)];
    const owner = String(row.disp || (m && m.created_by) || "").toLowerCase();
    return !owner || owner === "local" || owner === me();
  };
  window.fleetComplete = async function (id) {
    try {
      const r = await fetch("/api/fleet/complete", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: String(id) }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || r.status);
      S.synced.delete(key(id));             // не слать «удаление» — строка ушла в архив, а не в корзину
      S.completed.add(key(id));             // v3.23: ответ отправки, начатой до завершения, не вернёт её в synced
      setTimeout(() => S.completed.delete(key(id)), 60000);
      delete S.meta[key(id)];
      dropRow(Number(id));
      if (!rows.length) rows.push(emptyRow());
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(rows)); } catch (e) { /* ignore */ }
      toast("✓ Трип завершён — он в «Завершённых»");
      return true;
    } catch (e) {
      toast("Не удалось завершить: " + e.message);
      return false;
    }
  };
  function closeDone() { const el = document.getElementById("done-pop"); if (el) el.remove(); }
  async function openDone(btn, q) {
    closeDone();
    const pop = document.createElement("div");
    pop.id = "done-pop";
    pop.className = "trash-pop done-pop";
    pop.innerHTML = '<div class="tp-h"><span>Завершённые <span class="tp-sub">— трипы хранятся всегда</span></span><button class="tp-x" title="Закрыть">×</button></div>'
      + '<input class="dp-q" type="search" placeholder="Поиск: машина или точка">'
      + '<div class="tp-b">загружаю…</div>';
    document.body.appendChild(pop);
    const r = btn.getBoundingClientRect();
    pop.style.top = (window.scrollY + r.bottom + 4) + "px";
    pop.style.left = Math.max(8, window.scrollX + r.right - 420) + "px";
    pop.querySelector(".tp-x").addEventListener("click", closeDone);
    const qi = pop.querySelector(".dp-q");
    qi.value = q || "";
    let qt = null;
    qi.addEventListener("input", () => { clearTimeout(qt); qt = setTimeout(() => fill(qi.value), 300); });
    const body = pop.querySelector(".tp-b");
    async function fill(text) {
      try {
        const res = await fetch("/api/fleet/done?limit=50" + (text ? "&q=" + encodeURIComponent(text) : ""));
        const d = await res.json();
        if (!d.ok) throw new Error(d.error);
        if (!d.rows.length) { body.innerHTML = '<div class="tp-empty">пусто</div>'; return; }
        body.innerHTML = d.rows.map((x) => {
          const w = x.row;
          const pts = [w.target].concat((w.extra || []).map((e) => e.target)).filter(Boolean).join(" → ");
          return `<div class="tp-r" data-id="${escapeHtml(String(w.id))}"><div class="tp-t">`
            + `<div class="tp-l"><b>${escapeHtml(w.unit || "—")}</b> <span class="tp-pts" title="${escapeHtml(pts)}">${escapeHtml(pts)}</span></div>`
            + `<div class="tp-m">завершил ${escapeHtml(shortUser(x.completed_by))}, ${fmtTs(x.completed_at)}</div></div>`
            + (x.can_reopen ? '<button class="tp-back" title="Вернуть трип во Флот">↩ вернуть</button>' : "") + "</div>";
        }).join("") + (d.total > d.rows.length ? `<div class="tp-empty">показаны ${d.rows.length} из ${d.total} — уточните поиск</div>` : "");
        body.querySelectorAll(".tp-back").forEach((b) => b.addEventListener("click", async () => {
          const row = b.closest(".tp-r");
          b.disabled = true;
          try {
            const rr = await fetch("/api/fleet/reopen", {
              method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: row.dataset.id }),
            });
            const dd = await rr.json();
            if (!dd.ok) throw new Error(dd.error);
            row.remove();
            S.completed.delete(row.dataset.id);
            await pull();
            toast("↩ Трип возвращён во Флот");
          } catch (e) {
            b.disabled = false;
            toast("Не удалось вернуть: " + e.message);
          }
        }));
      } catch (e) {
        body.textContent = "ошибка: " + e.message;
      }
    }
    fill(qi.value);
  }
  function addDoneButton() {
    const bar = document.getElementById("sort-bar");
    if (!bar || document.getElementById("done-btn")) return;
    const b = document.createElement("button");
    b.type = "button";
    b.id = "done-btn";
    b.className = "trash-btn done-btn";
    b.title = "Завершённые трипы — хранятся всегда, можно вернуть во Флот";
    b.textContent = "✓ завершённые";
    bar.appendChild(b);
    const bottom = document.getElementById("sort-bar-bottom");
    const bb = bottom ? b.cloneNode(true) : null;
    if (bb) { bb.removeAttribute("id"); bottom.appendChild(bb); }
    [b, bb].filter(Boolean).forEach((btn) => btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (document.getElementById("done-pop")) closeDone(); else openDone(btn);
    }));
    document.addEventListener("click", (e) => { if (!e.target.closest("#done-pop, .done-btn")) closeDone(); });
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
    S.skew = d.now - Date.now();
    S.admin = !!d.admin;
    S.canAssign = !!d.can_assign;   // v3.11
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
    if (window.fleetMarkBar) window.fleetMarkBar();   // v2.01: кнопки "Мои / Все"
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
    addTrashButton();
    addDoneButton();   // v3.22
    setInterval(pull, PULL_MS);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) pull(); });
  };
})();
