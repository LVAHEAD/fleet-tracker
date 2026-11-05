/*
Fleet ETA Tracker — аутсорс-машины (v3.282).
Номера машины нет в Mapon (аутсорс): GPS и тахографа нет. Сервер (`_outsource_row`, fetat/services/fleet_calc.py) отдаёт
{outsource: true, dist_km, legs_km, pts, polys}. Во Флоте: в статусе красное «аутсорс», в ячейке КМ — километры по дорогам
между точками трипа, ETA не считаем; на карте — флажки точек и линия маршрута (prep-map.js, как у трипа без машины).
Настоящий номер диспетчер вписывает в «Примечание». Опирается на глобалы app.js / map-core.js (STOP_NUM, escapeHtml, lastCalcText);
грузится до prep-map.js и app.js.
*/
window.outsourceInfo = {};   // rowId -> { pts: [[lat, lng] | null], polys: [encoded | null], km }

function isOutsourceRow(row) {
  return !!(row && window.outsourceInfo[row.id]);
}

function renderOutsource(id, tr, data) {
  const statusCell = tr.querySelector(".status-cell");
  const distCell = tr.querySelector(".dist-cell");
  const etaCell = tr.querySelector(".eta-cell");
  const legs = data.legs_km || [];
  const tip = ["Аутсорс: машины нет в Mapon — GPS и ETA нет", "Настоящий номер — в примечании"]
    .concat(legs.map((k, i) => (k == null ? "" : `${STOP_NUM[i + 1]} → ${STOP_NUM[i + 2]}: ${Math.round(k)} км`)).filter(Boolean));
  if (data.dist_km != null) tip.push(`Всего по точкам: ${Math.round(data.dist_km)} км`);
  statusCell.innerHTML = `<div class="status-line out-st" title="${escapeHtml(tip.join("\n"))}">аутсорс</div>`;
  statusCell.className = "status-cell";
  distCell.textContent = data.dist_km != null ? String(Math.round(data.dist_km)) : "—";
  distCell.title = data.dist_km != null ? tip.slice(2).join("\n") : "";
  distCell.classList.toggle("muted", data.dist_km == null);
  etaCell.textContent = "—";
  etaCell.classList.remove("eta-late");
  delete lastCalcText[id];
  window.outsourceInfo[id] = { pts: data.pts || [], polys: data.polys || [], km: data.dist_km };
  if (window.PrepMap) PrepMap.sync();
}

// строка снова с машиной из Mapon (номер поправили) — убрать данные аутсорса и линию на карте
function clearOutsource(id) {
  if (!window.outsourceInfo[id]) return;
  delete window.outsourceInfo[id];
  if (window.PrepMap) PrepMap.sync();
}
