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
        if (u.searchParams.get("since")) return J({ ok: true, now: Date.now(), user: USER, changes: [] });
        return J(Object.assign({}, fleet, { now: Date.now() }));
      }
      if (p === "/api/calc") {
        var b = bodyOf(opts);
        var key = JSON.stringify([b.unit, b.target || "", b.extra || []]);
        var hit = snap.calc[key];
        return J(hit || { error: "нет данных в макете" });
      }
      var g = snap.gets[p];
      if (g && method === "GET") return J(g.json || {}, g.status === 200 ? 200 : 200);
      if (p.indexOf("/api/fleet/") === 0) return J({ ok: true, now: Date.now(), user: USER });
      if (p === "/api/warm" || p === "/api/presence") return J({ ok: true, tags: [], version: "3.184" });
      if (p === "/api/notebook" || p.indexOf("/api/notebook") === 0) return J({ ok: true, items: [], notes: [] });
      if (p === "/api/fuel-stations") return J({ ok: true, stations: [], items: [] });
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
