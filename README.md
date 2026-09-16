# Houville-diffusion

POC de diffusion automatique des informations municipales de Houville-la-Branche vers WhatsApp,
avec recherche documentaire publique dans les archives via **Œdicnème**.

Ce dépôt est le démonstrateur Houville. Ce n'est pas, à ce stade, une plateforme SaaS
multi-communes ni un service officiel de la mairie.

## État actuel

Le pipeline principal fonctionne de bout en bout en conditions réelles :

1. `vercel-app` scrape chaque jour le site de Houville-la-Branche ;
2. les nouveaux comptes rendus PDF sont OCRisés puis stockés dans Supabase ;
3. les actualités et comptes rendus créent une ligne dans `messages_a_envoyer` ;
4. `whatsapp-worker` lit cette file et diffuse les messages dans le groupe WhatsApp cible ;
5. `webapp-oedicneme` permet de rechercher les anciens comptes rendus depuis un navigateur.

Le worker WhatsApp est écrit en **Go** avec **whatsmeow** et tourne sur **AlwaysData**.
Sa session est persistée directement dans PostgreSQL/Supabase via `sqlstore`.

La webapp Œdicnème et le scraper sont déployés sur **Vercel**.
**UptimeRobot est actif** sur l'endpoint `/health` du worker.

## Architecture

```text
Site de Houville-la-Branche
          |
          v
vercel-app / Vercel Cron
  scraping + OCR.space
          |
          v
      Supabase
   /             \
  v               v
Œdicnème        messages_a_envoyer
Vercel              |
recherche FTS       v
             whatsapp-worker
             Go + whatsmeow
             AlwaysData
                    |
                    v
             groupe WhatsApp
```

Les composants ne s'appellent pas directement entre eux : **Supabase est le point de passage
central**.

## Principes de conception

- aucune IA générative dans la recherche ;
- PostgreSQL Full-Text Search français + `unaccent` + repli `pg_trgm` ;
- aucune requête de recherche ni identité utilisateur enregistrée côté serveur ;
- WhatsApp est utilisé uniquement pour la diffusion à sens unique ;
- priorité à la simplicité, au coût quasi nul et à la maintenance minimale ;
- les sources originales restent visibles : titre, date, extrait et PDF officiel.

## Structure du repo

- `vercel-app/` — scraper, cron quotidien, OCR et génération des messages WhatsApp ;
- `webapp-oedicneme/` — interface publique de recherche + `/api/search` ;
- `whatsapp-worker/` — worker Go/whatsmeow, polling de la file et `/health` ;
- `supabase/schema.sql` — schéma métier et fonctions de recherche ;
- `prototype/` — prototypes visuels conservés comme historique de conception ;
- `MESSAGES.md` — gabarits de diffusion ;
- `plan-houville.md` — source de vérité fonctionnelle et technique actuelle.

## Déploiements actuels

- Webapp Œdicnème : `https://webapp-oedicneme.vercel.app`
- Scraper / cron : `https://vercel-app-coral-chi.vercel.app`
- Worker WhatsApp : AlwaysData
- Monitoring : UptimeRobot sur `/health`

## Développement local

Créer les variables d'environnement à partir de `.env.example`, puis :

```bash
cd vercel-app
npm install
npm run typecheck

cd ../webapp-oedicneme
npm install
npm run typecheck

cd ../whatsapp-worker
go build ./...
go vet ./...
```

Pour l'architecture détaillée, les limites et les décisions à respecter, voir
[`plan-houville.md`](plan-houville.md).
