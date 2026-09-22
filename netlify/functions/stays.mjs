/**
 * Proxy hébergements — fonction au format web standard `(Request) => Response`,
 * route /api/stays. Servie par serveur.mjs.
 *
 * DEUX fournisseurs, choisis par la clé présente dans l'environnement :
 *
 *   LITEAPI_KEY  → LiteAPI / Nuitee Connect   (préféré : inscription libre)
 *   DUFFEL_TOKEN → Duffel Stays               (repli : demande une activation
 *                                              commerciale, 403 sinon)
 *
 * Aucune clé n'est jamais renvoyée au navigateur.
 *
 * ── LiteAPI ──────────────────────────────────────────────────────────────────
 * Contrat relevé sur la documentation le 2026-09-21, exemples bruts à l'appui.
 *   POST https://api.liteapi.travel/v3.0/hotels/rates
 *   en-tête : X-API-Key
 *   corps   : { occupancies:[{adults,children:[ages]}], currency, guestNationality,
 *               checkin, checkout, latitude, longitude, radius, limit,
 *               includeHotelData:true }
 *   réponse : { data:[ { hotelId, roomTypes:[ { offerRetailRate:{amount,currency},
 *                        rates:[ { retailRate:{ total:[{amount,currency}] },
 *                                  boardName, boardType } ] } ] } ],
 *               hotels:[ { id, name, stars, rating, main_photo, address } ] }
 *
 *   Pièges :
 *    - `radius` est en MÈTRES (« Search radius in meters »), pas en kilomètres.
 *    - les montants sont des NOMBRES (197.53), pas des chaînes comme chez Duffel.
 *    - `offerRetailRate` est le total au niveau de l'OFFRE, toutes chambres
 *      confondues ; `retailRate.total` est par chambre. On privilégie le premier.
 *    - `guestNationality` est requis.
 *
 * ── Duffel Stays ─────────────────────────────────────────────────────────────
 *   POST https://api.duffel.com/stays/search
 *   corps   : { data:{ rooms, check_in_date, check_out_date, guests,
 *                      location:{ radius (km), geographic_coordinates } } }
 *   réponse : { data:{ results:[ { cheapest_rate_total_amount (CHAÎNE),
 *                                  cheapest_rate_currency, accommodation:{…} } ] } }
 */

import { API, JOUR, json, jeton, entetes, empreinteJeton, parLots, creerCache, entiers, motifEchec }
  from "../lib/duffel.mjs";

const LITEAPI = "https://api.liteapi.travel/v3.0/hotels/rates";
const MAX_LIEUX = 12;
const CONCURRENCE = 6;
const BUDGET_MS = 18000;
const RAYON_M = 12000;        // 12 km : couvre une ville et sa côte
const NATIONALITE = "FR";
const cache = creerCache(15 * 60 * 1000, 300);

/** Codes de pension LiteAPI → valeurs du formulaire. */
export const PENSIONS_LITE = {
  RO: null, BB: "petit-dej", HB: "demi-pension",
  FB: "complet", AI: "all-inclusive", TI: "all-inclusive",
  BD: "demi-pension", BL: "demi-pension"
};

/** Une entrée d'occupation par chambre, voyageurs répartis au plus juste. */
export function occupations(adults, agesEnfants, nbChambres) {
  const out = Array.from({ length: nbChambres }, () => ({ adults: 0, children: [] }));
  for (let i = 0; i < adults; i++) out[i % nbChambres].adults++;
  agesEnfants.forEach((a, i) => out[i % nbChambres].children.push(Math.min(17, Math.max(0, Math.round(a)))));
  // une chambre sans adulte n'est pas réservable : on rééquilibre
  for (const o of out) if (o.adults === 0) { const d = out.find(x => x.adults > 1); if (d) { d.adults--; o.adults++; } }
  return out.map(o => (o.children.length ? o : { adults: o.adults }));
}

/** 3 couchages par chambre, bébés non comptés. Jamais plus de chambres que d'adultes :
 *  une chambre sans adulte n'est pas réservable et occupations() ne pourrait pas la rééquilibrer. */
