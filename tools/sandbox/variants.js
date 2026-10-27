/* Песочница Флота: ВРЕМЕННЫЕ варианты «Фикс-время точки» (27.10): ячейка ETA циклично меняется:
   ETA со значком (по умолчанию 30 с) → текст предупреждения (10 с) → снова ETA. Расчёта в аппе нет, числа выдуманы (OI-1781, ④ Bama Nyland). */
(function () {
  const tbl = document.getElementById("fleet-table");
  if (!tbl || document.getElementById("fx-demo")) return;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  // a — ETA со значком; b — короткий текст (варианты 1–3); bl — полный текст (вариант 4, бегущая строка)
  const ST = [
    { c: "fx-ok", st: "✓", name: "Успевает", slot: "28.10. at 00.30", a: "⏱ 00:30 ✓", b: "резерв 3:10", bl: "резерв после слота 3 ч 10 м · выехать до 22:40",
      tip: "Успевает. Слот 28.10 00:30 (at).\nСамый ранний приезд 21:15, ждёт 3 ч 15 м.\nВыехать до 22:40. После слота резерв 3 ч 10 м (нужно 2 ч)." },
    { c: "fx-wait", st: "⏳", name: "Приедет раньше", slot: "FIX 28.10 00:30", a: "⏳ 00:30", b: "ждёт 3 ч 15 м", bl: "приедет 21:15, ждёт 3 ч 15 м · выехать до 22:40",
      tip: "Приедет раньше слота: 21:15 против 00:30 (FIX).\nРаньше нельзя, ждёт 3 ч 15 м: можно занять перерывом или отдыхом.\nВыехать до 22:40." },
    { c: "fx-warn", st: "⚠", name: "Не хватает на выгрузку и парковку", slot: "F 28.10 00:30", a: "⚠ 00:30", b: "после слота 1:20", bl: "к слоту успевает, но после слота 1 ч 20 м, нужно 2 ч на выгрузку и парковку",
      tip: "К слоту 00:30 (F) успевает, но после слота у водителя 1 ч 20 м смены.\nНужно 2 ч на выгрузку и поиск парковки." },
    { c: "fx-bad", st: "✗", name: "Не успевает к слоту", slot: "28.10. at 00.30", a: "✗ 02:10", b: "позже на 1:40", bl: "не успевает: приезд 02:10, позже слота 00:30 на 1 ч 40 м",
      tip: "Не успевает к слоту: самый ранний приезд 02:10, слот 00:30 (at).\nПозже на 1 ч 40 м." },
    { c: "fx-go", st: "▶", name: "Пора выезжать", slot: "28.10. at 00.30", a: "▶ 00:30", b: "пора ехать!", bl: "пора ехать: выехать надо было до 22:40, сейчас 22:52, машина стоит",
      tip: "Выехать надо было до 22:40, сейчас 22:52, машина стоит.\nК слоту 00:30 (at) иначе не успеть." }
  ];
  const SPEED = { fast: [6, 3], real: [30, 10] };
  const VARS = [
    ["fx-v1", "Смена", "мгновенно"], ["fx-v2", "Плавно", "растворение за 0,6 с"],
    ["fx-v3", "Прокрутка", "строка уезжает вверх, текст выезжает снизу"], ["fx-v4", "Бегущая", "полный текст бежит все секунды фазы"]
  ];

  // ---- пульт под таблицей ----
  const body = ST.map((r) => `<tr>
    <td class="fx-st">${r.st} ${r.name}</td><td class="fx-slot">${r.slot}</td>
    <td class="${r.c}"><span class="fx-t">${esc(r.a)}</span></td>
    <td class="${r.c}"><span class="fx-t">${esc(r.b)}</span></td>
    <td class="fx-tip">${esc(r.tip).replace(/\n/g, " ")}</td></tr>`).join("");
  const T0 = 19 * 60, SPAN = 540, pct = (h, m) => (((h * 60 + m) - T0 + (h < 12 ? 1440 : 0)) / SPAN * 100).toFixed(2);
  const w = (a, b) => (pct(...b) - pct(...a)).toFixed(2);
  const sec = document.createElement("section");
  sec.id = "fx-demo";
  sec.innerHTML = `<h2>Фикс-время точки: ячейка ETA переключается (временные варианты)</h2>
    <p class="fx-sub">Ячейка ETA точки с фиксом (at, FIX, F) показывает время со значком состояния, а раз в 30 секунд на 10 секунд меняется на текст предупреждения. Выбери подачу и скорость; изменения видны в таблице Флота выше (строки с точкой ②+).</p>
    <div class="fx-ctl">
      <fieldset><legend>Как переключается</legend>
        ${VARS.map((v, i) => `<label class="fx-opt"><input type="radio" name="fx-var" value="${v[0]}"${i === 1 ? " checked" : ""}> <span><b>${i + 1} · ${v[1]}</b> <small>${v[2]}</small></span></label>`).join("")}
      </fieldset>
      <fieldset><legend>Скорость показа</legend>
        <label class="fx-opt"><input type="radio" name="fx-spd" value="fast" checked> <span><b>Ускоренно</b> <small>ETA 6 с, текст 3 с, чтобы быстро посмотреть</small></span></label>
        <label class="fx-opt"><input type="radio" name="fx-spd" value="real"> <span><b>Как задумано</b> <small>ETA 30 с, текст 10 с</small></span></label>
        <label class="fx-opt"><input type="checkbox" id="fx-on" checked> <span>Показывать в таблице выше</span></label>
      </fieldset>
      <div class="fx-act"><button type="button" id="fx-now">Показать текст сейчас</button><span class="fx-stat" id="fx-stat"></span></div>
    </div>
    <div class="fx-scroll"><table>
      <tr><th>Состояние</th><th>TimeSlot точки</th><th>ETA со значком</th><th>Текст предупреждения</th><th>Подсказка при наведении</th></tr>${body}</table></div>
    <div class="fx-tl"><b>OI-1781, ④ Bama Nyland: как считается запас</b>
      <div class="fx-bar">
        <span class="fx-seg-wait" style="width:${w([19, 0], [22, 40])}%">стоит</span>
        <span class="fx-seg-drive" style="width:${w([22, 40], [0, 30])}%">дорога 119 км</span>
        <span class="fx-seg-work" style="width:${w([0, 30], [2, 30])}%">выгрузка и парковка</span>
      </div>
      <div class="fx-ticks">
        <span style="left:${pct(22, 40)}%">22:40 выехать не позже</span>
        <span class="fx-slotm" style="left:${pct(0, 30)}%">00:30 слот</span>
        <span class="fx-lim" style="right:${(100 - pct(3, 40)).toFixed(2)}%">03:40 конец смены</span>
      </div>
      <p class="fx-foot">Резерв после слота: 03:40 − 00:30 = 3 ч 10 м, нужно 2 ч, значит «успевает». Числа выдуманы для макета, часы смены в аппе возьмём из Mapon.</p>
    </div>`;
  tbl.parentElement.appendChild(sec);

  // ---- цикл: один таймер на <body>, класс fx-phase-b = фаза «текст» ----
  const bodyEl = document.body;
  let speed = "fast", on = true, timer = 0, phaseB = false, endAt = 0;
  const stat = document.getElementById("fx-stat");
  function setPhase(v, secs) {
    phaseB = v; endAt = Date.now() + secs * 1000;
    bodyEl.classList.toggle("fx-phase-b", v);
  }
  function schedule() {
    clearTimeout(timer);
    const [a, b] = SPEED[speed];
    bodyEl.style.setProperty("--fx-b", b + "s");
    setPhase(false, a);
    timer = setTimeout(() => showText(), a * 1000);
  }
  function showText() {
    clearTimeout(timer);
    const [a, b] = SPEED[speed];
    bodyEl.style.setProperty("--fx-b", b + "s");
    setPhase(true, b);
    timer = setTimeout(() => schedule(), b * 1000);
  }
  setInterval(() => {
    if (!stat) return;
    const left = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
    stat.textContent = on ? (phaseB ? `текст, ещё ${left} с` : `ETA, текст через ${left} с`) : "выключено";
  }, 250);
  function setVariant(v) { VARS.forEach((x) => bodyEl.classList.toggle(x[0], x[0] === v)); }

  sec.addEventListener("change", (e) => {
    const t = e.target;
    if (t.name === "fx-var") { setVariant(t.value); schedule(); }
    else if (t.name === "fx-spd") { speed = t.value; schedule(); }
    else if (t.id === "fx-on") { on = t.checked; fxOn = on; if (typeof window.renderRows === "function") window.renderRows(); }
  });
  document.getElementById("fx-now").addEventListener("click", showText);

  // ---- показ в самой таблице: подмена etaCellHtml (после app.js) ----
  const picked = {};          // row.id -> номер состояния (стабильно при перерисовке)
  let fxOn = true;
  function fxPatch(row, c, html) {
    if (!row || !row.extra || !row.extra.length || !c || !c.extra) return html;
    const i = c.extra.findIndex((ce) => ce && !ce.done && !ce.error && (ce.eta_tacho || ce.eta_local));
    if (i < 0) return html;
    if (picked[row.id] == null) {
      if (Object.keys(picked).length >= ST.length) return html;
      picked[row.id] = Object.keys(picked).length;
    }
    const st = ST[picked[row.id]];
    const box = document.createElement("div");
    box.innerHTML = html;
    const sl = box.querySelectorAll(":scope > .sl")[i + 1];
    const t = sl && sl.querySelector(".eta-x-t");
    if (!t) return html;
    t.className = "eta-x-t " + st.c;
    t.innerHTML = `<span class="fx-a">${esc(st.a)}</span><span class="fx-b"><span class="fx-bs">${esc(st.b)}</span><span class="fx-bl">${esc(st.bl)}</span></span>`;
    if (st.c === "fx-warn") sl.classList.add("fx-warn-sl");
    if (st.c === "fx-bad" || st.c === "fx-go") sl.classList.add("sl-late");
    sl.title = st.tip;
    return box.innerHTML;
  }
  if (typeof window.etaCellHtml === "function") {
    const orig = window.etaCellHtml;
    window.etaCellHtml = function (row, c, composed) {
      const html = orig.apply(this, arguments);
      return fxOn ? fxPatch(row, c, html) : html;
    };
    if (typeof window.renderRows === "function") window.renderRows();
  }
  setVariant("fx-v2");
  schedule();
})();
