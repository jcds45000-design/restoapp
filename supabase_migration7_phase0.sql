-- ============================================================================
-- MIGRATION 7 — PHASE 0 du chantier Kimiko Pilotage (préparée le 27/08/2026)
-- ⚠️ NE PAS APPLIQUER sans le feu vert de Jean-Claude.
-- Pré-requis : backup frais via `node backup_data.mjs` (.backups-data/…).
-- Additive et compatible avec l'app actuellement déployée (aucun DROP de colonne,
-- aucun renommage). Section ROLLBACK documentée en fin de fichier.
--
-- Contenu :
--   0. Régularisation du DDL fantôme (constat docs/AUDIT-SCHEMA-2026-08-27.md)
--   1. Rôles applicatifs : employees.app_role (admin/manager/employe/lecture)
--   2. Permissions granulaires : permissions + employee_permissions
--   3. Fonctions d'autorisation : role_of(), has_permission(), mon_profil()
--   4. Identité par UUID : backfill schedule/tasks/stock_movements
--   5. Tâches : kind (recurrente/ponctuelle), statut non_faite, archivage
--   6. Audit log : table + RPC log_audit + triggers permissions/rôles
--   7. Colmatage sécurité : menu_items_rw, orders_rw, stock_movements_insert
-- ============================================================================

begin;

-- ─── 0. Régularisation DDL (le repo redevient la vérité du schéma) ───────────
-- Colonnes déjà présentes en prod (ajoutées à la main historiquement) :
alter table public.employees add column if not exists poste       text;
alter table public.employees add column if not exists taux_h      numeric;
alter table public.employees add column if not exists heures_hebdo numeric;
alter table public.employees add column if not exists contrat     text;
alter table public.employees add column if not exists date_entree date;
alter table public.employees add column if not exists date_fin    date;
alter table public.schedule  add column if not exists employee_name text;
alter table public.schedule  add column if not exists updated_at  timestamptz;

-- Tables créées à la main en juin 2026, jamais versionnées :
create table if not exists public.task_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 0,
  created_at timestamptz default now()
);
create table if not exists public.task_templates (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null default 'Autre',
  priority text not null default 'moyenne',
  creneau text not null check (creneau in ('ouverture','service','fermeture')),
  sort_order int not null default 0,
  created_at timestamptz default now()
);

-- ─── 1. Rôles applicatifs ────────────────────────────────────────────────────
alter table public.employees add column if not exists app_role text;
update public.employees
   set app_role = case when role = 'gerant' then 'admin' else 'employe' end
 where app_role is null;
do $$ begin
  alter table public.employees
    add constraint employees_app_role_chk
    check (app_role is null or app_role in ('admin','manager','employe','lecture'));
exception when duplicate_object then null; end $$;

-- ─── 2. Permissions granulaires ──────────────────────────────────────────────
create table if not exists public.permissions (
  key text primary key,
  label text not null,
  description text not null default ''
);
insert into public.permissions (key, label) values
  ('voir_finances',            'Voir les finances'),
  ('voir_marges',              'Voir les marges et le food cost'),
  ('voir_salaires',            'Voir les salaires et coûts horaires'),
  ('modifier_planning',        'Modifier le planning'),
  ('modifier_pointages',       'Corriger les pointages'),
  ('modifier_stock',           'Modifier le stock'),
  ('cloturer_inventaire',      'Clôturer un inventaire'),
  ('passer_commande',          'Préparer une commande fournisseur'),
  ('valider_commande',         'Valider une commande fournisseur'),
  ('receptionner_commande',    'Réceptionner une commande'),
  ('modifier_prix_fournisseur','Modifier un prix fournisseur'),
  ('creer_salarie',            'Créer ou modifier un salarié'),
  ('modifier_parametres',      'Modifier les paramètres'),
  ('exporter_donnees',         'Exporter des données'),
  ('declarer_perte',           'Déclarer une perte ou une sortie')
on conflict (key) do nothing;

create table if not exists public.employee_permissions (
  employee_id uuid not null references public.employees(id) on delete cascade,
  permission_key text not null references public.permissions(key) on delete cascade,
  granted boolean not null,
  created_at timestamptz not null default now(),
  primary key (employee_id, permission_key)
);

