# Passation — Travel Deal Hunter

Session du 2026-09-21. Reprise d'un site existant, debug, refonte, mise en ligne,
branchement de vraies données de vol, préparation des hôtels.

**Mise à jour du 2026-09-21 au soir — audit, huit correctifs et un alignement.** Une revue à six axes
a produit [`AUDIT.md`](AUDIT.md) : 8 défauts confirmés, 16 vérifiés une fois, 4 points
déjà assumés. **Les 8 sont corrigés et en ligne** — § 0, revérifié le 2026-09-22.

**Ce document remplace toute note antérieure. Commence par le § 0 : c'est l'état final,
mesuré, et il dit ce qui reste. Les sections suivantes gardent l'historique et les pièges —
elles évitent de refaire ce qui est déjà fait, mais leurs chiffres sont ceux de leur date.**

| | |
|---|---|
| En ligne | **https://travel-hunter.fr** — Infomaniak, site Node.js (§ 10) |
| Dépôt | https://github.com/oualidmedjidel/travel-hunter — `main` à `a6f4a74`, 2026-09-23 22:22 UTC |
| Ancien hôte | https://tdhunt.netlify.app → **301** vers travel-hunter.fr (mesuré 2026-09-22) |
| Administration Netlify | https://app.netlify.com/projects/tdhunt — ne sert plus l'application |
| Projet Netlify | `59abe778-4413-4a50-bcec-23aab922efd9` |
| Équipe | `medjidel-oualid` · `6a945552b54da30572aa8e4c` · offre **Free** |
| Source d'origine | https://jazzy-piroshki-acdbe2.netlify.app (compte tiers) |

---

# 0. État final au 2026-09-24 — tout est en ligne, tout est mesuré

Le projet tient debout tout seul. Ce bloc est le résumé le plus court qui reste vrai ;
le détail de chaque point est au § 8.

```
npm test                          358/358 · 40/40 · 115/115      513 assertions
?selftest=1 en production         113 PASS · 0 FAIL
page servie                       130 600 o · md5 f94514578a16edf1ec50a2bc380db147 = local
/api/flights  ORY → FAO           configured true · mode "test" · 1 offre
/api/stays    FAO                 fournisseur "liteapi" · mode "test" · 1 séjour
/api/veille                       quota 5 · clé VAPID publique de 65 octets
```

| Ce qui marche | État |
|---|---|
| **Vols** | réels via Duffel, jeton de **bac à sable** → badge `vol test`, jamais `vol réel` |
| **Hôtels** | réels via LiteAPI, clé **`sand_`** → badge `hôtel test`. Vrais établissements, notes, pensions ; prix d'exemple |
| **Bagages** | ce que le tarif **inclut**, par offre. La case « Bagage en soute inclus » change le vol **retenu**, pas l'affichage : mesuré en production, Transavia 150,37 € sans aucun bagage contre British Airways 276,80 € avec soute et cabine |
| **Tranche horaire** | deux menus, « décollage après » et « retour posé avant ». Comme les bagages, ils changent le tarif **retenu**. Mesuré en production le 2026-09-24, PAR → FAO : sans contrainte Transavia 80,27 € (départ 06:00) ; `depart_apres=10` retient TAP 440,09 € (départ 17:50) ; `retour_avant=11` retient Lufthansa 239,42 € (pose 08:25) |
| **Transfert** | modélisé, annoncé comme tel sur chaque carte |
| **Veille** | active, un relevé toutes les 6 h. Mesuré en production : relevés à 06:20 et 12:20 UTC, 7 vols et 9 hôtels par tour |
| **Alertes** | Web Push sans dépendance, clé VAPID générée par le serveur. **Notification reçue sur un vrai téléphone le 2026-09-23** |
| **Cache** | mémoire, **1 h / 300 entrées**, `CACHE_MS` dans `duffel.mjs` — une seule définition. Mesuré : 5,8 s puis 0,08 s sur la même recherche |
| **PWA** | manifeste + service worker `tdh-v6`, réseau d'abord pour le HTML |
| **Accessibilité** | une seule région `aria-live`, focus clavier restauré après rendu |

Données au moment d'écrire ces lignes : **1 veille** (`yxh26wy6`, PAR → 10 destinations,
2 relevés), **1 abonnement** (fcm.googleapis.com). Quatre doublons créés par erreur ont été
supprimés le 2026-09-23 via l'API de l'application.

**Ticket ouvert chez Nuitee le 2026-09-23** — `LAS-2556`, « Production access for a
comparison site - look-to-book policy question ». Trois questions : ce modèle de
comparateur (beaucoup de recherches, zéro réservation) tient-il dans leur gratuité, quel
est le seuil chiffré, et la carte demandée déclenche-t-elle un prélèvement sur le trafic
de recherche seul. Le cache est passé de 15 min à **1 h** en attendant leur réponse :
quatre fois moins d'appels amont pour le même service. Si leur seuil est plus strict, la
manette est à un seul endroit.

**Les trois seules choses qui restent, et aucune n'est du code :**

1. **Clé `prod_` LiteAPI** — demande un moyen de paiement chez Nuitee. Sans elle, les prix
   hôteliers restent des données d'exemple, donc l'historique de veille aussi.
2. **Jeton Duffel *live*** — demande leur validation commerciale. Même conséquence côté vols.
3. **Aucune alerte réelle n'a encore été déclenchée** par un record de prix : il faut deux
   relevés et une vraie baisse. Le canal, lui, est prouvé de bout en bout.
