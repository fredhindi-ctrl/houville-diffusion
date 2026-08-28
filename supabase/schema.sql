-- Houville-la-Branche — schéma Supabase (Postgres)
-- Idempotent : peut être rejoué sans risque sur une base déjà initialisée.
-- Aucune table ne stocke de requête de recherche ni d'identité de demandeur : exigence de
-- conception (voir plan-houville.md).

create table if not exists actualites (
  id serial primary key,
  site_id integer not null unique,        -- id numérique dans l'URL /fr/actualite/{id}/...
  titre text not null,
  url text not null,
  extrait text,
  date_ajout timestamptz not null default now()  -- pas de date de publication exposée par le site
);

create table if not exists comptes_rendus (
  id serial primary key,
  site_id integer not null unique,        -- id numérique dans l'URL /fr/compte-rendu/{id}/...
  titre text not null,
  url text not null,
  url_pdf text not null,
  date_conseil date not null,             -- date affichée sur le site (DD/MM/YYYY -> date)
  date_ajout timestamptz not null default now()
);

create table if not exists comptes_rendus_texte (
  id serial primary key,
  compte_rendu_id integer not null references comptes_rendus(id) on delete cascade,
  texte_extrait text not null
);

create table if not exists messages_a_envoyer (
  id serial primary key,
  contenu text not null,
  statut text not null default 'en_attente' check (statut in ('en_attente', 'envoye')),
  date_creation timestamptz not null default now(),
  date_envoi timestamptz
);

-- Moteur de recherche Œdicnème : Full-Text Search français insensible aux accents
-- (unaccent), + pg_trgm en repli pour tolérer les fautes de reconnaissance OCR. Voir
-- plan-houville.md, section "Architecture de recherche" — 100% déterministe, aucune IA,
-- aucun LLM, aucun embedding.
create extension if not exists unaccent;
create extension if not exists pg_trgm;

-- unaccent() n'est pas IMMUTABLE par défaut, ce qui bloque son usage dans une colonne
-- générée (GENERATED ALWAYS AS). Wrapper IMMUTABLE — pattern standard documenté par Postgres.
create or replace function immutable_unaccent(text) returns text as $$
  select unaccent('unaccent', $1)
$$ language sql immutable;

do $$
begin
  if not exists (select 1 from pg_ts_config where cfgname = 'french_unaccent') then
    create text search configuration french_unaccent (copy = french);
    alter text search configuration french_unaccent
      alter mapping for hword, hword_part, word with unaccent, french_stem;
  end if;
end $$;

-- Recrée systématiquement la colonne générée avec la bonne configuration : sans effet si
-- déjà à jour, corrige l'ancienne définition ('french' sans unaccent) sinon.
alter table comptes_rendus_texte drop column if exists recherche;
alter table comptes_rendus_texte add column recherche tsvector
  generated always as (to_tsvector('french_unaccent', immutable_unaccent(texte_extrait))) stored;

create index if not exists comptes_rendus_texte_recherche_idx
  on comptes_rendus_texte using gin (recherche);
create index if not exists comptes_rendus_texte_trgm_idx
  on comptes_rendus_texte using gin (texte_extrait gin_trgm_ops);

-- Lecture publique pour webapp-oedicneme (clé anon, jamais service_role côté public) —
-- écriture réservée à service_role (vercel-app, whatsapp-worker), qui contourne RLS.
alter table actualites enable row level security;
alter table comptes_rendus enable row level security;
alter table comptes_rendus_texte enable row level security;

drop policy if exists "lecture publique" on actualites;
create policy "lecture publique" on actualites for select using (true);

drop policy if exists "lecture publique" on comptes_rendus;
create policy "lecture publique" on comptes_rendus for select using (true);

drop policy if exists "lecture publique" on comptes_rendus_texte;
create policy "lecture publique" on comptes_rendus_texte for select using (true);

-- Recherche principale (Full-Text Search) : ts_rank pour le classement déterministe,
-- ts_headline pour l'extrait natif Postgres (pas de recomposition JS). ts_headline
-- retraite le texte BRUT (accentué) via la config french_unaccent, donc l'extrait affiché
-- garde les accents d'origine même si la requête n'en a pas.
--
-- Bonus de classement (+1, largement supérieur aux écarts habituels de ts_rank) quand le
-- mot cherché apparaît littéralement dans le document. Nécessaire car le stemmer français
-- de Postgres sur-généralise parfois : "voirie" et "voir" (verbe) partagent la même racine
-- Snowball, donc une recherche "voirie" remontait des comptes rendus qui ne parlent que de
-- "voir si..." sans aucun rapport avec la voirie — vérifié empiriquement (3 des 5 premiers
-- résultats étaient hors-sujet). Le bonus classe les vraies correspondances en premier, tout
-- en gardant les correspondances par racine seule en repli (ne les exclut pas : nécessaires
-- pour les vraies variantes morphologiques, ex. "aménagement" doit aussi trouver "aménager").
create or replace function recherche_fts(requete text, limite int default 10)
returns table (compte_rendu_id integer, rang real, extrait text)
language sql stable
as $$
  select
    t.compte_rendu_id,
    ts_rank(t.recherche, websearch_to_tsquery('french_unaccent', immutable_unaccent(requete)))
      + case when immutable_unaccent(t.texte_extrait) ilike ('%' || immutable_unaccent(requete) || '%') then 1 else 0 end
      as rang,
    ts_headline(
      'french_unaccent', t.texte_extrait, websearch_to_tsquery('french_unaccent', immutable_unaccent(requete)),
      'MaxFragments=1, MaxWords=40, MinWords=15, ShortWord=3, HighlightAll=false, StartSel=<<, StopSel=>>'
    ) as extrait
  from comptes_rendus_texte t
  where t.recherche @@ websearch_to_tsquery('french_unaccent', immutable_unaccent(requete))
  order by rang desc
  limit limite;
$$;

-- Repli pg_trgm (déclenché uniquement si recherche_fts ne trouve rien) : tolère les fautes
-- de reconnaissance OCR. word_similarity compare le mot cherché à la meilleure sous-chaîne
-- correspondante dans le document entier — c'est l'usage documenté de cette fonction
-- (contrairement à similarity(), pas adaptée pour comparer un mot court à un long texte).
-- Seuil calibré empiriquement (voir plan-houville.md) : à 0.35, une requête absurde
-- ("xyzinexistant999") remontait quand même des résultats par pur hasard statistique sur
-- de longs textes OCR — inacceptable (le principe du projet est de ne jamais donner
-- l'impression d'inventer). 0.55 rejette le bruit tout en gardant les vraies fautes OCR
-- (ex. "amenagernent" -> "aménagement", similarité 0.667).
create or replace function recherche_floue(mot text, seuil real default 0.55, limite int default 10)
returns table (compte_rendu_id integer, similarite real)
language sql stable
as $$
  select compte_rendu_id, word_similarity(immutable_unaccent(mot), immutable_unaccent(texte_extrait)) as similarite
  from comptes_rendus_texte
  where word_similarity(immutable_unaccent(mot), immutable_unaccent(texte_extrait)) > seuil
  order by similarite desc
  limit limite;
$$;

-- Persistance de la session WhatsApp (Baileys) : credentials + Signal keys. Koyeb ne garantit
-- pas un disque persistant entre redéploiements/redémarrages — la session doit survivre
-- ailleurs. Une seule ligne ("default") : ce projet n'a qu'un seul worker.
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