-- ─── 3. Fonctions d'autorisation ─────────────────────────────────────────────
-- Rôle de l'appelant : app_admins => admin ; sinon app_role de sa fiche ; sinon 'aucun'.
create or replace function private.role_of()
returns text language sql stable security definer
set search_path = public, private as $$
  select case
    when exists (select 1 from private.app_admins a where a.email = private.jwt_email()) then 'admin'
    else coalesce(
      (select coalesce(e.app_role, case when e.role = 'gerant' then 'admin' else 'employe' end)
         from public.employees e
        where lower(e.email) = private.jwt_email() and e.active
        limit 1),
      'aucun')
  end
$$;

-- Permissions par défaut de chaque rôle (les dérogations passent par employee_permissions).
create or replace function private.default_permissions(p_role text)
returns text[] language sql immutable as $$
  select case p_role
    when 'admin'   then array['voir_finances','voir_marges','voir_salaires','modifier_planning',
                              'modifier_pointages','modifier_stock','cloturer_inventaire',
                              'passer_commande','valider_commande','receptionner_commande',
                              'modifier_prix_fournisseur','creer_salarie','modifier_parametres',
                              'exporter_donnees','declarer_perte']
    when 'manager' then array['modifier_planning','modifier_pointages','modifier_stock',
                              'cloturer_inventaire','passer_commande','valider_commande',
                              'receptionner_commande','declarer_perte']
    else array[]::text[]  -- employe, lecture : tout passe par des dérogations explicites
  end
$$;

create or replace function private.has_permission(p_key text)
returns boolean language plpgsql stable security definer
set search_path = public, private as $$
declare
  v_role text := private.role_of();
  v_emp uuid;
  v_override boolean;
begin
  if v_role = 'admin' then return true; end if;
  if v_role in ('aucun','lecture') then return false; end if;
  select id into v_emp from public.employees
   where lower(email) = private.jwt_email() and active limit 1;
  if v_emp is not null then
    select granted into v_override from public.employee_permissions
     where employee_id = v_emp and permission_key = p_key;
    if found then return v_override; end if;
  end if;
  return p_key = any (private.default_permissions(v_role));
end $$;

-- is_gerant() devient un alias : TOUTES les policies existantes restent valides.
create or replace function private.is_gerant()
returns boolean language sql stable security definer
set search_path = public, private as $$
  select private.role_of() = 'admin'
$$;

-- Profil de l'appelant pour le front (rôle + permissions effectives).
create or replace function public.mon_profil()
returns jsonb language sql stable security definer
set search_path = public, private as $$
  select jsonb_build_object(
    'role', private.role_of(),
    'permissions', coalesce(
      (select jsonb_agg(p.key) from public.permissions p where private.has_permission(p.key)),
      '[]'::jsonb)
  )
$$;

revoke all on function private.role_of() from public;
revoke all on function private.default_permissions(text) from public;
revoke all on function private.has_permission(text) from public;
revoke all on function public.mon_profil() from public;
grant execute on function private.role_of() to authenticated;
grant execute on function private.default_permissions(text) to authenticated;
grant execute on function private.has_permission(text) to authenticated;
grant execute on function public.mon_profil() to authenticated;

alter table public.permissions enable row level security;
drop policy if exists permissions_read on public.permissions;
create policy permissions_read on public.permissions
  for select to authenticated using (true);
drop policy if exists permissions_write on public.permissions;
create policy permissions_write on public.permissions
  for all to authenticated using (private.is_gerant()) with check (private.is_gerant());

alter table public.employee_permissions enable row level security;
drop policy if exists employee_permissions_all on public.employee_permissions;
create policy employee_permissions_all on public.employee_permissions
  for all to authenticated using (private.is_gerant()) with check (private.is_gerant());

-- ─── 3bis. Policies étendues aux rôles manager / lecture ─────────────────────
-- Sans cela, un manager aurait la visibilité d'un simple employé.
drop policy if exists employees_read on public.employees;
create policy employees_read on public.employees
  for select to authenticated
  using ( private.is_gerant()
          or lower(email) = private.jwt_email()
          or private.role_of() in ('manager','lecture') );

