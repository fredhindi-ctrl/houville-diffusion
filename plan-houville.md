# Plan — Diffusion WhatsApp & recherche Œdicnème — Houville-la-Branche

*Ce document est la source de vérité du projet. Toute décision qui y figure prévaut sur les
échanges précédents. Dernière refonte majeure : abandon de Telegram au profit d'une WebApp de
recherche (Œdicnème), déterministe, sans IA.*

## État d'avancement (27/08/2026, à reprendre ici)

**Fait et validé en conditions réelles :**
- Telegram entièrement retiré (code, deps, env vars, doc).
- `render-whatsapp/` renommé `whatsapp-worker/` (partout dans le code et la doc).
- Migration SQL recherche (extensions `unaccent`/`pg_trgm`, config `french_unaccent`, RLS
  lecture publique) appliquée sur le vrai projet Supabase et testée.
- `webapp-oedicneme/api/search.ts` et `index.html` construits, testés dans un vrai navigateur
  (Playwright) contre les vraies données (54 comptes rendus).

**Deux bugs trouvés en testant l'interface réelle (pas juste la logique) :**
1. **Corrigé** : `index.html` n'avait pas de `<meta charset="utf-8">` → tous les accents et
   emojis s'affichaient en mojibake ("Å'dicnÃ¨me" au lieu de "Œdicnème"). Fixé.
2. **Corrigé et confirmé (28/08/2026)** : le stemmer français de Postgres fusionnait "voirie"
   et "voir" (même racine Snowball) — chercher "voirie" remontait 3 résultats sur 5 qui ne
   parlent que de "voir si..." sans rapport avec la voirie. Fonction `recherche_fts` mise à
   jour avec un bonus de classement pour les correspondances exactes (voir section G), SQL
   rejoué par l'utilisateur sur le vrai Supabase. **Revérifié en direct** (appel `recherche_fts`
   via l'API REST, clé `anon`, données réelles) : "voirie" remonte maintenant 3/3 résultats
   pertinents (rangs 1.06-1.09), plus aucun faux positif "voir". Jointure `comptes_rendus`
   (lecture RLS anon) et recherche insensible aux accents ("ecole" → "École") revérifiées aussi.
   **Non testé cette fois** : le clic-à-clic dans l'UI chat elle-même (pas d'outil navigateur
   disponible dans cette session) — seul le chemin backend/données a été rejoué, avec les mêmes
   identifiants (clé anon) et le même appel que fait `api/search.ts`.

**Pas commencé** : `whatsapp-worker` (Baileys, persistance session Supabase, `/health`),
déploiement Koyeb/UptimeRobot, déploiement réel Vercel (les deux projets), mise à jour de
`WEBAPP_URL`. Voir sections G/H/I/K plus bas — ce sont des **plans écrits, pas du code
implémenté**. La formulation de ces sections avait initialement laissé penser qu'elles étaient
en cours dans cette même passe ; ce n'est pas le cas, c'est explicitement reporté à une session
dédiée (voir section K).

**Nouveau (28/08/2026)** : `webapp-oedicneme/index.html` a été remplacé par le prototype visuel
fourni par l'utilisateur (`prototype/oedicneme-prototype-interactif-v11-mobile-header-mascot.html`
— mascotte 🦉 animée, tous les états UX, ~14 Mo dont la majorité en images base64 embarquées).
Design/CSS/animations repris **à l'identique, aucune modification**. Seul changement
fonctionnel : les fausses données en dur (`const DOCS`, 6 comptes rendus fictifs, et
`SOURCE_META`) ont été retirées et `searchDocs()` appelle maintenant le vrai `/api/search`
(fetch POST). `showResults()` utilise les vrais champs de l'API (`titre`, `date_conseil` formaté
en français, lien direct vers `url_pdf`) et le surlignage `<<...>>` déjà fourni par
`ts_headline` côté Postgres (plus besoin du matcher de mots-clés local). `runSearch()` gère
maintenant un vrai état d'erreur réseau (section F, point 6) au lieu de toujours réussir.
JS revérifié syntaxiquement (`node --check`). Ensuite, images de la mascotte (base64 inline,
~9,3 Mo) extraites vers `webapp-oedicneme/assets/*.{png,webp}` (fichiers statiques, servis
tels quels par Vercel) — `ASSET` et `IDLE_FRAMES` référencent maintenant des chemins `/assets/…`
au lieu de data URIs. `index.html` passe de ~14 Mo à ~1,6 Mo. Justification : webapp rouverte
à chaque nouveau message WhatsApp — en fichiers séparés, le navigateur les met en cache
(visites suivantes quasi instantanées) ; en base64 inline, tout le HTML était retéléchargé à
chaque visite. Design/comportement inchangés, seul l'emplacement des octets change.
Reste dead code intentionnellement conservé
(non branché mais inoffensif) : `parseQuery`/`tokens`/`SYNONYMS`/`STOP_WORDS`/`highlight` —
ancien moteur de recherche local du prototype, plus utilisé mais pas supprimé pour limiter le
diff. Ce dossier n'est pas un repo git — pas d'historique pour revenir en arrière sur l'ancien
`index.html` remplacé.

