/**
 * /api/veille — les recherches mises sous surveillance.
 *
 *   GET  ?proprietaire=<id>                 → les veilles de ce propriétaire, résumées
 *   POST { action:"ajouter", proprietaire, nom, criteres }
 *   POST { action:"supprimer", proprietaire, id }
 *
 * Le `proprietaire` est un identifiant aléatoire que la page garde dans son
 * `localStorage` : ni compte, ni mot de passe, ni courriel. Ce n'est PAS un secret
 * d'authentification — qui devinerait la valeur d'un autre verrait ses veilles. Le choix
 * est assumé pour une liste de « Faro en novembre » ; il ne le serait pas une minute si
 * on y stockait un jour autre chose que des critères de voyage.
 */
import { json } from "../lib/duffel.mjs";
import { ajouter, supprimer, lesSiennes, resume, MAX_VEILLES_PAR_PROPRIETAIRE } from "../lib/veille.mjs";

/** Forme imposée au propriétaire : assez long pour ne pas se deviner par hasard. */
const PROPRIETAIRE = /^[A-Za-z0-9_-]{12,64}$/;

export default async (req) => {
  const url = new URL(req.url);

  if (req.method === "GET") {
    const proprietaire = String(url.searchParams.get("proprietaire") || "");
    if (!PROPRIETAIRE.test(proprietaire)) {
      return json({ error: "proprietaire manquant ou mal formé." }, 400);
    }
    const veilles = await lesSiennes(proprietaire);
    return json({ veilles: veilles.map(resume), quota: MAX_VEILLES_PAR_PROPRIETAIRE });
  }

  if (req.method === "POST") {
    let corps = null;
    try { corps = await req.json(); } catch { corps = null; }
    if (!corps || typeof corps !== "object") return json({ error: "corps JSON attendu." }, 400);

    const proprietaire = String(corps.proprietaire || "");
    if (!PROPRIETAIRE.test(proprietaire)) {
      return json({ error: "proprietaire manquant ou mal formé." }, 400);
    }

    if (corps.action === "ajouter") {
      const r = await ajouter({ proprietaire, nom: corps.nom, criteres: corps.criteres });
      if (r.erreur) return json({ error: r.erreur }, 400);
      return json({ veille: resume(r.veille) }, 201);
    }

    if (corps.action === "supprimer") {
      const r = await supprimer({ proprietaire, id: String(corps.id || "") });
      if (r.erreur) return json({ error: r.erreur }, 404);
      return json(r);
    }

    return json({ error: "action inconnue : ajouter ou supprimer." }, 400);
  }

  return json({ error: "méthode non gérée." }, 405);
};

export const config = { path: "/api/veille" };
