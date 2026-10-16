/* v3.136: кнопка ⛽ в верхней панели — сверка списка АЗС (инструкция по заправкам) с группой Mapon
   «Actual Petrol Station». Только чтение: GET /api/fuel-stations, в Mapon ничего не пишем. */
(function () {
  const btn = document.getElementById("fuel-btn");
  if (!btn) return;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let pop = null;
  let loaded = false;

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
      const c = d.counts || {};
      let html = `В списке с GPS: <b>${c.list_gps || 0}</b> <span class="fuel-dim">(таблица: ${esc(d.sheet_updated || "—")}, прочитана ${esc(d.loaded_at || "")})</span>`;
      if (d.group) html += `<br>Группа Mapon «${esc(d.group.name)}»: <b>${d.group.count}</b> объектов`;
      if (d.mapon_error) html += `<br><span class="fuel-err">${esc(d.mapon_error)}</span>`;
      else html += `<br>Совпадает (до ${d.radius_m} м): <b>${c.matched}</b> · создать: <b>${c.to_create}</b> · не работает: ${c.not_working} · лишние в Mapon: ${c.extra}`;
      html += `<br><span class="fuel-dim">Без GPS (только названия): ${c.no_gps || 0}. Ничего не записывается.</span>`;
      st.innerHTML = html;
      const line = (x) => `${esc(x.network ? x.network + " · " : "")}${esc(x.name)} — ${esc(x.gps)}`;
      ls.innerHTML =
        block("Будет создано", d.to_create, line) +
        block("Не работает (не создаём)", d.not_working, line) +
        block("Совпадает с Mapon", d.matched, (x) => `${line(x)} → ${esc(x.mapon_name)} (${x.dist_m} м)`) +
        block("Есть в Mapon, нет в списке", d.extra, (x) => `${esc(x.name)} — ${esc(x.gps)}`) +
        block("Без GPS — только названия", d.no_gps, (x) => `${esc(x.country)} / ${esc(x.name)} — ${esc(x.card)}`);
    } catch (e) {
      st.innerHTML = `<span class="fuel-err">Не удалось получить список АЗС.</span>`;
    }
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
