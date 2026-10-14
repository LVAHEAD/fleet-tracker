/*
trailer-link.js — привязка прицепа к тягачу во Флоте (v3.74, вынесено из app.js).
normNo / isTrailerNo / findUnitNo, linkTrailer / linkTrailerRowToTruck / unlinkTrailer, редактор прицепа (openTrailerEditor),
клики «привязать / отвязать» в таблице. Опирается на глобалы app.js (rows, unitsCache, saveRows, renderRows, calcRow, dropRow, insertRowAfter…),
вызываемые во время работы. Грузится ДО app.js (таблица #fleet-tbody к этому моменту уже в DOM).
*/

// ---------- v1.71: привязка прицепа к тягачу ----------
const normNo = (s) => String(s || "").toUpperCase().replace(/[\s\-]/g, "");
function isTrailerNo(n) {
  return (unitsCache || []).some((u) => u.kind === "trailer" && normNo(u.number) === normNo(n));
}
function findUnitNo(n, kind) {
  const u = (unitsCache || []).find((x) => x.kind === kind && normNo(x.number) === normNo(n));
  return u ? u.number : null;
}
// тягачу truckId привязать прицеп trailerNo; строка этого прицепа во Флоте (если есть) уходит
function linkTrailer(truckId, trailerNo) {
  const truck = rows.find((r) => r.id === truckId);
  if (!truck) return;
  truck.trailer = String(trailerNo || "").trim();
  rows.filter((r) => r.id !== truckId && normNo(r.unit) === normNo(truck.trailer)).forEach((r) => {
    // v1.72: у тягача таргета нет, а у строки прицепа есть — переносим таргет, Delivery, примечание
    if (!truck.target && r.target) {
      ["lo", "target", "delivery", "extra", "open"].forEach((k) => { if (r[k] !== undefined) truck[k] = r[k]; });
    }
    if (!truck.note && r.note) truck.note = r.note;
    if (!truck.com && r.com) truck.com = r.com;
    dropRow(r.id);
  });
  saveRows();
  renderRows();
  calcRow(truckId);
}
// строку прицепа trailerRowId — к тягачу truckNo: есть строка тягача — туда, нет — строка становится тягачом
function linkTrailerRowToTruck(trailerRowId, truckNo) {
  const tRow = rows.find((r) => r.id === trailerRowId);
  if (!tRow) return;
  const truck = rows.find((r) => r.id !== trailerRowId && normNo(r.unit) === normNo(truckNo));
  if (truck) return linkTrailer(truck.id, tRow.unit);
  tRow.trailer = tRow.unit;
  tRow.unit = truckNo;
  delete lastCalcText[trailerRowId];
  removeMarker(trailerRowId);
  saveRows();
  renderRows();
  calcRow(trailerRowId);
}
function unlinkTrailer(truckId) {
  const truck = rows.find((r) => r.id === truckId);
  if (!truck || !truck.trailer) return;
  const no = truck.trailer;
  truck.trailer = "";
  removeTrailerLink(truckId);
  let nr = null;
  if (!rows.some((r) => normNo(r.unit) === normNo(no))) {
    nr = emptyRow();
    nr.unit = no;
    insertRowAfter(truckId, nr);
  }
  saveRows();
  renderRows();
  calcRow(truckId);
  if (nr) calcRow(nr.id);
}
let trlEd = null;
function closeTrailerEditor() { if (trlEd) { trlEd.remove(); trlEd = null; } }
// v1.72: в строке тягача — выбираем прицеп; в строке прицепа — выбираем тягач (строка уходит к нему)
function openTrailerEditor(id, anchor) {
  closeTrailerEditor();
  const row = rows.find((r) => r.id === id);
  if (!row) return;
  const forTrailer = isTrailerNo(row.unit);
  const kind = forTrailer ? "truck" : "trailer";
  trlEd = document.createElement("div");
  trlEd.className = "trl-ed";
  trlEd.innerHTML = `<div class="trl-ed-t">${forTrailer ? "Тягач для прицепа" : "Прицеп для"} ${escapeHtml(row.unit || "строки")}</div>
    <input list="${forTrailer ? "trucks-list" : "trailers-list"}" class="trl-ed-in" autocomplete="off" placeholder="${forTrailer ? "номер тягача" : "номер прицепа"}" value="${escapeHtml(forTrailer ? "" : row.trailer || "")}">
    <div class="trl-ed-err" hidden></div>
    <div class="trl-ed-b"><button class="trl-ed-ok">Привязать</button><button class="trl-ed-cancel">Отмена</button></div>`;
  document.body.appendChild(trlEd);
  const r = anchor.getBoundingClientRect();
  const z = uiZoom();
  trlEd.style.top = Math.min(window.innerHeight - trlEd.offsetHeight * z - 8, r.bottom + 4) / z + "px";
  trlEd.style.left = Math.max(8, r.right - trlEd.offsetWidth * z) / z + "px";
  const inp = trlEd.querySelector(".trl-ed-in");
  const err = trlEd.querySelector(".trl-ed-err");
  // v1.72: ближайший по GPS — сразу в поле, ещё два — кнопками под полем
  const near = document.createElement("div");
  near.className = "trl-ed-near";
  near.textContent = "ищу ближайший…";
  inp.after(near);
  const edNow = trlEd;
  if (row.unit) fetch(`/api/nearest-units?unit=${encodeURIComponent(row.unit)}&kind=${kind}`)
    .then((r) => r.json())
    .then((d) => {
      if (trlEd !== edNow) return;
      const items = (d && d.items) || [];
      if (!items.length) { near.textContent = d && d.error ? d.error : "рядом никого не нашёл"; return; }
      if (!inp.value.trim() || inp.dataset.auto) {
        inp.value = items[0].number;
        inp.dataset.auto = "1";
        inp.select();
      }
      const km = (x) => (x.km < 1 ? Math.round(x.km * 1000) + " м" : fmtKm(x.km));
      near.innerHTML = "ближайшие: " + items.map((x) =>
        `<button class="trl-ed-pick" data-n="${escapeHtml(x.number)}" title="${x.state === "driving" ? "едет" : "стоит"}">${escapeHtml(x.number)} · ${escapeHtml(km(x))}</button>`).join(" ");
      near.querySelectorAll(".trl-ed-pick").forEach((b) => b.addEventListener("click", () => {
        inp.value = b.dataset.n;
        inp.dataset.auto = "";
        inp.focus();
      }));
    })
    .catch(() => { if (trlEd === edNow) near.textContent = ""; });
  else near.textContent = "";
  inp.addEventListener("input", () => { inp.dataset.auto = ""; });
  const ok = () => {
    const v = inp.value.trim();
    if (!v) {
      closeTrailerEditor();
      if (!forTrailer && row.trailer) unlinkTrailer(id);
      return;
    }
    const hit = findUnitNo(v, kind);
    if ((unitsCache || []).length && !hit) {
      err.textContent = forTrailer ? "Такого тягача нет в группе машин" : "Такого прицепа нет в Mapon";
      err.hidden = false;
      return;
    }
    closeTrailerEditor();
    if (forTrailer) linkTrailerRowToTruck(id, hit || v);
    else linkTrailer(id, hit || v);
  };
  trlEd.querySelector(".trl-ed-ok").addEventListener("click", ok);
  trlEd.querySelector(".trl-ed-cancel").addEventListener("click", closeTrailerEditor);
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") ok();
    if (e.key === "Escape") closeTrailerEditor();
  });
  trlEd.addEventListener("mousedown", (e) => e.stopPropagation());
  inp.focus();
  inp.select();
}
document.addEventListener("mousedown", () => closeTrailerEditor());
// v3.119: Temp → NoTemp — с подтверждением, обратно без вопроса
function toggleNoTemp(id) {
  const row = rows.find((r) => r.id === id);
  if (!row) return;
  if (!row.noTemp && !confirm("Груз без температуры? Тревоги рефа выключатся.")) return;
  updateRowField(id, "noTemp", row.noTemp ? false : true);
}
(function () {
  document.getElementById("fleet-tbody").addEventListener("click", (e) => {
    const tg = e.target.closest && e.target.closest(".rf-tog");   // v3.119: Temp ⇄ NoTemp
    if (tg) {
      e.stopPropagation();
      return toggleNoTemp(Number(tg.closest("tr").dataset.id));
    }
    const b = e.target.closest && e.target.closest(".hitch-link, .trl-unlink");
    if (!b) return;
    e.stopPropagation();
    const id = Number(b.closest("tr").dataset.id);
    if (b.classList.contains("trl-unlink")) return unlinkTrailer(id);
    if (b.dataset.truck) return linkTrailerRowToTruck(id, b.dataset.truck);
    if (b.dataset.trailer) return linkTrailer(id, b.dataset.trailer);
  });
})();
