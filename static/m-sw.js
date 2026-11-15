// v3.317: service worker лёгкой страницы /m — оболочка (страница, CSS, JS) из кеша, если нет сети; данные (/api/…) никогда не кешируем.
const CACHE = "fetat-m-v1";
self.addEventListener("install", (e) => { self.skipWaiting(); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request, u = new URL(req.url);
  if (req.method !== "GET" || u.origin !== location.origin || u.pathname.startsWith("/api/")) return;
  if (u.pathname !== "/m" && !u.pathname.startsWith("/static/")) return;
  // сеть в приоритете, кеш — запасной вариант
  e.respondWith(fetch(req).then((r) => {
    if (r && r.ok) { const c = r.clone(); caches.open(CACHE).then((x) => x.put(req, c)); }
    return r;
  }).catch(() => caches.match(req)));
});