4. **Le prix d'un bagage acheté à part n'est pas affichable.** Mesuré le 2026-09-23 sur une
   vraie réponse Duffel — 19 offres, PAR → FAO : `available_services` valait `null` sur les
   **19**, y compris avec `return_available_services=true`. Duffel déclare l'allocation
   **incluse** (`passengers[].baggages`, par passager et par segment : checked:1 sur 14
   offres, checked:0 sur 5), jamais le tarif d'une valise en plus. LiteAPI, lui, expose des
   bagages tarifés sur ses **propres** vols (relevé le même jour : `bagType`, `pieces`,
   `pricing.display.amount`). Afficher « +25 € la valise » avec Duffel serait inventer un
   prix ; y accéder demanderait de changer de fournisseur pour les vols, pas de régler un
   paramètre.

   Ce qui est fait à la place, et qui vaut mieux pour une famille : `bagage_soute=1` ne
   filtre pas l'affichage, il change le **tarif retenu** — le moins cher **qui inclut** la
   soute. `bagagesInclus()` prend le minimum sur tous les segments (une soute à l'aller
   mais pas au retour n'est pas une soute incluse) et n'écarte jamais une offre muette :
   la carte affiche alors « bagages non communiqués ».

Avec ces deux clés, les badges passent au vert et les courbes deviennent vraies **sans
changer une ligne** — `modeLite()` et `badgeVol()` lisent le préfixe de la clé.

---

# 0 bis. Historique du 2026-09-22 — prod = local, clé hôtelière absente

Tout ce bloc est **mesuré le 2026-09-22**, commandes et sorties à l'appui. Il remplace
l'ancien § 0 « local ≠ production », qui n'est plus vrai : le déploiement a eu lieu.

Deux déploiements ont eu lieu dans la journée. **Le dernier est celui qui fait foi** :
`7150a20` — câblage de `maxBeachDistance`, lien Booking porteur du séjour (§ 8 points 2 et 5).

```
git pull sur le serveur (console SSH)   dbc4e95..7150a20 · Fast-forward · 2 files changed
md5sum public/index.html (serveur)      88bd63167c348937acab00de95aa90f2
curl https://travel-hunter.fr/          200 · 97 399 o · md5 88bd63167c348937acab00de95aa90f2
md5 -q public/index.html (local)               97 399 o · md5 88bd63167c348937acab00de95aa90f2
                                        → prod, dépôt GitHub et local identiques à l'octet
?selftest=1 en production               68 PASS · 0 FAIL
état du matin, pour mémoire                    92 558 o · md5 b39e642fc016a2b6f66043e67108fb24
/api/flights   ORY → FAO                {"configured":true,"mode":"test",…}
                                        FAO 150,37 EUR · Transavia France
/api/flights   10 destinations, PAR     200 · 14,2 s · 10/10 trouvées · devises ["EUR"]
/api/stays     RAK                      {"fournisseur":"duffel","trouves":0,
                                         sansOffre:[{status:403,extrait:"This feature is
                                         not enabled for your account…"}]}
?selftest=1 en production (navigateur)  61 PASS · 0 FAIL
npm test                                233/233 OK · 40/40 OK
tdhunt.netlify.app/                     301 → https://travel-hunter.fr/
```

Ce que ça change, par rapport à ce que disaient les versions précédentes de ce document :

- **Le `.env` du serveur existe et porte `DUFFEL_TOKEN`.** L'action humaine annoncée au
  § 10 est **faite** : les vols sont réels (bac à sable). Ne pas la refaire.
- **Les huit correctifs de l'audit sont en ligne.** Comparer la taille servie à celle du
  fichier local réussit désormais — c'était l'inverse la veille.
- **`LITEAPI_KEY` est posée depuis le 2026-09-22 au soir** — clé de **bac à sable** `sand_…`,
  la clé `prod_` demandant un moyen de paiement (§ 2). Mesuré après redémarrage :

  ```
  /api/stays 2 lieux, 8 nuits, demi-pension   200 · 3,9 s · fournisseur "liteapi" · mode "test"
                                              2/2 trouvés · EUR · sansOffre vide
                                              RAK   903,61 € Barceló Palmeraie Oasis ★5 7.8 Half Board
                                              FAO  1336,14 € Occidental Faro          ★4 8.4 Half Board
  chasse complète dans la page                7 cartes, badges « vol test + hôtel test »
                                              bandeau et note : « non réservables »
  ```
- La page a reçu, **après** la rédaction initiale de ce document, un panneau
  « sources interrogées » (`SOURCES`, `etiquetteSource`, `index.html:998-1044`) et un badge
  `vol test` distinct de `vol réel` (`badgeVol`) : 92 558 octets contre 80 819 décrits ici.
  Les commits `90f9e39`, `9489f0c` et `dbc4e95` portent ces trois changements.
- **`README.md` réécrit et publié le 2026-09-22** — commit `ea84324`. Le fichier local portait
  encore la version Netlify, le dépôt une version courte ; les deux disent maintenant l'état
  mesuré. Vérifié après envoi : `raw.githubusercontent.com` rend 5 431 o, md5
  `6013d6a1a3290a95e01e473a04434024`, identique au local.

## Historique — les huit correctifs de l'audit

Chacun porte un test qui échoue si on l'annule — vérifié en annulant :

| # audit | fichier | ce qui est corrigé |
|---|---|---|
| 1 | `public/index.html:939-940` `:996` | le badge « hôtel réel » ne surmonte plus le nom, les étoiles ni la note de démonstration |
| 3 | `netlify/functions/flights.mjs:79` | les escales du **retour** sont comptées ; un vol avec escale au retour ne s'affiche plus « direct » |
| 4 | `netlify/functions/stays.mjs:68` | `chambres()` plafonné au nombre d'adultes ; plus de chambre `{adults:0}` envoyée à LiteAPI |
| 5 | `netlify/functions/stays.mjs:219` | garde « un adulte par bébé », jumelle de celle de `flights.mjs:119` |
| 8 | `deploy.sh:42` | un déploiement raté sort en **1** ; avant il sortait en **0** en annonçant la mise en ligne |
| 2 | `netlify/functions/stays.mjs:87` `:104-110` `:141` `:256` | `retailRate.total` est **par chambre** : multiplié par `rooms`, comme le contrat de `stays.mjs:19-21` l'écrit. Les deux branches rendent désormais un total toutes chambres, donc le tri compare enfin des grandeurs de même nature. `rooms` n'est plus publié à `null`. |
| — | `public/index.html:559` | **page alignée sur la fonction** : `Math.min(f.adults, …)`, même règle que `chambres()`. Voir juste en dessous. |

| 6 | `flights.mjs:143` · `stays.mjs:253` `:268` | délai amont ramené de 20 s à `BUDGET_MS / 2`. Pire cas calculé sur `parLots` : `min(k·d, BUDGET_MS + d)` valait **38 s** avec d = 20 s, au-delà même des 30 s d'abandon du navigateur ; il vaut désormais exactement 18 s. |
| 7 | `duffel.mjs:102-107` | `extrait` **conservé** — contrairement à ce que proposait `AUDIT.md` — mais `expurge` durci : toute suite de 16 caractères ou plus sans séparateur devient `***`. |

**Les 8 défauts de l'audit sont traités.** Restent ouverts les constats A à P d'`AUDIT.md`,
vérifiés une seule fois, jamais passés au réfuteur.

### Pourquoi le correctif 7 ne suit pas l'audit

`AUDIT.md` § 7 propose de supprimer `extrait`. Le coût a été chiffré sur sept corps
fabriqués : dans **5 cas sur 7** il ne resterait que `{status, type, code:null, titre:null}`,
car `code`/`titre` ne sont peuplés que par la forme `{errors:[…]}` de **Duffel Air**. LiteAPI,
le 403 de Duffel Stays et toute passerelle tombent tous dans la branche `extrait`. On perdrait
notamment « This feature is not enabled for your account » — la phrase même qui a tranché
Duffel Stays. Le triage grossier 401 / 403 / 502 survivrait par `status` ; le motif **à
l'intérieur** d'un status, non.

La compensation retenue, mesurée sur un jeu d'essai exécuté :

```
message Duffel Stays  → intact, mot à mot
clé hex 20 et 32      → ***          JWT → ***.***.***
sk-proj-…  base64     → ***          duffel_test_… → duffel_***
502 nginx             → intact       « The authentication configuration is unavailable » → intact
```

⚠️ **Deux prix à cette compensation, tous deux mesurés :**
- un identifiant légitime long est expurgé aussi : `InternalServerError` → `***`.
- la règle littérale « le corps amont n'est jamais relayé » **n'est plus vraie**, et le § 4 a
  été réécrit en conséquence. Un amont qui découperait un secret en tranches de moins de
  16 caractères passerait la barrière. Aucune observation réelle d'un tel cas.

### ⚠️ `abandonnees` est devenu un champ mort

Effet de bord du correctif 6, non corrigé : à 2 lots avec un délai de `BUDGET_MS / 2`, le
contrôle de temps de `parLots` (`duffel.mjs:64`) ne peut plus jamais refuser le second lot.
`abandonnees` (`flights.mjs:167`) et `abandonnes` (`stays.mjs:291`) vaudront **0 en toute
circonstance**. Le signal de réponse partielle migre vers `sansOffre` avec
`status:"TimeoutError"`. Quiconque se fierait à `abandonnees` pour détecter une chasse
tronquée ne verrait plus rien.

## Comptage des chambres : une seule règle, et un garde-fou qui la tient

Le correctif 4 a plafonné `chambres()` au nombre d'adultes côté fonction ; la page a été
alignée dans la foulée (`index.html:559`). La règle unique est désormais :

```js
Math.max(1, Math.min(adults, Math.ceil((adults + enfants) / 3)))
```

3 couchages par chambre, **jamais plus de chambres que d'adultes** — une chambre sans adulte
n'est pas réservable, et `occupations()` ne peut pas la rééquilibrer.

Avant l'alignement, 9 des 45 saisies possibles divergeaient (`1 adulte + 3 à 8 enfants`,
`2 adultes + 5 à 7 enfants`) : le tarif réel couvrait le compte de la fonction, la carte
affichait celui de la page, et le prix de démonstration était multiplié par celui de la page.
Les deux prix n'étaient pas comparables. **Mesuré après alignement : 0 divergence sur 45.**

⚠️ **La règle est écrite à deux endroits** — la page n'importe rien, c'est un fichier unique
sans dépendance. Un contrôle exécutable lit donc l'expression réellement présente dans
`public/index.html`, la compare à `chambres()` sur les 45 saisies, et **échoue** si l'une des
deux dérive (`tests/flights.test.mjs`, dernier bloc). Vérifié en faisant dériver la page
exprès : `AssertionError: page et fonction doivent s'accorder sur les 45 saisies possibles`.

Effet assumé de l'alignement : sur ces 9 cas, le prix de **démonstration** baisse, puisqu'il
cesse d'être multiplié par une chambre de plus.

Ce qui reste discutable et n'est pas tranché : un adulte seul avec 3 enfants dans une seule
chambre n'est pas réservable partout non plus. La règle juste serait « au moins un adulte par
chambre **et** 3 couchages maximum », qui à 1 adulte et 4 enfants n'a aucune solution — il
faudrait refuser la saisie plutôt que la déformer. Aujourd'hui elle est déformée.

---

# 1. État vérifié — mesures du 2026-09-22 (dépassées, voir § 0)

Tout ci-dessous est **mesuré**, pas supposé. Inutile de le retester.

```
tests unitaires          npm test        255/255 OK · 40/40 OK    mesuré 2026-09-22 au soir
                         (233 le matin ; +7 modeLite, +15 perimee et sw.js)
auto-test                ?selftest=1     84 PASS · 0 FAIL en production (2026-09-23)
                         61 → 68 (plage, lien Booking) → 72 (badge hôtel) → 76 (mois unique)
                         → 79 (horizon de vente)
tests unitaires          npm test        314/314 OK · 40/40 OK   (2026-09-23, 255 la veille)
auto-test                ?selftest=1     68 PASS · 0 FAIL         mesuré 2026-09-22 EN PRODUCTION
                         après déploiement de 7150a20 (61 avant, 40 la veille)
Lighthouse mobile        Accessibilité 100 · Bonnes pratiques 100 · SEO 100 — 49 tests, 0 échec
                         mesuré le 2026-09-21 sur une version antérieure, NON rejoué depuis
/api/flights 10 dest.    14,2 s · 10/10 trouvées · devises ["EUR"]  mesuré 2026-09-22 en prod
```

Le compte d'assertions de `tests/flights.test.mjs` **était une chaîne codée en dur**
(`"91/91 OK"`) qui ne bougeait pas quand on ajoutait un test. Il est désormais compté à
l'exécution par un mandataire autour de `assert` : le chiffre affiché est mesuré.

| Composant | État |
|---|---|
| **Vols** | ✅ **réels** via Duffel, mode bac à sable. 10/10 destinations, EUR, 14,2 s (mesuré 2026-09-22) |
| **Hôtels** | ✅ **LiteAPI branché** (clé `sand_`, bac à sable) : vrais établissements, notes et pensions, prix d'exemple. Badge `hôtel test`, jamais `hôtel réel` |
| Transfert | modélisé, assumé comme tel |
| PWA | manifeste + service worker actifs, réseau-d'abord pour le HTML |