**Déploiement réel (28/08/2026)** : repo poussé sur GitHub
(`github.com/fredhindi-ctrl/houville-diffusion`, main), `vercel-app` et `webapp-oedicneme`
déployés en production sur Vercel (compte `fred-ac2b`, les deux connectés au repo GitHub pour
auto-déploiement sur futur push) :
- Webapp Œdicnème : **https://webapp-oedicneme.vercel.app** — testée en vrai (`POST /api/search`
  avec "voirie" → 5 résultats corrects, identiques aux tests directs sur Supabase).
- Scraper/cron : **https://vercel-app-coral-chi.vercel.app** — cron protégé par `CRON_SECRET`
  (généré à cette occasion, il était vide dans `.env`). Testé en vrai avec le secret : run
  complet sur le vrai site, 20 comptes rendus + 5 actualités scannés, 0 erreur.
- **Bug réel trouvé et corrigé au déploiement** (pas juste un souci de build) : la fonction cron
  plantait à chaque appel (`ERR_MODULE_NOT_FOUND`), avant même la vérification du secret. Cause :
  avec `"type": "module"`, le runtime Node de Vercel exige l'extension `.js` sur les imports
  relatifs même depuis du code source `.ts` (`tsconfig` avait `moduleResolution: "Bundler"`, qui
  laisse passer l'absence d'extension au typecheck mais pas à l'exécution réelle). Corrigé sur
  tous les imports relatifs de `vercel-app`. Effet de bord découvert au passage : `shared/types.ts`
  (à la racine du repo) n'existe pas dans l'environnement Vercel de `vercel-app` (Root Directory
  = `vercel-app/`, donc le reste du repo n'est jamais téléversé) — dupliqué dans
  `vercel-app/shared/types.ts`.
- `CRON_SECRET`, `WEBAPP_URL` (pointe maintenant vers la webapp déployée ci-dessus) et toutes
  les autres variables sont configurées sur les deux projets Vercel (production + preview).
- `whatsapp-worker` n'est pas déployé (toujours des stubs, chantier séparé, voir section H) —
  `WEBAPP_URL` est donc pour l'instant seulement utilisable manuellement, pas encore diffusée
  automatiquement par WhatsApp.
- **2ᵉ bug réel trouvé après coup (404 en prod)** : le `rootDirectory` des deux projets Vercel
  n'était jamais enregistré côté projet (`null`) — les déploiements CLI initiaux marchaient
  seulement parce qu'ils étaient lancés depuis le bon sous-dossier local. Le push du fix
  précédent a déclenché l'intégration Git (auto-déploiement sur push, jamais désactivé), qui
  clone tout le repo à la racine et n'y a rien trouvé → build vide → 404 constaté par
  l'utilisateur sur `webapp-oedicneme.vercel.app`. Corrigé en réglant `rootDirectory`
  explicitement sur les deux projets (`vercel-app`, `webapp-oedicneme`) via l'API Vercel, puis
  redéploiement forcé depuis Git. Revérifié en vrai : page 200, asset mascotte servi, recherche
  fonctionnelle, cron protégé. Un 3ᵉ projet parasite (`houville-diffusion`, créé automatiquement
  à la première connexion GitHub, `rootDirectory` également `null`) a été supprimé sur demande.

**Retouches webapp Œdicnème post-déploiement (28/08/2026)** :
- Badge «Prototype» et «— Prototype interactif» dans le `<title>` retirés (plus un prototype,
  c'est en prod) — badge «Recherche documentaire — sans IA générative» conservé.
- Titre des cartes résultat (`.result h3`) utilisait Georgia (serif) alors que la ligne
  méta au-dessus est en Inter (sans-serif) — incohérent visuellement, signalé par
  l'utilisateur. Retiré l'override, hérite maintenant de la même police.
- Résultats de recherche triés par pertinence (`rang` de `recherche_fts`) — pas intuitif pour
  des archives municipales. Changé en tri par date décroissante côté `api/search.ts` (les
  candidats restent choisis par pertinence, seul l'ordre d'affichage change).
- **Bug réel trouvé par l'utilisateur (login Vercel imposé sur mobile)** : `ssoProtection`
  était activée sur le projet `webapp-oedicneme` (`deploymentType: all_except_custom_domains`)
  — mettait un site censé être public derrière un mur de connexion Vercel, puisqu'aucun
  domaine personnalisé n'est configuré. Désactivée via l'API (`ssoProtection: null`), reconfirmé 200
  sans redirection depuis un client anonyme.
- **Débordement horizontal sur mobile (confirmé par l'utilisateur, scroll horizontal réel,
  bouton d'envoi coupé au bord de l'écran)** : cause exacte non identifiée malgré inspection
  approfondie du CSS (chaîne flex/grid `.form`/`.composer`/`.send` semblait correcte sur le
  papier). Filet de sécurité appliqué (`overflow-x:hidden` sur `html,body` et `.app`,
  `min-width:0` sur `.form`) — **pas reconfirmé par l'utilisateur après coup**.
- **Composer nécessitant un scroll de page pour être visible sur mobile** : le composer est
  imbriqué deux niveaux de grille sous `.app` (`main > .chatPane > .composer`). Ajouté
  `height:100%` à chaque niveau imbriqué (`main`, `.chatPane`), en plus du `min-height:0` déjà
  présent — hypothèse : Safari iOS a besoin des deux, pas seulement `min-height:0`, dans une
  grille imbriquée sur plusieurs niveaux. **Retesté par l'utilisateur : «pas terrible», pas
  concluant.** Chantier arrêté là à sa demande, pas relancé. À reprendre avec, idéalement, un
  vrai outil d'inspection mobile (DevTools distant ou navigateur pilotable) plutôt que du
  CSS à l'aveugle — c'est la limite atteinte cette session (aucun outil navigateur disponible).

**Pour reprendre la prochaine fois :**
1. ✅ SQL de `recherche_fts` (section G) rejoué sur Supabase et revérifié en direct (28/08/2026).
2. ✅ `webapp-oedicneme/index.html` = prototype utilisateur, branché sur `/api/search` réel
   (28/08/2026, voir ci-dessus).
3. ✅ Déploiement réel Vercel des deux projets, avec un vrai bug de runtime trouvé et corrigé
   (voir "Déploiement réel" ci-dessus) — c'était plus qu'un simple `vercel deploy` sans accroc.
4. ⏳ Reste à faire : test visuel dans un vrai navigateur de l'UI chat elle-même (accents, tri
   "voirie", liens PDF, état d'erreur) — pas fait faute d'outil navigateur dans la session, mais
   le backend est maintenant vérifié en production réelle, pas juste en local.
5. Continuer le reste de la checklist F (états UX) visuellement si pas déjà fait.
6. Puis seulement, passer à `whatsapp-worker`/Koyeb (chantier séparé, voir section H) — c'est le
   seul morceau de l'architecture qui reste non implémenté.

## Objectif du projet

Récupérer automatiquement les actualités et comptes rendus publiés sur le site de
Houville-la-Branche, pour :

1. diffuser automatiquement les nouvelles publications dans un groupe WhatsApp existant ;
2. permettre la recherche dans les anciens comptes rendus du conseil municipal ;
3. offrir une expérience de recherche agréable et extrêmement simple sur smartphone ;
4. fonctionner sans abonnement, coût cible **0 €/mois**.

Projet personnel pour quelques amis, pas un service officiel de la mairie.

## Décisions fondamentales

- **Telegram : ABANDONNÉ.** Plus aucune dépendance active — ni bibliothèque, ni bot, ni
  webhook, ni lien `t.me/...`, ni variable d'environnement. La recherche est maintenant une
  WebApp publique.
- **Recherche : WebApp conversationnelle "🦉 Œdicnème"** — accessible depuis n'importe quel
  navigateur, lien envoyé dans chaque message WhatsApp de diffusion.
- **Interface : apparence chatbot** — bulles de conversation, avatar 🦉, suggestions
  cliquables, champ de saisie fixé en bas. Ressemble à WhatsApp/Messenger dans sa forme.
- **Moteur : PostgreSQL déterministe.** Full-Text Search français + `unaccent` + repli
  `pg_trgm` pour tolérer les fautes d'OCR. Classement par `ts_rank`, extraits par
  `ts_headline` — aucune étape ne fait appel à un modèle de langage.
- **IA : AUCUNE. LLM : AUCUN. Embeddings : AUCUN. Vector DB : AUCUNE. RAG : AUCUN.** Pas
  d'appel à OpenAI, Claude API, Anthropic API, Gemini, Mistral, Ollama, Llama ou tout autre
  modèle local ou distant. Aucune génération de texte probabiliste, aucun résumé génératif,
  aucune reformulation par LLM, aucune analyse sémantique par modèle génératif. Zéro coût de
  token. **Cette contrainte prime sur toute autre considération de qualité d'expérience** :
  Œdicnème préfère répondre "je n'ai rien trouvé, essayez des mots-clés plus simples" plutôt
  que de simuler une compréhension qu'il n'a pas.
- **Historique utilisateur côté serveur : AUCUN.** Aucune requête, aucun mot-clé, aucune
  identité de demandeur n'est stockée en base ni journalisée (pas de `console.log(query)`,
  pas de table `conversations` ou `messages_utilisateurs`). L'historique de conversation est
  purement visuel, conservé dans l'état local du navigateur (disparaît à la fermeture/au
  rechargement — c'est acceptable).
- **Principe fondamental de qualité** : Œdicnème dit toujours *"j'ai trouvé ceci dans les
  archives"*, jamais *"voici ce qui s'est passé"* si cette phrase suppose une interprétation.
  Chercher, retrouver, montrer la source — jamais comprendre, interpréter, générer. Chaque
  résultat affiche systématiquement sa source (date, titre, extrait brut, lien PDF) pour que
  l'utilisateur vérifie lui-même.
- **Budget : 0 €/mois.** Vercel Free, Supabase Free, Koyeb Free, UptimeRobot Free, OCR.space
  Free, numéro WhatsApp personnel existant. Pas de VPS payant, pas d'API IA, pas d'API
  WhatsApp Business payante, pas d'abonnement, pas de numéro supplémentaire. Un projet
  gratuit peut demander occasionnellement une intervention manuelle — c'est accepté.
- **Ne pas sur-architecturer.** Projet petit : 200 lignes simples valent mieux que 2000 lignes
  avec abstraction inutile. Pas de microservices, CQRS, event sourcing, brokers, Redis, vector
  DB, système d'agents ou orchestration complexe. Priorités, dans l'ordre : simplicité,
  fiabilité, coût 0 €, maintenance minimale, expérience utilisateur agréable.

## Architecture globale

```
SITE DE LA MAIRIE
        │
        ▼
Vercel Cron (vercel-app)
Scraper quotidien
        │
        ├── actualités
        │
        └── comptes rendus PDF
                 │
                 ▼
              OCR.space
                 │
                 ▼
              Supabase (Postgres)
          ┌──────┴───────┐
          │              │
          ▼              ▼
messages_a_envoyer   comptes_rendus_texte
          │           (recherche FTS + pg_trgm)
          ▼              │
Koyeb Free                │
whatsapp-worker            │
Node + Baileys             ▼
          │           webapp-oedicneme (Vercel)
          ▼           Chat UI + /api/search
      groupe WhatsApp        │
                              ▼
                         navigateur (smartphone)
```

Quatre composants, qui ne communiquent qu'via Supabase (jamais d'appel direct entre eux) :

1. **`vercel-app`** (Vercel, cron quotidien) — scrape le site, fait l'OCR des PDF, écrit en
   base, génère les messages de diffusion WhatsApp.
2. **`whatsapp-worker`** (Koyeb, process permanent) — connecté en continu au groupe WhatsApp
   via Baileys, poste les nouveautés (poll de `messages_a_envoyer`), expose `/health`.
3. **`webapp-oedicneme`** (Vercel, serverless) — la WebApp de recherche : interface chatbot +
   `/api/search`, lecture seule sur Supabase (clé anon, RLS).
4. **Supabase** (Postgres gratuit) — base centrale + moteur de recherche déterministe.

## Structure du repo (état réel au moment de cette refonte)

```
houville-diffusion/
├── plan-houville.md         ← ce fichier, source de vérité
├── README.md
├── MESSAGES.md               gabarits des messages WhatsApp
├── .env / .env.example
├── shared/types.ts           types partagés (pas de node_modules propre — imports directs
│                             uniquement, pas de dépendance externe importable depuis ce dossier)
├── supabase/schema.sql       schéma Postgres complet, idempotent
├── vercel-app/                scraper + cron (Vercel)
│   ├── api/cron/scrape.ts
│   ├── lib/scraper/{actualites,comptes-rendus,pdf,run,whatsapp-templates}.ts
│   ├── lib/supabase.ts
│   └── scripts/backfill.ts    backfill historique, à lancer une seule fois à la main
├── webapp-oedicneme/          WebApp de recherche (Vercel)
│   ├── api/search.ts          déjà implémenté : FTS + repli pg_trgm, 0 IA
│   └── index.html             interface chatbot (nouveau)
└── whatsapp-worker/            diffuseur WhatsApp (Koyeb, anciennement prévu sur Render)
    └── src/{index,queue,supabase,whatsapp,auth-state,health}.ts
```

## A. État du repo au moment de cette refonte

- **Scraping (`vercel-app/lib/scraper/`)** : fonctionnel et déjà éprouvé sur le vrai site
  (structure HTML confirmée, pagination gérée, cas limite "page hors limites" documenté).
  `actualites.ts` et `comptes-rendus.ts` scrapent la page 1 (nouveautés) ; `backfill.ts`
  parcourt tout l'historique une fois à la main.
- **OCR (`vercel-app/lib/scraper/pdf.ts`)** : fonctionnel. PDF scannés (pas de couche texte,
  vérifié sur 4 échantillons 2016-2026), découpage par chunks de 3 pages via `pdf-lib` (limite
  du tier gratuit OCR.space), OCR séquentiel, concaténation.
- **Génération des messages WhatsApp (`whatsapp-templates.ts`)** : fonctionnelle, avec
  extraction automatique des décisions actées (`extraireTopics`, testée sur un vrai compte
  rendu). Contient encore le rappel Telegram — à retirer (voir section C).
- **Base Supabase (`supabase/schema.sql`)** : déjà très avancée. Tables `actualites`,
  `comptes_rendus`, `comptes_rendus_texte`, `messages_a_envoyer`. Moteur de recherche
  **déjà déterministe et sans IA** : FTS français + `unaccent` (config `french_unaccent`),
  repli `pg_trgm` (`recherche_floue`), RLS (lecture publique, écriture `service_role`
  uniquement). Cette partie répond déjà exactement aux exigences de la présente refonte.
- **`webapp-oedicneme/api/search.ts`** : déjà implémenté et déjà conforme à 100% aux règles
  "aucune IA" — normalisation déterministe légère, appel `recherche_fts` puis repli
  `recherche_floue`, aucune journalisation de la requête, réponse `POST /api/search`
  (jamais `GET ?q=`). Il manquait uniquement l'interface visuelle (chat UI) — ajoutée dans
  cette refonte.
- **`whatsapp-worker`** (anciennement pensé pour Render, renommé) : **squelette non
  implémenté** — `index.ts`, `queue.ts`, `whatsapp.ts` sont des stubs qui lèvent
  `TODO: ...`. C'est le composant le plus en retard. Les sections G/H/I ci-dessous en
  décrivent le design cible, mais **son implémentation est reportée à une session dédiée**
  (voir "État d'avancement" en haut de ce document) — pas faite dans cette passe.
- **Telegram** : aucune dépendance de code (aucune librairie installée, aucun webhook créé) —
  seulement des mentions dans la documentation (`README.md`, `MESSAGES.md`, ce fichier) et
  deux constantes (`RAPPEL_TELEGRAM_CR`, `RAPPEL_TELEGRAM_ACTU`) dans
  `whatsapp-templates.ts`. Suppression simple, aucun risque de régression.
- **Render** : aucune dépendance de code — mentions uniquement dans la documentation et dans
  des commentaires du code (`whatsapp-worker/src/*.ts`, `.gitignore`). Le dossier n'a jamais
  été nommé `render-whatsapp` dans les faits (déjà `whatsapp-worker/`) — seul le `README.md`
  employait encore cet ancien nom.

## B. Éléments à conserver tels quels

- Tout `vercel-app/lib/scraper/` (scraping + OCR) — fonctionnel, testé, pas de raison de
  réécrire.
- `supabase/schema.sql` — moteur de recherche déjà conforme à la présente refonte
  (déterministe, sans IA). Seul ajout : la table `baileys_auth_state` (section G).
- `webapp-oedicneme/api/search.ts` — déjà conforme, conservé sans modification de logique.
- `shared/types.ts`, tous les `package.json`/`tsconfig.json` existants.
- `vercel-app/scripts/backfill.ts`.

## C. Éléments supprimés dans cette refonte

- `RAPPEL_TELEGRAM_CR`, `RAPPEL_TELEGRAM_ACTU` dans `whatsapp-templates.ts` → remplacés par
  un rappel pointant vers `WEBAPP_URL` (déjà présent dans `.env.example`, jamais utilisé
  jusqu'ici).
- Toutes les mentions Telegram/BotFather/`@oedicneme_bot`/`t.me/...` dans `README.md` et
  `MESSAGES.md`.
- La mention de l'ancien nom de dossier `render-whatsapp/` dans `README.md` et `.gitignore`
  (remplacée par `whatsapp-worker/`, et la ligne d'auth locale devient obsolète — la session
  Baileys est désormais persistée dans Supabase, pas sur le disque du worker).
- Aucun code applicatif Telegram n'existait — rien à désinstaller côté `npm`.

## D. Nouvelle architecture (voir diagramme global ci-dessus)

Changement principal par rapport au plan précédent : la recherche n'est plus un canal
conversationnel WhatsApp/Telegram, mais une **WebApp** dédiée. Cela simplifie en réalité le
projet — un composant de moins à garder connecté 24/7 avec une identité de bot séparée, un
composant de plus mais entièrement serverless (`webapp-oedicneme`, aucun process permanent).
L'hébergement du diffuseur WhatsApp passe de Render à **Koyeb** (voir section H pour le détail
et la question de la persistance de session).

## E. Architecture de recherche (déterministe, sans IA)

```
Message utilisateur (WebApp Œdicnème)
        │
        ▼
Normalisation locale (JS, api/search.ts)
  minuscules, retrait ponctuation, espaces normalisés
        │
        ▼
Recherche PostgreSQL (RPC recherche_fts)
  Full-Text Search français (config "french_unaccent")
  + unaccent + word_stem
        │
        ├─ résultats trouvés ────────────────┐
        │                                     │
        └─ 0 résultat                         │
              │                                │
              ▼                                │
        Repli pg_trgm (RPC recherche_floue)     │
        sur le dernier mot significatif          │
        (tolère les fautes de reconnaissance OCR) │
              │                                    │
              ▼                                    ▼
        Classement déterministe (ts_rank / word_similarity, calculé en SQL)
                        │
                        ▼
        Extraction des passages (ts_headline, natif Postgres — pas de recomposition JS)
                        │
                        ▼
        Gabarit de réponse prédéfini (JS, front-end)
          count === 0  → "Je n'ai trouvé aucun compte rendu correspondant à cette recherche."
          count === 1  → "J'ai trouvé un compte rendu correspondant à votre recherche."
          count  > 1   → "J'ai trouvé {count} comptes rendus correspondant à votre recherche."
                        │
                        ▼
        Affichage sous forme de conversation (bulles, cartes de résultats, sources visibles)
```

Aucune étape de cette chaîne n'appelle un modèle de langage. `api/search.ts` (déjà écrit,
conservé sans changement) implémente exactement ce chemin. Les phrases affichées par Œdicnème
proviennent de gabarits fixes côté front-end (`index.html`), jamais générées dynamiquement par
un modèle.

