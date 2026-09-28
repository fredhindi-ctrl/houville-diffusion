# Plan technique — Houville-diffusion

**Source de vérité actuelle du POC Houville-la-Branche.**

Mise à jour : **28 septembre 2026**.

L'ancien historique détaillé des essais Baileys, Koyeb, Render et Telegram reste accessible
dans l'historique Git. Il ne décrit plus l'architecture courante et n'est donc plus conservé
dans ce document de référence.

## 1. Objectif

Récupérer automatiquement les actualités et comptes rendus publiés sur le site de
Houville-la-Branche afin de :

1. diffuser les nouvelles publications dans un groupe WhatsApp existant ;
2. indexer les anciens comptes rendus du conseil municipal ;
3. permettre leur recherche dans une WebApp mobile simple, **Œdicnème** ;
4. fonctionner avec une infrastructure légère et un coût mensuel minimal.

Le dépôt actuel est un **POC mono-commune**. Ce n'est pas encore une plateforme commerciale
multi-communes et ce n'est pas un service officiel de la mairie.

## 2. État réel

### Fonctionnel et validé

- scraping du vrai site de Houville-la-Branche ;
- cron Vercel quotidien ;
- récupération des actualités et comptes rendus ;
- OCR des PDF scannés avec OCR.space ;
- stockage Supabase/PostgreSQL ;
- recherche Full-Text Search française avec `unaccent` ;
- repli `pg_trgm` pour les erreurs d'OCR ;
- WebApp Œdicnème publique déployée sur Vercel ;
- interface mobile corrigée et validée sur iPhone ;
- worker WhatsApp écrit en Go avec whatsmeow ;
- session WhatsApp persistée dans PostgreSQL/Supabase ;
- worker déployé sur AlwaysData ;
- envoi réel d'un message dans le groupe WhatsApp cible validé ;
- message marqué `envoye` en base après diffusion ;
- endpoint `/health` opérationnel ;
- **UptimeRobot actif** sur `/health` ;
- copie email de chaque message WhatsApp envoyé (Resend) ;
- vérification quotidienne indépendante de l'état du worker, déclenchée par le cron Vercel.

### Pas encore produit commercial

- pas de multi-tenant ;
- pas de facturation ;
- pas de portail administrateur mairie complet ;
- pas d'isolation RLS par commune ;
- pas de mécanisme générique pour des sites municipaux différents ;
- pas d'API WhatsApp officielle.

Ces éléments ne doivent pas être construits avant validation commerciale du concept.

## 3. Architecture actuelle

```text
SITE DE HOUVILLE-LA-BRANCHE
            |
            v
    Vercel Cron (1x/jour)
        `vercel-app`
            |
      +-----+------+
      |            |
 actualités    comptes rendus PDF
                   |
                   v
               OCR.space
                   |
                   v
               Supabase
        +----------+-----------+
        |                      |
        v                      v
comptes_rendus_texte     messages_a_envoyer
 FTS + pg_trgm                 |
        |                      v
        v              whatsapp-worker
webapp-oedicneme        Go + whatsmeow
    Vercel                 AlwaysData
        |                      |
        v                      v
 navigateur             groupe WhatsApp

UptimeRobot ---> GET /health du whatsapp-worker
```

Supabase est le point de passage central. Les composants applicatifs ne dépendent pas d'appels
directs les uns vers les autres.

## 4. Composants

### `vercel-app`

Responsabilités :

- cron quotidien ;
- scraping des actualités ;
- scraping des comptes rendus ;
- téléchargement des PDF ;
- OCR des PDF scannés ;
- insertion des données dans Supabase ;
- génération des messages dans `messages_a_envoyer`.

Le cron est protégé par `CRON_SECRET` et défini dans `vercel-app/vercel.json`.

### `webapp-oedicneme`

WebApp publique, mobile-first, à apparence conversationnelle.

Elle ne fait **aucun appel à un LLM**. La requête est envoyée en `POST` à `/api/search`, puis :

1. normalisation déterministe légère ;
2. RPC `recherche_fts` ;
3. si aucun résultat, RPC `recherche_floue` ;
4. affichage des résultats avec titre, date, extrait et lien vers le PDF source.

Aucune requête utilisateur n'est volontairement stockée en base ou journalisée par
l'application.

### `whatsapp-worker`

Process permanent écrit en **Go**, hébergé sur **AlwaysData**.

Librairie : **whatsmeow**.

Responsabilités :

- connexion au compte WhatsApp déjà appairé ;
- lecture périodique des lignes `messages_a_envoyer` en statut `en_attente` ;
- envoi vers `WHATSAPP_GROUP_JID` ;
- passage du message à `envoye` après réussite ;
- exposition de `GET /health`.

