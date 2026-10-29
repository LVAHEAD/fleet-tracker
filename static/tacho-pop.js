/* v3.217: всплывашка статуса машины во Флоте — блок «Tachograph» как в панели Mapon (подписи по-английски, время по Риге).
   Данные — data.tacho_panel (fetat/domain/tacho.py: tacho_panel), лежат в data-tp на .status-line.
   Наведение — всплывашка, клик — закрепить, Esc / клик мимо / × — закрыть. Нет данных — обычный title. */
(function () {
  "use strict";

  const DAY_CAP = 36000, WEEK_CAP = 201600, NOW_CAP = 16200;     // 10:00, 56:00, 4:30 — шкалы полосок
  let tip = null, anchor = null, pinned = false, showT = 0, hideT = 0, tab = 0, cur = null;

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);
  const hm = (s) => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 3600) + ":" + ("0" + Math.floor(s % 3600 / 60)).slice(-2); };
  const mh = (s) => {
    s = Math.max(0, Math.floor(s || 0));
    const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
    return h && m ? h + "h " + m + "min" : h ? h + "h" : m + "min";
  };
  const riga = (ts, withDate) => {                                 // время по Риге, как показывает Mapon
    if (!num(ts) || ts < 1e9) return "—";
    const o = withDate ? { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" } : { hour: "2-digit", minute: "2-digit" };
    try { return new Intl.DateTimeFormat("ru-RU", Object.assign({ timeZone: "Europe/Riga", hourCycle: "h23" }, o)).format(new Date(ts * 1000)).replace(",", ""); }
    catch (e) { return "—"; }
  };

  const IC = {
    clock: '<svg viewBox="0 0 16 16" width="14" height="14"><circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="8" r="1.7" fill="currentColor"/></svg>',
    bed: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M2 3v10M2 10.2h12V13M2 10.2V7.3h6.4a3.2 3.2 0 0 1 3.2 2.9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    gauge: '<svg viewBox="0 0 16 16" width="15" height="15"><path d="M2.5 11a5.5 5.5 0 1 1 11 0M8 11l2.6-3.4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  };

  function tile(label, icon, val, sub, frac) {
    return '<div class="mp-t"><div class="mp-l">' + label + '</div><div class="mp-v">' + (icon ? '<i class="mp-i">' + IC[icon] + "</i>" : "") + val + "</div>" +
      '<div class="mp-s">' + (sub || "&nbsp;") + "</div>" +
      (frac == null ? "" : '<div class="mp-b"><i style="width:' + (Math.max(0, Math.min(1, frac)) * 100).toFixed(1) + '%"></i></div>') + "</div>";
  }

  const validTs = (v) => num(v) && v > 1e9;
  const cardOk = (d) => { const t = d.today || {}; return validTs(t.rest_start) || validTs(t.shift_start); };   // нет данных суток — Mapon показывает NO CARD
  // v3.234: подсказка к «45h*» — правило Claude (у Mapon его нет)
  const R45 = "Расчёт Claude: на этой неделе отдых уже сокращённый, срок попадает на следующую неделю — нужна 45ка. Mapon показывает 24ка";
  // v3.223: какой недельный отдых нужен — 45 h или 24 h (один на экипаж, по более строгому водителю)
  function weeklyNeed(pp) {
    const n = pp && num(pp.weekly_need);
    if (!n) return "";
    const h = Math.round(n / 3600) + " h";
    if (pp.weekly_rule45) return ' · <span title="' + R45 + '">' + h + "*</span>";
    return (pp.weekly_mixed ? ' · <span title="У водителей экипажа значения разные; экипаж отдыхает вместе — берём более строгое">' + h + "*</span>" : " · " + h);
  }
  // суффикс подписи плитки: «Weekly rest (45h)», норма жирным (нижняя строка плитки остаётся «время · 45 h»)
  function weeklyTag(pp) {
    const n = pp && num(pp.weekly_need);
    if (!n) return "";
    const h = Math.round(n / 3600) + "h";
    if (pp.weekly_rule45) return ' (<b title="' + R45 + '">' + h + "*</b>)";
    return (pp.weekly_mixed ? ' (<b title="У водителей экипажа значения разные; экипаж отдыхает вместе — берём более строгое">' + h + "*</b>)" : " (<b>" + h + "</b>)");
  }
  function tiles(d, at, pp) {
    if (!d) {
      return ["Now", "Today", "10h Driving", "9h rest", "Daily rest start", "This week", "Next week", "Weekly rest"]
        .map((l) => tile(l, "", "—", "", null)).join("");
    }
    const n = d.now || {}, t = d.today || {}, w = d.week || {};
    const ext = w.ext || [], sh = w.short || [];
    const nowRem = num(n.rem), tRem = num(t.rem), wRem = num(w.rem);
    const driving = d.state === "DRIVING";
    const restIn = num(t.rest_start) && t.rest_start > 1e9 ? Math.max(0, t.rest_start - at) : null;
    const wkIn = num(w.rest_start) && w.rest_start > 1e9 ? Math.max(0, w.rest_start - at) : null;
    const noDay = restIn == null;                              // Mapon: нет начала суточного отдыха — «NO DATA»
    const resting = !driving && num(n.rest) > 0;               // не за рулём — «Now» это идущий отдых (значок кровати)
    const nowTile = resting
      ? tile("Now", "bed", mh(n.rest), mh(Math.min(NOW_CAP, !noDay && tRem != null ? tRem : NOW_CAP)), null)
      : tile("Now", "clock", mh(n.driving), nowRem != null ? mh(nowRem) : "", nowRem != null ? (n.driving || 0) / ((n.driving || 0) + nowRem || NOW_CAP) : null);
    return nowTile +
      (noDay ? tile("Today", "", '<span class="mp-nd">NO DATA</span>', "", null)
        : tile("Today", "clock", mh(t.driving), tRem != null ? mh(tRem) : "", tRem != null ? (t.driving || 0) / ((t.driving || 0) + tRem || DAY_CAP) : null)) +
      tile("10h Driving", "clock", ext[0] != null && ext[1] != null ? ext[0] + "/" + ext[1] : "—", "", null) +     // «доступно» = лимит (2 / 3), как в Mapon
      tile("9h rest", "bed", sh[0] != null && sh[1] != null ? sh[0] + "/" + sh[1] : "—", "", sh[0] != null && sh[1] ? sh[0] / sh[1] : null) +
      (noDay ? tile("Daily rest start", "", '<span class="mp-nd">NO DATA</span>', "", null)
        : tile("Daily rest start", "bed", riga(t.rest_start), mh(restIn), null)) +
      tile("This week", "clock", mh(w.driving), wRem != null ? mh(wRem) : "", wRem != null ? (w.driving || 0) / ((w.driving || 0) + wRem || WEEK_CAP) : null) +
      tile("Next week", "clock", num(w.next) != null ? mh(w.next) : "—", "", null) +
      tile("Weekly rest" + weeklyTag(pp), "bed", riga(w.rest_start, true), (wkIn != null ? mh(wkIn) : "") + weeklyNeed(pp), null);
  }

  function gpsLine(p) {
    const f = p.fix;
    if (f) {
      const txt = f.kind === "nocard"
        ? "Вторая карта не считана: тахограф видит одного водителя (" + hm(f.tacho) + "), по GPS машина ехала " + hm(f.driven) + " — остаток по GPS"
        : "Тахограф отстаёт от GPS: по тахографу " + hm(f.tacho) + ", по GPS ≈ " + hm(f.driven) + " — остаток по GPS";
      return '<div class="tp-gps warn"><b>⚠</b><span>' + txt + "</span></div>";
    }
    if (p.gps && p.gps.driven != null && p.tacho_driven != null && Math.abs(p.gps.driven - p.tacho_driven) <= 3600) {
      return '<div class="tp-gps ok"><b>✓</b><span>Тахограф ' + hm(p.tacho_driven) + " · GPS ≈ " + hm(p.gps.driven) + " — сходится</span></div>";
    }
    return "";
  }

  function render(c) {
    const p = c.p, ds = p.drivers || [];
    const tabs = [0, 1].slice(0, p.team ? 2 : Math.max(1, ds.length)).map((i) => {
      const ok = !!ds[i] && cardOk(ds[i]);
      const nm = ok && ds[i].name ? ds[i].name : "Driver " + (i + 1);
      return '<button type="button" class="mp-tab' + (i === tab ? " on" : "") + '" data-tab="' + i + '"><span class="mp-n">' + esc(nm) +
        '</span><span class="mp-c' + (ok ? "" : " no") + '">' + (ok ? "CARD INSERTED" : "NO CARD") + "</span></button>";
    }).join("");
    const links = '<div class="mp-t mp-lk"><a class="mp-a" href="https://www.mapon.com/pro/online" target="_blank" rel="noopener"><span>Open in Mapon</span></a></div>';
    const plan = (p.plan || []).length
      ? '<div class="tp-plan"><b>План</b>' + p.plan.map((x) => "<div>" + esc(x) + "</div>").join("") + "</div>" : "";
    const crew = p.team ? " · потолок экипажа " + hm(p.day_max) + " минус вождение" : "";
    return '<div class="mp-h">' + IC.gauge + "<b>Tachograph</b>" + (c.u ? '<span class="mp-unit">' + esc(c.u) + "</span>" : "") +
      '<span class="mp-at">' + (c.h ? esc(c.h) + " · " : "") + "на " + riga(p.at) + ' (Riga)</span>' +
      '<button type="button" class="tp-x" aria-label="Закрыть">×</button></div>' +
      '<div class="mp-tabs">' + tabs + '</div><div class="mp-g">' + tiles(ds[tab] || null, p.at, p) + links + "</div>" + (!ds[tab] ? '<div class="tp-gps warn"><b>⚠</b><span>Mapon не отдаёт данные этого водителя: карта не считана, его часы неизвестны' + (p.team ? " — остаток дня экипажа считаем с учётом GPS" : "") + "</span></div>" : "") + gpsLine(p) +
      plan +
      '<div class="tp-f"><span>Сегодня осталось</span><b>' + hm(p.left) + "</b><span>" + (p.left_src === "gps" ? "по GPS" : "по тахографу") + crew + "</span></div>";
  }

  function place(el) {
    const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    const x = Math.min(Math.max(8, r.left), innerWidth - w - 8);
    let y = r.bottom + 6;
    if (y + h > innerHeight - 8) y = Math.max(8, r.top - h - 6);
    tip.style.left = x + "px"; tip.style.top = y + "px";
  }

  function load(el) {
    try { return JSON.parse(el.getAttribute("data-tp") || "null"); } catch (e) { return null; }
  }

  function open(el) {
    const c = load(el);
    if (!c || !c.p) return;
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "tp tp-mp";
      tip.addEventListener("mouseenter", () => clearTimeout(hideT));
      tip.addEventListener("mouseleave", () => { if (!pinned) hideT = setTimeout(close, 160); });
      tip.addEventListener("click", (e) => {
        if (e.target.closest(".tp-x")) { close(); return; }
        const tb = e.target.closest(".mp-tab");
        if (tb && anchor) { tab = +tb.getAttribute("data-tab"); open(anchor); }
      });
      document.body.appendChild(tip);
    }
    if (anchor !== el) tab = Math.max(0, (c.p.drivers || []).findIndex((d) => d.state === "DRIVING"));
    anchor = el; cur = c;
    tip.classList.toggle("pin", pinned);
    tip.innerHTML = render(c);
    const ds = c.p.drivers || [];
    tip.classList.toggle("tp-pink", (c.p.team && ds.length < 2) || ds.some((d) => d && !cardOk(d)));   // Mapon отдал не всё — бледно-розовая карточка
    tip.hidden = false;
    place(el);
  }

  function close() {
    pinned = false; clearTimeout(showT); clearTimeout(hideT);
    if (tip) { tip.hidden = true; tip.classList.remove("pin"); }
    anchor = null;
  }

  function strip(el) {                   // родную подсказку прячем, пока наведено (текст хранится рядом)
    if (el.hasAttribute("title")) { el.setAttribute("data-tp-title", el.getAttribute("title")); el.removeAttribute("title"); }
  }
  function restore() {
    document.querySelectorAll("[data-tp-title]").forEach((n) => {
      n.setAttribute("title", n.getAttribute("data-tp-title")); n.removeAttribute("data-tp-title");
    });
  }
  // плашка «на точке» (.ot-pill) — у неё свой клик (зум на машине) и своя подсказка: всплывашку не зовём
  // 26.10 (Владимир): всплывашка — только над флагом страны и значком экипажа (.cc-badge, .crew-b), не над всей строкой статуса
  const AREA = ".cc-badge, .crew-b";
  const host = (e) => {
    const t = e.target;
    if (!t.closest || t.closest(".ot-pill") || !t.closest(AREA)) return null;
    return t.closest(".status-line[data-tp]");
  };

  document.addEventListener("mouseover", (e) => {
    const el = host(e);
    if (!el) { if (!pinned && e.target.closest && e.target.closest(".ot-pill")) { close(); } return; }
    strip(el);
    if (pinned) return;
    clearTimeout(hideT);
    if (anchor === el && tip && !tip.hidden) return;
    clearTimeout(showT);
    showT = setTimeout(() => open(el), 1500);   // v3.226: 1,5 с (было 2 с)
  });
  document.addEventListener("mouseout", (e) => {
    const el = host(e);
    if (!el || pinned) return;
    clearTimeout(showT);
    const to = e.relatedTarget;
    const toArea = to && to.closest ? to.closest(AREA) : null;   // перешли с флага на значок экипажа — не закрываем
    if (to && ((toArea && el.contains(toArea)) || (tip && tip.contains(to)))) return;
    hideT = setTimeout(() => { close(); restore(); }, 160);
  });
  document.addEventListener("click", (e) => {
    const el = host(e);
    if (el) {
      if (pinned && anchor === el) { close(); return; }
      clearTimeout(showT); pinned = true; open(el);
      return;
    }
    if (pinned && tip && !tip.contains(e.target)) { close(); restore(); }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { close(); restore(); } });
  // строку Флота перерисовали — якорь пропал: закрываем, чтобы не висела чужая всплывашка
  setInterval(() => { if (anchor && !document.body.contains(anchor)) close(); }, 1500);
})();
