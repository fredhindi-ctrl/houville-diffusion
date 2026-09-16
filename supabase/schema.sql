-- Houville-la-Branche — schéma Supabase (Postgres)
-- Idempotent : peut être rejoué sur une base déjà initialisée.
-- Aucune table métier ne stocke de requête de recherche ni d'identité de demandeur.

create table if not exists actualites (
  id serial primary key,
  site_id integer not null unique,
  titre text not null,
  url text not null,
  extrait text,
  date_ajout timestamptz not null default now()
);

create table if not exists comptes_rendus (
  id serial primary key,
  site_id integer not null unique,
  titre text not null,
  url text not null,
  url_pdf text not null,
  date_conseil date not null,
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
-- + pg_trgm en repli pour tolérer les fautes OCR. Aucune IA, aucun embedding.
create extension if not exists unaccent;
create extension if not exists pg_trgm;

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

alter table comptes_rendus_texte drop column if exists recherche;
alter table comptes_rendus_texte add column recherche tsvector
  generated always as (to_tsvector('french_unaccent', immutable_unaccent(texte_extrait))) stored;

create index if not exists comptes_rendus_texte_recherche_idx
  on comptes_rendus_texte using gin (recherche);
create index if not exists comptes_rendus_texte_trgm_idx
  on comptes_rendus_texte using gin (texte_extrait gin_trgm_ops);

-- Lecture publique pour la webapp via clé anon ; écriture réservée aux composants serveur.
alter table actualites enable row level security;
alter table comptes_rendus enable row level security;
alter table comptes_rendus_texte enable row level security;

drop policy if exists "lecture publique" on actualites;
create policy "lecture publique" on actualites for select using (true);

drop policy if exists "lecture publique" on comptes_rendus;
create policy "lecture publique" on comptes_rendus for select using (true);

drop policy if exists "lecture publique" on comptes_rendus_texte;
create policy "lecture publique" on comptes_rendus_texte for select using (true);

-- Recherche principale : classement déterministe par ts_rank, avec bonus pour une
-- correspondance littérale afin d'éviter certaines sur-généralisations du stemmer français.
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

-- Repli pg_trgm, utilisé uniquement si la recherche FTS ne trouve rien.
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

-- Session WhatsApp : l'architecture actuelle utilise whatsmeow/sqlstore.
-- Les tables `whatsmeow_*` sont créées automatiquement par la librairie via une connexion
-- PostgreSQL directe ; elles ne sont donc pas déclarées ici.
-- IMPORTANT : sur toute nouvelle installation, activer RLS sur ces tables sans policy publique
-- afin qu'elles ne soient pas accessibles via l'API REST Supabase avec la clé anon.
--
-- L'ancienne table `baileys_auth_state` n'est plus utilisée et n'est volontairement plus créée
-- par ce schéma. Si elle existe dans une base historique, elle peut rester en place jusqu'à un
-- nettoyage manuel ultérieur.
