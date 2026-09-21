# Travel Deal Hunter

Comparateur vol + hôtel + transfert : le total réellement payé, pas un prix d'appel.
Zéro dépendance — tout est natif Node.

```
npm start        # node serveur.mjs, écoute sur $PORT (3000 par défaut)
npm test         # 233 assertions + 40 sur l'adaptateur HTTP
```

## Variables d'environnement

Copier `.env.exemple` en `.env` (jamais versionné) :

    DUFFEL_TOKEN=...     vols réels via Duffel Air
    LITEAPI_KEY=...      tarifs hôteliers réels via LiteAPI

Sans clé, l'application répond `200 {configured:false}` et bascule en démonstration :
aucun badge « réel » ne surmonte jamais une donnée fictive.

## Structure

    serveur.mjs                 traduit node:http ↔ Request/Response, sert public/
    netlify/functions/*.mjs     les deux proxys, format web standard (Request) => Response
    netlify/lib/duffel.mjs      jeton, en-têtes, lots, cache, empreinte, motif d'échec
    public/                     l'application entière, un seul fichier, zéro dépendance

Le dossier `netlify/` garde son nom d'origine : le renommer toucherait les imports
sans rien apporter.
