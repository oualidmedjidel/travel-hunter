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
import { genererVapid, abonnementValide } from "./push.mjs";

export const MAX_VEILLES_PAR_PROPRIETAIRE = 5;
export const MAX_RELEVES = 120;          // à un relevé toutes les 6 h : 30 jours d'historique
export const MAX_VEILLES_TOTAL = 500;    // garde-fou : le fichier reste lisible d'un coup d'œil
export const MAX_ABONNEMENTS = 3;        // un téléphone, un ordinateur, un de rattrapage

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

/**
 * Paire VAPID du serveur : lue du fichier, ou générée et rangée au premier appel.
 *
 * Personne ne la colle à la main. La clé privée ne quitte jamais ce fichier ; la clé
 * publique est faite pour être publiée, la page en a besoin pour s'abonner.
 */
export async function vapid(chemin = cheminFichier()) {
  const d = await lire(chemin);
  if (d.vapid && d.vapid.privee && d.vapid.point) return d.vapid;
  const neuve = genererVapid();
  d.vapid = neuve;
  await ecrire(d, chemin);
  return neuve;
}

/**
 * Enregistre un abonnement aux notifications. Le même point d'entrée n'est jamais stocké
 * deux fois : un navigateur qui se réabonne ne doit pas produire deux alertes.
 */
export async function abonner(proprietaire, brut, chemin = cheminFichier()) {
  const a = abonnementValide(brut);
  if (!a) return { erreur: "abonnement inexploitable" };
  const d = await lire(chemin);
  d.abonnements = Array.isArray(d.abonnements) ? d.abonnements : [];
  d.abonnements = d.abonnements.filter(x => x.endpoint !== a.endpoint);
  const siens = d.abonnements.filter(x => x.proprietaire === proprietaire);
  if (siens.length >= MAX_ABONNEMENTS) {
    // On retire le plus ancien plutôt que de refuser : l'utilisateur vient d'accepter
    // les notifications sur cet appareil, lui rendre une erreur serait incompréhensible.
    const plusVieux = siens.sort((x, y) => String(x.creee).localeCompare(String(y.creee)))[0];
    d.abonnements = d.abonnements.filter(x => x !== plusVieux);
  }
  d.abonnements.push({ ...a, proprietaire });
  await ecrire(d, chemin);
  return { abonne: true };
}

export async function desabonner(endpoint, chemin = cheminFichier()) {
  const d = await lire(chemin);
  d.abonnements = (Array.isArray(d.abonnements) ? d.abonnements : []).filter(x => x.endpoint !== endpoint);
  await ecrire(d, chemin);
  return { desabonne: true };
}

export async function abonnementsDe(proprietaire, chemin = cheminFichier()) {
  const d = await lire(chemin);
  return (Array.isArray(d.abonnements) ? d.abonnements : []).filter(x => x.proprietaire === proprietaire);
}

/** À qui appartient ce point d'entrée ? C'est ainsi que le service worker s'identifie. */
export async function proprietaireDeLAbonnement(endpoint, chemin = cheminFichier()) {
  const d = await lire(chemin);
  const a = (Array.isArray(d.abonnements) ? d.abonnements : []).find(x => x.endpoint === endpoint);
  return a ? a.proprietaire : null;
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

export const DELAI_ESSAI_MS = 60_000;   // un essai par minute : de quoi vérifier, pas de quoi marteler

/**
 * Alerte d'essai, rattachée au propriétaire et non à une veille : on doit pouvoir
 * vérifier que les notifications marchent **avant** d'avoir mis quoi que ce soit sous
 * surveillance. Rend `{ erreur }` si l'essai précédent date de moins d'une minute.
 */
export async function noterEssai(proprietaire, { maintenant = Date.now() } = {}, chemin = cheminFichier()) {
  const d = await lire(chemin);
  d.essais = d.essais && typeof d.essais === "object" ? d.essais : {};
  const precedent = d.essais[proprietaire];
  if (precedent && maintenant - Date.parse(precedent.t) < DELAI_ESSAI_MS) {
    return { erreur: "un essai vient d'être envoyé ; laisse-lui une minute" };
  }
  d.essais[proprietaire] = { t: new Date(maintenant).toISOString(), essai: true, nom: "Essai d'alerte" };
  await ecrire(d, chemin);
  return d.essais[proprietaire];
}

/** Garde la trace de la dernière alerte envoyée : c'est ce que le service worker affichera. */
export async function noterAlerte(id, alerte, chemin = cheminFichier()) {
  const d = await lire(chemin);
  const v = d.veilles.find(x => x.id === id);
  if (!v) return { erreur: "veille introuvable" };
  v.derniereAlerte = { t: new Date().toISOString(), ...alerte };
  await ecrire(d, chemin);
  return v.derniereAlerte;
}

/**
 * L'alerte la plus récente d'un propriétaire, et seulement si elle est fraîche.
 *
 * Un service worker peut être réveillé longtemps après l'envoi — appareil éteint, réseau
 * coupé. Annoncer « le prix a baissé » sur une alerte de la semaine dernière serait faux :
 * passé le délai, on rend null et la page s'affiche sans promesse.
 */
export async function derniereAlerteDe(proprietaire, { fraicheurH = 24, maintenant = Date.now() } = {},
                                       chemin = cheminFichier()) {
  const d = await lire(chemin);
  // Les alertes de veille ET l'essai éventuel entrent dans la même course : c'est la
  // plus récente qui parle, sinon un essai serait masqué par une vieille alerte.
  const essai = (d.essais || {})[proprietaire];
  const candidates = [
    ...d.veilles
      .filter(v => v.proprietaire === proprietaire && v.derniereAlerte)
      .map(v => ({ nom: v.nom, ...v.derniereAlerte })),
    ...(essai ? [essai] : [])
  ]
    .filter(a => maintenant - Date.parse(a.t) < fraicheurH * 3600000)
    .sort((a, b) => String(b.t).localeCompare(String(a.t)));
  return candidates[0] || null;
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
