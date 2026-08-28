# Houville-diffusion

Diffusion WhatsApp des actualités et comptes rendus du conseil municipal de Houville-la-Branche,
avec un bot Telegram séparé pour la recherche par mot-clé. Voir [plan-houville.md](plan-houville.md)
pour l'architecture complète et les décisions de conception (confidentialité, budget, hébergement).

## Structure du repo

- `supabase/` — schéma Postgres (tables + index full-text)
- `shared/` — types et client Supabase partagés entre les deux apps Node
- `vercel-app/` — déployé sur Vercel : scraper (cron 1x/jour) + bot Telegram (webhook)
- `render-whatsapp/` — déployé sur Render : process permanent Baileys (diffusion WhatsApp)

## État actuel

Squelette du repo posé (configs, types, stubs). Prochaine étape : implémenter le scraping
(`vercel-app/lib/scraper/`), déjà cadré par l'exploration du site documentée dans le plan.

## Setup local

```bash
cp .env.example .env   # puis remplir SUPABASE_URL, SUPABASE_KEY, etc.

cd vercel-app && npm install
cd ../render-whatsapp && npm install
```
