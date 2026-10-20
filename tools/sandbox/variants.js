/* Переключатели варианта полей ввода и плотности строк (только для макета). */
(function () {
  "use strict";
  var G = [
    { key: "fv-variant", title: "Поля ввода:", items: [["", "Как в аппе"], ["fv-soft", "Мягкие"], ["fv-read", "Читалка + линия"], ["fv-bare", "Читалка"]] },
    { key: "fd-variant", title: "Плотность:", def: "fd-mix", items: [["", "Как в аппе"], ["fd-compact", "Компактно"], ["fd-dense", "Плотно"], ["fd-mix", "Микс"]] },
    { key: "fb-variant", title: "Плашки стран:", def: "fb-80", items: [["", "Как в аппе"], ["fb-80", "−20%"], ["fb-70", "−30%"]] }
  ];
  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function put(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function apply(g, v) {
    g.items.forEach(function (x) { if (x[0]) document.body.classList.remove(x[0]); });
    if (v) document.body.classList.add(v);
    [].forEach.call(document.querySelectorAll('#fv-switch [data-g="' + g.key + '"] button'), function (b) {
      b.classList.toggle("on", b.getAttribute("data-v") === v);
    });
  }
  function init() {
    var box = document.createElement("div");
    box.id = "fv-switch";
    box.innerHTML = G.map(function (g) {
      return '<div class="fv-grp" data-g="' + g.key + '"><span>' + g.title + "</span>" + g.items.map(function (x) {
        return '<button type="button" data-v="' + x[0] + '">' + x[1] + "</button>";
      }).join("") + "</div>";
    }).join("");
    box.addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      var grp = b.parentNode.getAttribute("data-g");
      G.forEach(function (g) { if (g.key === grp) { var v = b.getAttribute("data-v"); put(g.key, v); apply(g, v); } });
    });
    document.body.appendChild(box);
    G.forEach(function (g) { var v = get(g.key); if (v === null) v = g.def || ""; apply(g, v); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
