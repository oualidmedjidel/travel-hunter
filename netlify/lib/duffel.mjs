/**
 * Commun aux fonctions Duffel (vols et hébergements).
 * Hors du dossier netlify/functions pour ne pas être empaqueté comme une fonction.
 */

export const API = "https://api.duffel.com";
export const IATA = /^[A-Z]{3}$/;
export const JOUR = /^\d{4}-\d{2}-\d{2}$/;

/** Horizon de vente : au-delà, aucun fournisseur ne tarife, l'appel est gaspillé. */
export const HORIZON_JOURS = 400;
const JOUR_MS = 86400000;

/** Minuit UTC d'une chaîne AAAA-MM-JJ déjà validée par JOUR, ou NaN. */
const versUtc = s => Date.parse(s + "T00:00:00Z");

/**
 * Date réelle ET exploitable. `JOUR` ne vérifie que la forme : `2026-02-31`, `2026-13-01`
 * et `2026-00-10` la traversaient et partaient chez le fournisseur.
 *
 * Trois refus, tous mesurés comme émettant jusqu'à 12 appels amont avant ce correctif :
 *  - date calendairement impossible (31 février) ;
 *  - date passée — personne ne réserve un vol pour 2020 ;
 *  - date au-delà de l'horizon de vente (9999-12-31 déclenchait 12 requêtes pour rien).
 *
 * Une journée de tolérance sur le passé : le serveur est en UTC, un visiteur peut être
 * la veille, et refuser « aujourd'hui » à cause d'un fuseau serait un faux refus.
 */
export function jourValide(s, maintenant = Date.now()) {
  if (!JOUR.test(s)) return false;
  const [a, m, j] = s.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1, j));
  if (d.getUTCFullYear() !== a || d.getUTCMonth() !== m - 1 || d.getUTCDate() !== j) return false;
  // Comparaison de JOUR à JOUR, pas d'instant à instant : avec `maintenant` à midi,
  // « hier » tombait du mauvais côté d'un décalage de 24 h et se faisait refuser.
  const jourZero = Math.floor(maintenant / JOUR_MS) * JOUR_MS;
  const t = versUtc(s);
  return t >= jourZero - JOUR_MS && t <= jourZero + HORIZON_JOURS * JOUR_MS;
}

/** Nombre de nuits entre deux jours validés. */
export const nuitsEntre = (a, b) => Math.round((versUtc(b) - versUtc(a)) / JOUR_MS);

export const json = (body, status = 200, maxAge = 0) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": maxAge ? `public, max-age=${maxAge}` : "no-store"
    }
  });

/**
 * Jeton nettoyé. Un retour à la ligne collé avec la valeur rend l'en-tête
 * Authorization invalide et produit un 401 indistinguable d'un mauvais jeton.
 */
export function jeton() {
  const brut = process.env.DUFFEL_TOKEN;
  return { brut, net: typeof brut === "string" ? brut.trim() : brut };
}

export const entetes = (t) => ({
  authorization: `Bearer ${t}`,
  "Duffel-Version": "v2",
  "content-type": "application/json",
  accept: "application/json"
});

/**
 * Empreinte d'un jeton, sans jamais en révéler un seul caractère.
 *
 * L'ancienne version rendait `net.slice(0, 4) + "…"` dès que la valeur ne portait pas
 * un préfixe de forme `lettres_lettres_`. Pour un jeton Duffel c'était inoffensif —
 * `duffel_test_` est public — mais pour une clé LiteAPI, ou toute clé de forme libre,
 * c'était quatre caractères du secret livrés au navigateur. Pire, le motif
 * `^([a-z]+_[a-z]+_)` recopiait tout jusqu'au deuxième souligné : « prod_secretvalue_ »
 * sortait en entier. Ce champ voyage dans la réponse JSON dès qu'un 401 ou un 403 remonte.
 *
 * Deux listes, et rien d'autre ne sort :
 *  - FAMILLES : préfixes de fournisseurs, valeurs publiques connues d'avance.
 *  - COLLAGES : marqueurs de structure qui trahissent un copier-coller raté. Un guillemet,
 *    « Bearer », « http », « NOM_DE_VARIABLE= » ne sont jamais de la matière secrète, et
 *    c'est précisément ce qu'on cherche à diagnostiquer. Sans eux, les quatre erreurs de
 *    collage les plus courantes rendraient toutes la même réponse muette.
 */
