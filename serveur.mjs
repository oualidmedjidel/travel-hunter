/**
 * Serveur Node autonome — pour héberger le projet ailleurs que sur Netlify
 * (Infomaniak « site Node.js », ou n'importe quel hôte qui lance un processus Node).
 *
 *   node serveur.mjs              écoute sur $PORT, 8080 par défaut
 *
 * Netlify appelle une fonction PAR REQUÊTE ; ici un seul processus tourne en
 * continu. Les handlers ne changent pas d'une ligne : ils sont déjà au format
 * web standard `(Request) => Response`. Ce fichier ne fait que deux choses —
 * traduire node:http vers Request/Response, et servir public/.
 *
 * Aucune dépendance : Node 18+ fournit Request, Response et fetch en global.
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import flights, { config as configFlights } from "./netlify/functions/flights.mjs";
import stays, { config as configStays } from "./netlify/functions/stays.mjs";
import veille, { config as configVeille } from "./netlify/functions/veille.mjs";
import { demarrerBoucle } from "./netlify/lib/releve.mjs";

const RACINE = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC = resolve(RACINE, "public");
// Infomaniak injecte PORT et affiche la même valeur dans le Manager (« Port d'écoute »).
// Le repli vaut 3000, la valeur par défaut du Manager : si l'injection venait à manquer,
// le serveur écoute quand même là où l'hébergeur l'attend.
const PORT = Number.parseInt(process.env.PORT || "3000", 10);

// Une seule source de vérité pour les routes : la déclaration que porte déjà
// chaque fonction (`export const config = { path: "/api/flights" }`).
const ROUTES = new Map([
  [configFlights.path, flights],
  [configStays.path, stays],
  [configVeille.path, veille]
]);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8"
};

// Repris de netlify.toml : la page et le service worker ne doivent jamais être
// servis depuis un cache périmé, sinon une mise en ligne passe inaperçue.
const SANS_CACHE = new Set(["/index.html", "/sw.js", "/manifest.json", "/"]);

/** node:http → Request standard. */
async function versRequest(req) {
  const hote = req.headers.host || `localhost:${PORT}`;
  const url = new URL(req.url, `http://${hote}`);
  const init = { method: req.method, headers: req.headers };
  if (req.method !== "GET" && req.method !== "HEAD") {
    const morceaux = [];
    for await (const m of req) morceaux.push(m);
    init.body = Buffer.concat(morceaux);
  }
  return new Request(url, init);
}

/** Response standard → node:http. */
async function ecrire(res, reponse) {
  const corps = Buffer.from(await reponse.arrayBuffer());
  const entetes = {};
  reponse.headers.forEach((v, k) => { entetes[k] = v; });
  res.writeHead(reponse.status, entetes);
  res.end(corps);
}

/**
 * Frontière de confiance : rend le chemin absolu du fichier demandé, ou null
 * s'il sort de public/.
 *
 * Aujourd'hui cette garde est INATTEIGNABLE par une requête HTTP : `new URL()`
 * normalise `..` avant elle — mesuré, « /../../../../etc/passwd » ressort en
 * « /etc/passwd », et « /%2e%2e/x » en « /x ». Elle est là en défense en
 * profondeur : quiconque ajouterait un `decodeURIComponent` sur le chemin, ou
 * remplacerait `new URL()` par un découpage à la main, la rendrait active du
 * jour au lendemain. Exportée pour être testée pour elle-même, puisque le
 * niveau HTTP ne peut pas l'exercer.
 */
export function cheminSur(chemin) {
  const cible = resolve(PUBLIC, "." + chemin);
  return cible === PUBLIC || cible.startsWith(PUBLIC + sep) ? cible : null;
}

async function servirFichier(res, chemin, urlPath) {
  const cible = cheminSur(chemin);
  if (cible === null) {
    res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    return res.end("403");
  }
  try {
    const info = await stat(cible);
    const fichier = info.isDirectory() ? join(cible, "index.html") : cible;
    const corps = await readFile(fichier);
    const entetes = { "content-type": TYPES[extname(fichier)] || "application/octet-stream" };
    if (SANS_CACHE.has(urlPath) || info.isDirectory()) {
      entetes["cache-control"] = "public, max-age=0, must-revalidate";
    }
    res.writeHead(200, entetes);
    res.end(corps);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("404");
  }
}

const serveur = createServer(async (req, res) => {
  let urlPath = "/";
  try {
    urlPath = new URL(req.url, "http://x").pathname;
    const handler = ROUTES.get(urlPath);
    if (handler) return await ecrire(res, await handler(await versRequest(req)));
    return await servirFichier(res, urlPath, urlPath);
  } catch (e) {
    // Le détail d'une erreur interne ne sort jamais vers le client.
    console.error(`500 ${req.method} ${urlPath} —`, e && e.message);
    if (!res.headersSent) res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "erreur interne" }));
  }
});

// N'écoute que lancé directement (`node serveur.mjs`) : importé par un test,
// le module ne doit pas ouvrir de port.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
serveur.listen(PORT, () => {
  // Le port réellement attribué, pas celui demandé : avec PORT=0 l'OS en choisit un,
  // et c'est cette ligne que lit tests/serveur.test.mjs.
  console.log(`http://localhost:${serveur.address().port}  —  routes : ${[...ROUTES.keys()].join(", ")}`);
  // La veille ne tourne que dans le processus lancé pour de bon : importé par un test,
  // ce fichier ne doit ouvrir ni port ni minuterie.
  demarrerBoucle();
});
}
