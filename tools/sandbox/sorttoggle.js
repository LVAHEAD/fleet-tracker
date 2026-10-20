/* Сортировка: вместо двух кнопок «L → O» и «O → L» — одна, клик переключает направление; вторая кнопка — «руками» (только для макета). */
(function () {
  "use strict";
  var lastDir = "LO";
  function bars() { return [].slice.call(document.querySelectorAll("button[data-sort='OL']")).map(function (b) { return b.parentNode; }); }
  function labelAll() {
    [].forEach.call(document.querySelectorAll("button[data-sort-toggle]"), function (t) {
      t.dataset.sort = lastDir;                                    // подсветка «on» от приложения: включена, когда сортировка по этому направлению
      t.textContent = lastDir === "LO" ? "L → O" : "O → L";
      t.title = lastDir === "LO" ? "Сначала погрузки, потом выгрузки. Клик — переключить на O → L"
                                 : "Сначала выгрузки, потом погрузки. Клик — переключить на L → O";
    });
    if (window.fleetMarkBar) window.fleetMarkBar();
  }
  function init() {
    try { if (typeof sortMode === "string" && (sortMode === "LO" || sortMode === "OL")) lastDir = sortMode; } catch (e) {}
    bars().forEach(function (bar) {
      var lo = bar.querySelector("button[data-sort='LO']"), ol = bar.querySelector("button[data-sort='OL']");
      if (!lo || !ol) return;
      lo.setAttribute("data-sort-toggle", "1");
      ol.style.display = "none";
      bar.addEventListener("click", function (e) {
        var t = e.target.closest("button[data-sort-toggle]"); if (!t) return;
        e.stopImmediatePropagation();
        if (sortMode === "LO" || sortMode === "OL") sortMode = sortMode === "LO" ? "OL" : "LO";   // уже сортируем — переключаем
        else sortMode = lastDir;                                                                     // были «руками» — возвращаем последнее направление
        lastDir = sortMode;
        saveSortState(); labelAll(); resort();
      }, true);
    });
    labelAll();
  }
  window.addEventListener("load", function () { setTimeout(init, 300); });
})();