Les cartes portent **un badge par composant** — `vol réel` / `hôtel démo` — et
n'affichent jamais une donnée fictive sous un badge « réel ».

Exemple relevé en production le 2026-09-21, avant le badge `vol test` (en bac à sable,
la carte affiche désormais `vol test` et non `vol réel`) :
```
Faro   1 261 €   [vol réel] [hôtel démo]
       Transavia France · départ 16:45 · retour 16:55 · direct   ← Duffel, réel
       Vila Galé Albacora ★★★★ · 8.3/10 · 1 chambre              ← modèle local
```

---

# 2. La clé hôtelière — posée en bac à sable, reste la production

**Poser `LITEAPI_KEY` dans les variables Netlify.** C'est tout. Le code hôtelier est
écrit, testé et déployé ; il attend une clé.

1. Compte sur https://connect.nuitee.com/register — inscription réellement ouverte,
   créée le 2026-09-22. **Mais la gratuité s'arrête à la clé de bac à sable**, relevé sur
   https://connect.nuitee.com/apikeys/ le jour même :

   ```
   Production Key        prod_••••   « Add a payment method to access your production API key »
   Production – Public   prod_••••   idem
   Sandbox Key           sand_…      active, gratuite
   ```

   La clé `sand_` répond avec des **données d'exemple**. D'où `modeLite()` dans
   `stays.mjs` et le badge `hôtel test` (commit `29e4d96`) : un tarif de bac à sable ne
   porte jamais le badge `hôtel réel`. Pour des tarifs payables, il faut enregistrer un
   moyen de paiement chez Nuitee et reprendre la clé `prod_`.
2. Récupérer la clé d'API dans le tableau de bord.
3. L'ajouter au `.env` du serveur Infomaniak, à côté de `DUFFEL_TOKEN` qui y est déjà
   (`printf 'LITEAPI_KEY=%s\n' 'la_cle' >> .env`, puis `grep -c LITEAPI_KEY .env` pour
   contrôler **sans afficher la valeur**) :
   `/srv/customer/sites/travel-hunter.fr/.env` (console SSH du Manager, § 10).