export const chambres = (adults, nbEnfants) => Math.max(1, Math.min(adults, Math.ceil((adults + nbEnfants) / 3)));

/** Voyageurs au format Duffel Stays. */
export function invites(adults, agesEnfants, agesBebesMois) {
  const out = [];
  for (let i = 0; i < adults; i++) out.push({ type: "adult" });
  for (const a of agesEnfants) out.push({ type: "adult", age: Math.min(17, Math.max(2, Math.round(a))) });
  for (const m of agesBebesMois) out.push({ type: "adult", age: Math.min(1, Math.max(0, Math.floor(m / 12))) });
  return out;
}

const nb = v => { const n = typeof v === "string" ? Number.parseFloat(v) : v; return Number.isFinite(n) ? n : null; };

/**
 * Meilleure offre d'une réponse LiteAPI.
 * `pensionVoulue` privilégie une formule de restauration, sans jamais écarter
 * le séjour s'il n'existe pas de tarif dans cette formule.
 */
export function meilleurLiteApi(payload, cle, pensionVoulue, rooms = 1) {
  const data = payload && Array.isArray(payload.data) ? payload.data : [];
  const hotels = payload && Array.isArray(payload.hotels) ? payload.hotels : [];
  const parId = new Map(hotels.filter(h => h && h.id != null).map(h => [String(h.id), h]));

  let best = null;
  for (const offre of data) {
    if (!offre || !Array.isArray(offre.roomTypes)) continue;

    for (const rt of offre.roomTypes) {
      if (!rt) continue;
      // offerRetailRate couvre toutes les chambres ; retailRate.total est par chambre.
      const auNiveauOffre = rt.offerRetailRate && nb(rt.offerRetailRate.amount);
      const tarifs = Array.isArray(rt.rates) ? rt.rates : [];

      for (const r of tarifs) {
        const t0 = r && r.retailRate && Array.isArray(r.retailRate.total) ? r.retailRate.total[0] : null;
        // Les deux branches doivent produire un total POUR TOUT LE SÉJOUR, toutes chambres :
        // c'est ce que la page consomme, et c'est ce que le tri ci-dessous compare.
        // offerRetailRate l'est déjà ; retailRate.total est par chambre, d'où × rooms.
        const parChambre = t0 ? nb(t0.amount) : null;
        const montant = auNiveauOffre != null
          ? auNiveauOffre
          : (parChambre != null ? parChambre * rooms : null);
        if (montant == null || montant <= 0) continue;

        const code = typeof r.boardType === "string" ? r.boardType.toUpperCase() : null;
        const pension = code && Object.hasOwn(PENSIONS_LITE, code) ? PENSIONS_LITE[code] : null;
        const correspond = pensionVoulue ? pension === pensionVoulue : false;

        // à prix égal on préfère la bonne pension ; une meilleure pension ne
        // justifie pas de payer plus cher sans le dire
        const mieux = !best
          || (correspond && !best.pensionCorrespond)
          || (correspond === best.pensionCorrespond && montant < best.total);
        if (!mieux) continue;

        const h = parId.get(String(offre.hotelId)) || {};
        best = {
          cle,
          total: Math.round(montant * 100) / 100,
          currency: (t0 && typeof t0.currency === "string" ? t0.currency : null)
            || (rt.offerRetailRate && typeof rt.offerRetailRate.currency === "string" ? rt.offerRetailRate.currency : null),
          publicAmount: rt.suggestedSellingPrice && nb(rt.suggestedSellingPrice.amount) != null
            ? Math.round(nb(rt.suggestedSellingPrice.amount) * 100) / 100 : null,
          nom: typeof h.name === "string" ? h.name : null,
          etoiles: nb(h.stars),
          note: nb(h.rating),
          avis: nb(h.reviewCount),
          ville: typeof h.city === "string" ? h.city : (typeof h.address === "string" ? h.address : null),
          photo: typeof h.main_photo === "string" ? h.main_photo : null,
          pension,
          pensionNom: typeof r.boardName === "string" ? r.boardName : null,
          pensionCorrespond: correspond,
          rooms,
          fournisseur: "liteapi"
        };
      }
    }
  }
  return best;
}

