/**
 * Veille — ce qui rend le mot « hunter » vrai : surveiller un prix dans le temps.
 *
 * Trois partis pris, tous pour ne pas dupliquer une règle qui vit déjà ailleurs :
 *
 * 1. **On ne stocke que ce que l'amont a dit.** Le total d'un séjour (vol + hôtel +
 *    transfert × chambres × pension) est calculé par la page, et cette règle n'a pas à
 *    exister une seconde fois ici. Un relevé garde donc le vol le moins cher par
 *    destination et l'hébergement le moins cher par lieu, tels que rendus par les deux
 *    proxys — des nombres, pas un modèle.
 *
 * 2. **Aucun compte.** Une veille appartient à un `proprietaire` : un identifiant
 *    aléatoire que la page garde dans son `localStorage`. Qui perd son navigateur perd
 *    ses veilles ; c'est le prix à payer pour n'avoir ni inscription ni mot de passe.
 *
 * 3. **Un fichier JSON, pas une base.** Le site n'a pas de base de données, en ouvrir
 *    une pour quelques dizaines de lignes serait hors de proportion. Écriture atomique
 *    (fichier temporaire puis `rename`) pour qu'un redémarrage au mauvais moment ne
 *    laisse jamais un JSON tronqué.
 *
 * ponytail: plafond — tout le fichier est relu et réécrit à chaque changement, et
 * l'historique est borné à MAX_RELEVES par veille. À quelques centaines de veilles, il
 * faudra une vraie base ; en dessous, ceci suffit et se lit d'un coup d'œil.
 */
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
// La règle de date vit dans duffel.mjs et nulle part ailleurs : calendrier réel, ni date
// passée, ni au-delà de l'horizon de vente. Une veille posée sur le 31 février ne
// produirait que des 400 à chaque relevé.
import { jourValide } from "./duffel.mjs";

export const MAX_VEILLES_PAR_PROPRIETAIRE = 5;
export const MAX_RELEVES = 120;          // à un relevé toutes les 6 h : 30 jours d'historique
export const MAX_VEILLES_TOTAL = 500;    // garde-fou : le fichier reste lisible d'un coup d'œil

/**
 * Emplacement du fichier. **Hors du dépôt** : un `git pull` ne doit jamais l'écraser, et
 * `git status` ne doit pas le voir. Par défaut, le dossier PARENT du projet — sur le
 * serveur, `/srv/customer/sites/` — qui survit aux mises à jour comme aux redémarrages.
 *
 * `VEILLE_FICHIER` l'emporte (les tests s'en servent) ; si le parent n'est pas
 * accessible en écriture, `VEILLE_DOSSIER` permet de le déplacer sans toucher au code.
 */
export function cheminFichier() {
  if (process.env.VEILLE_FICHIER) return process.env.VEILLE_FICHIER;
  const racine = process.env.VEILLE_DOSSIER || join(process.cwd(), "..");
  return join(racine, "travel-hunter-veilles.json");
}

/** Lecture tolérante : un fichier absent ou illisible vaut « aucune veille ». */
export async function lire(chemin = cheminFichier()) {
  try {
    const brut = await readFile(chemin, "utf8");
    const d = JSON.parse(brut);
    return Array.isArray(d && d.veilles) ? d : { veilles: [] };
  } catch {
    return { veilles: [] };
  }
}

/** Écriture atomique : personne ne doit pouvoir lire un JSON à moitié écrit. */
export async function ecrire(donnees, chemin = cheminFichier()) {
  await mkdir(dirname(chemin), { recursive: true }).catch(() => {});
  const provisoire = `${chemin}.${process.pid}.tmp`;
  await writeFile(provisoire, JSON.stringify(donnees), "utf8");
  await rename(provisoire, chemin);
}

const IATA = /^[A-Z]{3}$/;
/** « CLE:lat,lon;… », la forme qu'attend /api/stays. */
const LIEUX = /^[A-Za-z0-9_-]{1,12}:-?\d+(\.\d+)?,-?\d+(\.\d+)?(;[A-Za-z0-9_-]{1,12}:-?\d+(\.\d+)?,-?\d+(\.\d+)?)*$/;

/**
 * Critères d'une veille, assainis. Rend null si la saisie n'est pas exploitable —
 * une veille qui produirait un 400 à chaque relevé n'a aucune raison d'exister.
 */
export function criteresValides(brut) {
  if (!brut || typeof brut !== "object") return null;
  const origin = String(brut.origin || "").toUpperCase();
  const destinations = [...new Set(
    (Array.isArray(brut.destinations) ? brut.destinations : [])
      .map(d => String(d).toUpperCase().trim()).filter(Boolean)
  )].slice(0, 12);
  if (!IATA.test(origin)) return null;
  if (!destinations.length || destinations.some(d => !IATA.test(d))) return null;
  if (destinations.includes(origin)) return null;
  if (!jourValide(String(brut.depart || ""))) return null;
  if (brut.retour && !jourValide(String(brut.retour))) return null;
  if (brut.retour && String(brut.retour) <= String(brut.depart)) return null;
  const adults = Number.parseInt(brut.adults, 10);
  if (!(adults >= 1 && adults <= 9)) return null;
  const ages = (Array.isArray(brut.childrenAges) ? brut.childrenAges : [])
    .map(a => Number.parseInt(a, 10)).filter(a => Number.isInteger(a) && a >= 2 && a <= 17);
  // Les coordonnées viennent de la page : le serveur ne connaît pas le jeu de séjours.
  // Sans elles, la veille ne relève que les vols — c'est dégradé, pas cassé.
  const lieux = LIEUX.test(String(brut.lieux || "")) ? String(brut.lieux) : "";
  return { origin, destinations, depart: String(brut.depart), retour: brut.retour ? String(brut.retour) : "",
           adults, childrenAges: ages, lieux };
}

