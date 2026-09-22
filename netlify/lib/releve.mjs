/**
 * Le relevé périodique — le moteur de la veille.
 *
 * Il n'interroge pas Duffel ni LiteAPI lui-même : il appelle les deux proxys existants
 * avec une `Request` fabriquée. Les fonctions sont déjà au format web standard
 * `(Request) => Response`, donc rien à réécrire, et surtout : **aucune règle dupliquée**.
 * Validation des dates, bornes des âges, expurgation des secrets, cache, budget de temps,
 * refus de suivre une redirection — tout ce qui protège `/api/flights` et `/api/stays`
 * protège aussi la veille, sans une ligne de plus.
 */
import vols from "../functions/flights.mjs";
import sejours from "../functions/stays.mjs";
import { lire, enregistrerReleve, cheminFichier } from "./veille.mjs";

/** Une Request locale : l'origine n'a aucune importance, seul le chemin est lu. */
const requete = (chemin, params) =>
  new Request(`http://veille.local${chemin}?${new URLSearchParams(params)}`);

/** Le moins cher par code, depuis la réponse d'un proxy. */
function moinsChers(liste, cle, champ = "total") {
  const out = {};
  for (const e of Array.isArray(liste) ? liste : []) {
    const code = e && e[cle];
    const prix = e && typeof e[champ] === "number" ? e[champ] : null;
    if (!code || prix === null) continue;
    if (out[code] === undefined || prix < out[code]) out[code] = prix;
  }
  return out;
}

/**
 * Un relevé pour une veille. Ne lève jamais : une panne d'un côté ne doit pas empêcher
 * d'enregistrer ce que l'autre a rendu, et surtout pas arrêter la boucle.
 */
export async function relever(veille, { appelVols = vols, appelSejours = sejours } = {}) {
  const c = veille.criteres;
  const commun = { adults: String(c.adults) };
  if (c.childrenAges && c.childrenAges.length) commun.children_ages = c.childrenAges.join(",");

  let volsTrouves = {}, hotels = {}, devise = null, mode = null, echecs = [];

  try {
    const r = await appelVols(requete("/api/flights", {
      ...commun, origin: c.origin, destinations: c.destinations.join(","),
      depart_date: c.depart, ...(c.retour ? { return_date: c.retour } : {})
    }));
    const d = await r.json();
    if (d.configured && !d.error) {
      volsTrouves = moinsChers(d.flights, "destination");
      devise = (d.devises || [])[0] || null;
      mode = d.mode || null;
    } else {
      echecs.push(`vols: ${d.error || d.reason || "non configuré"}`);
    }
  } catch (e) { echecs.push(`vols: ${e.name}`); }

  if (c.lieux && c.retour) {
    try {
      const r = await appelSejours(requete("/api/stays", {
        ...commun, lieux: c.lieux, check_in: c.depart, check_out: c.retour
      }));
      const d = await r.json();
      if (d.configured && !d.error) {
        hotels = moinsChers(d.stays, "cle");
        devise = devise || (d.devises || [])[0] || null;
        mode = mode || d.mode || null;
      } else {
        echecs.push(`hôtels: ${d.error || d.reason || "non configuré"}`);
      }
    } catch (e) { echecs.push(`hôtels: ${e.name}`); }
  }

  // Un relevé vide n'est pas enregistré : une série de zéros ressemblerait à des prix
  // effondrés, alors que c'est l'amont qui n'a rien dit.
  const vide = !Object.keys(volsTrouves).length && !Object.keys(hotels).length;
  if (vide) return { id: veille.id, enregistre: false, echecs };

  await enregistrerReleve(veille.id, { vols: volsTrouves, hotels, devise, mode });
  return { id: veille.id, enregistre: true, vols: Object.keys(volsTrouves).length,
           hotels: Object.keys(hotels).length, echecs };
}

/** Toutes les veilles, l'une après l'autre : rien ne presse, et l'amont a des quotas. */
export async function releverToutes(chemin = cheminFichier(), options = {}) {
  const d = await lire(chemin);
  const resultats = [];
  for (const v of d.veilles) {
    try { resultats.push(await relever(v, options)); }
    catch (e) { resultats.push({ id: v.id, enregistre: false, echecs: [e.name] }); }
  }
  return resultats;
}

/**
 * Boucle de fond, démarrée par serveur.mjs.
 *
 * `VEILLE_HEURES` règle la cadence (6 h par défaut, 0 la désactive). Le premier relevé
 * attend une minute : au démarrage, le serveur a mieux à faire que de lancer douze
 * requêtes amont pendant que les premiers visiteurs arrivent.
 */
export function demarrerBoucle(journal = console) {
  const heures = Number.parseFloat(process.env.VEILLE_HEURES ?? "6");
  if (!(heures > 0)) { journal.log("veille désactivée (VEILLE_HEURES=0)"); return null; }
  if (!process.env.DUFFEL_TOKEN && !process.env.LITEAPI_KEY) {
    journal.log("veille inactive : aucune clé, un relevé ne rendrait que des refus");
    return null;
  }

  const tour = async () => {
    try {
      const r = await releverToutes();
      const ok = r.filter(x => x.enregistre).length;
      if (r.length) journal.log(`veille : ${ok}/${r.length} relevés enregistrés`);
    } catch (e) {
      journal.error("veille : tour manqué —", e && e.message);
    }
  };

  const premier = setTimeout(tour, 60_000);
  const suivants = setInterval(tour, heures * 3600_000);
  journal.log(`veille active : un relevé toutes les ${heures} h`);
  return () => { clearTimeout(premier); clearInterval(suivants); };
}
