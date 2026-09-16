# Plan technique — Houville-diffusion

**Source de vérité actuelle du POC Houville-la-Branche.**

Mise à jour : **16 septembre 2026**.

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
- **UptimeRobot actif** sur `/health`.

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

**UptimeRobot est actif.**

Il interroge `GET /health` du worker AlwaysData.

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
