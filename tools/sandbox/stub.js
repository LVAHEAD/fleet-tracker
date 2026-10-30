/* Заглушка сети и Google Maps для макета Флота (песочница F.ETA.T, без деплоя).
   Все /api/* отдаются из snap.json (ответы настоящего движка аппы на обезличенных данных, модельные позиции машин и маршруты),
   Google Maps — «пустой» объект: карты в макете серые, вёрстка и логика строк — настоящие. */
(function () {
  "use strict";
  var origFetch = window.fetch.bind(window);
  var snapP = origFetch("snap.json").then(function (r) { return r.json(); });
  var fleetP = origFetch("fleet.json").then(function (r) { return r.json(); });
  var USER = "dispatcher1@example.com";

  function J(obj, status) {
    return new Response(JSON.stringify(obj), { status: status || 200, headers: { "Content-Type": "application/json" } });
  }
  function bodyOf(opts) {
    try { return opts && opts.body ? JSON.parse(opts.body) : {}; } catch (e) { return {}; }
  }

  window.fetch = function (input, opts) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    var u = new URL(url, location.href);
    var p = u.pathname;
    if (p.indexOf("/api/") !== 0) return origFetch(input, opts);
    var method = ((opts && opts.method) || "GET").toUpperCase();
    if (window.__STUBLOG) console.log("STUB " + method + " " + p);
    return Promise.all([snapP, fleetP]).then(function (all) {
      var snap = all[0], fleet = all[1];
      if (p === "/api/fleet" && method === "GET") {
        // v3.244: «чужие правки» для проверки sync — очередь window.__stubChanges (кладёт панель в variants.js)
        if (u.searchParams.get("since")) return J({ ok: true, now: Date.now(), user: USER, changes: (window.__stubChanges || []).splice(0) });
        return J(Object.assign({}, fleet, { now: Date.now() }));
      }
      var calcOne = function (b) {
        var hit = snap.calc[JSON.stringify([b.unit, b.target || "", b.extra || []])];
        return hit || { error: "нет данных в макете" };
      };
      if (p === "/api/calc") return J(calcOne(bodyOf(opts)));
      if (p === "/api/calc-batch") return J({ results: (bodyOf(opts).items || []).map(calcOne) });   // v3.243
      var g = snap.gets[p];
      if (g && method === "GET") return J(g.json || {}, g.status === 200 ? 200 : 200);
      if (p.indexOf("/api/fleet/") === 0) return J({ ok: true, now: Date.now(), user: USER });
      if (p === "/api/warm" || p === "/api/presence") return J({ ok: true, tags: [], version: "3.184" });
      if (p === "/api/notebook" || p.indexOf("/api/notebook") === 0) return J({ ok: true, items: [], notes: [] });
      if (p === "/api/fuel-stations") return J({ ok: true, stations: [], items: [] });
      // v3.231: объект Mapon у адреса — модель: у каждого третьего адреса зоны нет, у остальных зона из списка объектов макета
      if (p === "/api/mapon-object-at") {
        var la = parseFloat(u.searchParams.get("lat")), ln = parseFloat(u.searchParams.get("lng"));
        var objs = ((snap.gets["/api/mapon-objects"] || {}).json || {}).objects || [];
        if (!objs.length) objs = [   // в снимке объектов Mapon нет — вымышленные зоны с группами, как в аппе
          { name: "Зона погрузки 1", group: "GFI Clients" }, { name: "Склад клиента", group: "Fish Clients" },
          { name: "Паркинг у терминала", group: "PARKING" }, { name: "Зона выгрузки", group: "Bama Supliers" }];
        var h = Math.abs(Math.round(la * 1000) + Math.round(ln * 1000));
        if (h % 3 === 0) return J({ object: null });
        var o = objs[h % objs.length];
        return J({ object: { name: o.name, group: o.group || "" } });
      }
      return J({ error: "в макете недоступно" });
    });
  };

  // Google Maps: «пустышка» — любой вызов возвращает такую же пустышку, чтобы код аппы не падал
  function mk() {
    var f = function () {};
    return new Proxy(f, {
      get: function (t, k) {
        if (k === Symbol.toPrimitive) return function () { return 0; };
        if (k === "then") return undefined;
        return mk();
      },
      apply: function () { return mk(); },
      construct: function () { return mk(); }
    });
  }
  window.google = { maps: mk() };
  window.gm_authFailure = function () {};
  window.addEventListener("load", function () {
    try { if (typeof window.initMap === "function") window.initMap(); } catch (e) { console.warn("initMap (макет):", e); }
  });
})();
