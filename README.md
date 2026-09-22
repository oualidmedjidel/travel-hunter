# Travel Deal Hunter

En ligne : **https://travel-hunter.fr** — hébergement Infomaniak, site Node.js.

Comparateur vol + hôtel + transfert : le total réellement payé, pas un prix d'appel.
Zéro dépendance — tout est natif Node.

```
npm start        # node serveur.mjs, écoute sur $PORT (3000 par défaut)
npm test         # 233 assertions + 40 sur l'adaptateur HTTP
```

En production, la commande de démarrage est `node --env-file-if-exists=.env serveur.mjs`.
**`--env-file-if-exists`, pas `--env-file`** : avec la seconde, Node refuse de démarrer
quand le fichier manque, et le site reste mort au lieu de tourner en démonstration.

## Variables d'environnement

Copier `.env.exemple` en `.env` à la racine, hors de `public/` — donc joignable par aucune
URL. Jamais versionné.

    DUFFEL_TOKEN=...     vols réels via Duffel Air
    LITEAPI_KEY=...      tarifs hôteliers réels via LiteAPI

Sans clé, l'application répond `200 {configured:false}` et bascule en démonstration :
aucun badge « réel » ne surmonte jamais une donnée fictive.

## État mesuré le 2026-09-22

```
https://travel-hunter.fr/                200 · 92 558 o · md5 b39e642fc016a2b6f66043e67108fb24
                                         = public/index.html local, à l'octet
/api/flights 10 destinations depuis PAR  200 · 14,2 s · 10/10 trouvées · devises ["EUR"]
/api/stays   2 lieux                     200 · 3,9 s · fournisseur "liteapi" · mode "test"
                                         2/2 trouvés · EUR · vrais établissements,
                                         prix de bac à sable
?selftest=1 dans un navigateur           61 PASS · 0 FAIL
npm test                                 233/233 OK · 40/40 OK
```

- **Vols : réels**, avec un jeton de bac à sable (`mode:"test"`) — d'où le badge `vol test`,
  jamais `vol réel`.
- **Hôtels : LiteAPI branché, en bac à sable.** La clé `sand_…` est gratuite, la clé
  `prod_…` demande un moyen de paiement chez Nuitee. Établissements, notes et pensions sont
  réels, les prix sont des données d'exemple — d'où le badge `hôtel test`. Remplacer la
  valeur de `LITEAPI_KEY` par une clé `prod_` suffit à passer à `hôtel réel`, sans toucher au
  code (`modeLite()` dans `netlify/functions/stays.mjs`).
- **Transfert : modélisé**, annoncé comme tel sur chaque carte.

## Points d'entrée

```
GET /api/flights?origin=PAR&destinations=RAK,LIS&depart_date=2026-11-05
                &return_date=2026-11-13&adults=2&children_ages=3&infants_ages_months=10
GET /api/stays?lieux=RAK:31.6295,-7.9811&check_in=2026-11-05&check_out=2026-11-13
              &adults=2&pension=demi-pension
```

- Clés lues dans l'environnement, **jamais** renvoyées au navigateur.
- Tout paramètre est validé avant d'atteindre l'amont : IATA sur 3 lettres, dates
  `YYYY-MM-DD` strictes, 12 destinations ou lieux par appel, 9 voyageurs assis, au moins un
  adulte par bébé. Rien n'est recopié tel quel.
- Duffel tarife d'après les **âges réels** des mineurs, pas des compteurs.
- Erreur amont → **200**, destination listée dans `sansOffre` : `{status, type, code, titre}`
  quand l'amont parle la forme Duffel, sinon un `extrait` du corps borné à 160 caractères.
  Cet extrait passe par `expurge` : toute suite de 16 caractères ou plus sans séparateur
  devient `***`, donc ni jeton ni clé n'en ressort, même renvoyée en écho par l'amont.
- Appels par **lots de 6**, budget total **18 s**, délai amont **9 s**, cache mémoire
  **15 min / 300 entrées**.
- ⚠️ `abandonnees` (vols) et `abandonnes` (hôtels) valent **0 en toute circonstance** depuis
  que le délai amont est passé à 9 s : le contrôle de temps ne peut plus refuser un lot. Le
  signal d'une chasse tronquée est dans `sansOffre`, avec `status:"TimeoutError"`.

### Deux limites à connaître

**Mode bac à sable.** Un jeton `duffel_test_` renvoie surtout *Duffel Airways* (code `ZZ`),
compagnie fictive aux horaires et tarifs irréalistes, plus les bacs à sable de vraies
compagnies que Duffel ne garantit pas. Bon pour valider la plomberie, inutilisable comme
vrais prix : la réponse expose `mode`, le badge dit `vol test` et le bandeau le répète.

**Devise imposée.** Duffel facture dans la devise du compte, il n'existe aucun paramètre de
devise. Les tarifs qui ne sont pas en euros sont **écartés** plutôt qu'additionnés à tort à
des prix d'hôtel en euros — un bandeau le signale. Régler la devise du compte sur EUR.

**`total_amount` est une chaîne, et c'est le total pour TOUS les passagers.** Ne pas le
remultiplier par le nombre de voyageurs. Les noms de champs viennent des exemples bruts de
la documentation, pas d'une synthèse : celle-ci annonçait `total_price` et `departure_time`,
deux champs qui n'existent pas.

## Structure

    serveur.mjs                 traduit node:http ↔ Request/Response, sert public/
    netlify/functions/*.mjs     les deux proxys, format web standard (Request) => Response
    netlify/lib/duffel.mjs      jeton, en-têtes, lots, cache, empreinte, motif d'échec
    public/                     l'application entière, un seul fichier, zéro dépendance
    tests/                      node tests/flights.test.mjs · node tests/serveur.test.mjs

Le dossier `netlify/` garde son nom d'origine : le renommer toucherait les imports sans
rien apporter. Netlify n'héberge plus l'application — `tdhunt.netlify.app` redirige en 301
vers `travel-hunter.fr`.

L'auto-test de l'interface s'ouvre avec `?selftest=1` : 61 assertions (tarification,
filtres, validation, échappement HTML, fusion des tarifs réels, comptage des chambres)
affichées en surimpression.