La session whatsmeow n'est pas stockée sur le disque du worker. `sqlstore` la persiste
directement dans PostgreSQL/Supabase via les tables `whatsmeow_*` créées par la librairie.

### Supabase

Contient les données métier et le moteur de recherche :

- `actualites` ;
- `comptes_rendus` ;
- `comptes_rendus_texte` ;
- `messages_a_envoyer` ;
- tables `whatsmeow_*` gérées par whatsmeow/sqlstore.

La table `baileys_auth_state` appartient à une ancienne architecture. Elle peut encore exister
dans la base historique mais **n'est plus utilisée** par le code actuel et ne doit pas être
créée sur une nouvelle installation.

## 5. Recherche Œdicnème

### Principe

Œdicnème est un moteur de recherche documentaire, pas un assistant qui prétend comprendre les
décisions municipales.

Principe de réponse :

> Chercher, retrouver, montrer la source — jamais inventer ni interpréter.

### Chaîne de recherche

```text
requête utilisateur
      |
      v
normalisation JS
      |
      v
recherche_fts
PostgreSQL / french_unaccent
      |
   résultat ? ---- oui ---> ts_rank + ts_headline
      |
     non
      v
recherche_floue / pg_trgm
      |
      v
affichage de la source
```

Aucun LLM, embedding, vector DB ou RAG n'est utilisé.

## 6. Vie privée

Pour le portail public :

- aucun compte citoyen ;
- aucune table de conversations ;
- aucune table de requêtes utilisateur ;
- pas de `console.log(query)` ;
- historique visuel conservé uniquement dans l'état local de la page ;
- clé Supabase `anon` uniquement côté web public ;
- `service_role` réservé aux composants serveur privés.

Les tables `whatsmeow_*` contiennent des secrets de session WhatsApp. Sur le projet Supabase
actuel, leur accès public a été bloqué en activant RLS sans policy publique. Cette exigence doit
être reproduite sur toute nouvelle installation.

## 7. Variables d'environnement

| Variable | vercel-app | webapp-oedicneme | whatsapp-worker |
|---|---:|---:|---:|
| `SUPABASE_URL` | oui | oui | oui |
| `SUPABASE_SERVICE_ROLE_KEY` | oui | non | oui |
| `SUPABASE_ANON_KEY` | non | oui | non |
| `SUPABASE_DB_PASSWORD` | non | non | oui |
| `CRON_SECRET` | oui | non | non |
| `WEBAPP_URL` | oui | non | non |
| `OCR_SPACE_API_KEY` | oui | non | non |
| `WHATSAPP_GROUP_JID` | non | non | oui |
| `PORT` | non | non | optionnel |

`WHATSAPP_PHONE_NUMBER` n'est plus utilisé par l'architecture actuelle.

## 8. Monitoring

Trois couches indépendantes, pas juste une :

1. **UptimeRobot** — interroge `GET /health` du worker AlwaysData toutes les 5 min, alerte
   email en cas de panne.
2. **Vérification quotidienne côté `vercel-app`** — le cron de scrape appelle aussi `/health`
   une fois par jour (`lib/scraper/whatsapp-health.ts`) et envoie sa propre alerte email
   (Resend) si le worker ne répond pas correctement. Indépendante d'UptimeRobot : si l'une des
   deux couches tombe en panne, l'autre reste un filet de sécurité.