**Limites assumées** : sans IA, Œdicnème ne comprend pas le sens d'une phrase complexe. Une
requête comme *"ils ont parlé du terrain de foot ?"* n'est pas traduite intelligemment en
`terrain foot` — seule la normalisation déterministe (minuscules, ponctuation, espaces) est
appliquée. Si la recherche échoue, le message d'erreur invite explicitement à reformuler avec
des mots-clés simples plutôt que de prétendre à une compréhension qu'il n'a pas.

## F. UX Œdicnème — états de l'interface

1. **Accueil** — avatar 🦉, titre "Œdicnème", sous-titre "Recherche dans les archives de
   Houville-la-Branche", message de bienvenue, 4 boutons de suggestion (Voirie, Budget,
   École, Urbanisme) qui lancent directement une recherche (pas des prompts IA), champ de
   saisie fixé en bas, mention discrète de l'absence d'IA.
2. **Saisie** — l'utilisateur tape dans le champ fixé en bas, bouton envoyer (➤), la bulle
   apparaît immédiatement côté "Vous" dès l'envoi.
3. **Chargement** — indicateur discret (points animés, façon "en train d'écrire") pendant
   l'appel à `/api/search` — animation très sobre, pas d'effet superflu.
4. **Résultats** — bulle Œdicnème avec la phrase de gabarit ("J'ai trouvé N comptes rendus…"),
   suivie d'une carte par résultat : 📄 date + titre, extrait brut (`ts_headline`, jamais
   reformulé), bouton "Voir le compte rendu" (lien direct vers le PDF source).
