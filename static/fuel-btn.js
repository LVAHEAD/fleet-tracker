/* v3.136: кнопка ⛽ в верхней панели — сверка списка АЗС (инструкция по заправкам) с группой Mapon
   «Actual Petrol Station» (GET /api/fuel-stations, только чтение).
   v3.139: создание недостающих — POST /api/fuel-stations/create: сначала один пробный объект (с проверкой по Mapon),
   потом, после подтверждения в карточке, остальные. Системных confirm() нет. */
(function () {
  const btn = document.getElementById("fuel-btn");
  if (!btn) return;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let pop = null;
  let lastRep = null;

  function block(title, items, line) {
    if (!items || !items.length) return "";
    return `<details class="fuel-det"><summary>${esc(title)} (${items.length})</summary>` +
      items.map((x) => `<div>${line(x)}</div>`).join("") + `</details>`;
  }

  async function load(refresh) {
    const st = pop.querySelector(".fuel-status");
    const ls = pop.querySelector(".fuel-lists");
    st.textContent = "Читаю список АЗС и Mapon…";
    try {
      const res = await fetch("/api/fuel-stations" + (refresh ? "?refresh=1" : ""));
      const d = await res.json();
      if (d.error) { st.innerHTML = `<span class="fuel-err">${esc(d.error)}</span>`; ls.innerHTML = ""; return; }
      lastRep = d;
      const c = d.counts || {};
      let html = `В списке с GPS: <b>${c.list_gps || 0}</b> <span class="fuel-dim">(таблица: ${esc(d.sheet_updated || "—")}, прочитана ${esc(d.loaded_at || "")})</span>`;
      if (d.group) html += `<br>Группа Mapon «${esc(d.group.name)}»: <b>${d.group.count}</b> объектов`;
      if (d.mapon_error) html += `<br><span class="fuel-err">${esc(d.mapon_error)}</span>`;
      else html += `<br>Совпадает (до ${d.radius_m} м): <b>${c.matched}</b> · создать: <b>${c.to_create}</b> · не работает: ${c.not_working} · лишние в Mapon: ${c.extra}`;
      html += `<br><span class="fuel-dim">Без GPS (только названия): ${c.no_gps || 0}.</span>`;
      if (d.sample) html += `<br><span class="fuel-dim">Образец формы: «${esc(d.sample.name)}» (${esc(String(d.sample.wkt).slice(0, 70))}…)</span>`;
      st.innerHTML = html;
      const act = pop.querySelector(".fuel-act");
      act.innerHTML = "";
      if (!d.mapon_error && d.sample && c.to_create > 0) {
        act.innerHTML = `<button type="button" class="fuel-go fuel-trial">Создать 1 пробную</button><div class="fuel-res"></div>`;
        act.querySelector(".fuel-trial").addEventListener("click", () => create("trial"));
      } else if (!d.mapon_error && c.to_create > 0 && !d.sample) {
        act.innerHTML = `<span class="fuel-dim">Нет образца-многоугольника в группе — форму не с чего повторить.</span>`;
      }
      const line = (x) => `${esc(x.network ? x.network + " · " : "")}${esc(x.name)} — ${esc(x.gps)}`;
      ls.innerHTML =
        block("Будет создано", d.to_create, (x) => `${esc(x.obj_name)}`) +
        block("Не работает (не создаём)", d.not_working, line) +
        block("Совпадает с Mapon", d.matched, (x) => `${line(x)} → ${esc(x.mapon_name)} (${x.dist_m} м)`) +
        block("Есть в Mapon, нет в списке", d.extra, (x) => `${esc(x.name)} — ${esc(x.gps)}`) +
        block("Без GPS — только названия", d.no_gps, (x) => `${esc(x.country)} / ${esc(x.name)} — ${esc(x.card)}`);
    } catch (e) {
      st.innerHTML = `<span class="fuel-err">Не удалось получить список АЗС.</span>`;
    }
  }

  async function create(mode) {
    const act = pop.querySelector(".fuel-act");
    const res = act.querySelector(".fuel-res");
    act.querySelectorAll("button").forEach((b) => { b.disabled = true; });
    res.textContent = mode === "trial" ? "Создаю пробный объект…" : "Создаю…";
    let d;
    try {
      const r = await fetch("/api/fuel-stations/create", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, confirm: true }) });
      d = await r.json();
    } catch (e) { d = { error: "нет связи с сервером" }; }
    if (d.error) { res.innerHTML = `<span class="fuel-err">${esc(d.error)}</span>`; act.querySelectorAll("button").forEach((b) => { b.disabled = false; }); return; }
    const bad = (d.failed || []).map((f) => `<div class="fuel-err">${esc(f.name)} — ${esc(f.error)}</div>`).join("");
    if (mode === "trial") {
      const ok = d.verified;
      res.innerHTML = `Создан: <b>${esc((d.created || [])[0] || "—")}</b><br>` +
        (ok ? `<span class="fuel-ok">Проверено: ${esc(d.verify_note)}.</span>` : `<span class="fuel-err">Не подтверждено: ${esc(d.verify_note || "")}. Проверьте объект в Mapon.</span>`) + bad;
      if (ok && d.left > 0) {
        res.innerHTML += `<div class="fuel-conf">Создать остальные <b>${d.left}</b> по этому образцу? Удалять объекты аппа не умеет.
          <div class="fuel-foot"><button type="button" class="fuel-go fuel-all">Да, создать ${d.left}</button><button type="button" class="fuel-go fuel-no">Нет</button></div></div>`;
        res.querySelector(".fuel-all").addEventListener("click", () => create("all"));
        res.querySelector(".fuel-no").addEventListener("click", () => load(true));
      }
      return;
    }
    res.innerHTML = `Создано: <b>${(d.created || []).length}</b>, осталось: ${d.left}` + bad;
    setTimeout(() => load(true), 1500);
  }

  function close() {
    if (pop) { pop.remove(); pop = null; }
    document.removeEventListener("mousedown", onOutside, true);
    document.removeEventListener("keydown", onKey, true);
  }
  function onOutside(e) { if (pop && !pop.contains(e.target) && e.target !== btn) close(); }
  function onKey(e) { if (e.key === "Escape") close(); }

  function open() {
    pop = document.createElement("div");
    pop.className = "fuel-pop";
    pop.innerHTML = `<div class="fuel-head"><b>АЗС ↔ Mapon</b><button type="button" class="fuel-x" title="Закрыть">×</button></div>
      <div class="fuel-status">…</div>
      <div class="fuel-act"></div>
      <div class="fuel-lists"></div>
      <div class="fuel-foot"><button type="button" class="fuel-go">↻ Сверить АЗС</button></div>`;
    document.body.appendChild(pop);
    const r = btn.getBoundingClientRect();
    pop.style.top = Math.round(r.bottom + 6) + "px";
    pop.style.right = Math.max(8, Math.round(window.innerWidth - r.right)) + "px";
    pop.querySelector(".fuel-x").addEventListener("click", close);
    const go = pop.querySelector(".fuel-go");
    go.addEventListener("click", async () => {
      go.disabled = true; go.textContent = "Сверяю…";
      await load(true);
      go.disabled = false; go.textContent = "↻ Сверить АЗС";
    });
    document.addEventListener("mousedown", onOutside, true);
    document.addEventListener("keydown", onKey, true);
    load(false);
  }

  btn.addEventListener("click", () => { if (pop) close(); else open(); });
})();
