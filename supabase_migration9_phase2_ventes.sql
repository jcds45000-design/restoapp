-- ============================================================================
-- MIGRATION 9 — PHASE 2 du chantier Kimiko Pilotage (préparée le 30/08/2026)
-- ⚠️ NE PAS APPLIQUER sans le feu vert de Jean-Claude.
-- Pré-requis : backup frais via `node backup_data.mjs` (.backups-data/…).
-- Additive : aucun DROP, aucun renommage. ROLLBACK documenté en fin de fichier.
--
-- Contenu (spec maître §15-17, plan de migration Phase 2) :
--   1. sales_imports    : journal des imports (API ou CSV), idempotence
--   2. sales_tickets    : tickets Abill (en-tête)
--   3. sales_lines      : lignes de vente (produits, options en JSONB)
--   4. abill_item_mapping : article Abill → recette/produit de l'app
--   5. menu_components / menu_choices : menus à choix (Menu Boneless x10…)
--   6. RLS : gérant seul (données de CA)
--
-- Modélisation calquée sur l'API réelle Fulle (api.fulleapps.io, openapi v379) :
-- GET /tickets → NoteTicket { id, r_ticket, date, total_ttc/ht, sale_method,
-- details[NoteTicketDetail { id_product, name, quantity, unit_ttc, total_ttc,
-- discount, free, details[options] }], payments[], taxes[] }.
-- L'import CSV/Excel (secours) alimente les mêmes tables.
-- ============================================================================

begin;

-- ─── 1. Journal des imports ──────────────────────────────────────────────────
create table if not exists public.sales_imports (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('API', 'CSV')),
  periode_debut date,
  periode_fin date,
  nb_tickets int not null default 0,
  nb_lignes int not null default 0,
  nb_doublons int not null default 0,
  meta jsonb,
  created_by uuid,
  created_at timestamptz not null default now()
);

-- ─── 2. Tickets ──────────────────────────────────────────────────────────────
create table if not exists public.sales_tickets (
  id uuid primary key default gen_random_uuid(),
  -- Clé métier : l'identifiant du ticket chez Abill. Un ré-import du même
  -- ticket est un doublon, jamais une seconde vente (garde-fou spec §risques).
  abill_id text not null unique,
  r_ticket text,
  n_ticket text,
  type_document text,
  date_service date not null,
  date_saisie timestamptz,
  canal_id int,
  canal text,                    -- nom du sale_method (Sur place, Uber Eats…)
  n_lignes int,
  total_ttc numeric,
  total_ht numeric,
  reverse boolean not null default false,   -- extourne : à exclure des ventes
  paiements jsonb,               -- [{mode, montant}] : détail sans table dédiée
  taxes jsonb,
  import_id uuid references public.sales_imports(id) on delete set null,
  brut jsonb,                    -- payload d'origine : rejouable si le modèle évolue
  created_at timestamptz not null default now()
);
create index if not exists sales_tickets_date_idx on public.sales_tickets (date_service);
create index if not exists sales_tickets_canal_idx on public.sales_tickets (canal_id);

-- ─── 3. Lignes de vente ──────────────────────────────────────────────────────
create table if not exists public.sales_lines (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.sales_tickets(id) on delete cascade,
  abill_line_id text,
  abill_product_id text,         -- id_product Abill : pivot du mapping
  libelle text not null,
  quantity numeric not null default 1,
  unit_ttc numeric,
  total_ttc numeric,
  unit_ht numeric,
  total_ht numeric,
  remise_pct numeric,
  offert boolean not null default false,
  exclu_ca boolean not null default false,
  tva jsonb,
  options jsonb,                 -- sous-details Abill : choix de menu, suppléments
  created_at timestamptz not null default now()
);
create index if not exists sales_lines_ticket_idx on public.sales_lines (ticket_id);
create index if not exists sales_lines_product_idx on public.sales_lines (abill_product_id);

-- ─── 4. Mapping Abill → app ──────────────────────────────────────────────────
-- Un article Abill pointe vers UNE cible ; plusieurs articles Abill peuvent
-- pointer vers la même cible (WINGS 5 et WINGS 5 UBER → même recette).
create table if not exists public.abill_item_mapping (
  id uuid primary key default gen_random_uuid(),
  abill_product_id text not null unique,
  libelle_abill text,            -- dernier libellé vu : aide au mapping manuel
  cible_type text not null default 'a_mapper'
    check (cible_type in ('a_mapper', 'produit', 'recette', 'menu', 'ignorer')),
  menu_item_id uuid references public.menu_items(id) on delete set null,
  recipe_id uuid references public.recipes(id) on delete set null,
  commentaire text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- ─── 5. Menus à choix (spec §17) ─────────────────────────────────────────────
-- Un menu = des composants ; un composant fixe pointe une recette, un composant
-- « au choix » liste ses choix possibles. Le décrément de stock suivra les
-- choix réels remontés dans sales_lines.options.
create table if not exists public.menu_components (
  id uuid primary key default gen_random_uuid(),
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  nom text not null,             -- « 10 boneless », « Accompagnement », « Boisson »
  quantity numeric not null default 1,
  recipe_id uuid references public.recipes(id) on delete set null,  -- composant fixe
  au_choix boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists public.menu_choices (
  id uuid primary key default gen_random_uuid(),
  component_id uuid not null references public.menu_components(id) on delete cascade,
  nom text not null,
  recipe_id uuid references public.recipes(id) on delete set null,
  menu_item_id uuid references public.menu_items(id) on delete set null,
  surcout_ttc numeric not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists menu_components_menu_idx on public.menu_components (menu_item_id);
create index if not exists menu_choices_component_idx on public.menu_choices (component_id);

-- ─── 6. RLS : données de chiffre d'affaires, gérant seul ─────────────────────
alter table public.sales_imports enable row level security;
alter table public.sales_tickets enable row level security;
alter table public.sales_lines enable row level security;
alter table public.abill_item_mapping enable row level security;
alter table public.menu_components enable row level security;
alter table public.menu_choices enable row level security;

create policy sales_imports_gerant on public.sales_imports
  for all using (private.is_gerant()) with check (private.is_gerant());
create policy sales_tickets_gerant on public.sales_tickets
  for all using (private.is_gerant()) with check (private.is_gerant());
create policy sales_lines_gerant on public.sales_lines
  for all using (private.is_gerant()) with check (private.is_gerant());
create policy abill_item_mapping_gerant on public.abill_item_mapping
  for all using (private.is_gerant()) with check (private.is_gerant());
-- Les menus décrivent la carte (pas le CA) : lecture pour tout connecté,
-- écriture gérant, comme menu_items.
create policy menu_components_read on public.menu_components
  for select using (auth.role() = 'authenticated');
create policy menu_components_write on public.menu_components
  for all using (private.is_gerant()) with check (private.is_gerant());
create policy menu_choices_read on public.menu_choices
  for select using (auth.role() = 'authenticated');
create policy menu_choices_write on public.menu_choices
  for all using (private.is_gerant()) with check (private.is_gerant());

commit;

-- ============================================================================
-- ROLLBACK (à n'exécuter qu'en cas de retour arrière assumé : PERTE DE DONNÉES
-- des tables de ventes importées ; refaire un import ensuite est possible tant
-- que la source Abill existe).
-- begin;
-- drop table if exists public.menu_choices;
-- drop table if exists public.menu_components;
-- drop table if exists public.abill_item_mapping;
-- drop table if exists public.sales_lines;
-- drop table if exists public.sales_tickets;
-- drop table if exists public.sales_imports;
-- commit;
-- ============================================================================