5. **Zéro résultat** — "🦉 Je n'ai rien trouvé. Essayez avec quelques mots-clés plus simples,
   par exemple : terrain foot" — jamais de silence ni d'erreur technique affichée.
6. **Erreur** (panne réseau, Supabase indisponible) — message neutre et honnête ("Une erreur
   est survenue, réessayez dans un instant"), jamais un message qui laisse croire à une
   recherche vide alors que le système a échoué.

Design : moderne, simple, chaleureux, léger, pas institutionnel, mobile-first, coins
légèrement arrondis, beaucoup d'espace, animations très discrètes, chargement rapide même sur
téléphone moyen. Ludique grâce au 🦉, sans être enfantin.

## G. Schéma SQL — modifications nécessaires

Le schéma de recherche existant (`recherche_fts`, `recherche_floue`, RLS, index GIN) est
conservé sans changement — déjà conforme. Seul ajout, pour la persistance Baileys (section H) :

```sql
-- Persistance de la session WhatsApp (Baileys) : credentials + Signal keys.
-- Koyeb ne garantit pas un disque persistant entre redéploiements/redémarrages — la session
-- doit survivre ailleurs. Une seule ligne ("default") : ce projet n'a qu'un seul worker.
-- service_role uniquement (jamais RLS publique, jamais clé anon) — contient des secrets de
-- session WhatsApp.
create table if not exists baileys_auth_state (
  id text primary key default 'default',
  creds jsonb not null,
  keys jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table baileys_auth_state enable row level security;
-- Aucune policy créée : par défaut, RLS sans policy = accès refusé à tout sauf service_role
-- (qui contourne RLS). C'est le comportement voulu ici.
```

## H. Hébergement whatsapp-worker : AlwaysData + whatsmeow (Go)

**Changement hébergement (28/08/2026)** : Koyeb nécessitait un compte/token que l'utilisateur
n'avait pas sous la main ; Northflank a été essayé ensuite mais bloque la création du moindre
service (même gratuit) tant qu'aucune carte bancaire n'est enregistrée sur le compte —
incompatible avec le "0 €/mois, pas de CB" du projet. **AlwaysData** a un forfait gratuit
permanent réel (1 Go disque, 256 Mo RAM, 0.25 CPU, "for life"), pas de CB demandée, et son
type de site `user_program` permet de déclarer une commande arbitraire persistante (déclarée
via leur API REST `api.alwaysdata.com/v1/site/`, authentification Basic avec un token API en
nom d'utilisateur). Point de vigilance découvert dans leur doc API : chaque site a un champ
`max_idle_time` (1800s par défaut) après lequel le process est arrêté — géré par le ping
UptimeRobot sur `/health` (section I), qui sert donc doublement de surveillance et de
garde-fou anti-inactivité, exactement comme prévu pour Koyeb à l'origine.

**Changement librairie (28/08/2026)** : Baileys (TypeScript) abandonné — pairing code et QR
tous deux cassés par un bug amont non résolu (détail section K, point 10). Remplacé par
**whatsmeow**, une implémentation indépendante du même protocole WhatsApp multi-appareils, en
**Go** — non affectée par ce bug, confirmé empiriquement (QR scanné avec succès sur un vrai
téléphone, aucun crash). Seul `whatsapp-worker` change de langage ; le reste du projet
(scraper, webapp) reste en TypeScript. Déploiement plus simple qu'avant : un binaire Go
compilé (`go build`) tourne directement sur AlwaysData, pas besoin d'installer Go sur le
serveur (contrairement à Node qui, lui, y est déjà installé).

`whatsapp-worker` tourne comme process Go permanent sur **AlwaysData** (site `user_program`,
`fredhindi.alwaysdata.net/whatsapp-worker/`). Composition :

- Connexion whatsmeow au numéro WhatsApp personnel existant, via QR code (le pairing code
  Baileys posait problème ; pas encore retesté côté whatsmeow — voir section K).
- **Persistance de session via une connexion Postgres directe à Supabase** (`sqlstore` de
  whatsmeow — pas l'API REST comme le reste du projet, nécessite `SUPABASE_DB_PASSWORD`, le
  mot de passe direct de la base). whatsmeow gère lui-même son schéma (17 tables `whatsmeow_*`,
  migrations automatiques) — pas de store custom à écrire, contrairement à la version Baileys.
  **RLS activée sans policy sur ces 17 tables** (indispensable : Supabase expose par défaut
  toute table `public` via son API REST avec la seule clé `anon` si RLS n'est pas activée —
  vérifié et corrigé en urgence pendant cette session, voir section K point 10). Avantage
  pratique : la session vit dans cette base, donc appairer depuis n'importe quelle machine
  (ex. en local pour le tout premier appairage) suffit à ce que le worker déployé la retrouve
  ensuite, sans transfert manuel de fichiers de session.
- Boucle de polling `messages_a_envoyer` (statut `en_attente`) toutes les 5 minutes, envoi
  dans le groupe, marquage `envoye`.
- **Aucune recherche depuis WhatsApp, aucun chatbot WhatsApp, aucune réponse automatique aux
  habitants** — WhatsApp reste un canal de diffusion à sens unique.
- Endpoint `GET /health` pour UptimeRobot (voir section I).

## I. Surveillance : UptimeRobot

UptimeRobot Free interroge `GET /health` sur AlwaysData. Réponse attendue :

```json
{ "status": "ok", "whatsapp": "connected", "database": "ok", "worker": "ok" }
```

Si la connexion WhatsApp est perdue, l'endpoint répond **HTTP 503** (pas 200 avec un champ
"whatsapp": "disconnected" caché dans le JSON) pour que UptimeRobot déclenche réellement une
alerte. Le endpoint vérifie : process Node actif (trivial, il répond), état de connexion
Baileys réel (pas juste "le process tourne"), accessibilité Supabase (ping léger), et que la
boucle de polling n'est pas bloquée (timestamp du dernier passage, comparé à un seuil).

## J. Variables d'environnement, par composant

| Variable | vercel-app | whatsapp-worker | webapp-oedicneme | Description |
|---|---|---|---|---|
| `SUPABASE_URL` | ✅ | ✅ | ✅ | URL du projet Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | ✅ | ❌ | Accès total, contourne RLS — jamais côté public |
| `SUPABASE_ANON_KEY` | ❌ | ❌ | ✅ | Lecture seule via RLS — seule clé légitime en public |
| `CRON_SECRET` | ✅ | ❌ | ❌ | Protection du endpoint `/api/cron/scrape` |
| `WEBAPP_URL` | ✅ | ❌ | ❌ | Lien Œdicnème inclus dans chaque message WhatsApp |
| `OCR_SPACE_API_KEY` | ✅ | ❌ | ❌ | OCR des PDF scannés (tier gratuit, 25 000 req/mois) |
| `PORT` | ❌ | ✅ (optionnel) | ❌ | Port HTTP du serveur `/health` (AlwaysData l'injecte) |
| `WHATSAPP_PHONE_NUMBER` | ❌ | ✅ | ❌ | Numéro personnel (E.164) qui demande le pairing code |
| `WHATSAPP_GROUP_JID` | ❌ | ✅ | ❌ | Identifiant du groupe WhatsApp cible (`...@g.us`) |

La session WhatsApp elle-même (creds + Signal keys) n'a pas de variable dédiée — générée à la
première connexion (pairing code) et persistée automatiquement dans `baileys_auth_state`. Ajouté
au fil de l'implémentation (28/08/2026) : `WHATSAPP_PHONE_NUMBER` et `WHATSAPP_GROUP_JID`
n'étaient pas dans la version précédente de ce tableau — nécessaires en pratique pour demander
le pairing code et cibler le bon groupe, oubli du plan initial.

## K. Plan de migration (ordre exact)

**Passe 1 — recherche Œdicnème (cette session)**

1. ✅ Supprimer Telegram, renommer `whatsapp-worker/`.
2. ✅ Migration SQL recherche (`unaccent`, `pg_trgm`, `french_unaccent`, RLS) — appliquée et
   testée sur le vrai Supabase.
3. ✅ Retirer les constantes Telegram de `whatsapp-templates.ts` (à vérifier au prochain
   démarrage que c'est bien fait — voir "État d'avancement").
4. ✅ Construire `webapp-oedicneme/index.html` + `api/search.ts`, testés dans un vrai
   navigateur contre les vraies données.
5. ✅ Fix `recherche_fts` (bonus correspondance exacte, section G) rejoué et reconfirmé en
   direct sur les vraies données (28/08/2026). Reste : test visuel dans un vrai navigateur
   (pas fait cette fois, pas d'outil navigateur disponible dans la session).
6. Mettre à jour `README.md` et `.env.example` (déjà partiellement fait pour Koyeb au lieu de
   Render, `whatsapp-worker` au lieu de `render-whatsapp` — à vérifier).
7. Valider `tsc --noEmit` sur les trois packages.

**Passe 2 — diffuseur WhatsApp (28/08/2026)**

8. ✅ `baileys_auth_state` ajoutée à `supabase/schema.sql` — SQL donné à l'utilisateur pour être
   rejoué sur le vrai Supabase (même flux que pour `recherche_fts`, aucun accès SQL direct
   disponible). **À confirmer rejoué avant le premier démarrage réel du worker.**
9. ✅ Code écrit : `whatsapp-worker/src/auth-state.ts` (store Baileys sur Supabase, calqué sur
   `useMultiFileAuthState`, l'implémentation officielle), `whatsapp.ts` (connexion + pairing
   code), `queue.ts` (polling/envoi — `WHATSAPP_GROUP_JID` rendu non-bloquant au démarrage,
   voir ci-dessous), `index.ts` (boucle + serveur `/health`), `scripts/list-groups.ts` (utilitaire
   pour trouver le JID du groupe une fois connecté). `tsc --noEmit` propre. **Persistance de
   session pas encore testée en conditions réelles** (déconnexion/reconnexion du worker) —
   prévu dès que la connexion initiale fonctionne.
   - Oubli corrigé en cours de route : `queue.ts` faisait planter le worker au démarrage si
     `WHATSAPP_GROUP_JID` n'était pas encore défini — impossible de connaître ce JID avant
     d'être connecté. Rendu non-bloquant (vérifié à chaque appel de `pollAndSend`, pas au
     chargement du module).
10. 🟡 **En pause, mais net progrès** — déploiement AlwaysData fait (compte + token API, site
    `user_program` configuré sur `fredhindi.alwaysdata.net/whatsapp-worker/`, repo cloné,
    `/health` vérifié en direct — 200 OK avant connexion WhatsApp, 503 honnête ensuite comme
    prévu section I).
    - **Baileys (TypeScript) abandonné** : pairing code ET QR cassés par un bug amont non
      résolu ([WhiskeySockets/Baileys#2364](https://github.com/WhiskeySockets/Baileys/issues/2364)),
      reproduit identiquement sur AlwaysData, en local, sur Baileys 6.7.24 et 7.0.0-rc14 —
      détail complet conservé ci-dessous pour mémoire.
    - **Bascule vers whatsmeow (Go)** (28/08/2026, voir section H) : réécriture complète de
      `whatsapp-worker` en Go. Compile proprement (`go vet`, `go build`). Testé en local : le
      QR se génère et **se scanne avec succès sur un vrai téléphone, aucun crash protocolaire**
      — contrairement à Baileys, whatsmeow n'est pas touché par ce bug précis. C'est la
      confirmation qu'on cherchait.
    - **Bug de sécurité réel trouvé et corrigé dans la foulée** : les tables `whatsmeow_*»
      (créées automatiquement par la librairie dans Postgres) avaient RLS désactivée — donc
      lisibles/écrivables publiquement via l'API REST Supabase avec la seule clé `anon`,
      confirmé par une requête anonyme réussie avant correction. RLS activée sans policy sur
      les 17 tables, reconfirmé bloqué ensuite (401 sur une tentative d'insertion anonyme).
    - **Pas encore appairé** : après plusieurs tentatives rapprochées (relances Baileys +
      whatsmeow), WhatsApp a déclenché son propre garde-fou anti-abus côté serveur ("Impossible
      de connecter un appareil pour le moment") au moment du scan — pas un bug de notre côté,
      cooldown probablement temporaire (minutes à ~1h). **À reprendre** : relancer
      `whatsapp-worker` (en local ou sur AlwaysData), régénérer une page de scan avec le QR
      frais (voir méthode utilisée cette session : capture `QR_CODE_DATA:` dans les logs,
      génère un PNG, publie une page Artifact), scanner rapidement (~20s de validité par code).
    - Reste après appairage réussi : trouver `WHATSAPP_GROUP_JID` (lister les groupes du compte
      connecté — pas encore de script dédié côté Go, `scripts/list-groups.ts` de la version
      Baileys est obsolète), configurer la vraie commande + variables d'env du site AlwaysData
      (actuellement `command:"true"` — placeholder), UptimeRobot sur `/health` (token à fournir).
    - `WEBAPP_URL` déjà mis à jour côté `vercel-app` (fait lors du déploiement Vercel, voir
      "Déploiement réel" plus haut) — indépendant de ce chantier.
    - **Détail Baileys (pour mémoire, abandonné)** : pairing code générait bien un code, mais
      la connexion se refermait ~2-5s après avec `Error: Connection Failure`
      (`noise-handler.ts`, `decodeFrame`) avant saisie possible côté téléphone, cycle répété
      toutes les 10-25s. QR code en repli : même erreur, jamais émis. Testé sur 6.7.24 (`legacy`)
      et 7.0.0-rc14 (`latest`) : identique. Reproduit aussi en local (pas juste AlwaysData) —
      élimine l'hypothèse réseau/datacenter. Mêmes symptômes rapportés par des utilisateurs sur
      d'autres hébergeurs complètement différents (squarecloud.app, etc.).

## Risques à connaître

- **Baileys n'est pas une API officielle WhatsApp** : usage contraire aux CGU. Risque de ban
  du numéro personnel en cas d'usage jugé automatisé — faible pour un usage de diffusion à
  faible volume (1x/jour), mais à garder en tête.
- **Koyeb Free** : à valider en conditions réelles que le process reste bien actif en continu
  (comportement face à l'inactivité moins documenté publiquement que sur d'autres
  plateformes). Plan de repli : petit plan payant si le gratuit s'avère instable pour ce cas
  d'usage précis (connexion WebSocket permanente).
- **Site de la mairie non standard** (HTTP simple, sans HTTPS) : structure HTML potentiellement
  fragile dans le temps — le scraper pourra casser si le site change de template.
- **Persistance Baileys dans Supabase** : approche correcte mais pas triviale — à tester
  réellement (déconnexion/reconnexion du worker) avant de considérer la session fiable en
  production.
