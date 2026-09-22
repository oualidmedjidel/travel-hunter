/* Travel Deal Hunter — service worker
 *
 * Correction par rapport à la version d'origine : celle-ci répondait `caches.match()`
 * AVANT le réseau pour TOUTES les requêtes, index.html compris. Conséquence : une fois
 * la page en cache, un nouveau déploiement n'était jamais servi — l'utilisateur restait
 * bloqué sur l'ancienne version tant qu'il ne vidait pas le stockage du site.
 *
 * Ici : network-first pour les navigations (HTML), cache-first pour le reste.
 */
const CACHE = "tdh-v4";   // v3 → v4 : purge les caches empoisonnés par le défaut corrigé ci-dessous

/**
 * Ce qui mérite d'entrer en cache. La version précédente mettait en cache la réponse de
 * navigation SANS regarder son statut : un 500 ou un 404 attrapé une fois devenait la page
 * servie hors-ligne, et le cache le gardait jusqu'à la prochaine visite en ligne réussie.
 * Une page d'erreur n'est pas un repli, c'est une panne figée.
 *
 * `type` écarte les réponses opaques (cross-origin), dont on ne peut rien lire : `ok` y vaut
 * toujours false, mais la garde est explicite pour qui relira.
 */
const enCache = res => !!res && res.ok && res.type !== "opaque";
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
          if (enCache(res)) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req).then(r => r || caches.match("/index.html")))
    );
    return;
  }

  // Statique : cache d'abord, réseau en remplissage.
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (enCache(res) && res.type === "basic") {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      }
      return res;
    }))
  );
});
