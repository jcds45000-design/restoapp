-- ============================================================================
-- restoapp — Durcissement RLS  (audit du 2026-06-29)
-- Projet Supabase : udhqiasudfiiiovhmspz
--
-- A LANCER dans : Dashboard Supabase > SQL Editor (en une fois).
-- Idempotent : peut être relancé sans casse.
--
-- Modèle d'accès retenu (choisi par JC) :
--   - LECTURE  : cloisonnée. Un employé ne voit QUE ses propres données
--                (ses tâches, son planning, sa fiche). Le gérant voit tout.
--                Stock + catégories + tâches habituelles : lisibles par tout
--                utilisateur connecté (pas de données perso).
--   - ECRITURE : gérant uniquement, SAUF : un employé peut mettre à jour
--                le statut de SES tâches (cocher).
--   - ANONYME  : bloqué partout (plus aucune lecture/écriture sans login).
--
-- IMPORTANT (à faire AVANT d'activer ce script) :
--   Les workflows n8n lisent schedule/employees avec la clé ANON. Une fois la
--   RLS active, l'anon est bloqué : bascule d'abord n8n sur la clé service_role
--   (qui contourne la RLS, côté serveur de confiance), sinon les rappels cassent.
-- ============================================================================

-- ─── 1. Schéma privé (NON exposé à l'API PostgREST) ──────────────────────────
create schema if not exists private;

-- ─── 2. Gérants "externes" (absents de la table employees, ex : Jean-Claude) ──
--     Modifiable uniquement en SQL, jamais via l'API. Amorçage avec ton email.
create table if not exists private.app_admins (email text primary key);
insert into private.app_admins (email) values ('jcds45000@gmail.com')
  on conflict (email) do nothing;

-- Ceinture + bretelles : le schema private n'est deja pas expose a l'API PostgREST,
-- mais on active AUSSI la RLS sur app_admins. Aucune politique => aucun acces via les
-- cles anon/authenticated. is_gerant() (SECURITY DEFINER) et le service_role (BYPASSRLS)
-- continuent de la lire, donc rien ne casse. Idempotent (re-activer la RLS = no-op).
alter table private.app_admins enable row level security;

-- ─── 3. Fonctions d'autorisation ────────────────────────────────────────────
--     SECURITY DEFINER => s'exécutent avec les droits du propriétaire (bypass
--     RLS) : indispensable pour lire employees SANS récursion de politique.
create or replace function private.jwt_email()
returns text language sql stable as $$
  select lower(nullif(auth.jwt() ->> 'email', ''))
$$;

create or replace function private.is_gerant()
returns boolean language sql security definer set search_path = public, private stable as $$
  select coalesce(private.jwt_email() in (select lower(email) from private.app_admins), false)
      or exists (
           select 1 from public.employees
           where lower(email) = private.jwt_email() and role = 'gerant'
         );
$$;

create or replace function private.my_name()
returns text language sql security definer set search_path = public stable as $$
  select name from public.employees
  where lower(email) = private.jwt_email()
  limit 1;
$$;

-- Ces fonctions ne doivent être appelables que par les rôles connectés.
revoke all on function private.jwt_email() from public;
revoke all on function private.is_gerant() from public;
revoke all on function private.my_name() from public;
-- IMPORTANT : jwt_email() est appelée DIRECTEMENT dans la politique employees_read
-- (section 5). Le rôle authenticated DOIT pouvoir l'exécuter, sinon la lecture des
-- employés échoue en « permission denied » et l'écran Équipe affiche 0 employé.
-- (Oubli du script d'origine, diagnostiqué et corrigé le 05/07/2026.)
grant execute on function private.jwt_email(), private.is_gerant(), private.my_name() to authenticated;

-- ─── 4. Purge des politiques existantes sur les 6 tables (repart propre) ─────
do $$
declare r record;
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in ('employees','schedule','tasks','products','task_categories','task_templates')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- ─── 5. employees : PII + salaires. Lecture = gérant OU sa propre fiche ──────
alter table public.employees enable row level security;
create policy employees_read on public.employees
  for select to authenticated
  using ( private.is_gerant() or lower(email) = private.jwt_email() );
create policy employees_write on public.employees
  for all to authenticated
  using ( private.is_gerant() ) with check ( private.is_gerant() );

-- ─── 6. schedule : un employé ne voit que SON planning ──────────────────────
alter table public.schedule enable row level security;
create policy schedule_read on public.schedule
  for select to authenticated
  using ( private.is_gerant() or employee_name = private.my_name() );
create policy schedule_write on public.schedule
  for all to authenticated
  using ( private.is_gerant() ) with check ( private.is_gerant() );

-- ─── 7. tasks : un employé voit/MAJ SES tâches ; création/suppression = gérant ─
alter table public.tasks enable row level security;
create policy tasks_read on public.tasks
  for select to authenticated
  using ( private.is_gerant() or assignee_name = private.my_name() );
create policy tasks_update on public.tasks
  for update to authenticated
  using ( private.is_gerant() or assignee_name = private.my_name() )
  with check ( private.is_gerant() or assignee_name = private.my_name() );
create policy tasks_insert on public.tasks
  for insert to authenticated
  with check ( private.is_gerant() );
create policy tasks_delete on public.tasks
  for delete to authenticated
  using ( private.is_gerant() );

-- ─── 8. products / task_categories / task_templates : lecture connectée, ──────
--        écriture gérant uniquement (pas de données perso).
alter table public.products enable row level security;
create policy products_read on public.products
  for select to authenticated using ( true );
create policy products_write on public.products
  for all to authenticated
  using ( private.is_gerant() ) with check ( private.is_gerant() );

alter table public.task_categories enable row level security;
create policy task_categories_read on public.task_categories
  for select to authenticated using ( true );
create policy task_categories_write on public.task_categories
  for all to authenticated
  using ( private.is_gerant() ) with check ( private.is_gerant() );

alter table public.task_templates enable row level security;
create policy task_templates_read on public.task_templates
  for select to authenticated using ( true );
create policy task_templates_write on public.task_templates
  for all to authenticated
  using ( private.is_gerant() ) with check ( private.is_gerant() );

-- ─── 8bis. orders / stock_movements / menu_items : fermeture de l'anonyme ────
--     Oubliées lors du durcissement d'origine : restées en using(true) = ouvertes
--     à TOUS, y compris les non-connectés (dont le CA via orders). Ajout du
--     05/07/2026 : lecture/écriture réservées aux utilisateurs connectés. L'appli
--     restoapp étant entièrement derrière login, ce resserrement ne casse rien.
--     (n8n lit via service_role, qui contourne la RLS : non impacté.)
do $$
declare r record;
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in ('orders','stock_movements','menu_items')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

alter table public.orders enable row level security;
create policy orders_rw on public.orders
  for all to authenticated using ( true ) with check ( true );

alter table public.stock_movements enable row level security;
create policy stock_movements_rw on public.stock_movements
  for all to authenticated using ( true ) with check ( true );

alter table public.menu_items enable row level security;
create policy menu_items_rw on public.menu_items
  for all to authenticated using ( true ) with check ( true );

-- ─── 9. Vérif rapide (optionnel) : doit lister RLS active + les politiques ───
-- select tablename, rowsecurity from pg_tables where schemaname='public'
--   and tablename in ('employees','schedule','tasks','products','task_categories','task_templates');
-- select tablename, policyname, cmd from pg_policies where schemaname='public' order by tablename;