/** Identifiant court, lisible dans un fichier ouvert à la main. */
const identifiant = () => Math.random().toString(36).slice(2, 10);

/**
 * Ajoute une veille. Le quota par propriétaire n'est pas décoratif : sans lui, une page
 * en boucle remplirait le disque du serveur.
 */
export async function ajouter({ proprietaire, nom, criteres }, chemin = cheminFichier()) {
  const c = criteresValides(criteres);
  if (!c) return { erreur: "critères inexploitables" };
  if (!proprietaire || typeof proprietaire !== "string") return { erreur: "propriétaire manquant" };

  const d = await lire(chemin);
  if (d.veilles.length >= MAX_VEILLES_TOTAL) return { erreur: "le serveur a atteint son quota de veilles" };
  const siennes = d.veilles.filter(v => v.proprietaire === proprietaire);
  if (siennes.length >= MAX_VEILLES_PAR_PROPRIETAIRE) {
    return { erreur: `${MAX_VEILLES_PAR_PROPRIETAIRE} veilles maximum ; supprimes-en une d'abord` };
  }
  const veille = {
    id: identifiant(),
    proprietaire,
    nom: String(nom || `${c.origin} → ${c.destinations.join(", ")}`).slice(0, 60),
    criteres: c,
    creee: new Date().toISOString(),
    releves: []
  };
  d.veilles.push(veille);
  await ecrire(d, chemin);
  return { veille };
}

export async function supprimer({ proprietaire, id }, chemin = cheminFichier()) {
  const d = await lire(chemin);
  const avant = d.veilles.length;
  // Le propriétaire est vérifié : un identifiant deviné ne suffit pas à supprimer.
  d.veilles = d.veilles.filter(v => !(v.id === id && v.proprietaire === proprietaire));
  if (d.veilles.length === avant) return { erreur: "veille introuvable" };
  await ecrire(d, chemin);
  return { supprimee: id };
}

export async function lesSiennes(proprietaire, chemin = cheminFichier()) {
  const d = await lire(chemin);
  return d.veilles.filter(v => v.proprietaire === proprietaire);
}

/**
 * Enregistre un relevé. `vols` et `hotels` sont des objets { CODE: total }, le total
 * étant celui rendu par l'amont — jamais recalculé ici.
 */
export async function enregistrerReleve(id, releve, chemin = cheminFichier()) {
  const d = await lire(chemin);
  const v = d.veilles.find(x => x.id === id);
  if (!v) return { erreur: "veille introuvable" };
  v.releves.push({
    t: releve.t || new Date().toISOString(),
    vols: releve.vols || {},
    hotels: releve.hotels || {},
    devise: releve.devise || null,
    mode: releve.mode || null          // "test" tant que les clés sont en bac à sable
  });
  if (v.releves.length > MAX_RELEVES) v.releves = v.releves.slice(-MAX_RELEVES);
  await ecrire(d, chemin);
  return { releves: v.releves.length };
}

/**
 * Lecture d'un historique : pour chaque destination, le dernier prix, le meilleur jamais
 * vu, et l'écart entre les deux. C'est la seule chose qu'un chasseur veut savoir.
 *
 * `null` partout tant qu'aucun relevé n'a abouti — on n'invente pas une baisse de 0 %.
 */
export function resume(veille) {
  const releves = Array.isArray(veille.releves) ? veille.releves : [];
  const dernier = releves[releves.length - 1] || null;
  const codes = [...new Set(releves.flatMap(r => Object.keys(r.vols || {})))];

  const parDestination = codes.map(code => {
    const serie = releves
      .map(r => ({ t: r.t, prix: r.vols && typeof r.vols[code] === "number" ? r.vols[code] : null }))
      .filter(p => p.prix !== null);
    if (!serie.length) return { code, actuel: null, meilleur: null, ecart: null, releves: 0 };
    const actuel = serie[serie.length - 1].prix;
    const meilleur = Math.min(...serie.map(p => p.prix));
    return {
      code,
      actuel,
      meilleur,
      // Écart en pourcentage par rapport au meilleur prix déjà observé. 0 = on y est.
      ecart: meilleur > 0 ? Math.round(((actuel - meilleur) / meilleur) * 1000) / 10 : null,
      releves: serie.length,
      serie: serie.slice(-30)
    };
  }).sort((a, b) => (a.actuel ?? Infinity) - (b.actuel ?? Infinity));

  return {
    id: veille.id,
    nom: veille.nom,
    criteres: veille.criteres,
    creee: veille.creee,
    dernierReleve: dernier ? dernier.t : null,
    mode: dernier ? dernier.mode : null,
    devise: dernier ? dernier.devise : null,
    destinations: parDestination
  };
}