const FAMILLES = /^(?:duffel_(?:test|live)_|sand_|prod_|pk_(?:test|live)_|sk_(?:test|live)_)/;
const COLLAGES = [
  [/^["']/, "guillemet en tête"],
  [/^Bearer\s/i, "préfixe Bearer"],
  [/^https?:\/\//i, "URL collée"],
  [/^[A-Za-z][A-Za-z0-9_]*=/, "ligne VARIABLE= collée"]
];

export function empreinteJeton(brut) {
  const s = String(brut == null ? "" : brut);
  const net = s.trim();
  const famille = net.match(FAMILLES);
  const collage = COLLAGES.find(([motif]) => motif.test(net));
  return {
    // Image finie : un préfixe public, un libellé fixe, ou rien. Jamais un extrait.
    prefixe: famille ? famille[0] : (collage ? collage[1] : "forme inconnue"),
    longueur: net.length,
    espacesParasites: net.length !== s.length,
    contientEspaceInterne: /\s/.test(net),
    vide: net.length === 0
  };
}

/**
 * Exécute les tâches par lots. `budgetMs` borne le temps total : les lots non lancés
 * rendent null. Renvoie { resultats, abandonnees } — un objet plutôt qu'un tableau
 * décoré d'une propriété, qui casse deepEqual et surprend le prochain lecteur.
 */
export async function parLots(taches, taille, budgetMs = Infinity) {
  const fin = Date.now() + budgetMs;
  const resultats = [];
  let abandonnees = 0;
  for (let i = 0; i < taches.length; i += taille) {
    const lot = taches.slice(i, i + taille);
    if (Date.now() >= fin) { abandonnees += lot.length; resultats.push(...lot.map(() => null)); continue; }
    resultats.push(...await Promise.all(lot.map(t => t())));
  }
  return { resultats, abandonnees };
}

/**
 * Durée de vie du cache mémoire, la même pour les deux proxys.
 *
 * Passée de 15 min à 1 h le 2026-09-23 : un comparateur émet beaucoup de recherches pour
 * zéro réservation, et les fournisseurs conditionnent leur gratuité à ce rapport. Quatre
 * fois moins d'appels amont pour le même service rendu.
 *
 * Ce que ça coûte : un tarif hôtelier peut avoir jusqu'à une heure. Côté vols, rien —
 * `perimee()` écarte déjà du cache toute offre dont Duffel a annoncé l'expiration, et
 * les offres expirent bien avant une heure.
 */
export const CACHE_MS = 60 * 60 * 1000;

/** Cache mémoire borné, par instance de fonction. */
export function creerCache(ttlMs, maxEntrees) {
  const m = new Map();
  return {
    lire(cle) {
      const hit = m.get(cle);
      return hit && Date.now() - hit.t < ttlMs ? hit.v : undefined;
    },
    ecrire(cle, v) {
      m.set(cle, { t: Date.now(), v });
      if (m.size > maxEntrees) m.delete(m.keys().next().value);
    }
  };
}

/**
 * Liste d'entiers bornés depuis un paramètre « a,b,c ». **null** si l'un d'eux sort des
 * bornes ou n'est pas un entier — l'appelant doit alors refuser la requête.
 *
 * Le `.filter()` d'origine AMPUTAIT en silence : `entiers("1,5", 2, 17)` rendait `[5]`,
 * et `passagers(2, [5], [])` partait chez Duffel avec **3 voyageurs pour 4 demandés**.
 * Le tarif revenait pour trois personnes et s'affichait sous un badge de tarif réel.
 * Côté séjours, le même trou faisait disparaître l'enfant de `occupations()`.
 *
 * Un paramètre absent ou vide reste une liste vide : c'est « aucun enfant », pas une
 * erreur. Un créneau vide (« 5,,9 ») devient 0 et se fait donc refuser côté enfants
 * (bornes 2..17) ; côté bébés il compte un bébé de 0 mois — on sur-compte, jamais
 * l'inverse, et le prix penche du bon côté.
 */
export const entiers = (brut, lo, hi) => {
  const net = String(brut == null ? "" : brut).trim();
  if (!net) return [];
  const out = net.split(",").map(Number);
  return out.every(n => Number.isInteger(n) && n >= lo && n <= hi) ? out : null;
};

/**
 * Retire d'un texte toute trace des secrets, en deux temps.
 *
 * 1. Les VALEURS RÉELLES d'abord, telles qu'elles vivent dans l'environnement. C'est la
 *    seule barrière qui ne dépende pas de la forme du secret : l'heuristique ci-dessous
 *    laissait passer une clé de 15 caractères (le seuil est 16) et toute clé contenant un
 *    point ou un deux-points (hors du jeu `[A-Za-z0-9_-]`, donc découpée en morceaux courts).
 *    Un amont qui renvoie la clé en écho — « Invalid API key: abc123XYZ789def » — la
 *    reversait intégralement au navigateur.
 * 2. L'heuristique ensuite, pour ce que l'environnement ne connaît pas : jeton d'un autre
 *    service, identifiant opaque d'une passerelle.
 */
export function expurge(texte, secrets = [process.env.DUFFEL_TOKEN, process.env.LITEAPI_KEY]) {
  let t = String(texte);
  for (const brut of secrets) {
    const v = typeof brut === "string" ? brut.trim() : "";
    if (v.length >= 4) t = t.split(v).join("***");
  }
  return t
    .replace(/duffel_(test|live)_[A-Za-z0-9_-]+/g, "duffel_***")
    .replace(/[A-Za-z0-9_-]{16,}/g, "***");
}

/**
 * Motif d'échec amont : code et titre structurés quand l'amont parle la forme Duffel,
 * sinon un extrait borné à 160 caractères. Cet extrait EST un fragment du corps amont :
 * c'est le seul canal de diagnostic de la fonction (aucun journal côté serveur), et c'est
 * ce qui a tranché Duffel Stays (« This feature is not enabled for your account »).
 *
 * TOUT ce qui ressort passe par `expurge`, `code` compris. Il ne le faisait pas : le
 * commentaire d'origine affirmait le contraire de ce que faisait le code, et un corps
 * `{"errors":[{"code":"<la clé>"}]}` suffisait à publier le secret en entier.
 */
export async function motifEchec(res) {
  const type = (res.headers.get("content-type") || "").split(";")[0] || null;
  let texte = "";
  try { texte = await res.text(); } catch {}

  let code = null, titre = null;
  try {
    const e = (JSON.parse(texte).errors || [])[0] || {};
    code = typeof e.code === "string" ? expurge(e.code).slice(0, 60) : null;
    titre = typeof e.title === "string" ? expurge(e.title).slice(0, 80) : null;
  } catch {}

  return {
    status: res.status, type, code, titre,
    // extrait borné, utile quand le refus vient d'une passerelle et non de l'API
    ...(code || titre ? {} : { extrait: expurge(texte).replace(/\s+/g, " ").slice(0, 160) || null })
  };
}