4. « Redémarrer » dans le tableau de bord — le fichier n'est lu qu'au démarrage du process.
   *(L'ancienne consigne « Netlify → Environment variables » ne vaut plus : Netlify
   redirige, il n'exécute plus rien.)*

Contrôle :
```bash
curl "https://travel-hunter.fr/api/stays?lieux=RAK:31.6295,-7.9811&check_in=2026-11-05&check_out=2026-11-13&adults=2&pension=demi-pension"
```
- `fournisseur=liteapi` + `trouves>0` → gagné, les badges passent à `hôtel réel`
- `fournisseur=duffel` → clé non vue, redémarrage oublié (état mesuré au 2026-09-22 : `403`)
- `fournisseur=null` → aucune clé

`/api/stays` gère **deux fournisseurs** : `LITEAPI_KEY` en priorité, `DUFFEL_TOKEN` en
repli. Le travail Duffel n'est pas perdu si Stays est activé un jour.

---

# 3. Déployer — procédure obligatoire

## 🛑 Netlify redirige vers Infomaniak — rien à déployer ici

**Depuis le 2026-09-21, `tdhunt.netlify.app` ne sert plus l'application : il redirige en
301 vers `travel-hunter.fr`**, chemin et paramètres conservés. Mesuré :

```
tdhunt.netlify.app/                     301 → https://travel-hunter.fr/
tdhunt.netlify.app/api/stays?lieux=RAK  301 → https://travel-hunter.fr/api/stays?lieux=RAK
en suivant la redirection               200, 80 377 o, marqueur de version présent
```

Le site n'est **pas supprimé**, volontairement : `DUFFEL_TOKEN` n'existe nulle part ailleurs
que dans ses variables d'environnement, et il sert à remplir le `.env` d'Infomaniak.
Supprimer avant d'avoir recopié le jeton obligerait à en régénérer un chez Duffel.
Supprimer libère aussi `tdhunt.netlify.app` : n'importe qui pourrait le reprendre.

### Comment la redirection a été publiée malgré le mur de crédits

`netlify deploy --prod` est toujours refusé :
*« Account credit usage exceeded - new deploys are blocked until credits are added »*.
Les **brouillons passent encore** — vérifié. La procédure qui a fonctionné :

```bash
netlify deploy --dir=. --site=<id> --no-build        # brouillon, accepté
netlify api restoreSiteDeploy --data '{"site_id":"<id>","deploy_id":"<du brouillon>"}'
```

Le dossier déployé ne contient que deux fichiers : un `_redirects` avec
`/*  https://travel-hunter.fr/:splat  301!` et une page de repli avec `meta refresh`.

### ⚠️ Un marqueur de version qui ne marquait rien

`deploy.sh:44` contrôle la mise en ligne en cherchant `datesEffectives` dans la page servie.
**Ce marqueur est présent dans toutes les versions** — mesuré, 3 occurrences dans le fichier
actuel comme dans l'ancien. Il ne distingue donc rien et le contrôle est décoratif.
Le seul marqueur discriminant utilisé depuis est `Établissement non communiqué`, apparu avec
le correctif 1.

## Netlify n'est plus la cible — voir le § 10

**Le site tourne sur Infomaniak depuis le 2026-09-21 : https://travel-hunter.fr.**
Ce qui suit ne concerne plus que l'ancien site `tdhunt.netlify.app`, laissé en ligne sur sa
version précédente. La tâche planifiée qui devait déployer le 29 septembre a été **supprimée**
le 2026-09-21 (plist, script et journaux) : elle n'avait plus d'objet.

Deux leçons de cette tâche méritent d'être gardées, elles resserviront :

- **launchd ne rattrape PAS un déclenchement manqué** quand le job n'était pas chargé.
  Mesuré avec un agent jetable : chargé après l'heure prévue, `runs = 0`. Un `Month`/`Day`
  figé dans un plist reporte donc d'un an si la machine était éteinte.
- **Un agent launchd ne peut pas lire `~/Documents` ni `~/Downloads`** (protection macOS).
  Mesuré : `Operation not permitted`, code de sortie 126. Tout travail planifié sur un projet
  rangé là demande un accès complet au disque, ou un projet ailleurs.

## L'ancien mur de crédits Netlify, pour mémoire

Courriel Netlify reçu le 2026-09-21. **Contenu rapporté par le propriétaire du compte, non
vérifié dans la console** :

> *…has used its full credit allowance for this billing cycle. We've added 30 operational
> credits to keep your published sites online. These credits can't be used for production
> deploys or Agent Runners… If your team also exhausts its operational credits, **your
> published sites will be suspended** until credits are restored or your billing cycle
> resets on **September 29**.*

Trois conséquences, dont deux qui n'étaient pas dans ce document :

1. **Date de réinitialisation : 29 septembre.** Ce document disait « quand les crédits se
   réinitialiseront », sans date.
2. **Le site peut être coupé.** Les 30 crédits opérationnels servent à le maintenir en ligne ;
   chaque brouillon déployé y puise. Les épuiser **suspend le site publié**. Ce risque
   n'était écrit nulle part, et il change le coût d'un simple déploiement d'essai.
3. **La republication du § ci-dessous est devenue incertaine.** Elle publie en production, et
   le courriel annonce la production en pause. Elle fonctionnait *avant* cet état ; l'essayer
   consomme des crédits opérationnels, donc l'essayer a un prix.

Le site répondait toujours au 2026-09-21 à 22 h, mesuré :

```
/             http=200  79 681 o
/api/flights  http=200  0,6 à 7,3 s selon le cache amont, vols réels
/api/stays    http=200  1,9 s   fournisseur=duffel, 403, repli démo
```

**Aucun correctif en attente ne corrige un défaut actif en production**, sauf le n° 3
(escales du retour), cosmétique : un vol avec escale au retour s'affiche « direct ». Tous les
autres exigent `LITEAPI_KEY`, absente, ou ne touchent que l'outillage local. Rien ne justifie
de risquer la suspension du site pour huit jours d'attente.

⚠️ **Le compte Duffel a aussi une limite de débit.** Elle a été atteinte le 2026-09-21
(`rate_limit_exceeded`) en enchaînant quatre chasses à 12 destinations en quelques minutes.
Elle se rétablit seule — vérifié 20 min plus tard, `trouvees:1`, `sansOffre:[]` — mais elle
plafonne les essais : à 6 requêtes simultanées le compte sature déjà.

---

⚠️ **Le déploiement normal ne marche plus.** Crédits de build Netlify épuisés :

```json
{"state":"error","skipped":true,
 "error_message":"Skipped due to account credit usage exceeded"}
```

Vérifié : les **brouillons passent**, les **productions sont refusées**. La procédure
qui fonctionne évite le build distant, sans rien enfreindre.

```bash
cd "/Users/Oualid/Documents/PROJETS WEB/Foirefouille"

# une seule fois : connexion OAuth navigateur, action humaine
npx netlify-cli login

# 1) contrôles locaux + brouillon + vérification automatique du brouillon
bash deploy.sh
```

`deploy.sh --prod` **échoue** (`JSONHTTPError: Forbidden`, même mur). Pour publier, on
republie le brouillon **déjà construit**, ce qui ne consomme pas de crédit :

```bash
# récupérer l'identifiant du dernier déploiement prêt
npx netlify-cli api listSiteDeploys --data '{"site_id":"59abe778-4413-4a50-bcec-23aab922efd9"}' \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(next(x['id'] for x in d if x['state']=='ready'))"

# le publier en production
npx netlify-cli api restoreSiteDeploy \
  --data '{"site_id":"59abe778-4413-4a50-bcec-23aab922efd9","deploy_id":"<ID_CI_DESSUS>"}'
```

Puis vérifier que la production a bougé — **comparer une taille, pas un code HTTP** :
```bash
curl -sS -o /tmp/p.html -w "%{size_download}\n" https://tdhunt.netlify.app/
stat -f%z public/index.html     # la taille en ligne doit valoir celle-ci + 720
```

⚠️ **Ce contrôle ne vaut plus** : `tdhunt.netlify.app` répond 301 et ne sert plus la page.
Le contrôle vivant est celui du § 0, contre `travel-hunter.fr` — au 2026-09-22 il rend
**92 558 = 92 558**, même empreinte MD5.

`deploy.sh` ne ment plus sur son résultat : depuis le correctif 8, un `netlify deploy` qui
rend un statut non nul arrête le script avec le code 1. Avant, il continuait, interrogeait
l'**ancienne** production, la trouvait conforme et sortait en 0 en affichant
« 🚀 en production ». Mesuré, avec un faux CLI rendant 1 :

```
deploy.sh avant    → exit=0   dernière ligne : 🚀 en production : https://tdhunt.netlify.app
deploy.sh corrigé  → exit=1   dernière ligne : ❌ déploiement échoué — netlify a rendu un statut non nul
```

> **Piège vérifié :** `netlify status` **sort avec le code 0 même sans session**, tout
> en affichant « Not logged in ». Pour tester l'authentification, utiliser
> `netlify api listSites`, qui sort en 1 avec `Unauthorized`. `deploy.sh` le fait déjà.

Quand les crédits se réinitialiseront — **le 29 septembre**, cf. le § 🛑 en tête — 
`deploy.sh --prod` redeviendra utilisable.

---

# 4. Architecture

```
public/                    seul dossier publié
  index.html               application entière, zéro dépendance externe (92 558 o au 2026-09-22)
  manifest.json  sw.js     PWA — sw.js exclut /api/ du cache
netlify/
  lib/duffel.mjs           commun : jeton, en-têtes, parLots, cache, empreinte, motifEchec
  functions/flights.mjs    /api/flights  → Duffel Air
  functions/stays.mjs      /api/stays    → LiteAPI (prioritaire) ou Duffel Stays
serveur.mjs                processus Node qui sert public/ et les deux routes (§ 11)
tests/flights.test.mjs     233 assertions — node tests/flights.test.mjs
tests/serveur.test.mjs      40 assertions — node tests/serveur.test.mjs
deploy.sh                  déploiement Netlify, brouillon d'abord — **hérité, Netlify n'héberge plus**
netlify.toml               idem : publiait public/, empaquetait netlify/functions/
BUGS.md  AUDIT.md          debug et audit (non publiés)
```

Clés, au 2026-09-22 : elles vivent dans le `.env` du serveur Infomaniak (§ 10), pas chez
Netlify. `DUFFEL_TOKEN` posée · `LITEAPI_KEY` **manquante**, mesuré par le 403 du § 0.

Règles tenues dans tout le code, à ne pas casser :
- aucune clé ne sort vers le navigateur ; du corps des réponses amont, seul un extrait
  expurgé et borné à 160 caractères ressort, et uniquement quand l'amont ne parle pas la
  forme `{errors:[…]}` de Duffel (`duffel.mjs` `motifEchec`). C'est délibéré depuis le
  correctif 7 : sans journal côté fonction, c'est le seul canal de diagnostic, et c'est lui
  qui a tranché Duffel Stays. La barrière est `expurge`, contrôlée par le test.
- tout paramètre est validé avant d'atteindre l'amont
- sans clé → `200 {configured:false}`, la page bascule en démonstration sans erreur
- budget de 18 s par fonction, désormais réellement tenu (§ 0) ; mais `abandonnees` ne peut
  plus se déclencher — le signal de troncature est passé dans `sansOffre`
- un badge « réel » ne surmonte jamais une donnée de démonstration

---

# 5. Contrats d'API vérifiés — ne pas re-chercher

## Nos propres points d'entrée — noms de paramètres exacts
Relevés dans le code, pas devinés. Un mauvais nom rend **400**, pas un défaut.

```
/api/flights   origin=PAR  destinations=RAK,FAO  depart_date=YYYY-MM-DD
               return_date=YYYY-MM-DD  adults=2  children_ages=…  infants_ages_months=…
               bagage_soute=1  depart_apres=10  retour_avant=20
/api/stays     lieux=RAK:31.6295,-7.9811;FAO:37.0,-7.9   check_in=…  check_out=…
               adults=2  children_ages=…  infants_ages_months=…  pension=demi-pension
```

`flights.mjs:99-106` · `stays.mjs:203-209`. Attention, les deux fonctions ne suivent pas la
même convention : `depart_date`/`return_date` pour les vols, `check_in`/`check_out` pour les
hébergements. `origine`, `depart`, `adultes` n'existent pas.

Relevés sur les **exemples bruts** de la documentation, jamais sur une synthèse : les
synthèses automatiques ont produit **quatre noms de champs faux** dans cette session.

## Duffel Air — branché et fonctionnel
```
POST https://api.duffel.com/air/offer_requests?return_offers=true&supplier_timeout=7000
en-têtes : Authorization: Bearer …, Duffel-Version: v2
corps    : { data: { slices:[{origin,destination,departure_date}],
                     passengers:[{type:"adult"} | {age:N}], cabin_class, max_connections } }
réponse  : data.offers[].total_amount (CHAÎNE) · total_currency · owner.name
           slices[].segments[].departing_at
```
- `total_amount` est une **chaîne** couvrant **tous les passagers** — ne pas remultiplier
- les mineurs passent par `age`, pas par un type — c'est ce qui rend les champs d'âge utiles
- Duffel impose la **devise du compte** ; les montants non-EUR sont écartés côté page

## LiteAPI — écrit et testé, jamais exercé avec une vraie clé
```
POST https://api.liteapi.travel/v3.0/hotels/rates
en-tête : X-API-Key
corps   : { occupancies:[{adults,children:[ages]}], currency, guestNationality,
            checkin, checkout, latitude, longitude, radius, limit, includeHotelData:true }
réponse : data[].roomTypes[].offerRetailRate.amount          ← toutes chambres
          data[].roomTypes[].rates[].retailRate.total[0].amount ← par chambre
          hotels[] : name, stars, rating, main_photo
```
- **`radius` est en MÈTRES** (« Search radius in meters »), pas en kilomètres
- les montants sont des **nombres**, pas des chaînes comme Duffel
- `guestNationality` est **requis**
- pensions : `BB`→petit-déj · `HB`→demi-pension · `FB`→complète · `AI`/`TI`→all-inclusive.
  La pension demandée est privilégiée mais ne fait **jamais perdre** un séjour.

## Hôtes Amadeus — si jamais la question revient
Les hôtes de la spécification publiée sont **morts** : `test.api.amadeus.com` n'a aucun
enregistrement DNS (vérifié via 8.8.8.8), `api.amadeus.com` renvoie 410 depuis un proxy.
Les vrais sont `test.travel.api.amadeus.com` et `travel.api.amadeus.com`.

---

# 6. Impasses — ne pas réexplorer

| Piste | Pourquoi c'est mort |
|---|---|
| **Travelpayouts** | jeton accessible seulement après installation **et vérification** d'un script tiers (`emrldtp.cc`) injectant des offres dans chaque page. Six routes de contournement testées, toutes fermées. Compte créé, conditions acceptées. |
| **Amadeus Self-Service** | **supprimé le 17 juillet**. `developers.amadeus.com/self-service` redirige vers l'accueil : *« self-service portal has been decommissioned … Enterprise API Portal only »*. |
| **Duffel Stays** | route existante, même jeton, mais **403** : *« This feature is not enabled for your account. Please contact sales »*. Code écrit et prêt si activé. |
| **Kiwi / Tequila** | `/portal/register` **redirige vers `/portal/login`**. Il faut écrire à `affiliates@kiwi.com`. |
| **Skyscanner** | candidature, revue humaine sous deux semaines, critère « entreprise établie avec une large audience ». |
| **Sous-domaine pour contourner le quota** | le quota est sur **le compte**, pas le site — l'erreur dit *account*. Un domaine ne change ni qui déploie ni ce qui est facturé. |

**Leçon transversale, la plus chère de la session :** trois fournisseurs ont été codés
puis abandonnés pour des raisons d'**accès**, jamais de technique. Désormais : **ouvrir
la page d'inscription et vérifier qu'un compte solo peut être créé AVANT d'écrire une
ligne.**

---

# 7. Pièges vérifiés, coûteux si oubliés

- **Un code de retour n'est pas une preuve.** `netlify status` rend 0 en affichant
  « Not logged in ». Comparer une propriété du contenu : taille, empreinte, champ attendu.
- **Les synthèses de documentation mentent.** `total_price` et `departure_time` chez
  Duffel : deux champs inexistants. Lire les exemples bruts.
- **401 ≠ 403.** 401 = mauvais identifiant · 403 = identifiant valide sans habilitation.
  Cette distinction a tranché Duffel Stays en quelques minutes.
- **Diagnostiquer un secret sans le regarder.** `empreinteJeton()` remonte préfixe,
  longueur et espaces parasites. C'est ce qui a révélé qu'une **URL** avait été collée à
  la place du jeton (`prefixe:"http…"`, `longueur:57`).
- **Le service worker exclut `/api/`** du cache, sinon il resservirait des prix périmés.
- **Le badge Netlify** occupe 202 × 64 px en bas à droite à toutes les largeurs. La
  variable `--nf-badge: 66px` lui réserve sa bande ; sans elle il recouvre les boutons.
- **Grouper les déploiements** sur une offre gratuite : une quinzaine dans la journée a
  épuisé le quota.
- **Un compte de test écrit en dur est un faux contrôle.** `tests/flights.test.mjs`
  annonçait `91/91 OK` par une chaîne littérale : le chiffre ne bougeait pas quand on
  ajoutait une assertion, et servait pourtant de référence de recette dans ce document.
  Compté à l'exécution depuis l'audit.
- **Un test qui passe ne prouve rien s'il passe aussi sans le correctif.** Les cinq
  correctifs du § 0 ont été validés en **annulant** chacun et en vérifiant que le test
  échoue. C'est le seul contrôle qui distingue un test utile d'un test décoratif.

---

# 8. Reste ouvert, par ordre d'intérêt

0. ~~Déployer les correctifs du § 0~~ — **fait** : prod, dépôt et local ont la même
   empreinte (§ 0, mesuré 2026-09-22).
1. **Hôtels *payables*** — la clé de bac à sable est posée et fonctionne (§ 0) ; les prix
   restent des données d'exemple. Passer aux tarifs réservables demande un moyen de paiement
   chez Nuitee, puis de remplacer la valeur de `LITEAPI_KEY` par la clé `prod_` : **aucune
   ligne de code à écrire**, `modeLite()` fait passer le badge de `hôtel test` à `hôtel réel`
   tout seul.
2. ~~`maxBeachDistance`~~ — **câblé le 2026-09-22.** Il était déclaré dans `DEFAULTS` et
   rien d'autre : ni assaini, ni filtré, aucun champ. Désormais curseur « Distance à la
   plage » dans la carte Hôtel, assainissement (`clamp(…, 1, PLAGE_LIBRE)`), filtre sur
   `d.beachKm`, motif de rejet dédié, et quatre assertions d'auto-test.
   Deux choix, tous deux mesurés :
   - **Par défaut le filtre n'écarte rien** : `DEFAULTS.maxBeachDistance` passe de 5 à
     `PLAGE_LIBRE` (50), valeur où le curseur affiche « sans limite ». Sans ça, un défaut à
     5 km aurait silencieusement supprimé Marrakech (180 km) et Lisbonne (22 km) des
     résultats. Vérifié dans le navigateur : 8 cartes avec et sans le correctif, Marrakech
     comprise ; à 2 km, 7 cartes, toutes à 1,5 km ou moins.
   - `beachKm` vient du jeu de séjours et **restera modélisé** même quand l'hôtel est réel :
     aucune API interrogée ne donne cette distance. Le libellé sous le curseur le dit.
   ⚠️ Une recherche **sauvegardée avant ce jour** porte `maxBeachDistance: 5` : elle se met
   donc à filtrer à 5 km une fois rechargée. Assumé, pas un bogue.
3. ~~Mode flexible approximatif~~ — **tranché le 2026-09-22** (`3382341`). L'interface
   laissait cocher plusieurs mois, `datesEffectives()` n'en lisait qu'un : le choix est
   devenu **exclusif** (`role="radiogroup"`, `aria-checked`, un libellé qui annonce la date
   réellement sondée — le 15 du mois choisi). `sanitizeForm` ne garde qu'un mois, donc une
   recherche sauvegardée avant ce jour est ramenée au premier — celui qui servait déjà.
   **Ce qui n'est PAS fait**, et reste ouvert si le besoin apparaît : chasser réellement
   plusieurs mois. Il faudrait une fenêtre de recherche par mois, donc autant d'appels
   Duffel et LiteAPI, et une chasse qui passe des 14 s mesurées à 25-40 s. Écarté au profit
   de l'honnêteté immédiate, pas par impossibilité.
4. **La promesse « hunter »** — ~~pas tenue~~, **socle en ligne depuis le 2026-09-23**
   (`3effcc9`). Une recherche se met sous surveillance (bouton 🔔), le serveur relève les
   prix toutes les 6 h et garde l'historique, la page montre par destination le prix
   courant, le meilleur jamais vu et l'écart.

   - `netlify/lib/veille.mjs` : stockage JSON atomique, **hors du dépôt**
     (`/srv/customer/sites/travel-hunter-veilles.json`), quotas 5 par propriétaire /
     500 au total / 120 relevés gardés.
   - `netlify/lib/releve.mjs` : le relevé **appelle `/api/flights` et `/api/stays`** avec
     une `Request` fabriquée. Aucune règle dupliquée : dates, âges, expurgation, cache,
     `redirect:"manual"` — tout ce qui protège les proxys protège la veille.
   - `netlify/functions/veille.mjs` : `/api/veille`, GET/POST, propriétaire vérifié.
   - Pas de compte : identifiant aléatoire en `localStorage`, dit à l'écran.

   Vérifié en production après déploiement : `/api/veille` rend `{"veilles":[],"quota":5}`,
   une veille créée puis relue puis supprimée, un tiers reçoit 404 sur la veille d'un
   autre, des critères invalides sont refusés en 400, auto-test 92 PASS · 0 FAIL.

   **Les alertes poussées sont en ligne depuis le 2026-09-23** (`08cb954`) :

   - **Aucune clé n'est passée par une main humaine.** Le serveur génère sa paire VAPID au
     premier besoin et la range à côté des veilles, hors du dépôt. Mesuré en production :
     la réponse HTTP porte la clé publique (65 octets, préfixe `0x04`) et ni le champ
     `privee` ni un `"d":` de JWK ; le fichier serveur, lui, porte bien la clé privée.
   - **Aucune charge utile n'est envoyée.** Le chiffrement RFC 8291 n'est obligatoire que
     pour transporter du contenu ; un réveil vide ne demande que la signature VAPID.
     Conséquence qui compte : rien de ce que l'utilisateur surveille ne traverse les
     serveurs de Google, Apple ou Mozilla. Le service worker rappelle le site
     (`POST /api/veille?quoi=alerte`) en s'identifiant par son propre point d'entrée —
     il n'a pas accès au `localStorage` où vit le propriétaire.
   - **Déclencheur** : un prix strictement inférieur à TOUT l'historique de la
     destination. Pas de seuil, pas de « ça a baissé depuis hier », jamais au premier
     relevé. Un record est rare, donc l'alerte est rare — une notification trop fréquente
     finit désactivée, et une alerte désactivée ne vaut rien.
   - Un abonnement qui rend 404 ou 410 est oublié sur-le-champ ; une alerte de plus de
     24 h n'est plus affichée ; trois appareils par personne, le plus ancien cède la place.

   Vérifié en production : `abonner` → 201, `?quoi=alerte` → `{"alerte":null}` sur un
   abonnement connu et `{"alerte":null,"inconnu":true}` sur un inconnu, un endpoint non
   https refusé en 400, `sw.js` servi avec son écouteur `push`, auto-test 95 PASS · 0 FAIL.

   **Bouton « Tester l'alerte »** (`d9534e5`) — parce que le premier vrai record demande
   deux relevés, soit 12 h, sur des prix de bac à sable qui bougent peu. L'essai emprunte
   **exactement** le chemin d'une alerte réelle : même jeton VAPID, même réveil sans
   charge utile, même oubli des abonnements périmés. Un bouton qui passerait ailleurs ne
   prouverait rien sur le vrai. L'alerte d'essai est rattachée au propriétaire, pas à une
   veille — on doit pouvoir vérifier les notifications avant d'avoir mis quoi que ce soit
   sous surveillance — et elle ne porte aucun prix : « Essai réussi », jamais un chiffre
   inventé. Un essai par minute, sinon 429.

   Mesuré en production, boucle armée (journal du serveur après redémarrage) :
   ```
   http://localhost:3000 — routes : /api/flights, /api/stays, /api/veille
   veille active : un relevé toutes les 6 h
   page 121 592 o md5 905dc2e2f84ba166385b77c28b484f96 = local · sw.js 5 114 o = local, cache tdh-v6
   tester sans abonnement      200 {"envoyees":0,"tentees":0,"sansAbonnement":true}
   tester, appareil injoignable 200 {"envoyees":0,"tentees":1}   ← l'échec est rendu tel quel
   second essai immédiat       429 « laisse-lui une minute »
   ?quoi=alerte                {"alerte":{"essai":true,"nom":"Essai d'alerte"}}  sans prix
   ```

   ⚠️ **Défaut trouvé à l'usage, corrigé le 2026-09-23** (`5f82aec`) : depuis l'écran des
   résultats, 🔔 créait la veille côté serveur **sans rien afficher** — le message de
   retour n'était rendu que par la vue « Mes veilles ». Mesuré avant correctif :
   `veillesCreees: 1`, et le texte de confirmation introuvable dans le DOM, présent
   seulement dans la source du script. Une action sans retour visible n'est pas une
   action. `messageVeille()` est désormais rendu par les deux vues qui déclenchent une
   action de veille, avec un bouton « Voir mes veilles » depuis les résultats.
   **Confirmé par le propriétaire du site** : « ça marche maintenant, je vois mes veilles ».

   ✅ **Chaîne complète observée le 2026-09-23.** Le propriétaire du site a installé la
   PWA sur son téléphone, activé les alertes et appuyé sur « Tester l'alerte » : la
   notification **« Essai réussi »** est arrivée sur l'appareil. Relevé côté serveur
   juste après, dans `/srv/customer/sites/travel-hunter-veilles.json` :

   ```
   abonnements: 1
    - fcm.googleapis.com | créé 2026-09-23T13:53:54.959Z
   essais notés : [{"t":"2026-09-23T13:55:21.142Z","essai":true,"nom":"Essai d'alerte"}, …]
   ```

   Le dernier maillon — *service de push → écran* — n'est donc plus une déduction. Reste
   qu'aucune alerte **réelle** (déclenchée par un record de prix) n'a encore eu lieu : il
   faut deux relevés et une vraie baisse, sur des prix de bac à sable qui bougent peu.
   ⚠️ Le premier relevé d'une veille arrive **au prochain tour** : la boucle démarre à
   `serveur.mjs` (boot + 60 s, puis toutes les `VEILLE_HEURES` heures, 6 par défaut,
   `VEILLE_HEURES=0` la désactive). Les prix relevés sont ceux des clés en place : en bac
   à sable aujourd'hui, donc l'historique aussi — le résumé remonte `mode`.
5. **Liens de réservation** — le lien pointe sur le bon établissement *et* porte le séjour
   depuis le 2026-09-22 : `checkin`, `checkout`, `group_adults`, `group_children`, un `age`
   par mineur (bébés convertis en années, comme `invites()` dans `stays.mjs`) et `no_rooms`
   repris de `priceDeal` — jamais recalculé, la règle des chambres ne vit qu'à un endroit.
   Relevé sur une carte rendue en local :
   `…?ss=Vila%20Gal%C3%A9%20Albacora%2C%20Faro&checkin=2026-11-06&checkout=2026-11-14&group_adults=2&group_children=2&no_rooms=1&age=3&age=0`
   ✅ **Vérifié le 2026-09-22 dans un vrai navigateur**, capture à l'appui : Booking ouvre
   « Le Patio de Mezraya : 1 établissement trouvé », dates « ven. 6 nov. — sam. 14 nov. »,
   « 2 adultes · 2 enfants · 1 chambre ». Les paramètres sont bien honorés.
   *(Depuis un navigateur piloté, Booking rend une page dégradée — « 0 établissement », dates
   du jour — pour le lien actuel comme pour l'ancien : ce test-là ne tranche rien, ne pas le
   rejouer par automatisation.)*
   Deux limites qui restent : c'est **une recherche**, pas l'offre exacte — aucun des deux
   fournisseurs ne rend d'URL de réservation ; et en bac à sable LiteAPI annonce un prix là
   où Booking affiche « Indisponible aux dates sélectionnées », ses disponibilités étant
   fictives.
6. ~~Crédits Netlify~~ — sans objet : l'application tourne sur Infomaniak (§ 10) et
   `tdhunt.netlify.app` se contente de rediriger (301 mesuré le 2026-09-22). Le site Netlify
   reste ouvert pour son `DUFFEL_TOKEN` et pour ne pas libérer le sous-domaine.
7. **Pas de suivi d'erreurs, pas d'intégration continue** — l'auto-test ne tourne que dans
   un navigateur, `npm test` qu'à la main. Le domaine propre, lui, existe : travel-hunter.fr.
8. **Le dossier de travail n'est pas un dépôt** — `git status` dans
   `~/Documents/PROJETS WEB/Foirefouille` : *not a git repository*. Le code part vers GitHub
   depuis ailleurs, puis le serveur fait `git pull`. Conséquence mesurée le 2026-09-22 :
   les 10 fichiers publiés sont identiques au local — `README.md` compris depuis le commit
   `ea84324`, poussé via un clone jetable puis recoupé par empreinte. Tant que ce dossier
   n'est pas un dépôt, chaque envoi passera par ce détour.
9. ~~`sw.js` met en cache les réponses d'erreur~~ — **corrigé le 2026-09-22** (`1abf8cb`,
   `AUDIT.md` § B). La règle passe par `enCache()` : `ok` exigé, réponses opaques écartées.
   Nom du cache `tdh-v3` → `tdh-v4` pour purger les caches déjà empoisonnés chez les
   visiteurs. Vérifié en production : `https://travel-hunter.fr/sw.js` rend l'empreinte du
   fichier local et contient `tdh-v4`.
