/*
km-bell.js — напоминание «до точки осталось N км» (v3.334).
Колокольчик 🔔 справа в поле «Дата» каждой точки (серый — нет напоминания, синий — есть). Клик по колокольчику или Ctrl+клик по полю —
карточка: пороги 500 / 300 / 100 км, звук. Хранится в точке: `bell = {th: [500, 300], sound: true, fired: {"500": "<хозяин>"}, snz: {"500": ms}}`
(для ① — в строке, для ②+ — в `row.extra[i]`), уходит в Firestore вместе со строкой (`saveRows`).
Когда КМ до точки (по расчёту строки) упал до порога — всплывающая карточка в углу: «Ок» / «Отложить на 15 мин», звук и системное
уведомление (вкладка в фоне). Видит только хозяин трипа (`rowIsMine`); при смене хозяина «уже показано» не считается.
Если вкладка была закрыта — карточка покажется после первого расчёта при открытии. Опирается на глобалы app.js:
rows, lastCalcText, saveRows, STOP_NUM, uiZoom, escapeHtml, rowIsMine, rowDisp.
*/
(function () {
  if (typeof document === "undefined") return;
  const TH = [500, 300, 100], SNOOZE_MS = 15 * 60 * 1000;
  const BELL = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M12 22a2.2 2.2 0 0 0 2.2-2.2h-4.4A2.2 2.2 0 0 0 12 22zm6.5-6.2V11c0-3.2-1.7-5.8-4.7-6.5V3.8a1.8 1.8 0 0 0-3.6 0v.7C7.2 5.2 5.5 7.8 5.5 11v4.8L3.7 17.6v1h16.6v-1l-1.8-1.8z"/></svg>';
  const shown = new Set();   // уже показанные в этой вкладке: row.id/k/порог
  let pop = null, stack = null;

  const esc = (s) => (typeof escapeHtml === "function" ? escapeHtml(s) : String(s));
  const pointOf = (row, k) => (k === 0 ? row : (row.extra || [])[k - 1]);
  const owner = (row) => (typeof rowDisp === "function" ? rowDisp(row) || "" : "");
  const mine = (row) => typeof rowIsMine !== "function" || rowIsMine(row);

  // ---------- колокольчик у поля «Дата» ----------
  function decorate(tr, row) {
    if (!tr || !row) return;
    const inputs = [tr.querySelector(".delivery-input")].concat([...tr.querySelectorAll(".xd-input")]);
    inputs.forEach((inp, k) => {
      if (!inp || (inp.parentNode && inp.parentNode.classList.contains("kb-w"))) return;
      const w = document.createElement("span");
      w.className = "kb-w" + (k > 0 ? " kb-x" : "");
      inp.parentNode.insertBefore(w, inp);
      w.appendChild(inp);
      const b = document.createElement("button");
      b.type = "button";
      b.className = "kb-b";
      b.dataset.k = String(k);
      b.innerHTML = BELL;
      w.appendChild(b);
      paint(b, pointOf(row, k));
      b.addEventListener("click", (e) => { e.stopPropagation(); openSetup(b, row.id, k); });
      inp.addEventListener("click", (e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); openSetup(b, row.id, k); } });
    });
  }
  function paint(b, p) {
    const on = !!(p && p.bell && p.bell.th && p.bell.th.length);
    b.classList.toggle("on", on);
    b.title = on ? `Напоминание: за ${p.bell.th.join(" / ")} км до точки (клик — изменить)` : "Напоминание «до точки N км» (клик или Ctrl+клик по полю)";
  }

  // ---------- карточка настройки ----------
  function closeSetup() { if (pop) { pop.remove(); pop = null; } }
  function openSetup(anchor, id, k) {
    closeSetup();
    const row = (window.rows || (typeof rows !== "undefined" ? rows : [])).find((r) => String(r.id) === String(id));
    const p = row && pointOf(row, k);
    if (!p) return;
    const bl = p.bell || { th: [], sound: true };
    pop = document.createElement("div");
    pop.className = "trl-ed kb-pop";
    pop.innerHTML = `<div class="trl-ed-t">🔔 Напоминание: до точки ${esc((typeof STOP_NUM !== "undefined" && STOP_NUM[k + 1]) || k + 1)} ${esc(p.target || "")}</div>`
      + `<div class="kb-th">${TH.map((t) => `<label><input type="checkbox" class="kb-t" value="${t}"${(bl.th || []).includes(t) ? " checked" : ""}> ${t} км</label>`).join("")}</div>`
      + `<label class="kb-snd"><input type="checkbox" class="kb-s"${bl.sound === false ? "" : " checked"}> звук и уведомление браузера</label>`
      + `<div class="trl-ed-b"><button class="trl-ed-cancel" data-a="off">Снять</button><button class="trl-ed-ok" data-a="ok">Сохранить</button></div>`;
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect(), z = typeof uiZoom === "function" ? uiZoom() : 1;
    pop.style.width = "250px";
    pop.style.top = Math.max(8, Math.min(window.innerHeight - pop.offsetHeight * z - 8, r.bottom + 4)) / z + "px";
    pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth * z - 8)) / z + "px";
    pop.addEventListener("mousedown", (e) => e.stopPropagation());
    pop.addEventListener("click", (e) => {
      const a = e.target.closest("button");
      if (!a) return;
      if (a.dataset.a === "off") delete p.bell;
      else {
        const th = [...pop.querySelectorAll(".kb-t:checked")].map((x) => Number(x.value)).sort((x, y) => y - x);
        const sound = pop.querySelector(".kb-s").checked;
        if (th.length) p.bell = { th, sound, fired: {}, snz: {} }; else delete p.bell;
        if (th.length && sound && window.Notification && Notification.permission === "default") { try { Notification.requestPermission(); } catch (x) { /* ignore */ } }
      }
      closeSetup();
      document.querySelectorAll(`#fleet-tbody tr[data-id="${id}"] .kb-b[data-k="${k}"]`).forEach((b) => paint(b, p));
      if (typeof saveRows === "function") saveRows();
      check(id);
    });
  }
  document.addEventListener("mousedown", closeSetup);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSetup(); });

  // ---------- срабатывание ----------
  function kmOf(c, k) {
    if (!c) return null;
    const at = c.ecAt || 0;
    if (k < at) return null;
    if (k === at) return c.ecKm != null ? Number(c.ecKm) : null;
    const ce = c.extra && c.extra[k - 1];
    return ce && !ce.done && ce.dist_km != null ? Number(ce.dist_km) : null;
  }
  function etaOf(c, k) {
    if (k === (c.ecAt || 0)) return c.etaStr || "";
    const ce = c.extra && c.extra[k - 1];
    return ce ? ce.eta_tacho || ce.eta_local || "" : "";
  }
  function check(id) {
    const list = window.rows || (typeof rows !== "undefined" ? rows : []);
    const row = list.find((r) => String(r.id) === String(id));
    const c = typeof lastCalcText !== "undefined" ? lastCalcText[id] : null;
    if (!row || !c || !mine(row)) return;
    const ow = owner(row), now = Date.now();
    const n = 1 + (row.extra || []).length;
    for (let k = 0; k < n; k++) {
      const p = pointOf(row, k), bl = p && p.bell;
      if (!bl || !bl.th || !bl.th.length) continue;
      const km = kmOf(c, k);
      if (km == null) continue;
      const hit = bl.th.filter((t) => km <= t);
      if (!hit.length) continue;
      const t = Math.min.apply(null, hit);
      const fired = bl.fired || {};
      if (hit.every((x) => fired[x] === ow)) continue;                 // уже показано этому хозяину
      if ((bl.snz && bl.snz[t] || 0) > now) continue;                  // отложено
      const key = id + "/" + k + "/" + t;
      if (shown.has(key)) continue;
      shown.add(key);
      showCard(row, k, p, t, km, etaOf(c, k), hit);
    }
  }

  // ---------- карточка-напоминание ----------
  function beep() {
    try {
      const A = window.AudioContext || window.webkitAudioContext;
      if (!A) return;
      const ctx = new A(), o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.value = 880; g.gain.value = 0.15;
      o.connect(g); g.connect(ctx.destination); o.start();
      setTimeout(() => { o.frequency.value = 660; }, 180);
      setTimeout(() => { o.stop(); ctx.close(); }, 420);
    } catch (e) { /* ignore */ }
  }
  function showCard(row, k, p, t, km, eta, hit) {
    if (!stack) { stack = document.createElement("div"); stack.className = "kb-stack"; document.body.appendChild(stack); }
    const num = (typeof STOP_NUM !== "undefined" && STOP_NUM[k + 1]) || k + 1, unit = row.unit || "";
    const card = document.createElement("div");
    card.className = "trl-ed kb-card";
    card.innerHTML = `<div class="kb-h">🔔 ${esc(unit)} — до точки ${esc(num)} ≤ ${t} км</div>`
      + `<div class="kb-l"><b>${esc(p.target || "")}</b></div>`
      + `<div class="kb-l">Осталось ${Math.round(km)} км${eta ? ` · ETA ${esc(eta)}` : ""}</div>`
      + (p.delivery ? `<div class="kb-l">Окно «Дата»: ${esc(p.delivery)}</div>` : "")
      + `<div class="kb-hint">Пора звонить клиенту / согласовывать окно.</div>`
      + `<div class="trl-ed-b"><button class="trl-ed-cancel" data-a="snz">Отложить на 15 мин</button><button class="trl-ed-ok" data-a="ok">Ок</button></div>`;
    stack.appendChild(card);
    const bl = p.bell;
    if (bl.sound !== false) {
      beep();
      if (document.hidden && window.Notification && Notification.permission === "granted") {
        try { new Notification(`${unit}: до точки ${num} ≤ ${t} км`, { body: `${p.target || ""} · осталось ${Math.round(km)} км${eta ? " · ETA " + eta : ""}` }); } catch (e) { /* ignore */ }
      }
    }
    card.addEventListener("click", (e) => {
      const a = e.target.closest("button");
      if (!a) return;
      const b2 = p.bell;
      if (b2) {
        if (a.dataset.a === "ok") { b2.fired = b2.fired || {}; hit.forEach((x) => { b2.fired[x] = owner(row); }); }
        else { b2.snz = b2.snz || {}; b2.snz[t] = Date.now() + SNOOZE_MS; shown.delete(row.id + "/" + k + "/" + t); }
        if (typeof saveRows === "function") saveRows();
      }
      card.remove();
    });
  }

  window.kmBellDecorate = decorate;
  window.kmBellCheck = check;
})();
