# Travel Deal Hunter — règles du projet

## 1. Un sous-agent ne modifie JAMAIS ce dépôt

Tout agent lancé depuis ce dossier — sous-agent, agent de workflow, agent d'audit —
travaille en **lecture seule** sur l'arborescence du projet.

Interdit : `Write`, `Edit`, `sed -i`, `>` ou `>>` vers un fichier du dépôt, `cp` vers un
fichier du dépôt, `git checkout/reset/stash`, `npm install`, et **toute écriture par
interpréteur** — `python3 -c "open('x','w')"`, `node -e 'writeFileSync(…)'`, un heredoc
qui écrit. Un hook les refuse, ce n'est pas une consigne de politesse.

Autorisé, et encouragé : lire, exécuter `npm test`, lancer `node -e` ou `python3 -c` qui
**lisent** ou mesurent, `curl`, `grep`, et copier le projet vers le scratchpad.

**Pour mesurer un correctif, il faut une copie.** Jamais le dépôt :

```bash
COPIE="$TMPDIR/essai-$$" && cp -R "$PWD" "$COPIE" && cd "$COPIE"
# patcher ici, lancer npm test ici, rapporter les chiffres obtenus ici
```

Le livrable d'un agent de vérification est **le texte du correctif** (fichier, ligne,
code exact) et **les mesures faites sur la copie** — pas un dépôt modifié. Le fil
principal seul écrit dans le projet, parce qu'il est le seul à voir l'ensemble des
modifications en cours et à pouvoir les pousser.

*Origine : le 2026-09-23, un agent de vérification a patché `tests/flights.test.mjs` et
`deploy.sh` dans le dépôt réel pour prouver son correctif, puis n'a restauré que
`public/index.html`. Le compte d'assertions a bougé de 296 à 298 sans que personne ne
sache pourquoi, en plein milieu d'une série de correctifs de sécurité. Le prompt
demandait « mesure et exécute » et « propose le correctif » sans donner d'atelier ni
poser d'interdit : l'agent a fait la chose la plus naturelle.*

## 2. Une affirmation = une preuve

Voir `~/.claude/CLAUDE.md`. Dans ce projet, concrètement :

- un chiffre (taille, durée, nombre d'assertions, empreinte) sort d'une commande qu'on
  vient de lancer, ou ne se dit pas ;
- `npm test` et `?selftest=1` sont les deux seules sources du compte d'assertions —
  aucun chiffre codé en dur dans un document ne fait foi ;
- un correctif non trivial s'accompagne d'un test **qu'on annule exprès** pour vérifier
  qu'il échoue. Un test qui ne tombe pas quand on casse la règle ne prouve rien.

## 3. Ce que ce dépôt est

- Application en ligne : https://travel-hunter.fr, hébergée chez Infomaniak (site Node.js).
- Mise à jour : `git pull` dans `/srv/customer/sites/travel-hunter.fr` via la console SSH
  du Manager, puis « Redémarrer » **si un fichier serveur a changé** — `public/` seul est
  relu à chaque requête, aucun redémarrage nécessaire.
- Le dossier de travail local **n'est pas un dépôt git** : les envois passent par un clone
  jetable. Ne pas supposer qu'un `git checkout` peut rattraper une erreur ici.
- `deploy.sh` et `netlify.toml` sont hérités de Netlify, qui n'héberge plus rien.
- Documents : `PASSATION.md` (état des lieux, ce qui reste ouvert), `AUDIT.md` (revue du
  2026-09-21), `BUGS.md` (debug du site d'origine). Les lire avant de rouvrir un sujet.

## 4. Clés et secrets

Les clés vivent dans le `.env` du serveur, jamais dans le dépôt, jamais dans une
conversation. Aucun agent ne saisit, ne lit ni ne recopie une clé d'API : pour en poser
une, on prépare la commande et l'humain colle la valeur lui-même, saisie masquée.