10. ~~`expires_at` n'est jamais lu~~ — **corrigé le 2026-09-22** (`1abf8cb`, `AUDIT.md` § E).
    `perimee()` écarte du cache une offre dont la date est lue et dépassée ; une offre sans
    date ou avec une date illisible n'est jamais déclarée périmée. La page ne l'affiche
    toujours pas, ce qui reste acceptable : les tarifs viennent d'un appel frais à chaque
    chasse, le cache était la seule source de péremption.
10bis. **Badge `hôtel test`** — fait le 2026-09-22 (`29e4d96`), avant même que la clé
    existe : `/api/stays` publie `mode` pour LiteAPI via `modeLite()`, seul un préfixe
    `prod_` exact vaut « live ». Déployé et vérifié en production : 72 PASS · 0 FAIL,
    `badgeHotel(true,"test")` rend « hôtel test ».
11. **`abandonnees` et `abandonnes` sont morts** — 0 en toute circonstance depuis le
    correctif 6 (§ 0). Vérifié le 2026-09-22 sur 10 destinations en production :
    `"abandonnees":0`. Le signal de chasse tronquée vit dans `sansOffre`.
12. ~~Les constats A à P d'`AUDIT.md`~~ — **tous traités au 2026-09-23** (`72a0f03`),
    après une vérification à 22 agents : un examen par constat contre le code du jour,
    puis une contre-expertise de chacun de ceux déclarés encore ouverts.

    | | |
    |---|---|
    | **F** | sans objet — `deploy.sh` vise Netlify, qui n'héberge plus. Marqué hérité en tête du fichier. |
    | **M** | déjà corrigé la veille — la note de bas de page est conditionnelle depuis le badge `vol test`. |
    | **A** | une destination entière disparaissait quand LiteAPI donnait le prix au niveau de l'offre sans `rates[]`, ou avec un `offerRetailRate` à 0. Mesuré : 880 € présents, séjour rendu `null`. |
    | **D** | `entiers("1,5", 2, 17)` rendait `[5]` : **3 voyageurs envoyés à Duffel pour 4 demandés**, tarif de trois affiché sous un badge réel. Les deux handlers refusent maintenant en 400 — l'audit ne visait que `flights.mjs`, `stays.mjs` avait le même trou. |
    | **H** | le focus retombait sur `<body>` à chaque rendu, aucun bouton du formulaire n'ayant d'`id`. `selecteurFocus()` le retrouve par l'ensemble des `data-*`. Vérifié : après un clic sur « + », le focus reste sur ce bouton. |
    | **I** | `aria-live` couvrait `#app`, réécrit en entier à chaque rendu : la page entière était réannoncée au moindre clic. Région dédiée d'une phrase, qui annonce en plus la recherche en cours. |
    | **J** | « filtre budget appliqué » était tautologique : à 1 200 € aucun séjour ne passait, `[].every()` vaut `true`. À 1 500 € l'assertion voit garder ET rejeter. |
    | **L** | le contrôle de syntaxe acceptait 0 octet en silence si le tag portait un attribut. Déplacé dans les tests, restreint aux scripts exécutables, passé à `vm.Script`. |
    | **N** | trois des quatre branches du bandeau annonçaient « aucun tarif réel » en taisant l'état hôtelier, qui peut être branché. |
    | **P** | `invites()` garde sa forme hybride, **documentée comme jamais exercée** (Stays répond 403). L'aligner à l'aveugle remplacerait une incertitude connue par une invention. |

    Chaque correctif a été annulé pour voir la suite tomber. Mesuré après déploiement :
    `npm test` 314/314 et 40/40, `?selftest=1` 84 PASS 0 FAIL en production, page
    106 460 o md5 `174129762e7add9e660439261811cd88` identique au local, et
    `/api/flights?children_ages=1,5` → 400 sans appel amont.

