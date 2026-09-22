/**
 * Proxy Duffel — fonction au format web standard `(Request) => Response`.
 * Servie par serveur.mjs (processus Node) ; l'origine Netlify est documentée en § 10
 * de PASSATION.md.
 *
 * Le jeton ne peut pas vivre dans la page : il est lu ici depuis DUFFEL_TOKEN et
 * n'est jamais renvoyé au navigateur. Un jeton de bac à sable commence par
 * `duffel_test_`, un jeton réel non — la réponse expose `mode` pour le rappeler.
 *
 * Contrat relevé sur la documentation Duffel le 2026-09-21, exemples bruts à l'appui
 * (la synthèse automatique de ces pages annonçait `total_price` et `departure_time`,
 * DEUX noms de champs inexistants — d'où la lecture directe des exemples) :
 *
 *   POST https://api.duffel.com/air/offer_requests?return_offers=true
 *   en-têtes : Authorization: Bearer …, Duffel-Version: v2, Content-Type: application/json
 *   corps    : { data: { slices:[{origin,destination,departure_date}],
 *                        passengers:[{type:"adult"} | {age:N}],
 *                        cabin_class, max_connections } }
 *   réponse  : { data: { offers:[ { total_amount:"45.00", total_currency:"GBP",
 *                                   owner:{iata_code,name},
 *                                   slices:[{segments:[{departing_at,arriving_at,
 *                                            operating_carrier:{iata_code,name}}]}] } ] } }
 *
 * Deux pièges :
 *  - `total_amount` est une CHAÎNE, et c'est le total POUR TOUS LES PASSAGERS de la
 *    requête. Ne pas le remultiplier par le nombre de voyageurs.
 *  - Duffel renvoie la devise du compte, il n'existe pas de paramètre de devise.
 *    `total_currency` est donc remonté tel quel : ne jamais supposer l'euro.
 *
 * Sans jeton : 200 { configured:false } → la page bascule en démonstration.
 */

import { API, IATA, jourValide, json, jeton, entetes, empreinteJeton, parLots, creerCache, entiers, motifEchec }
  from "../lib/duffel.mjs";

const ROUTE = `${API}/air/offer_requests`;
const MAX_DESTINATIONS = 12;
const CONCURRENCE = 6;
// Budget auto-imposé : au-delà, la page a déjà abandonné (30 s) et l'utilisateur attend.
// Plutôt que de tout perdre, on arrête de lancer de nouveaux lots passé ce délai et
// on renvoie ce qui est déjà remonté : une réponse partielle vaut mieux qu'un 502.
const BUDGET_MS = 18000;
const cache = creerCache(15 * 60 * 1000, 300);

/**
 * Une offre Duffel porte sa propre date de péremption, et elle est plus courte que le cache.
 * Sans cette garde, une offre expirée depuis dix minutes ressortait du cache (TTL 15 min) et
 * s'affichait comme un prix courant : le voyageur cliquait sur un tarif qui n'existait plus.
 *
 * Une offre sans `expiresAt` (ou avec une date illisible) n'est jamais déclarée périmée :
 * seule une date lue et dépassée écarte l'offre.
 */
export function perimee(offre, maintenant = Date.now()) {
  if (!offre || typeof offre.expiresAt !== "string") return false;
  const t = Date.parse(offre.expiresAt);
  return Number.isFinite(t) && t <= maintenant;
}

/** Adultes par `type`, mineurs par `age` : c'est la forme documentée par Duffel. */
export function passagers(adults, agesEnfants, agesBebesMois) {
  const out = [];
  for (let i = 0; i < adults; i++) out.push({ type: "adult" });
  for (const a of agesEnfants) out.push({ age: Math.min(17, Math.max(2, Math.round(a))) });
  for (const m of agesBebesMois) out.push({ age: Math.min(1, Math.max(0, Math.floor(m / 12))) });
  return out;
}

/** Offre la moins chère d'une réponse Duffel. null si la route ne renvoie rien. */
export function meilleureOffre(payload, destination) {
  const offres = payload && payload.data && Array.isArray(payload.data.offers) ? payload.data.offers : [];
  let best = null;

  for (const o of offres) {
    // total_amount est une chaîne décimale.
    const total = Number.parseFloat(o && o.total_amount);
    if (!Number.isFinite(total) || total <= 0) continue;
    if (best && total >= best.total) continue;

    const slices = Array.isArray(o.slices) ? o.slices : [];
    const aller = slices[0] && Array.isArray(slices[0].segments) ? slices[0].segments : [];
    const retour = slices[1] && Array.isArray(slices[1].segments) ? slices[1].segments : [];
    const s0 = aller[0] || null;
    const porteur = (o.owner && typeof o.owner.name === "string" && o.owner.name)
      || (s0 && s0.operating_carrier && s0.operating_carrier.name)
      || null;

    best = {
      destination,
      total: Math.round(total * 100) / 100,
      currency: typeof o.total_currency === "string" ? o.total_currency : null,
      airline: porteur,
      airlineCode: (o.owner && typeof o.owner.iata_code === "string" ? o.owner.iata_code : null),
      departureAt: s0 && typeof s0.departing_at === "string" ? s0.departing_at : null,
      returnAt: retour[0] && typeof retour[0].departing_at === "string" ? retour[0].departing_at : null,
      transfers: Math.max(0, aller.length - 1) + Math.max(0, retour.length - 1),
      expiresAt: typeof o.expires_at === "string" ? o.expires_at : null
    };
  }
  return best;
}