drop policy if exists schedule_read on public.schedule;
create policy schedule_read on public.schedule
  for select to authenticated
  using ( private.is_gerant() or employee_name = private.my_name()
          or private.role_of() in ('manager','lecture') );
drop policy if exists schedule_write on public.schedule;
create policy schedule_write on public.schedule
  for all to authenticated
  using ( private.has_permission('modifier_planning') )
  with check ( private.has_permission('modifier_planning') );

drop policy if exists tasks_read on public.tasks;
create policy tasks_read on public.tasks
  for select to authenticated
  using ( private.is_gerant() or assignee_name = private.my_name()
          or private.role_of() in ('manager','lecture') );
drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks
  for update to authenticated
  using ( private.role_of() in ('admin','manager') or assignee_name = private.my_name() )
  with check ( private.role_of() in ('admin','manager') or assignee_name = private.my_name() );
drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks
  for insert to authenticated
  with check ( private.role_of() in ('admin','manager') );
drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks
  for delete to authenticated
  using ( private.role_of() in ('admin','manager') );

drop policy if exists products_write on public.products;
create policy products_write on public.products
  for all to authenticated
  using ( private.has_permission('modifier_stock') )
  with check ( private.has_permission('modifier_stock') );
drop policy if exists stock_movements_update on public.stock_movements;
create policy stock_movements_update on public.stock_movements
  for update to authenticated
  using ( private.has_permission('modifier_stock') )
  with check ( private.has_permission('modifier_stock') );
drop policy if exists product_suppliers_write on public.product_suppliers;
create policy product_suppliers_write on public.product_suppliers
  for all to authenticated
  using ( private.has_permission('modifier_prix_fournisseur') )
  with check ( private.has_permission('modifier_prix_fournisseur') );
-- suppliers, recettes, carte, finances : inchangés (admin seul via is_gerant()).

-- ─── 4. Identité par UUID (backfill, colonnes nom conservées pour n8n) ──────
alter table public.schedule add column if not exists employee_id uuid references public.employees(id) on delete set null;
update public.schedule s set employee_id = e.id
  from public.employees e
 where s.employee_id is null and s.employee_name = e.name;

alter table public.tasks add column if not exists completed_by_id uuid references public.employees(id) on delete set null;
update public.tasks t set assigned_to = e.id
  from public.employees e
 where t.assigned_to is null and t.assignee_name = e.name;
update public.tasks t set completed_by_id = e.id
  from public.employees e
 where t.completed_by_id is null and t.completed_by_name = e.name;

update public.stock_movements m set employee_id = e.id
  from public.employees e
 where m.employee_id is null and m.employee_name = e.name;

-- ─── 5. Tâches : nature + statut non_faite + archivage ──────────────────────
-- kind reste NULLABLE sans défaut : l'app déployée n'écrit pas encore cette
-- colonne ; le front retombe sur la correspondance titre↔catalogue si null.
alter table public.tasks add column if not exists kind text;
do $$ begin
  alter table public.tasks
    add constraint tasks_kind_chk check (kind is null or kind in ('recurrente','ponctuelle'));
exception when duplicate_object then null; end $$;
update public.tasks t set kind = 'recurrente'
 where t.kind is null
   and exists (select 1 from public.task_templates tt where tt.title = t.title);
update public.tasks set kind = 'ponctuelle' where kind is null;

alter table public.tasks drop constraint if exists tasks_status_check;
alter table public.tasks add constraint tasks_status_check
  check (status in ('todo','doing','done','in_progress','non_faite'));

