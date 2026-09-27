// v1.61: разделы "в разработке".
// Любой вкладке достаточно добавить атрибут data-wip:
//   <button class="main-tab-btn" data-tab="xxx" data-wip>Название</button>
// тогда перед названием вкладки появится значок-каска, а вверху панели #tab-xxx —
// плашка с конусом "Этот раздел в разработке". Когда раздел готов — data-wip убрать.
(function () {
  const svg = (paths) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const HAT = svg('<path d="M5 13a7 7 0 0 1 14 0"/><path d="M3 13h18"/><path d="M6 13c0 5 3 7 6 7s6-2 6-7"/>');
  const CONE = svg('<path d="M9.5 4h5L19 19H5z"/><path d="M8.3 9h7.4M6.9 14h10.2"/><path d="M3 20h18"/>');

  document.querySelectorAll(".main-tab-btn[data-wip]").forEach((btn) => {
    if (!btn.querySelector(".wip-ic")) {
      btn.insertAdjacentHTML("afterbegin", `<span class="wip-ic" title="Раздел в разработке">${HAT}</span>`);
    }
    const panel = document.getElementById("tab-" + btn.dataset.tab);
    if (panel && !panel.querySelector(".wip-banner")) {
      panel.insertAdjacentHTML("afterbegin",
        `<div class="wip-banner"><span class="wip-cone">${CONE}</span><span>Этот раздел в разработке</span></div>`);
    }
  });
})();