3. **Copie email de chaque message WhatsApp** (`whatsapp-worker/email.go`, Resend) — envoyée
   juste après un envoi WhatsApp réussi, non bloquante (un échec d'email n'empêche jamais
   l'envoi WhatsApp ni le marquage `envoye` en base). Permet de remarquer visuellement une
   absence de diffusion même sans consulter les outils de monitoring.

Le worker renvoie HTTP 503 si l'un des éléments suivants est en défaut :

- WhatsApp déconnecté ;
- Supabase inaccessible ;
- boucle de polling considérée comme bloquée.

Réponse saine attendue :

```json
{
  "status": "ok",
  "whatsapp": "connected",
  "database": "ok",
  "worker": "ok"
}
```

### Incident résolu : coupures WhatsApp début septembre

Deux coupures silencieuses (29/08, 02/09) ont laissé des messages bloqués en `en_attente`
plusieurs jours sans alerte (avant la mise en place du monitoring ci-dessus). Cause racine
trouvée dans les logs AlwaysData :

```
[02/Sep 08:02:38] STDOUT: WhatsApp connecté.
[02/Sep 08:32:55] Upstream stopped (reason: idle)   ← exactement 30 min plus tard
```

AlwaysData tue les sites `user_program` après `max_idle_time` secondes sans requête HTTP
entrante (1800s par défaut) — et rien ne relance le process tout seul ensuite. **Corrigé** :
`max_idle_time` mis à `0` (désactivé) via l'API AlwaysData
(`PATCH /v1/site/1071764/` `{max_idle_time: 0}`). La coupure du 29/08 avait une cause
différente (réseau mobile pendant l'appairage initial). Zéro coupure constatée depuis via
UptimeRobot, mais aucune garantie à 100 % pour un autre mode de panne — d'où les trois couches
de monitoring ci-dessus plutôt qu'une seule.

## 9. Déploiements

- Œdicnème : `https://webapp-oedicneme.vercel.app`
- scraper/cron : `https://vercel-app-coral-chi.vercel.app`
- worker WhatsApp : AlwaysData
- base : Supabase
- monitoring : UptimeRobot

Les deux projets Vercel sont reliés au dépôt GitHub et se redéploient depuis `main`.

## 10. Risques techniques assumés

### WhatsApp non officiel

whatsmeow utilise le protocole WhatsApp multi-device, pas l'API officielle Meta. Le POC peut
fonctionner ainsi, mais cette dépendance reste un **risque majeur pour une commercialisation** :
changement de protocole, déconnexion, blocage de compte ou incompatibilité future.

Cette architecture convient au démonstrateur. Elle ne doit pas être présentée comme une garantie
de service institutionnelle avant décision sur une stratégie WhatsApp soutenable.

### Scraping spécifique au site

Le scraper dépend du HTML du site de Houville. Un changement de template peut casser la collecte.
Pour un futur produit multi-communes, il faudra soit des connecteurs par fournisseur de site,
soit une autre source d'entrée plus stable.

### OCR externe

OCR.space est suffisant pour le POC, mais reste un service tiers avec limites de quota et de
disponibilité.

## 11. Deux points de robustesse à traiter avant exploitation longue durée

Ils ne bloquent pas la démo mais sont connus :

1. **écriture partielle du scraper** : un compte rendu peut être inséré avant que son texte OCR
   ou son message ne soit créé. Si une étape suivante échoue, le `site_id` existant peut empêcher
   une reprise automatique complète ;
2. **doublon WhatsApp possible** : si l'envoi WhatsApp réussit mais que le marquage `envoye`
   échoue, le même message peut être repris au poll suivant.

Ces corrections doivent être faites dans un commit séparé du nettoyage documentaire.

## 12. Prochaine étape produit

Ne pas transformer ce dépôt en SaaS avant validation de la disposition à payer.

La prochaine étape est de conserver ce POC comme démonstrateur Houville et de tester le concept
commercial auprès de petites communes. Le multi-tenant, la facturation et le portail admin ne
sont justifiés qu'après un signal commercial réel.

## 13. Landing page commerciale (pitch mairies)

Landing page complète dédiée à la prospection de nouvelles communes, séparée de la WebApp
Œdicnème (aucun impact sur le produit déployé).

**Emplacement et déploiement** : `landing-page/index.html`, dans le dépôt, poussé sur `main`.
Déployée en production sur Vercel : `https://landing-page-chi-rosy-62.vercel.app` (projet
`landing-page`, équipe `fred-ac2b`). **Limite connue** : l'auto-déploiement Vercel depuis les
push GitHub ne fonctionne pas correctement pour ce sous-dossier (mauvais root directory
détecté) — chaque mise à jour du site en ligne nécessite un déploiement manuel
(`npx vercel --prod` lancé depuis `landing-page/`).

**Architecture de marque** : "Mairie Diffusion" est la marque commerciale principale
(logo, titre, ton). "Œdicnème" n'apparaît plus dans la présentation commerciale visible —
c'est uniquement le nom interne du module de recherche documentaire, présenté sous le libellé
"Mairie Diffusion · Recherche". Le nom "Œdicnème" reste dans le code/fichiers de la WebApp
elle-même (non renommée, hors périmètre).

**Logo** : un seul logo (`images/logo-mairie-diffusion.png`) utilisé partout — header, hero,
section WhatsApp, footer, pages légales. Un mark court dérivé ("bulle + MD", lettres
recomposées à partir de l'icône existante) a été fabriqué pour le centre du QR code de la
section WhatsApp. Les anciennes variantes colorimétriques (`images/logo-variantes/`) ne sont
plus utilisées, décision tranchée en faveur du logo de référence.

**Contenu de la page** (sections, dans l'ordre) : hero (photo réelle + carte translucide sur
mobile pour la lisibilité du texte, desktop non recadré) → "Votre site reste" → section
WhatsApp (parcours 3 étapes QR/laptop/téléphone, QR code réel généré localement — pas de
service tiers — pointant vers un canal WhatsApp de démonstration, bande de bénéfices) →
section Recherche ("Mairie Diffusion · Recherche", ordre texte-puis-visuel sur mobile) →
"Ce que ce n'est pas" → offre (290 € HT/an) → CTA avec intégration Calendly (popup, scripts
chargés uniquement au clic, pas au chargement de la page) → footer avec liens vers
`mentions-legales.html` et `confidentialite.html` (pages également dans le dépôt).

**Point non résolu** : le lien Calendly du CTA pointe encore vers le slug `/30min`
(`https://calendly.com/mairiediffusion/30min`) alors que le texte affiché annonce "20 minutes"
— à corriger dès qu'une URL Calendly valide à 20 min est fournie ; ne pas fabriquer de slug.

## 14. POC WhatsApp Channel (whatsmeow) — validé

**Exigence produit** : un groupe WhatsApp n'est pas acceptable pour Mairie Diffusion (habitants
visibles entre eux, pas de vrai flux d'abonnement). Cible : Site communal → Mairie Diffusion →
vrai WhatsApp Channel de la mairie → habitants abonnés volontairement, sans jamais saisir de
numéro de téléphone.

**Audit du worker existant** (`whatsapp-worker/`, whatsmeow
`v0.0.0-20260821141805-33cfac511629`) : aucune modification nécessaire côté architecture.
`client.SendMessage(ctx, jid, message)` — déjà utilisé pour le groupe dans `queue.go` — dispatche
en interne selon `jid.Server` (groupe, DM ou `newsletter`). Le code actuel ne suppose "groupe"
que par nommage (`WHATSAPP_GROUP_JID`, commentaires), jamais structurellement. Le module
whatsmeow déjà en place expose intégralement le support des Channels : `CreateNewsletter`,
`GetNewsletterInfo`, `GetNewsletterInfoWithInvite`, `GetSubscribedNewsletters`,
`FollowNewsletter`/`UnfollowNewsletter`, `UploadNewsletter` (média), et l'envoi via le même
`SendMessage` avec un JID `@newsletter`. Aucune mise à jour de version requise.

**POC réel exécuté le 18/09/2026, via l'outil isolé** `whatsapp-worker/cmd/channel-test/`
(ne touche ni `messages_a_envoyer`, ni `WHATSAPP_GROUP_JID`, ni aucun autre composant).
Résultat validé empiriquement :

- publication automatique réussie depuis notre programme Go utilisant la session whatsmeow
  existante ;
- destination : vrai WhatsApp Channel, pas un groupe ;
- Channel : Mairie-Diffusion : Goureville ;
- JID : `120363413874422398@newsletter` ;
- type vérifié comme `newsletter/channel` avant envoi (refus explicite si JID de groupe) ;
- message envoyé : « Test Mairie Diffusion — publication automatique sur le canal WhatsApp
  réussie. » ;
- ID message WhatsApp : `3EB02E9F85BCE6FFF67F35` ;
- message vérifié visuellement sur le Channel à 17:29 le 18/09/2026 ;
- un seul envoi, pas de boucle, pas de retry ;
- aucune modification du pipeline actuel, `messages_a_envoyer` inchangé, l'envoi groupe existant
  reste fonctionnel ;
- secrets provenant uniquement de `.env` (déjà ignoré par Git), rien écrit en dur.

**POC WhatsApp Channel : VALIDÉ**

Go / whatsmeow → vrai WhatsApp Channel → message visible

**Abonnement habitant** : le lien public du Channel
(`https://whatsapp.com/channel/<invite>`, disponible via `ThreadMeta.InviteCode`) est une URL
standard, transformable en QR code sans dépendance à whatsmeow — l'abonnement se fait nativement
dans l'app WhatsApp de l'habitant, sans collecte de numéro côté Mairie Diffusion.

**Risque principal identifié, non résolu** : contrairement à la messagerie classique (protocole
binaire stable), les fonctions Channel de whatsmeow passent par la couche interne `w:mex`
(GraphQL) de Meta, avec des identifiants de requête codés en dur dans `newsletter.go`
(`queryFetchNewsletter`, `mutationCreateNewsletter`, etc.). Ce sont des détails internes
susceptibles d'être changés par Meta sans préavis, ce qui casserait les fonctions Channel jusqu'à
correctif whatsmeow.

whatsmeow reste une solution non officielle vis-à-vis de Meta. Cette validation du POC ne
constitue pas encore une validation de robustesse pour une exploitation commerciale : acceptable
pour la démonstration en cours, pas encore pour un engagement contractuel ferme envers des
mairies sans plan de mitigation (monitoring de la fonctionnalité, transparence sur la nature non
officielle du canal technique).
