/* Travel Deal Hunter — service worker
 *
 * Correction par rapport à la version d'origine : celle-ci répondait `caches.match()`
 * AVANT le réseau pour TOUTES les requêtes, index.html compris. Conséquence : une fois
 * la page en cache, un nouveau déploiement n'était jamais servi — l'utilisateur restait
 * bloqué sur l'ancienne version tant qu'il ne vidait pas le stockage du site.
 *
 * Ici : network-first pour les navigations (HTML), cache-first pour le reste.
 */
const CACHE = "tdh-v3";
const PRECACHE = ["/", "/index.html", "/manifest.json"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(names => Promise.all(names.filter(n => n !== CACHE).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;

  // Les réponses de /api/ sont des tarifs datés : jamais de cache côté client,
  // sinon une recherche ultérieure resservirait des prix périmés.
  if (url.pathname.startsWith("/api/")) return;

  // HTML : réseau d'abord, cache en secours hors-ligne.
  if (req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html")) {
    e.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then(r => r || caches.match("/index.html")))
    );
    return;
  }

  // Statique : cache d'abord, réseau en remplissage.
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res && res.status === 200 && res.type === "basic") {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      }
      return res;
    }))
  );
});