export default async (req) => {
  const url = new URL(req.url);
  const { brut, net: token } = jeton();

  if (!token) {
    return json({
      configured: false,
      reason: "DUFFEL_TOKEN absent de l'environnement du serveur.",
      flights: []
    });
  }

  // Rien de ce qui arrive n'est recopié tel quel dans la requête amont.
  const origin = String(url.searchParams.get("origin") || "").toUpperCase();
  const depart = String(url.searchParams.get("depart_date") || "");
  const retour = String(url.searchParams.get("return_date") || "");
  const adults = Number.parseInt(url.searchParams.get("adults") || "1", 10);
  const agesEnfants = entiers(url.searchParams.get("children_ages"), 2, 17);
  const agesBebes = entiers(url.searchParams.get("infants_ages_months"), 0, 23);
  const destinations = [...new Set(
    String(url.searchParams.get("destinations") || "").toUpperCase().split(",").map(d => d.trim()).filter(Boolean)
  )];

  if (!IATA.test(origin)) return json({ configured: true, error: "origin doit être un code IATA de 3 lettres." }, 400);
  if (!destinations.length) return json({ configured: true, error: "destinations est vide." }, 400);
  if (destinations.length > MAX_DESTINATIONS) return json({ configured: true, error: `${MAX_DESTINATIONS} destinations maximum par appel.` }, 400);
  if (destinations.some(d => !IATA.test(d))) return json({ configured: true, error: "chaque destination doit être un code IATA de 3 lettres." }, 400);
  if (destinations.includes(origin)) return json({ configured: true, error: "une destination ne peut pas être l'aéroport de départ." }, 400);
  // jourValide refuse aussi le 31 février, une date passée et une date au-delà de
  // l'horizon de vente : chacune partait en 12 appels amont pour rien.
  if (!jourValide(depart)) return json({ configured: true, error: "depart_date doit être une date réelle au format YYYY-MM-DD, ni passée ni au-delà de l'horizon de vente." }, 400);
  if (retour && !jourValide(retour)) return json({ configured: true, error: "return_date doit être une date réelle au format YYYY-MM-DD, ni passée ni au-delà de l'horizon de vente." }, 400);
  if (retour && retour <= depart) return json({ configured: true, error: "return_date doit suivre depart_date." }, 400);
  if (!(adults >= 1 && adults <= 9)) return json({ configured: true, error: "adults doit être compris entre 1 et 9." }, 400);
  if (adults + agesEnfants.length > 9) return json({ configured: true, error: "9 voyageurs assis maximum (adultes + enfants)." }, 400);
  if (agesBebes.length > adults) return json({ configured: true, error: "il faut au moins un adulte par bébé." }, 400);

  const pax = passagers(adults, agesEnfants, agesBebes);
  const signature = [origin, depart, retour, JSON.stringify(pax)].join("|");
  const echecs = [];

  const { resultats, abandonnees } = await parLots(destinations.map(dest => async () => {
    const cle = `${signature}|${dest}`;
    const hit = cache.lire(cle);
    // Une offre encore en cache mais périmée est rejetée : on redemande à l'amont.
    if (hit !== undefined && !perimee(hit)) return hit;

    const slices = [{ origin, destination: dest, departure_date: depart }];
    if (retour) slices.push({ origin: dest, destination: origin, departure_date: retour });

    try {
      const res = await fetch(`${ROUTE}?return_offers=true&supplier_timeout=7000`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "Duffel-Version": "v2",
          "content-type": "application/json",
          accept: "application/json"
        },
        body: JSON.stringify({ data: { slices, passengers: pax, cabin_class: "economy", max_connections: 1 } }),
        // Une redirection n'est jamais suivie : undici retire `authorization` en
        // inter-origine mais pas un en-tête maison, et suivre à l'aveugle enverrait
        // les identifiants chez l'hôte indiqué par l'amont. Un 3xx devient un échec.
        redirect: "manual",
        signal: AbortSignal.timeout(BUDGET_MS / 2)
      });

      // Le corps amont ne sort qu'expurgé et borné par motifEchec (duffel.mjs) — jamais tel quel.
      if (!res.ok) { echecs.push({ destination: dest, ...(await motifEchec(res)) }); return null; }

      const offre = meilleureOffre(await res.json(), dest);
      cache.ecrire(cle, offre);
      return offre;
    } catch (e) {
      echecs.push({ destination: dest, status: e.name });
      return null;
    }
  }), CONCURRENCE, BUDGET_MS);

  const flights = resultats.filter(Boolean).sort((a, b) => a.total - b.total);
  const devises = [...new Set(flights.map(f => f.currency).filter(Boolean))];

  return json({
    configured: true,
    mode: token.startsWith("duffel_test_") ? "test" : "live",
    origin,
    demandees: destinations.length,
    trouvees: flights.length,
    abandonnees,                               // lots non lancés faute de temps
    devises,            // Duffel impose la devise du compte : la page doit l'afficher telle quelle
    sansOffre: echecs,
    // Diagnostic affiché uniquement quand l'amont refuse l'authentification :
    // il aide à identifier un mauvais collage sans exposer la valeur.
    ...(echecs.some(e => e.status === 401) ? { jeton: empreinteJeton(brut) } : {}),
    flights
  }, 200, 300);
};

export const config = { path: "/api/flights" };
