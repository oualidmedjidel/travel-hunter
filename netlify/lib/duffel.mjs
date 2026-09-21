/**
 * Commun aux fonctions Duffel (vols et hébergements).
 * Hors du dossier netlify/functions pour ne pas être empaqueté comme une fonction.
 */

export const API = "https://api.duffel.com";
export const IATA = /^[A-Z]{3}$/;
export const JOUR = /^\d{4}-\d{2}-\d{2}$/;

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
 * Empreinte d'un jeton, sans jamais le révéler : préfixe de famille, longueur et
 * espaces parasites. Assez pour diagnostiquer un copier-coller raté (une URL collée
 * à la place du jeton, par exemple), très loin d'être assez pour le reconstituer.
 */
export function empreinteJeton(brut) {
  const s = String(brut == null ? "" : brut);
  const net = s.trim();
  const m = net.match(/^([a-z]+_[a-z]+_)/);
  return {
    prefixe: m ? m[1] : (net.slice(0, 4) + "…"),
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

/** Liste d'entiers bornés depuis un paramètre « a,b,c ». */
export const entiers = (brut, lo, hi) => String(brut || "")
  .split(",").map(x => Number.parseInt(x.trim(), 10))
  .filter(n => Number.isFinite(n) && n >= lo && n <= hi);

/**
 * Motif d'échec amont : code et titre structurés quand l'amont parle la forme Duffel,
 * sinon un extrait borné à 160 caractères. Cet extrait EST un fragment du corps amont :
 * c'est le seul canal de diagnostic de la fonction (aucun journal côté serveur), et c'est
 * ce qui a tranché Duffel Stays (« This feature is not enabled for your account »).
 * `expurge` est donc la barrière : plus aucune séquence de forme secrète n'en ressort.
 */
export async function motifEchec(res) {
  const type = (res.headers.get("content-type") || "").split(";")[0] || null;
  let texte = "";
  try { texte = await res.text(); } catch {}

  // Aucune séquence ressemblant à un secret ne ressort, quoi qu'envoie l'amont : la
  // famille Duffel garde son préfixe (utile au diagnostic), et toute autre suite de 16
  // caractères ou plus sans séparateur — clé LiteAPI, jeton porteur, identifiant opaque —
  // devient ***. Les mots d'un message d'erreur réel restent bien en deçà de 16.
  const expurge = t => String(t)
    .replace(/duffel_(test|live)_[A-Za-z0-9_-]+/g, "duffel_***")
    .replace(/[A-Za-z0-9_-]{16,}/g, "***");

  let code = null, titre = null;
  try {
    const e = (JSON.parse(texte).errors || [])[0] || {};
    code = typeof e.code === "string" ? e.code : null;
    titre = typeof e.title === "string" ? expurge(e.title).slice(0, 80) : null;
  } catch {}

  return {
    status: res.status, type, code, titre,
    // extrait borné, utile quand le refus vient d'une passerelle et non de l'API
    ...(code || titre ? {} : { extrait: expurge(texte).replace(/\s+/g, " ").slice(0, 160) || null })
  };
}
