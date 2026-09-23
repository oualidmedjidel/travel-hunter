/* Travel Deal Hunter — service worker
 *
 * Correction par rapport à la version d'origine : celle-ci répondait `caches.match()`
 * AVANT le réseau pour TOUTES les requêtes, index.html compris. Conséquence : une fois
 * la page en cache, un nouveau déploiement n'était jamais servi — l'utilisateur restait
 * bloqué sur l'ancienne version tant qu'il ne vidait pas le stockage du site.
 *
 * Ici : network-first pour les navigations (HTML), cache-first pour le reste.
 */
const CACHE = "tdh-v6";   // v4 → v5 : le service worker gagne le push, les anciens caches partent

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

/**
 * Une notification poussée arrive SANS contenu : le serveur ne fait que réveiller
 * l'appareil (netlify/lib/push.mjs explique pourquoi). C'est donc ici qu'on demande au
 * site quoi afficher, en s'identifiant par notre propre point d'entrée — un service
 * worker n'a pas accès au localStorage où vit l'identifiant du propriétaire.
 *
 * Si le serveur ne rend aucune alerte fraîche, on affiche une formule neutre plutôt
 * qu'un prix inventé : la permission a été accordée, un silence total serait pire.
 */
self.addEventListener("push", e => {
  e.waitUntil((async () => {
    let titre = "Travel Deal Hunter", corps = "Un prix a bougé sur une de tes veilles.";
    try {
      const abonnement = await self.registration.pushManager.getSubscription();
      if (abonnement) {
        const r = await fetch("/api/veille?quoi=alerte", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: abonnement.endpoint })
        });
        const d = await r.json();
        if (d && d.alerte && d.alerte.essai) {
          titre = "Essai réussi";
          corps = "Les alertes fonctionnent sur cet appareil. Tu seras prévenu au prochain record de prix.";
        } else if (d && d.alerte) {
          const a = d.alerte;
          titre = `${a.code} : ${Math.round(a.nouveau)} € — nouveau meilleur prix`;
          corps = `${a.baisse} % sous le meilleur prix déjà vu (${Math.round(a.ancien)} €)`
                + (a.nom ? ` · ${a.nom}` : "");
        }
      }
    } catch {}
    await self.registration.showNotification(titre, {
      body: corps,
      icon: "/icone-192.png",
      badge: "/icone-192.png",
      tag: "tdh-veille",        // une seule notification à la fois, pas une pile
      renotify: true
    });
  })());
});

/** Un clic ramène sur la page des veilles, en réutilisant l'onglet déjà ouvert s'il existe. */
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil((async () => {
    const fenetres = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const ouverte = fenetres.find(c => c.url.includes(self.location.origin));
    if (ouverte) { await ouverte.focus(); return; }
    await self.clients.openWindow("/");
  })());
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
