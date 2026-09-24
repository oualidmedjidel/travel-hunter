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

import { API, IATA, jourValide, json, jeton, entetes, empreinteJeton, parLots, creerCache, CACHE_MS, entiers, motifEchec }
  from "../lib/duffel.mjs";

const ROUTE = `${API}/air/offer_requests`;
const MAX_DESTINATIONS = 12;
const CONCURRENCE = 6;
// Budget auto-imposé : au-delà, la page a déjà abandonné (30 s) et l'utilisateur attend.
// Plutôt que de tout perdre, on arrête de lancer de nouveaux lots passé ce délai et
// on renvoie ce qui est déjà remonté : une réponse partielle vaut mieux qu'un 502.
const BUDGET_MS = 18000;
const cache = creerCache(CACHE_MS, 300);

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

/**
 * Bagages **inclus** dans une offre, en nombre de pièces par voyageur.
 *
 * Mesuré sur une vraie réponse Duffel (19 offres, 2026-09-23) : l'allocation est déclarée
 * par passager ET par segment, sous `passengers[].baggages = [{type, quantity}]`, avec
 * `type` valant `checked` ou `carry_on`. Elle varie d'une offre à l'autre — 14 offres sur
 * 19 incluaient une soute, 5 aucune.
 *
 * On retient le **minimum sur tous les segments et tous les passagers** : c'est la
 * contrainte qui s'applique réellement au voyage. Une soute à l'aller mais pas au retour
 * n'est pas « une soute incluse ».
 *
 * ⚠️ Ce que Duffel ne donne PAS : le prix d'un bagage supplémentaire. `available_services`
 * était `null` sur les 19 offres, même en demandant `return_available_services=true`.
 * On ne chiffre donc aucun bagage payant — ce serait inventer un prix.
 */
export function bagagesInclus(offre) {
  const slices = Array.isArray(offre && offre.slices) ? offre.slices : [];
  let soute = null, cabine = null;
  for (const s of slices) {
    for (const seg of (Array.isArray(s.segments) ? s.segments : [])) {
      for (const pax of (Array.isArray(seg.passengers) ? seg.passengers : [])) {
        let pSoute = 0, pCabine = 0;
        for (const b of (Array.isArray(pax.baggages) ? pax.baggages : [])) {
          const q = Number.isFinite(b && b.quantity) ? b.quantity : 0;
          if (b && b.type === "checked") pSoute += q;
          if (b && b.type === "carry_on") pCabine += q;
        }
        soute = soute === null ? pSoute : Math.min(soute, pSoute);
        cabine = cabine === null ? pCabine : Math.min(cabine, pCabine);
      }
    }
  }
  // null, et non 0, quand l'amont n'a rien déclaré : « on ne sait pas » n'est pas « rien ».
  return { soute, cabine };
}

/**
 * Heure locale d'un horodatage Duffel, **en minutes depuis minuit**.
 *
 * Duffel rend `2026-11-05T09:55:00` — sans fuseau : c'est déjà l'heure locale de
 * l'aéroport, la seule qui intéresse un voyageur. On lit donc les chiffres du champ au
 * lieu de passer par `Date`, qui les réinterpréterait dans le fuseau du serveur et
 * décalerait un vol de Marrakech ou de Djerba.
 *
 * ⚠️ Les minutes comptent, et pas pour la beauté du geste : mesuré en production le
 * 2026-09-23, une comparaison en heures pleines laissait passer un atterrissage à
 * **20 h 35** sous la contrainte « retour posé avant 20 h ». L'étiquette mentait d'une
 * demi-heure.
 */
export function minutesLocales(iso) {
  const m = /T(\d{2}):(\d{2})/.exec(String(iso || ""));
  return m ? Number.parseInt(m[1], 10) * 60 + Number.parseInt(m[2], 10) : null;
}

/**
 * Offre la moins chère d'une réponse Duffel. null si la route ne renvoie rien.
 *
 * `souteMin` écarte les tarifs qui n'incluent pas assez de bagages en soute : pour une
 * famille, le vol à 200 € sans soute n'est pas moins cher que celui à 260 € avec, il est
 * juste incomparable. Une offre dont l'amont ne déclare rien n'est jamais écartée — on ne
 * punit pas un tarif pour un silence de la source.
 */
