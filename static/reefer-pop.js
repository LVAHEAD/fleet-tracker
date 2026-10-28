/* v3.222: всплывашка рефа прицепа — плитки как панель Freezer в Mapon (подписи по-английски, время по Риге).
   Данные — data.reefer (fetat/domain/trailers.py: reefer_summary), лежат в data-rp на плашке .rf-pill.
   Наведение (через 2 с) — всплывашка, уход курсора / Esc — закрыть. Клик по плашке остаётся «Temp ↔ NoTemp». */
(function () {
  "use strict";

  const RUN = { 0: "Start-Stop", 1: "Continuous" };               // Carrier: режим работы (0 / 1); другое значение — показываем числом
  let tip = null, anchor = null, showT = 0, hideT = 0;

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);
  const deg = (v) => (num(v) == null ? "—" : Number(v).toFixed(1).replace(/\.0$/, "") + "°C");
  const riga = (ts) => {
    if (!num(ts) || ts < 1e9) return "";
    try { return new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Riga", hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).format(new Date(ts * 1000)); }
    catch (e) { return ""; }
  };

  function tile(label, val, sub, cls) {
    return '<div class="mp-t"><div class="mp-l">' + label + '</div><div class="mp-v' + (cls ? " " + cls : "") + '">' + val + "</div>" +
      '<div class="mp-s">' + (sub || "&nbsp;") + "</div></div>";
  }

  function render(r) {
    const comps = r.compartments || [];
    const main = comps.find((c) => c.on) || comps[0] || null;
    const other = comps.find((c) => c !== main) || null;
    const bad = (c) => !!c && c.dev != null && Math.abs(c.dev) > c.lim && !c.stale;      // отклонение возврата от уставки больше допуска
    const dev = bad(main), bad2 = bad(other), badC = comps.find(bad) || null;
    const ts = Math.max.apply(null, comps.map((c) => num(c.ts) || 0).concat([0]));
    // v3.232: как панель Freezer в Mapon — общий блок, затем «Temperature 1» и «Temperature 2» (уставка + Outgoing каждого отсека)
    const t = [];
    t.push(tile("Incoming temperature", main && main.on ? deg(main.ret) : "—", main && main.on && main.dev != null ? (main.dev > 0 ? "+" : "") + main.dev + "° к уставке" : "", dev ? "bad" : ""));
    t.push(tile("Run mode", num(r.run) == null ? "—" : esc(RUN[r.run] || "mode " + r.run), ""));
    t.push(tile("Diesel hours", num(r.diesel_h) == null ? "—" : Math.round(r.diesel_h), ""));
    const sec = (title, c, badc) => '<div class="mp-sec">' + title + '</div><div class="mp-g mp-g2">' +
      tile("Set temperature", c && c.on ? deg(c.set) : "—", "") +
      tile("Outgoing temperature", c && c.on ? deg(c.sup) : (c ? '<span class="mp-nd">Off</span>' : "—"), c && c.on && c.dev != null && c !== main ? (c.dev > 0 ? "+" : "") + c.dev + "° к уставке (возврат " + deg(c.ret) + ")" : "", badc ? "bad" : "") + "</div>";
    const fuelTile = '<div class="mp-g">' + tile("Fuel", num(r.fuel_l) == null ? "—" : Math.round(r.fuel_l) + " L", r.fuel_low ? "мало (< 40 л)" : "", r.fuel_low ? "bad" : "") + "</div>";
    const stale = comps.some((c) => c.on && c.stale);
    const warn = stale ? "Данные рефа старые — температуры могут не совпадать с текущими"
      : badC ? "Отсек " + badC.n + ": возврат отличается от уставки на " + (badC.dev > 0 ? "+" : "") + badC.dev + "° (допуск ±" + badC.lim + "°)" : "";
    return '<div class="mp-h"><b>Freezer</b>' + (r.type ? '<span class="mp-unit">' + esc(r.type) + "</span>" : "") +
      '<span class="mp-at">' + (ts ? "на " + riga(ts) + " (Riga)" : "") + "</span></div>" +
      '<div class="mp-g">' + t.join("") + "</div>" +
      sec("Temperature 1", main, dev) + (other ? sec("Temperature 2", other, bad2) : "") + fuelTile +
      (warn ? '<div class="tp-gps warn"><b>⚠</b><span>' + esc(warn) + "</span></div>" : "");
  }

  function place(el) {
    const q = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    const x = Math.min(Math.max(8, q.left), innerWidth - w - 8);
    let y = q.bottom + 6;
    if (y + h > innerHeight - 8) y = Math.max(8, q.top - h - 6);
    tip.style.left = x + "px"; tip.style.top = y + "px";
  }

  function open(el) {
    let r = null;
    try { r = JSON.parse(el.getAttribute("data-rp") || "null"); } catch (e) { r = null; }
    if (!r) return;
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "tp tp-mp tp-rf";
      tip.addEventListener("mouseenter", () => clearTimeout(hideT));
      tip.addEventListener("mouseleave", () => { hideT = setTimeout(close, 160); });
      document.body.appendChild(tip);
    }
    anchor = el;
    tip.innerHTML = render(r);
    tip.hidden = false;
    place(el);
  }

  function close() {
    clearTimeout(showT); clearTimeout(hideT);
    if (tip) tip.hidden = true;
    restore(); anchor = null;
  }

  function strip(el) {                   // родную подсказку прячем, пока наведено (текст хранится рядом)
    if (el.hasAttribute("title")) { el.setAttribute("data-rp-title", el.getAttribute("title")); el.removeAttribute("title"); }
  }
  function restore() {
    document.querySelectorAll("[data-rp-title]").forEach((n) => {
      n.setAttribute("title", n.getAttribute("data-rp-title")); n.removeAttribute("data-rp-title");
    });
  }
  const host = (e) => (e.target && e.target.closest ? e.target.closest(".rf-pill[data-rp]") : null);

  document.addEventListener("mouseover", (e) => {
    const el = host(e);
    if (!el) return;
    strip(el);
    clearTimeout(hideT);
    if (anchor === el && tip && !tip.hidden) return;
    clearTimeout(showT);
    showT = setTimeout(() => open(el), 2000);
  });
  document.addEventListener("mouseout", (e) => {
    const el = host(e);
    if (!el) return;
    clearTimeout(showT);
    const to = e.relatedTarget;
    if (to && ((el.contains(to)) || (tip && tip.contains(to)))) return;
    hideT = setTimeout(close, 160);
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  // строку Флота перерисовали — якорь пропал: закрываем, чтобы не висела чужая всплывашка
  setInterval(() => { if (anchor && !document.body.contains(anchor)) close(); }, 1500);
})();