/** Meilleure offre d'une réponse Duffel Stays. */
export function meilleurDuffel(payload, cle) {
  const res = payload && payload.data && Array.isArray(payload.data.results) ? payload.data.results : [];
  let best = null;

  for (const r of res) {
    // cheapest_rate_total_amount est une CHAÎNE couvrant tout le séjour.
    const total = nb(r && r.cheapest_rate_total_amount);
    if (total == null || total <= 0) continue;
    if (best && total >= best.total) continue;

    const a = r.accommodation || {};
    best = {
      cle,
      total: Math.round(total * 100) / 100,
      currency: typeof r.cheapest_rate_currency === "string" ? r.cheapest_rate_currency : null,
      publicAmount: nb(r.cheapest_rate_public_amount) != null
        ? Math.round(nb(r.cheapest_rate_public_amount) * 100) / 100 : null,
      nom: typeof a.name === "string" ? a.name : null,
      etoiles: nb(a.rating),
      note: nb(a.review_score),
      avis: nb(a.review_count),
      ville: a.location && a.location.address && typeof a.location.address.city_name === "string"
        ? a.location.address.city_name : null,
      photo: Array.isArray(a.photos) && a.photos[0] && typeof a.photos[0].url === "string" ? a.photos[0].url : null,
      pension: null, pensionNom: null, pensionCorrespond: false,
      rooms: Number.isFinite(r.rooms) ? r.rooms : null,
      fournisseur: "duffel"
    };
  }
  return best;
}

/**
 * Bac à sable ou production, d'après le préfixe de la clé LiteAPI.
 *
 * Le tableau de bord Nuitee distribue une clé `sand_…` gratuitement et réserve la clé
 * `prod_…` aux comptes ayant enregistré un moyen de paiement — relevé le 2026-09-22. La
 * clé de bac à sable répond avec des données d'exemple : sans ce champ, la page
 * afficherait « hôtel réel » au-dessus de prix inventés.
 *
 * Seul un `prod_` explicite vaut « live ». Une clé de forme inconnue est déclarée « test »,
 * jamais l'inverse : un badge « réel » ne doit jamais surmonter une donnée douteuse.
 */
export const modeLite = cle => String(cle || "").trim().startsWith("prod_") ? "live" : "test";