export function meilleureOffre(payload, destination, { souteMin = 0, departApres = null, retourAvant = null } = {}, rejets = {}) {
  const offres = payload && payload.data && Array.isArray(payload.data.offers) ? payload.data.offers : [];
  // Combien d'offres vues, combien écartées et par quelle règle. Sans ces compteurs, rendre
  // `null` était indistinguable d'un amont muet : mesuré en production le 2026-09-24,
  // retour_avant=1 rendait { trouvees:0, sansOffre:[] } — la destination disparaissait de
  // la réponse sans motif et la page lui inventait un tarif modélisé. Les compteurs sont
  // exacts dans ce cas précis : `best` reste null, donc le raccourci « déjà plus cher que
  // le meilleur » ci-dessous ne saute jamais un filtre tant que rien n'a été retenu.
  Object.assign(rejets, { vues: offres.length, soute: 0, departApres: 0, retourAvant: 0 });
  let best = null;

  for (const o of offres) {
    // total_amount est une chaîne décimale.
    const total = Number.parseFloat(o && o.total_amount);
    if (!Number.isFinite(total) || total <= 0) continue;
    if (best && total >= best.total) continue;

    const bagages = bagagesInclus(o);
    if (souteMin > 0 && bagages.soute !== null && bagages.soute < souteMin) { rejets.soute++; continue; }

    const slices = Array.isArray(o.slices) ? o.slices : [];
    const aller = slices[0] && Array.isArray(slices[0].segments) ? slices[0].segments : [];
    const retour = slices[1] && Array.isArray(slices[1].segments) ? slices[1].segments : [];

    // Tranche horaire. `departApres` porte sur le décollage de l'aller ; `retourAvant`
    // sur l'ATTERRISSAGE du retour — c'est l'heure où l'on rentre chez soi qui compte,
    // pas celle où l'on quitte la destination. Un horaire non déclaré ne fait jamais
    // écarter une offre : on n'invente pas une contrainte sur un silence.
    const mDepart = minutesLocales(aller[0] && aller[0].departing_at);
    const dernierRetour = retour.length ? retour[retour.length - 1] : null;
    const mRetour = minutesLocales(dernierRetour && (dernierRetour.arriving_at || dernierRetour.departing_at));
    // Les bornes sont exprimées en heures pleines et comparées à la minute : « pas avant
    // 8 h » accepte 8 h 00, « posé avant 20 h » refuse 20 h 01.
    if (departApres !== null && mDepart !== null && mDepart < departApres * 60) { rejets.departApres++; continue; }
    if (retourAvant !== null && mRetour !== null && mRetour > retourAvant * 60) { rejets.retourAvant++; continue; }
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
      arriveeRetourAt: dernierRetour && typeof dernierRetour.arriving_at === "string" ? dernierRetour.arriving_at : null,
      bagages,                                   // { soute, cabine } — inclus, jamais un prix
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
  // 0 = peu importe. Au-delà, on ne garde que les tarifs qui incluent la soute.
  const souteMin = Math.min(2, Math.max(0, Number.parseInt(url.searchParams.get("bagage_soute") || "0", 10) || 0));
  // Heures pleines, 0 à 23. Absent = aucune contrainte, et c'est le cas par défaut.
  const heure = (nom) => {
    const brut = url.searchParams.get(nom);
    if (brut === null || brut === "") return null;
    const h = Number.parseInt(brut, 10);
    return Number.isInteger(h) && h >= 0 && h <= 23 ? h : null;
  };
  const departApres = heure("depart_apres");
  const retourAvant = heure("retour_avant");
  const destinations = [...new Set(
    String(url.searchParams.get("destinations") || "").toUpperCase().split(",").map(d => d.trim()).filter(Boolean)
  )];

  // Un âge hors bornes refuse la requête : l'amputer silencieusement faisait tarifer
  // moins de voyageurs qu'il n'en a été demandé (constat D d'AUDIT.md).
  if (agesEnfants === null) return json({ configured: true, error: "children_ages : chaque âge doit être un entier de 2 à 17 ans." }, 400);
  if (agesBebes === null) return json({ configured: true, error: "infants_ages_months : chaque âge doit être un entier de 0 à 23 mois." }, 400);
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
    // Tous les filtres entrent dans la clé : deux recherches aux contraintes différentes
    // ne doivent jamais se resservir le même résultat.
    const cle = `${signature}|${souteMin}|${departApres}|${retourAvant}|${dest}`;
    const hit = cache.lire(cle);
    // Une offre encore en cache mais périmée est rejetée : on redemande à l'amont.
    if (hit !== undefined && !perimee(hit)) {
      // Le cache garde aussi les motifs, et il faut les republier à chaque hit : ce retour
      // sort AVANT les deux seuls push d'échec plus bas, donc sans ce rappel la 1re requête
      // disait pourquoi et les 59 minutes suivantes rendaient sansOffre:[] (CACHE_MS = 1 h).
      if (hit && hit.motif) { echecs.push(hit); return null; }
      return hit;
    }

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

      const rejets = {};
      const offre = meilleureOffre(await res.json(), dest, { souteMin, departApres, retourAvant }, rejets);
      // Pas d'offre retenue = la destination va disparaître de `flights` : elle doit dire
      // pourquoi, sinon la page lui invente un tarif modélisé sans un mot (195 € pour FAO,
      // mesuré le 2026-09-24). `motif` sépare les deux silences — l'amont n'a rien proposé,
      // ou rien de ce qu'il a proposé n'a été retenu, et les compteurs disent par quelle
      // règle — et il distingue en cache un motif d'une offre.
      const echec = offre ? null : { destination: dest, motif: rejets.vues ? "toutes-ecartees" : "aucune-offre", ...rejets };
      cache.ecrire(cle, offre || echec);
      if (echec) echecs.push(echec);
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
    souteMin,
    departApres,
    retourAvant,
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