-- ─── 6. Audit log (avant la fonction d'archivage qui y écrit) ────────────────
create table if not exists public.audit_log (
  id uuid primary key default uuid_generate_v4(),
  at timestamptz not null default now(),
  user_email text not null default '',
  user_name text not null default '',
  module text not null,
  action text not null,
  table_name text not null default '',
  record_id text not null default '',
  before jsonb,
  after jsonb,
  motif text not null default ''
);
alter table public.audit_log enable row level security;
-- Lecture : admin seulement. Aucune policy INSERT/UPDATE/DELETE : la seule
-- écriture passe par les fonctions SECURITY DEFINER => journal immuable via l'API.
drop policy if exists audit_log_read on public.audit_log;
create policy audit_log_read on public.audit_log
  for select to authenticated using (private.is_gerant());

create or replace function public.log_audit(
  p_module text, p_action text,
  p_table text default '', p_record text default '',
  p_before jsonb default null, p_after jsonb default null,
  p_motif text default ''
) returns void language sql security definer
set search_path = public, private as $$
  insert into public.audit_log (user_email, user_name, module, action, table_name, record_id, before, after, motif)
  values (coalesce(private.jwt_email(), ''), coalesce(private.my_name(), ''),
          p_module, p_action, p_table, p_record, p_before, p_after, p_motif)
$$;
revoke all on function public.log_audit(text,text,text,text,jsonb,jsonb,text) from public;
grant execute on function public.log_audit(text,text,text,text,jsonb,jsonb,text) to authenticated;

-- Archivage des tâches récurrentes expirées (appelé par l'app au chargement).
create or replace function public.archiver_taches_expirees()
returns integer language plpgsql security definer
set search_path = public, private as $$
declare n integer;
begin
  if private.role_of() not in ('admin','manager') then
    raise exception 'non autorise';
  end if;
  update public.tasks t
     set status = 'non_faite', updated_at = now()
   where (t.kind = 'recurrente'
          or (t.kind is null and exists (select 1 from public.task_templates tt where tt.title = t.title)))
     and t.status in ('todo','doing','in_progress')
     and t.due_date < current_date;
  get diagnostics n = row_count;
  if n > 0 then
    perform public.log_audit('taches', 'archivage_auto', 'tasks', '', null,
                             jsonb_build_object('nb_archivees', n),
                             'tâches récurrentes expirées passées en non_faite');
  end if;
  return n;
end $$;
revoke all on function public.archiver_taches_expirees() from public;
grant execute on function public.archiver_taches_expirees() to authenticated;

-- Traçage automatique des changements de permissions et de rôles (spec §47).
create or replace function private.tg_audit_permissions()
returns trigger language plpgsql security definer
set search_path = public, private as $$
begin
  perform public.log_audit('parametres',
    lower(tg_op), 'employee_permissions',
    coalesce(new.employee_id::text, old.employee_id::text),
    to_jsonb(old), to_jsonb(new), 'dérogation de permission');
  return coalesce(new, old);
end $$;
drop trigger if exists employee_permissions_audit on public.employee_permissions;
create trigger employee_permissions_audit
  after insert or update or delete on public.employee_permissions
  for each row execute function private.tg_audit_permissions();

create or replace function private.tg_audit_app_role()
returns trigger language plpgsql security definer
set search_path = public, private as $$
begin
  if new.app_role is distinct from old.app_role or new.role is distinct from old.role then
    perform public.log_audit('parametres', 'changement_role', 'employees', new.id::text,
      jsonb_build_object('app_role', old.app_role, 'role', old.role),
      jsonb_build_object('app_role', new.app_role, 'role', new.role), '');
  end if;
  return new;
end $$;
drop trigger if exists employees_role_audit on public.employees;
create trigger employees_role_audit
  after update on public.employees
  for each row execute function private.tg_audit_app_role();

-- ─── 7. Colmatage sécurité ───────────────────────────────────────────────────
-- S2 : menu_items_rw (using true) rendait la carte modifiable par tout compte.
drop policy if exists menu_items_rw on public.menu_items;
-- S5 : orders (0 ligne, table morte) était en lecture/écriture pour tous.
drop policy if exists orders_rw on public.orders;
drop policy if exists orders_admin on public.orders;
create policy orders_admin on public.orders
  for all to authenticated using (private.is_gerant()) with check (private.is_gerant());
-- S4 : une sortie déclarée doit l'être à son propre nom (fin de l'usurpation).
drop policy if exists stock_movements_insert on public.stock_movements;
create policy stock_movements_insert on public.stock_movements
  for insert to authenticated
  with check (
    type = 'out' and status = 'pending'
    and (private.is_gerant() or employee_name = private.my_name())
  );

commit;

-- ============================================================================
-- ROLLBACK (à exécuter seulement pour annuler ENTIÈREMENT la migration)
-- ============================================================================
-- begin;
-- -- 7. restaurer les policies d'origine
-- drop policy if exists stock_movements_insert on public.stock_movements;
-- create policy stock_movements_insert on public.stock_movements
--   for insert to authenticated with check (type='out' and status='pending');
-- drop policy if exists orders_admin on public.orders;
-- create policy orders_rw on public.orders
--   for all to authenticated using (true) with check (true);
-- create policy menu_items_rw on public.menu_items
--   for all to authenticated using (true) with check (true);
-- -- 6. audit
-- drop trigger if exists employees_role_audit on public.employees;
-- drop function if exists private.tg_audit_app_role();
-- drop trigger if exists employee_permissions_audit on public.employee_permissions;
-- drop function if exists private.tg_audit_permissions();
-- drop function if exists public.archiver_taches_expirees();
-- drop function if exists public.log_audit(text,text,text,text,jsonb,jsonb,text);
-- drop table if exists public.audit_log;
-- -- 5. tâches
-- update public.tasks set status='todo' where status='non_faite';
-- alter table public.tasks drop constraint if exists tasks_status_check;
-- alter table public.tasks add constraint tasks_status_check
--   check (status in ('todo','doing','done','in_progress'));
-- alter table public.tasks drop constraint if exists tasks_kind_chk;
-- alter table public.tasks drop column if exists kind;
-- -- 4. identité (les backfills d'assigned_to/employee_id sont sans danger : on peut les laisser)
-- alter table public.tasks drop column if exists completed_by_id;
-- alter table public.schedule drop column if exists employee_id;
-- -- 3bis. restaurer les policies du hardening 2026-06-29 / migrations 3-4
-- drop policy if exists employees_read on public.employees;
-- create policy employees_read on public.employees for select to authenticated
--   using ( private.is_gerant() or lower(email) = private.jwt_email() );
-- drop policy if exists schedule_read on public.schedule;
-- create policy schedule_read on public.schedule for select to authenticated
--   using ( private.is_gerant() or employee_name = private.my_name() );
-- drop policy if exists schedule_write on public.schedule;
-- create policy schedule_write on public.schedule for all to authenticated
--   using ( private.is_gerant() ) with check ( private.is_gerant() );
-- drop policy if exists tasks_read on public.tasks;
-- create policy tasks_read on public.tasks for select to authenticated
--   using ( private.is_gerant() or assignee_name = private.my_name() );
-- drop policy if exists tasks_update on public.tasks;
-- create policy tasks_update on public.tasks for update to authenticated
--   using ( private.is_gerant() or assignee_name = private.my_name() )
--   with check ( private.is_gerant() or assignee_name = private.my_name() );
-- drop policy if exists tasks_insert on public.tasks;
-- create policy tasks_insert on public.tasks for insert to authenticated
--   with check ( private.is_gerant() );
-- drop policy if exists tasks_delete on public.tasks;
-- create policy tasks_delete on public.tasks for delete to authenticated
--   using ( private.is_gerant() );
-- drop policy if exists products_write on public.products;
-- create policy products_write on public.products for all to authenticated
--   using ( private.is_gerant() ) with check ( private.is_gerant() );
-- drop policy if exists stock_movements_update on public.stock_movements;
-- create policy stock_movements_update on public.stock_movements for update to authenticated
--   using ( private.is_gerant() ) with check ( private.is_gerant() );
-- drop policy if exists product_suppliers_write on public.product_suppliers;
-- create policy product_suppliers_write on public.product_suppliers for all to authenticated
--   using ( private.is_gerant() ) with check ( private.is_gerant() );
-- -- 3. fonctions : restaurer l'is_gerant() historique
-- create or replace function private.is_gerant()
-- returns boolean language sql stable security definer
-- set search_path = public, private as $$
--   select exists (select 1 from private.app_admins a where a.email = private.jwt_email())
--       or exists (select 1 from public.employees e
--                   where lower(e.email) = private.jwt_email() and e.role = 'gerant')
-- $$;
-- drop function if exists public.mon_profil();
-- drop function if exists private.has_permission(text);
-- drop function if exists private.default_permissions(text);
-- drop function if exists private.role_of();
-- -- 2/1. permissions et rôle
-- drop table if exists public.employee_permissions;
-- drop table if exists public.permissions;
-- alter table public.employees drop constraint if exists employees_app_role_chk;
-- alter table public.employees drop column if exists app_role;
-- commit;