/** « CLE:lat,lon;… » → [{cle, lat, lon}]. Rejette tout ce qui n'est pas exploitable. */
export function lireLieux(brut) {
  const out = [];
  for (const part of String(brut || "").split(";")) {
    const m = part.trim().match(/^([A-Za-z0-9_-]{1,12}):(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/);
    if (!m) continue;
    const lat = Number.parseFloat(m[2]), lon = Number.parseFloat(m[3]);
    if (!(lat >= -90 && lat <= 90) || !(lon >= -180 && lon <= 180)) continue;
    out.push({ cle: m[1].toUpperCase(), lat, lon });
  }
  return out.filter((v, i) => out.findIndex(x => x.cle === v.cle) === i);
}

export default async (req) => {
  const url = new URL(req.url);
  const cleLite = typeof process.env.LITEAPI_KEY === "string" ? process.env.LITEAPI_KEY.trim() : null;
  const { brut: duffelBrut, net: duffelToken } = jeton();
  const fournisseur = cleLite ? "liteapi" : (duffelToken ? "duffel" : null);

  if (!fournisseur) {
    return json({
      configured: false,
      reason: "Ni LITEAPI_KEY ni DUFFEL_TOKEN dans l'environnement du serveur.",
      stays: []
    });
  }

  const arrivee = String(url.searchParams.get("check_in") || "");
  const depart = String(url.searchParams.get("check_out") || "");
  const adults = Number.parseInt(url.searchParams.get("adults") || "1", 10);
  const agesEnfants = entiers(url.searchParams.get("children_ages"), 2, 17);
  const agesBebes = entiers(url.searchParams.get("infants_ages_months"), 0, 23);
  const pension = String(url.searchParams.get("pension") || "") || null;
  const lieux = lireLieux(url.searchParams.get("lieux"));

  if (!lieux.length) return json({ configured: true, error: "lieux est vide ou mal formé (attendu « CLE:lat,lon;… »)." }, 400);
  if (lieux.length > MAX_LIEUX) return json({ configured: true, error: `${MAX_LIEUX} lieux maximum par appel.` }, 400);
  if (!JOUR.test(arrivee)) return json({ configured: true, error: "check_in doit être au format YYYY-MM-DD." }, 400);
  if (!JOUR.test(depart)) return json({ configured: true, error: "check_out doit être au format YYYY-MM-DD." }, 400);
  if (depart <= arrivee) return json({ configured: true, error: "check_out doit suivre check_in." }, 400);
  if (!(adults >= 1 && adults <= 9)) return json({ configured: true, error: "adults doit être compris entre 1 et 9." }, 400);
  if (adults + agesEnfants.length > 9) return json({ configured: true, error: "9 voyageurs maximum (adultes + enfants)." }, 400);
  if (agesBebes.length > adults) return json({ configured: true, error: "il faut au moins un adulte par bébé." }, 400);

  const rooms = chambres(adults, agesEnfants.length);
  const signature = [fournisseur, arrivee, depart, rooms, adults, agesEnfants.join(","), pension].join("|");
  const echecs = [];

  const { resultats, abandonnees } = await parLots(lieux.map(l => async () => {
    const cle = `${signature}|${l.cle}|${l.lat},${l.lon}`;
    const hit = cache.lire(cle);
    if (hit !== undefined) return hit;

    try {
      let res, sejour;
      if (fournisseur === "liteapi") {
        res = await fetch(LITEAPI, {
          method: "POST",
          headers: { "X-API-Key": cleLite, "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({
            occupancies: occupations(adults, agesEnfants, rooms),
            currency: "EUR",
            guestNationality: NATIONALITE,
            checkin: arrivee,
            checkout: depart,
            latitude: l.lat, longitude: l.lon,
            radius: RAYON_M,          // mètres
            limit: 25,
            includeHotelData: true
          }),
          signal: AbortSignal.timeout(BUDGET_MS / 2)
        });
        if (!res.ok) { echecs.push({ cle: l.cle, ...(await motifEchec(res)) }); return null; }
        sejour = meilleurLiteApi(await res.json(), l.cle, pension, rooms);
      } else {
        res = await fetch(`${API}/stays/search`, {
          method: "POST",
          headers: entetes(duffelToken),
          body: JSON.stringify({
            data: {
              rooms, check_in_date: arrivee, check_out_date: depart,
              guests: invites(adults, agesEnfants, agesBebes),
              location: { radius: Math.round(RAYON_M / 1000), geographic_coordinates: { latitude: l.lat, longitude: l.lon } }
            }
          }),
          signal: AbortSignal.timeout(BUDGET_MS / 2)
        });
        if (!res.ok) { echecs.push({ cle: l.cle, ...(await motifEchec(res)) }); return null; }
        sejour = meilleurDuffel(await res.json(), l.cle);
      }
      cache.ecrire(cle, sejour);
      return sejour;
    } catch (e) {
      echecs.push({ cle: l.cle, status: e.name });
      return null;
    }
  }), CONCURRENCE, BUDGET_MS);

  const stays = resultats.filter(Boolean).sort((a, b) => a.total - b.total);
  const devises = [...new Set(stays.map(s => s.currency).filter(Boolean))];
  const auth401 = echecs.some(e => e.status === 401 || e.status === 403);

  return json({
    configured: true,
    fournisseur,
    mode: fournisseur === "duffel"
      ? (duffelToken.startsWith("duffel_test_") ? "test" : "live")
      : modeLite(cleLite),
    demandes: lieux.length,
    trouves: stays.length,
    abandonnes: abandonnees,
    nuits: Math.round((new Date(depart + "T12:00:00") - new Date(arrivee + "T12:00:00")) / 864e5),
    rooms,
    devises,
    sansOffre: echecs,
    ...(auth401 && fournisseur === "duffel" ? { jeton: empreinteJeton(duffelBrut) } : {}),
    ...(auth401 && fournisseur === "liteapi" ? { cle: empreinteJeton(process.env.LITEAPI_KEY) } : {}),
    stays
  }, 200, 300);
};

export const config = { path: "/api/stays" };
