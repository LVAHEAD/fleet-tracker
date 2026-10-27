/* Песочница Флота: вариант «Фикс-время точки (at / FIX / F): оповещения» (27.10). Только макет, расчёта в аппе пока нет (НекстБилд). Числа в примере: OI-1781, ④ Bama Nyland. */
(function () {
  const tbl = document.getElementById("fleet-table");
  if (!tbl || document.getElementById("fx-demo")) return;
  const rows = [
    { cls: "fx-ok", st: "✓", name: "Успевает", slot: "28.10. at 00.30", t: "📍 28/10 00:30 ✓",
      n: "приедет 21:15, ждёт 3 ч 15 м", tip: "Выехать до 22:40. После слота резерв 3 ч 10 м (нужно 2 ч)." },
    { cls: "fx-wait", st: "⏳", name: "Приедет раньше", slot: "FIX 28.10 00:30", t: "📍 28/10 00:30",
      n: "приедет 21:15, ждёт 3 ч 15 м", tip: "Раньше слота нельзя: ожидание можно занять перерывом или отдыхом. Выехать до 22:40." },
    { cls: "fx-warn", st: "⚠", name: "Не хватает на выгрузку и парковку", slot: "F 28.10 00:30", t: "📍 28/10 00:30 ⚠",
      n: "после слота 1 ч 20 м, нужно 2 ч", tip: "К слоту успевает, но смена кончится раньше, чем выгрузка и поиск парковки." },
    { cls: "fx-bad", st: "✗", name: "Не успевает к слоту", slot: "28.10. at 00.30", t: "📍 28/10 02:10",
      n: "позже фикса на 1 ч 40 м", tip: "Самый ранний приезд позже слота: красная ячейка, как опоздание сейчас." },
    { cls: "fx-go", st: "▶", name: "Пора выезжать", slot: "28.10. at 00.30", t: "пора ехать",
      n: "выехать до 22:40, сейчас 22:52", tip: "Позже «выехать не позже», а машина ещё стоит: ячейка краснеет и мигает." }
  ];
  const body = rows.map((r) => `<tr>
    <td class="fx-st"><i>${r.st}</i>${r.name}</td>
    <td class="fx-slot">${r.slot}</td>
    <td class="fx-cell ${r.cls}"><span class="fx-t">${r.t}</span><span class="fx-n">${r.n}</span></td>
    <td class="fx-tip">${r.tip}</td></tr>`).join("");
  // шкала 19:00 → 04:00 (540 мин): ждёт до 22:40, дорога до 00:30, выгрузка и парковка 2 ч, конец смены 03:40
  const T0 = 19 * 60, SPAN = 540, pct = (h, m) => (((h * 60 + m) - T0 + (h < 12 ? 1440 : 0)) / SPAN * 100).toFixed(2);
  const w = (a, b) => (pct(...b) - pct(...a)).toFixed(2);
  const sec = document.createElement("section");
  sec.id = "fx-demo";
  sec.innerHTML = `<h2>Фикс-время точки: оповещения (макет)</h2>
    <p class="fx-sub">Метки фикса: at, FIX, F. После слота водителю нужно ~2 ч на выгрузку и поиск парковки. Ячейка ETA красится по тому же образцу, что опоздание сейчас.</p>
    <label class="fx-sw"><input type="checkbox" id="fx-on" checked> Показать в таблице Флота выше: пять строк, сверху вниз в том же порядке, у первой непройденной точки ②+. Одна строка в ячейке, подробности в подсказке при наведении.</label>
    <div class="fx-scroll"><table>
      <tr><th>Состояние</th><th>TimeSlot точки</th><th>Ячейка ETA</th><th>Подсказка</th></tr>${body}</table></div>
    <div class="fx-tl"><b>OI-1781, ④ Bama Nyland: как считается запас</b>
      <div class="fx-bar">
        <span class="fx-seg-wait" style="width:${w([19, 0], [22, 40])}%">стоит</span>
        <span class="fx-seg-drive" style="width:${w([22, 40], [0, 30])}%">дорога 119 км</span>
        <span class="fx-seg-work" style="width:${w([0, 30], [2, 30])}%">выгрузка и парковка</span>
      </div>
      <div class="fx-ticks">
        <span style="left:${pct(22, 40)}%">22:40 выехать не позже</span>
        <span class="fx-slotm" style="left:${pct(0, 30)}%;top:14px">00:30 слот</span>
        <span class="fx-lim" style="right:${(100 - pct(3, 40)).toFixed(2)}%">03:40 конец смены</span>
      </div>
      <p class="fx-foot">Резерв после слота: 03:40 − 00:30 = 3 ч 10 м, нужно 2 ч, значит «успевает». Числа в примере выдуманы для макета, часы смены в аппе возьмём из Mapon.</p>
    </div>`;
  tbl.parentElement.appendChild(sec);

  // ---- показ в самой таблице: подменяем etaCellHtml (после app.js), строка ETA точки ②+ получает состояние ----
  const SHORT = [
    { c: "fx-ok", t: "⏱ 00:30 ✓", tip: "Успевает. Слот 28.10 00:30 (at).\nСамый ранний приезд 21:15, ждёт 3 ч 15 м.\nВыехать до 22:40. После слота резерв 3 ч 10 м (нужно 2 ч)." },
    { c: "fx-wait", t: "⏳ ждёт 3:15", tip: "Приедет раньше слота: 21:15 против 00:30 (FIX).\nРаньше нельзя, ждёт 3 ч 15 м: можно занять перерывом или отдыхом.\nВыехать до 22:40." },
    { c: "fx-warn", t: "⚠ рез. 1:20", tip: "К слоту 00:30 (F) успевает, но после слота у водителя 1 ч 20 м смены.\nНужно 2 ч на выгрузку и поиск парковки." },
    { c: "fx-bad", t: "✗ 02:10 +1:40", tip: "Не успевает к слоту: самый ранний приезд 02:10, слот 00:30 (at).\nПозже на 1 ч 40 м." },
    { c: "fx-go", t: "▶ пора ехать", tip: "Выехать надо было до 22:40, сейчас 22:52, машина стоит.\nК слоту 00:30 (at) иначе не успеть." }
  ];
  const picked = {};          // row.id -> номер состояния (стабильно при перерисовке)
  let fxOn = true;
  function fxPatch(row, c, html) {
    if (!row || !row.extra || !row.extra.length || !c || !c.extra) return html;
    const i = c.extra.findIndex((ce) => ce && !ce.done && !ce.error && (ce.eta_tacho || ce.eta_local));
    if (i < 0) return html;
    if (picked[row.id] == null) {
      if (Object.keys(picked).length >= SHORT.length) return html;
      picked[row.id] = Object.keys(picked).length;
    }
    const st = SHORT[picked[row.id]];
    const box = document.createElement("div");
    box.innerHTML = html;
    const sl = box.querySelectorAll(":scope > .sl")[i + 1];
    const t = sl && sl.querySelector(".eta-x-t");
    if (!t) return html;
    t.textContent = st.t;
    t.className = "eta-x-t " + st.c;
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
    const sw = document.getElementById("fx-on");
    if (sw) sw.addEventListener("change", () => { fxOn = sw.checked; if (typeof window.renderRows === "function") window.renderRows(); });
    if (typeof window.renderRows === "function") window.renderRows();
  }
})();