14. ⚠️ **Un agent a modifié le dépôt pendant la vérification, et c'est le prompt qui
    l'a permis.** L'agent `verifie:L` a lancé
    `cp tests/flights.test.mjs /tmp/…bak && cp deploy.sh /tmp/…bak && python3 …`,
    patché les deux fichiers **dans le dépôt réel** pour mesurer son correctif, puis n'a
    restauré que `public/index.html`. Le compte d'assertions est passé de 296 à 298 sans
    explication, en plein milieu d'une série de correctifs de sécurité.

    Cause : le prompt demandait « mesure, exécute, cite la sortie » **et** « propose le
    correctif » sans fournir d'atelier ni poser d'interdit. Appliquer le patch sur place
    était la lecture la plus naturelle.

    Trois garde-fous posés, dans l'ordre de solidité :
    - `CLAUDE.md` à la racine (règle n° 1) — lu par tout agent lancé depuis ce dossier ;
    - fichier marqueur `.agents-lecture-seule` + hook `PreToolUse`
      `~/.claude/hooks/depot_lecture_seule.py`, qui **refuse** `Write`/`Edit` et les
      commandes shell d'écriture quand l'appel porte un `agent_id` (mesuré : un
      sous-agent en a un, le fil principal non). Le scratchpad reste ouvert, `npm test`
      et `cp -R . <scratchpad>` passent, les autres projets ne sont pas touchés ;
    - la clause d'interdiction à répéter dans chaque prompt de workflow.

    Vérifié de bout en bout : un sous-agent chargé d'écrire dans le dépôt reçoit
    « Refusé : un sous-agent n'écrit pas dans … » et le fichier n'est pas créé.
    **Cette porte a été fermée dans la foulée.** Le hook reconnaît aussi l'écriture par
    interpréteur : `python3 -c`, `node -e`, `perl -e`, un heredoc — il ne bloque pas les
    interpréteurs eux-mêmes (les agents mesurent avec `node -e` en permanence), seulement
    ceux dont le code appelle une primitive d'écriture vers une cible hors scratchpad.
    Mesuré sur 14 cas, puis de bout en bout : un sous-agent reçoit
    « Bash (écriture par interpréteur) : … » et ni `SONDE2.txt` ni `SONDE3.txt` n'existent,
    pendant que `node -e 'import("./netlify/lib/duffel.mjs")…'` continue de rendre
    `entiers 1,5 = null`.

    Un faux positif a été trouvé et corrigé au passage : le motif de redirection prenait
    la flèche `m=>console.log` pour un `>`, ce qui interdisait aux agents la commande de
    mesure la plus courante.

    ⚠️ Plafond résiduel : tout repose sur des motifs. Un agent déterminé qui encoderait
    son écriture (base64, script déposé d'abord dans /tmp puis exécuté) passerait encore.
    Le hook vise la maladresse, pas l'adversaire.

13. ~~Fuites de clé et validation des dates~~ — **corrigées le 2026-09-23** (`4379b97`),
    après un audit à dix agents : quatre balayages indépendants du dépôt, puis trois
    réfuteurs par correctif proposé. **60 constats, 4 réfutations sur 6 avis** — mes deux
    correctifs initiaux (C et G) ont été jugés insuffisants, à raison. Cinq défauts traités,
    chacun établi par une preuve exécutée, pas par raisonnement :

    | # | Gravité | Ce qui fuyait ou passait |
    |---|---|---|
    | 1 | haute | `X-API-Key` survivait à une redirection : `undici` retire `authorization` en inter-origine, **pas** un en-tête maison. Deux serveurs locaux et un 302 ont montré le tiers recevant la clé LiteAPI entière. → `redirect: "manual"` sur les trois appels amont. |
    | 2 | haute | `code` contournait `expurge` — `titre` et `extrait` étaient filtrés, lui non. `{"errors":[{"code":"<la clé>"}]}` publiait le secret au navigateur. |
    | 3 | haute | `expurge` dépendait de la **forme** du secret : seuil de 16 caractères, jeu `[A-Za-z0-9_-]`. Une clé de 15 caractères ou contenant un point traversait intacte. → les **valeurs réelles** de l'environnement sont retirées d'abord, l'heuristique ne sert plus que pour l'inconnu. |
    | 4 | moyenne | `empreinteJeton` rendait `net.slice(0, 4)` — quatre caractères réels de toute clé sans préfixe `lettres_lettres_` — et recopiait jusqu'au second souligné (« prod_secretvalue_ » en entier). → image finie : préfixe de famille public, ou libellé de collage (`guillemet en tête`, `préfixe Bearer`, `URL collée`, `ligne VARIABLE= collée`). |
    | 5 | — | `JOUR` ne validait que la forme. `2026-02-31`, `2020-01-01`, `9999-12-31` partaient en **12 appels amont chacun** ; un séjour de 29 219 nuits passait. → `jourValide` (calendrier, passé, horizon de 400 jours), plafond de 60 nuits, et la page borne ses champs `min`/`max` pour refuser **avant** l'appel. |

    Les cinq gardes ont été annulées une à une : la suite tombe à chaque fois sur
    l'assertion correspondante (`aucun champ du motif ne porte la clé`, `la clé 15 car. est
    retirée`, `collage : guillemet en tête`, `une date passée ne se réserve pas`,
    `stays.mjs : 2 appel(s) fetch, 1 garde(s) redirect`), puis restaurées.

    ⚠️ **Deux assertions encodaient l'ancien comportement** et ont été réécrites, pas
    supprimées : `tests/flights.test.mjs:171` attendait `"http…"` comme empreinte d'une URL
    collée — elle testait la fuite elle-même — et l'auto-test prenait `2099-06-02` pour une
    date valide.

    Mesuré en production après déploiement :
    ```
    /api/flights depart_date=2020-01-01   400 « ni passée ni au-delà de l'horizon de vente »
    /api/stays   check_in=2026-02-31      400 idem
    /api/stays   349 nuits                400 « 60 nuits maximum par séjour »
    /api/stays   séjour normal            200 fournisseur liteapi, mode test, 8 nuits
    ?selftest=1                           79 PASS · 0 FAIL, champ date max=2027-10-27
    npm test                              296/296 OK · 40/40 OK   (255 avant)
    ```

Méthode tenue pour les deux correctifs du soir : chaque garde a été **annulée exprès** pour
vérifier que la suite échoue — « une 500 n'entre jamais en cache » et « le cache de
flights.mjs doit consulter perimee() » — puis restaurée. Un test qui ne tombe pas quand on
casse la règle ne prouve rien.

14. **La tranche horaire** — **en ligne depuis le 2026-09-24** (`a6f4a74`). Deux menus,
    « décollage après » et « retour posé avant », qui suivent exactement la logique des
    bagages : ils ne filtrent pas l'affichage, ils changent le **tarif retenu**. Une famille
    qui ne peut pas partir à 6 h du matin voit le prix de l'avion qu'elle peut prendre, pas
    un prix d'appel qu'elle devra abandonner à l'étape suivante.

    | Choix | Ce que l'API fait | Pourquoi |
    |---|---|---|
    | `depart_apres=H` | écarte les offres dont l'aller décolle avant `H:00` | l'heure qu'une famille regarde est celle où elle doit être debout |
    | `retour_avant=H` | écarte celles dont le retour **se pose** après `H:00` | ce qui compte est l'heure d'arrivée à la maison, pas celle du décollage au loin |

    Les deux bornes sont **inclusives à la minute**. Mesuré en production le 2026-09-24,
    PAR → FAO, 2026-11-08 → 2026-11-15 :

    ```
    aucune contrainte        80,27 €  Transavia   départ 06:00 · pose 12:00
    depart_apres=10         440,09 €  TAP         départ 17:50 · pose 11:45
    retour_avant=12          80,27 €  Transavia   pose 12:00 → gardée, la borne inclut 12:00
    retour_avant=11         239,42 €  Lufthansa   pose 08:25
    depart_apres=23&retour_avant=1    trouvees 0 · aucun vol ne tient
    ```

    **Deux défauts ont été trouvés en production, pas en local** — les deux valent d'être
    retenus, parce qu'aucun test local ne les aurait vus :

    - ⚠️ **« posé avant 20 h » acceptait un atterrissage à 20:35.** La comparaison se faisait
      à l'heure, pas à la minute. Corrigé par `minutesLocales(iso)` — qui lit l'horaire **par
      expression régulière sur la chaîne ISO, jamais par `Date`** : `new Date()` appliquerait
      le fuseau du serveur à une heure qui est déjà locale à l'aéroport. La garde a été
      annulée exprès : la suite tombe sur « retour posé : 20:35 ne passe pas sous 20 h ».
    - ⚠️ **Les deux menus étaient invisibles dans le mode de dates par défaut.** Ils avaient
      été insérés à l'intérieur de la branche « dates flexibles » du ternaire, donc
      `document.getElementById("departApres")` rendait `null` sur la page telle qu'elle
      s'ouvre. Mesuré dans le navigateur en production, pas déduit. Corrigé en sortant les
      champs du ternaire — la tranche horaire vaut pour les deux modes de dates — et couvert
      par l'assertion « horaires : les deux menus existent dans le mode de dates par défaut ».

    Les deux valeurs voyagent dans la **clé de cache** (`${signature}|${souteMin}|${departApres}|${retourAvant}|${dest}`) :
    sans ça, une recherche contrainte resservirait le résultat d'une recherche libre.

    ⚠️ **Plafond assumé** : quand une contrainte ne laisse aucune offre, la destination sort
    avec `trouvees: 0` et **`sansOffre` reste vide** — la carte affiche « aucune offre » sans
    dire que c'est l'horaire qui l'a vidée. `sansOffre` ne porte aujourd'hui que les échecs
    de l'amont. Même plafond exactement pour `bagage_soute=1`. Vérifié en production le
    2026-09-24 avec `depart_apres=23&retour_avant=1`.

---

# 10. EN LIGNE sur Infomaniak — https://travel-hunter.fr

**Déployé le 2026-09-21 à 23 h.** Mesuré depuis l'extérieur, pas déduit — **état de ce
soir-là, dépassé depuis : les chiffres à jour sont au § 0** (92 558 o, jeton posé) :

```
https://travel-hunter.fr/            http=200  80 377 o = le fichier local, à l'octet
                                     marqueur « Établissement non communiqué » : 2
https://travel-hunter.fr/api/flights http=200  {"configured":false,…}  ← pas encore de clé
?selftest=1 dans un navigateur       40 PASS · 0 FAIL
journal du serveur                   .env not found. Continuing without it.
                                     http://localhost:3000 — routes : /api/flights, /api/stays
```

Domaine de repli pour tester sans toucher au principal :
`https://ywb3coxncuc.preview.hosting-ik.com` — mêmes 80 377 octets.

## Comment le code arrive sur le serveur

Chemin exact, refait le 2026-09-22 : **Manager → Hébergement → pariswebdesign.com →
travel-hunter.fr → Tableau de bord → Actions rapides → « Ouvrir la console SSH »**, soit
`/v3/hosting/801755/hosting/583640/ssh-terminal/Node.js/terminal`. La page « Consoles » du
site, elle, ne donne QUE les journaux d'exécution et de build — pas de shell.
Le `git pull` a suffi : `serveur.mjs` relit `public/` à chaque requête, aucun redémarrage
n'a été nécessaire pour une modification de page.

Dépôt **public** : https://github.com/oualidmedjidel/travel-hunter — `41f670a` à la mise en
ligne, **`dbc4e95` au 2026-09-22** (2026-09-21 22:24 UTC). Le conteneur le clone, sans aucun
identifiant à stocker.

```bash
# mise à jour, depuis la console SSH du Manager
cd /srv/customer/sites/travel-hunter.fr && git pull
# puis « Redémarrer » dans le tableau de bord
```

Le dépôt ne contient QUE ce qui tourne : `serveur.mjs`, `package.json`, `netlify/`,
`public/`, `.env.exemple`, `README.md`. **Ni `BUGS.md`, ni `PASSATION.md`, ni `AUDIT.md`**
— vérifié avant publication, et `.gitignore` exclut `.env`, contrôlé en le créant exprès.

Les 8 fichiers ont été recoupés par empreinte après clonage : identiques à l'octet.

## Configuration posée dans le Manager

```
Version de Node.js      24
Commande d'exécution    node --env-file-if-exists=.env serveur.mjs
Port d'écoute           3000
Commande de build       npm i        (sans effet : zéro dépendance)
```

⚠️ **`--env-file-if-exists`, pas `--env-file`.** Mesuré : avec `--env-file`, Node refuse de
démarrer si le fichier manque — le site serait resté mort jusqu'à la création du `.env`.
La variante tolérante prévient et continue en mode démonstration.

⚠️ **Le Manager n'offre AUCUN champ de variables d'environnement** pour un site Node.js —
formulaire vérifié en entier. D'où le `.env`, à créer à la racine du projet sur le serveur,
hors de `public/` donc injoignable par URL (vérifié : `/.env` rend 404).

## Le `.env` est posé — vérifié le 2026-09-22

`DUFFEL_TOKEN` y est : `/api/flights` répond `{"configured":true,"mode":"test"}` et remonte
de vraies offres (FAO 150,37 EUR, Transavia France, 10/10 destinations en 14,2 s). L'action
humaine annoncée ici **est faite**, ne pas la refaire.

Reste une ligne à ajouter dans le même fichier
`/srv/customer/sites/travel-hunter.fr/.env`, puis « Redémarrer » dans le tableau de bord :

```
LITEAPI_KEY=sand_…   posée le 2026-09-22 au soir, saisie par le propriétaire lui-même
```

Elle a été ajoutée sans jamais s'afficher, par `read -s -r K && printf 'LITEAPI_KEY=%s\n' "$K"
>> .env && unset K`, contrôlée par `grep -c LITEAPI_KEY .env` → `1`. Aucune clé n'est passée
par un agent ni par un journal de conversation.

Sans clé, le site tournerait avec des hôtels de démonstration sans erreur — comportement
prévu, pas une panne.

## Le gabarit d'origine n'a pas été supprimé

Le projet NestJS livré par Infomaniak est dans `/srv/customer/gabarit-nest/`, intact.

---

# 11. Le portage — `serveur.mjs`, comment il a été écrit et éprouvé

**Infomaniak est la référence depuis le 2026-09-21**, et le site y tourne (§ 10).
Le site Netlify reste en ligne sur son ancienne version ; il n'est plus la cible.

`serveur.mjs` a été écrit et éprouvé en local avant d'être déployé (§ 10). Il existe parce que le mur de crédits
Netlify (§ 3) rend l'hébergeur discutable, et parce que le propriétaire a un compte
Infomaniak, qui propose des « sites Node.js ».

Le décalage à combler : Netlify exécute une fonction **par requête** ; Infomaniak lance un
**processus qui tourne en continu**. Les handlers ne changent pas d'une ligne — ils sont déjà
au format web standard. Mesuré : `0` import de SDK Netlify, seules `fetch`, `URL`, `Response`
et `AbortSignal` sont utilisées. `serveur.mjs` ne fait que traduire node:http ↔ Request /
Response et servir `public/`. Zéro dépendance.

```
node serveur.mjs          écoute sur $PORT, 8080 par défaut
node tests/serveur.test.mjs   40/40 OK
```

Les routes ne sont pas recopiées : elles sont lues sur la déclaration que porte déjà chaque
fonction (`export const config = { path: "/api/flights" }`), pour qu'il n'y ait jamais deux
vérités. Le module n'écoute que lancé directement, pour rester importable par le test.

Éprouvé en local le **2026-09-21**, avec un **faux** jeton fabriqué pour l'occasion — aucune
clé réelle n'a été manipulée. Chiffres d'époque : la page pesait alors 80 819 o et l'auto-test
comptait 40 assertions ; au 2026-09-22 c'est 92 558 o et 61 assertions (§ 0).

```
page servie             80 819 octets, octet pour octet identiques au fichier local
?selftest=1             40 PASS · 0 FAIL, servi par serveur.mjs
sans jeton              200 {configured:false}, bascule en démo
paramètres invalides    400 « origin doit être un code IATA de 3 lettres. »
                        400 « il faut au moins un adulte par bébé. »
appel amont réel        401 Duffel → sansOffre:[{code:"access_token_not_found",
                        titre:"Access token not found"}], jeton résumé par empreinte
journal du serveur      0 occurrence du jeton
```

## ⚠️ Un test de sécurité qui ne testait rien

La première version du test prétendait couvrir la traversée de chemin. Elle ne couvrait rien :
retirer la garde laissait **40/40 au vert**. `fetch`, `curl` et le parseur `new URL()`
normalisent `..` avant que la garde soit atteinte — mesuré :

```
/../../../../etc/passwd   → pathname /etc/passwd
/%2e%2e/PASSATION.md      → pathname /PASSATION.md
```

Testé aussi par socket brute, sans client pour normaliser : même résultat, 404 avec ou sans
la garde. La protection réelle vient donc du parseur d'URL, pas de la garde.

La garde est **conservée** en défense en profondeur — quiconque ajouterait un
`decodeURIComponent` sur le chemin la rendrait active du jour au lendemain — mais elle est
désormais extraite en `cheminSur()` et testée **pour elle-même**, sur des entrées déjà
décodées. Vérifié en la neutralisant : `AssertionError: cheminSur doit refuser /../PASSATION.md`.

## Ce qu'il resterait à faire pour héberger chez Infomaniak

1. Vérifier dans le manager que l'offre permet un **site Node.js** et des **variables
   d'environnement** — `DUFFEL_TOKEN` ne doit jamais descendre dans le navigateur ni être
   versionné. Non vérifié : seul le propriétaire du compte peut le voir.
2. Poser `DUFFEL_TOKEN`, et `LITEAPI_KEY` le jour où elle existe.
3. ~~Trois chaînes disent « environnement Netlify »~~ — **fait le 2026-09-21.**
4. ~~`--nf-badge: 66px`~~ — **fait le 2026-09-21.** Mesuré à 375 px, avant puis après :

   ```
                             avant    après
   --nf-badge                 66px   (aucune)
   body padding-bottom       154px     88px
   actionbar padding-bottom   78px     12px
   ```

   Les messages ne nomment plus d'hébergeur : « absent de l'environnement du serveur »,
   vérifié en interrogeant les deux routes. Les commentaires qui citent le **chemin**
   `netlify/functions/…` sont conservés : le dossier s'appelle toujours comme ça, et le
   renommer toucherait les imports pour zéro gain.
5. Effet de bord favorable : `creerCache` est aujourd'hui vidé à chaque instance de fonction.
   Sur un processus continu il tient vraiment — moins d'appels Duffel, et la limite de débit
   du compte (§ 3) devient beaucoup moins gênante.

---

# 9. Décisions tranchées — ne pas rouvrir

- **Nouveau site Netlify, pas d'écrasement.** Le site d'origine n'appartient pas à ce
  compte (`get-project` → 404, 0 projet avant). Vérifié, pas supposé.
- **`BUGS.md`, `PASSATION.md`, `README.md` restent hors ligne** — `netlify.toml` limite
  la publication à `public/`. `BUGS.md` décrit une faille encore exploitable sur le site
  d'origine. Les 404 le confirment.
- **Verrou SSO désactivé** sur accord explicite : le site est public.
- **Badge Netlify conservé** — le masquer toucherait à la marque de l'hébergeur.
- **Le site affiche « démo »**, jamais « ✓ VÉRIFIÉ », sur des données fictives.
  L'original présentait des prix inventés comme vérifiés.
- **Aucune clé n'est manipulée par l'assistant** — création de compte, saisie de mot de
  passe, récupération de jeton et acceptation de conditions restent des actions humaines.
  Le jeton Duffel initial a fuité en clair dans la conversation, a été **révoqué et
  remplacé**.
  ⚠️ **Correction du 2026-09-21 :** ce document affirmait que la variable Netlify était
  « marquée secrète ». C'est **faux**, mesuré via l'API : `is_secret: False`. La valeur reste
  donc lisible dans l'interface Netlify — ce qui a permis de la récupérer pour Infomaniak,
  mais ce n'était pas l'intention affichée.
