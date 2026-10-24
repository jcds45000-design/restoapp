-- ============================================================
-- MIGRATION 10 - Phase 6 lot 1 : pointage et decompte des heures
-- Spec : docs/superpowers/specs/2026-09-20-pointage-heures-design.md
-- Plan : docs/superpowers/plans/2026-09-20-pointage-lot1.md (Tache 7)
-- Additive uniquement. Aucune donnee supprimee, aucune colonne renommee.
-- A coller UNE FOIS dans le SQL Editor de Supabase. Tout passe ou rien ne passe.
-- ============================================================

begin;

-- pgcrypto fournit crypt() et gen_salt() : le code PIN n'est JAMAIS stocke en clair.
-- Sur Supabase, l'extension vit dans le schema "extensions" : il est donc ajoute au
-- search_path de chaque fonction ci-dessous, sinon crypt() est introuvable a l'appel.
create extension if not exists pgcrypto with schema extensions;

-- ─── 1. Code PIN sur la fiche salarie ───────────────────────
alter table public.employees add column if not exists pin_hash text;

-- ─── 2. Appareils autorises a pointer ───────────────────────
-- Seule la tablette enregistree peut ecrire un pointage. Le jeton vit dans le
-- localStorage de la tablette ; seule son empreinte est en base.
create table if not exists public.pointage_appareils (
  id uuid primary key default uuid_generate_v4(),
  libelle text not null,
  jeton_hash text not null,
  actif boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.pointage_appareils enable row level security;
drop policy if exists pointage_appareils_read on public.pointage_appareils;
create policy pointage_appareils_read on public.pointage_appareils
  for select to authenticated using ( private.is_gerant() );
drop policy if exists pointage_appareils_write on public.pointage_appareils;
create policy pointage_appareils_write on public.pointage_appareils
  for all to authenticated using ( private.is_gerant() ) with check ( private.is_gerant() );

-- ─── 2 bis. Tentatives ratees (anti-force brute) ────────────
-- Un code a 4 chiffres se devine a la main en quelques dizaines d'essais : sans
-- limite, la protection ne vaut rien (spec §8).
create table if not exists public.pointage_tentatives (
  id uuid primary key default uuid_generate_v4(),
  appareil_id uuid references public.pointage_appareils(id) on delete cascade,
  at timestamptz not null default now()
);
create index if not exists pointage_tentatives_at on public.pointage_tentatives (appareil_id, at);
alter table public.pointage_tentatives enable row level security;
drop policy if exists pointage_tentatives_read on public.pointage_tentatives;
create policy pointage_tentatives_read on public.pointage_tentatives
  for select to authenticated using ( private.is_gerant() );
-- Aucune policy d'ecriture : seules les fonctions pointer() et declarer_depart() y ecrivent.

-- ─── 3. Reglages ────────────────────────────────────────────
create table if not exists public.pointage_settings (
  id int primary key default 1,
  midi_debut text not null default '11:30',
  midi_fin text not null default '14:30',
  soir_debut text not null default '18:30',
  soir_fin text not null default '22:00',
  heures_avant_cloture int not null default 14,
  semaine_a_cheval text not null default 'mois_fin'
    check (semaine_a_cheval in ('mois_debut','mois_fin')),
  arrondi_minutes int not null default 0,
  photo_retention_jours int not null default 30,
  constraint pointage_settings_singleton check (id = 1)
);
insert into public.pointage_settings (id) values (1) on conflict (id) do nothing;
alter table public.pointage_settings enable row level security;
drop policy if exists pointage_settings_read on public.pointage_settings;
create policy pointage_settings_read on public.pointage_settings
  for select to authenticated using ( true );
drop policy if exists pointage_settings_write on public.pointage_settings;
create policy pointage_settings_write on public.pointage_settings
  for all to authenticated using ( private.is_gerant() ) with check ( private.is_gerant() );

-- ─── 4. Presences ───────────────────────────────────────────
-- Une ligne par presence, debut et fin. Une coupure = deux lignes le meme jour,
-- une journee continue = une ligne. Une anomalie = une ligne dont fin est vide.
-- jour = date du DEBUT en heure de Paris, comme jourDeRattachement() dans pointage.js.
create table if not exists public.presences (
  id uuid primary key default uuid_generate_v4(),
  employee_id uuid not null references public.employees(id) on delete restrict,
  jour date not null,
  debut timestamptz not null,
  fin timestamptz,
  statut text not null default 'ouverte'
    check (statut in ('ouverte','complete','anomalie')),
  debut_origine text not null default 'borne'
    check (debut_origine in ('borne','declare','correction')),
  fin_origine text
    check (fin_origine in ('borne','declare','correction','cloture_auto')),
  debut_photo text,
  fin_photo text,
  debut_appareil uuid references public.pointage_appareils(id),
  fin_appareil uuid references public.pointage_appareils(id),
  corrigee boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists presences_employee_jour on public.presences (employee_id, jour);
create index if not exists presences_statut on public.presences (statut);
-- Un salarie ne peut pas avoir deux presences ouvertes en meme temps.
create unique index if not exists presences_une_seule_ouverte
  on public.presences (employee_id) where statut = 'ouverte';

alter table public.presences enable row level security;
-- Lecture : le gerant voit tout, un salarie ne voit QUE ses propres lignes.
drop policy if exists presences_read on public.presences;
create policy presences_read on public.presences
  for select to authenticated using (
    private.is_gerant()
    or employee_id in (
      select id from public.employees where lower(email) = private.jwt_email()
    )
  );
-- Aucune policy insert/update/delete : toute ecriture passe par les fonctions
-- SECURITY DEFINER ci-dessous. Meme un compte vole ne peut pas fabriquer d'heures.

-- ─── 5. Etat d'un salarie, lu par la borne ──────────────────
-- La borne doit savoir, avant le code, s'il faut afficher ARRIVEE ou DEPART et s'il
-- reste un oubli a regulariser. Elle ne lit PAS la table presences : la RLS ne lui
-- montrerait rien si son compte n'est pas gerant, et un compte gerant sur une tablette
-- en libre acces serait une faille. Seul le jeton de la borne ouvre cette lecture.
create or replace function public.etat_pointage(p_jeton text, p_employee uuid)
returns jsonb language plpgsql stable security definer
set search_path = public, private, extensions as $fn$
declare
  v_appareil uuid;
  v_ouverte public.presences%rowtype;
  v_oubli public.presences%rowtype;
begin
  select id into v_appareil from public.pointage_appareils
    where actif and jeton_hash = crypt(p_jeton, jeton_hash) limit 1;
  if v_appareil is null then
    raise exception 'appareil non autorise';
  end if;

  select * into v_ouverte from public.presences
    where employee_id = p_employee and statut = 'ouverte' limit 1;
  select * into v_oubli from public.presences
    where employee_id = p_employee and statut = 'anomalie' and fin is null
    order by jour, debut limit 1;

  return jsonb_build_object(
    'en_poste', v_ouverte.id is not null,
    'debut', v_ouverte.debut,
    'a_regulariser', case when v_oubli.id is null then null else
      jsonb_build_object('id', v_oubli.id, 'jour', v_oubli.jour, 'debut', v_oubli.debut) end);
end $fn$;
revoke all on function public.etat_pointage(text, uuid) from public;
revoke execute on function public.etat_pointage(text, uuid) from anon;
grant execute on function public.etat_pointage(text, uuid) to authenticated;

-- ─── 6. Fonction de pointage (borne) ────────────────────────
-- Le code doit etre celui du salarie CHOISI sur la grille : sinon un code tape sous la
-- mauvaise case pointerait un collegue, et deviner un code au hasard suffirait a tomber
-- sur quelqu'un. Retourne un json decrivant ce qui vient d'etre fait, pour l'affichage.
create or replace function public.pointer(
  p_employee uuid, p_pin text, p_jeton text, p_photo text default null
) returns jsonb language plpgsql security definer
set search_path = public, private, extensions as $fn$
declare
  v_appareil uuid;
  v_emp public.employees%rowtype;
  v_ouverte public.presences%rowtype;
  v_echecs int;
  v_now timestamptz := now();
begin
  -- 1. L'appareil doit etre une borne enregistree et active.
  select id into v_appareil from public.pointage_appareils
    where actif and jeton_hash = crypt(p_jeton, jeton_hash) limit 1;
  if v_appareil is null then
    raise exception 'appareil non autorise';
  end if;

  -- 2. Blocage temporaire au-dela de 5 echecs sur 5 minutes depuis cette borne.
  select count(*) into v_echecs from public.pointage_tentatives
    where appareil_id = v_appareil and at > v_now - interval '5 minutes';
  if v_echecs >= 5 then
    return jsonb_build_object('action','erreur','motif','trop_de_tentatives');
  end if;

  -- 3. Le code doit correspondre au salarie choisi, et ce salarie doit etre actif.
  -- ATTENTION : on RETOURNE une erreur, on ne la LEVE pas. Une exception annulerait
  -- la transaction, donc effacerait l'enregistrement de la tentative ratee, et le
  -- compteur ci-dessus resterait a zero pour toujours.
  select * into v_emp from public.employees
    where id = p_employee and active is not false
      and pin_hash is not null and pin_hash = crypt(p_pin, pin_hash);
  if v_emp.id is null then
    insert into public.pointage_tentatives (appareil_id) values (v_appareil);
    return jsonb_build_object('action','erreur','motif','code_invalide');
  end if;

  -- Code juste : on efface l'ardoise des tentatives de cette borne.
  delete from public.pointage_tentatives where appareil_id = v_appareil;

  -- 4. Presence ouverte ? Alors c'est un depart. Sinon c'est une arrivee.
  select * into v_ouverte from public.presences
    where employee_id = v_emp.id and statut = 'ouverte' limit 1;

  if v_ouverte.id is not null then
    -- Anti-rebond : arrivee puis appui a moins d'une minute, le second est ignore.
    if v_now - v_ouverte.debut < interval '1 minute' then
      return jsonb_build_object('action','ignore','salarie',v_emp.name);
    end if;
    update public.presences set
      fin = v_now, fin_origine = 'borne', fin_appareil = v_appareil,
      fin_photo = p_photo, statut = 'complete'
      where id = v_ouverte.id;
    return jsonb_build_object(
      'action','depart','salarie',v_emp.name,'heure',v_now,
      'minutes', extract(epoch from (v_now - v_ouverte.debut))/60);
  end if;

  -- Anti-rebond dans l'autre sens : un double appui sur DEPART ne doit pas ouvrir une
  -- presence fantome, qui finirait en anomalie 14 h plus tard (spec §8).
  if exists (select 1 from public.presences
             where employee_id = v_emp.id and fin_origine = 'borne'
               and fin > v_now - interval '1 minute') then
    return jsonb_build_object('action','ignore','salarie',v_emp.name);
  end if;

  insert into public.presences
    (employee_id, jour, debut, debut_origine, debut_appareil, debut_photo, statut)
  values
    (v_emp.id, (v_now at time zone 'Europe/Paris')::date, v_now, 'borne',
     v_appareil, p_photo, 'ouverte');
  return jsonb_build_object('action','arrivee','salarie',v_emp.name,'heure',v_now);
end $fn$;
revoke all on function public.pointer(uuid, text, text, text) from public;
revoke execute on function public.pointer(uuid, text, text, text) from anon;
grant execute on function public.pointer(uuid, text, text, text) to authenticated;

-- ─── 7. Regularisation d'un oubli, par le salarie, sur la borne ──
-- L'heure saisie est marquee 'declare' : elle est croyable, pas mesuree.
-- Meme protection que pointer() : sans compteur ici, cette fonction servirait a
-- essayer tous les codes en contournant le blocage de la borne.
create or replace function public.declarer_depart(
  p_employee uuid, p_pin text, p_jeton text, p_presence uuid, p_heure timestamptz
) returns jsonb language plpgsql security definer
set search_path = public, private, extensions as $fn$
declare
  v_appareil uuid;
  v_emp public.employees%rowtype;
  v_presence public.presences%rowtype;
  v_echecs int;
  v_heures int;
  v_now timestamptz := now();
begin
  select id into v_appareil from public.pointage_appareils
    where actif and jeton_hash = crypt(p_jeton, jeton_hash) limit 1;
  if v_appareil is null then raise exception 'appareil non autorise'; end if;

  select count(*) into v_echecs from public.pointage_tentatives
    where appareil_id = v_appareil and at > v_now - interval '5 minutes';
  if v_echecs >= 5 then
    return jsonb_build_object('action','erreur','motif','trop_de_tentatives');
  end if;

  select * into v_emp from public.employees
    where id = p_employee and active is not false
      and pin_hash is not null and pin_hash = crypt(p_pin, pin_hash);
  if v_emp.id is null then
    insert into public.pointage_tentatives (appareil_id) values (v_appareil);
    return jsonb_build_object('action','erreur','motif','code_invalide');
  end if;
  delete from public.pointage_tentatives where appareil_id = v_appareil;

  -- Seul un OUBLI se regularise. Une presence ouverte se ferme en pointant : sinon un
  -- salarie en poste pourrait declarer un depart a l'heure de son choix.
  select * into v_presence from public.presences
    where id = p_presence and employee_id = v_emp.id
      and statut = 'anomalie' and fin is null;
  if v_presence.id is null then
    return jsonb_build_object('action','erreur','motif','presence_non_regularisable');
  end if;

  -- L'heure declaree doit etre plausible : apres l'arrivee, pas dans le futur, et pas
  -- plus longue que le delai de cloture automatique (une vraie presence plus longue
  -- aurait de toute facon ete fermee en anomalie).
  select coalesce(heures_avant_cloture, 14) into v_heures
    from public.pointage_settings where id = 1;
  if p_heure is null or p_heure <= v_presence.debut or p_heure > v_now
     or p_heure > v_presence.debut + make_interval(hours => coalesce(v_heures, 14)) then
    return jsonb_build_object('action','erreur','motif','heure_invalide');
  end if;

  update public.presences set
    fin = p_heure, fin_origine = 'declare', fin_appareil = v_appareil, statut = 'complete'
    where id = p_presence;
  return jsonb_build_object('action','regularise','salarie',v_emp.name,'heure',p_heure);
end $fn$;
revoke all on function public.declarer_depart(uuid, text, text, uuid, timestamptz) from public;
revoke execute on function public.declarer_depart(uuid, text, text, uuid, timestamptz) from anon;
grant execute on function public.declarer_depart(uuid, text, text, uuid, timestamptz) to authenticated;

-- ─── 8. Correction par le gerant : motif OBLIGATOIRE, ancienne valeur conservee ──
create or replace function public.corriger_presence(
  p_presence uuid, p_debut timestamptz, p_fin timestamptz, p_motif text
) returns void language plpgsql security definer
set search_path = public, private, extensions as $fn$
declare
  v_avant public.presences%rowtype;
begin
  if not private.is_gerant() then raise exception 'non autorise'; end if;
  if p_motif is null or btrim(p_motif) = '' then
    raise exception 'motif obligatoire';
  end if;
  if p_debut is null then raise exception 'debut obligatoire'; end if;
  select * into v_avant from public.presences where id = p_presence;
  if v_avant.id is null then raise exception 'presence inconnue'; end if;
  if p_fin is not null and p_fin <= p_debut then
    raise exception 'fin anterieure au debut';
  end if;
  if p_fin is not null and p_fin > now() then
    raise exception 'fin dans le futur';
  end if;

  update public.presences set
    debut = p_debut, fin = p_fin,
    -- Le recap regroupe par jour : un debut deplace sur un autre jour change le jour.
    jour = (p_debut at time zone 'Europe/Paris')::date,
    debut_origine = case when p_debut <> v_avant.debut then 'correction' else debut_origine end,
    fin_origine = case when p_fin is null then null
                       when v_avant.fin is null or p_fin <> v_avant.fin then 'correction'
                       else fin_origine end,
    -- Corriger l'arrivee d'un salarie encore en poste ne doit pas le sortir de poste.
    statut = case when p_fin is not null then 'complete'
                  when v_avant.statut = 'ouverte' then 'ouverte'
                  else 'anomalie' end,
    corrigee = true
    where id = p_presence;

  perform public.log_audit(
    'pointage', 'correction', 'presences', p_presence::text,
    to_jsonb(v_avant),
    (select to_jsonb(p) from public.presences p where p.id = p_presence),
    p_motif);
end $fn$;
revoke all on function public.corriger_presence(uuid, timestamptz, timestamptz, text) from public;
revoke execute on function public.corriger_presence(uuid, timestamptz, timestamptz, text) from anon;
grant execute on function public.corriger_presence(uuid, timestamptz, timestamptz, text) to authenticated;

-- ─── 8 bis. Ajout d'une presence par le gerant : arrivee jamais pointee ──
-- Sans arrivee, aucune ligne n'existe et la borne n'a rien a regulariser : seul le
-- gerant peut alors creer la presence. Elle est marquee 'correction' et corrigee, donc
-- comptee en heures DECLAREES, jamais en heures pointees. Motif obligatoire, audite.
-- Sans fin, la presence est ouverte : le salarie encore en poste pointera son depart.
create or replace function public.ajouter_presence(
  p_employee uuid, p_debut timestamptz, p_fin timestamptz, p_motif text
) returns uuid language plpgsql security definer
set search_path = public, private, extensions as $fn$
declare
  v_id uuid;
  v_heures int;
  v_now timestamptz := now();
begin
  if not private.is_gerant() then raise exception 'non autorise'; end if;
  if p_motif is null or btrim(p_motif) = '' then
    raise exception 'motif obligatoire';
  end if;
  if p_debut is null then raise exception 'debut obligatoire'; end if;
  if not exists (select 1 from public.employees where id = p_employee) then
    raise exception 'salarie inconnu';
  end if;
  if p_debut > v_now then raise exception 'debut dans le futur'; end if;
  if p_fin is not null and p_fin <= p_debut then
    raise exception 'fin anterieure au debut';
  end if;
  if p_fin is not null and p_fin > v_now then
    raise exception 'fin dans le futur';
  end if;

  -- Meme plafond que la cloture automatique : au-dela, c'est une erreur de saisie
  -- (mauvaise date), pas une journee de travail.
  select coalesce(heures_avant_cloture, 14) into v_heures
    from public.pointage_settings where id = 1;
  if coalesce(p_fin, v_now) - p_debut > make_interval(hours => coalesce(v_heures, 14)) then
    raise exception 'presence trop longue, verifier la date';
  end if;

  -- Une presence qui en recouvre une autre compterait les memes heures deux fois.
  -- Une anomalie sans fin occupe l'instant de son arrivee : si elle tombe dedans, c'est
  -- elle qu'il faut corriger, pas une nouvelle ligne qu'il faut creer.
  if exists (
    select 1 from public.presences p
    where p.employee_id = p_employee
      and p.debut < coalesce(p_fin, 'infinity'::timestamptz)
      and coalesce(p.fin,
            case when p.statut = 'ouverte' then 'infinity'::timestamptz
                 else p.debut + interval '1 microsecond' end) > p_debut
  ) then
    raise exception 'chevauche une presence existante, la corriger plutot';
  end if;

  insert into public.presences
    (employee_id, jour, debut, fin, statut, debut_origine, fin_origine, corrigee)
  values
    (p_employee, (p_debut at time zone 'Europe/Paris')::date, p_debut, p_fin,
     case when p_fin is null then 'ouverte' else 'complete' end,
     'correction',
     case when p_fin is null then null else 'correction' end,
     true)
  returning id into v_id;

  perform public.log_audit(
    'pointage', 'ajout', 'presences', v_id::text,
    null,
    (select to_jsonb(p) from public.presences p where p.id = v_id),
    p_motif);
  return v_id;
end $fn$;
revoke all on function public.ajouter_presence(uuid, timestamptz, timestamptz, text) from public;
revoke execute on function public.ajouter_presence(uuid, timestamptz, timestamptz, text) from anon;
grant execute on function public.ajouter_presence(uuid, timestamptz, timestamptz, text) to authenticated;

-- ─── 9. Cloture automatique des oublis (appelee par n8n) ────
-- Une presence oubliee est fermee EN ANOMALIE, jamais completee avec une heure inventee.
-- Reservee au service_role, celui de la credential n8n : ni l'application ni la borne
-- n'ont a l'appeler.
create or replace function public.cloturer_presences_oubliees()
returns int language plpgsql security definer
set search_path = public, private, extensions as $fn$
declare
  v_heures int;
  v_nb int;
begin
  select heures_avant_cloture into v_heures from public.pointage_settings where id = 1;
  update public.presences set
    statut = 'anomalie', fin_origine = 'cloture_auto'
    where statut = 'ouverte'
      and now() - debut > make_interval(hours => coalesce(v_heures, 14));
  get diagnostics v_nb = row_count;
  return v_nb;
end $fn$;
revoke all on function public.cloturer_presences_oubliees() from public;
revoke execute on function public.cloturer_presences_oubliees() from anon, authenticated;
grant execute on function public.cloturer_presences_oubliees() to service_role;

-- ─── 10. Attribution d'un code PIN (gerant uniquement) ──────
-- Le code n'est jamais relu : s'il est oublie, on en attribue un autre.
create or replace function public.definir_pin(p_employee uuid, p_pin text)
returns void language plpgsql security definer
set search_path = public, private, extensions as $fn$
declare v_existe int;
begin
  if not private.is_gerant() then raise exception 'non autorise'; end if;
  if p_pin is null or p_pin !~ '^[0-9]{4,6}$' then
    raise exception 'le code doit faire 4 a 6 chiffres';
  end if;
  -- Unicite sur TOUS les salaries, actifs ou non : sinon le turn-over finit par
  -- attribuer des heures au mauvais nom.
  select count(*) into v_existe from public.employees
    where pin_hash is not null and id <> p_employee and pin_hash = crypt(p_pin, pin_hash);
  if v_existe > 0 then raise exception 'ce code est deja utilise'; end if;
  update public.employees set pin_hash = crypt(p_pin, gen_salt('bf')) where id = p_employee;
  if not found then raise exception 'salarie inconnu'; end if;
  perform public.log_audit('pointage', 'definir_pin', 'employees', p_employee::text,
    null, null, 'attribution d un code de pointage');
end $fn$;
revoke all on function public.definir_pin(uuid, text) from public;
revoke execute on function public.definir_pin(uuid, text) from anon;
grant execute on function public.definir_pin(uuid, text) to authenticated;

-- ─── 11. Enregistrement d'une borne (gerant uniquement) ─────
create or replace function public.enregistrer_appareil(p_libelle text, p_jeton text)
returns uuid language plpgsql security definer
set search_path = public, private, extensions as $fn$
declare v_id uuid;
begin
  if not private.is_gerant() then raise exception 'non autorise'; end if;
  if p_jeton is null or length(p_jeton) < 32 then
    raise exception 'jeton trop court';
  end if;
  insert into public.pointage_appareils (libelle, jeton_hash)
    values (p_libelle, crypt(p_jeton, gen_salt('bf'))) returning id into v_id;
  return v_id;
end $fn$;
revoke all on function public.enregistrer_appareil(text, text) from public;
revoke execute on function public.enregistrer_appareil(text, text) from anon;
grant execute on function public.enregistrer_appareil(text, text) to authenticated;

-- ─── 12. Photos de pointage : bucket PRIVE ──────────────────
-- Lisibles par le gerant seul, par URL signee. Cree ici plutot qu'a la main dans
-- l'onglet Storage : un oubli de la case « Public » ne peut plus arriver.
insert into storage.buckets (id, name, public)
  values ('pointages', 'pointages', false)
  on conflict (id) do nothing;
-- Depot d'une photo : reserve aux comptes connectes (la borne en est un).
drop policy if exists pointages_insert on storage.objects;
create policy pointages_insert on storage.objects
  for insert to authenticated with check ( bucket_id = 'pointages' );
-- Lecture : gerant uniquement.
drop policy if exists pointages_select on storage.objects;
create policy pointages_select on storage.objects
  for select to authenticated using ( bucket_id = 'pointages' and private.is_gerant() );
-- Suppression : gerant uniquement (purge des photos de plus de 30 jours).
drop policy if exists pointages_delete on storage.objects;
create policy pointages_delete on storage.objects
  for delete to authenticated using ( bucket_id = 'pointages' and private.is_gerant() );

commit;

-- ============================================================
-- ROLLBACK (a garder, non execute)
-- drop policy if exists pointages_insert on storage.objects;
-- drop policy if exists pointages_select on storage.objects;
-- drop policy if exists pointages_delete on storage.objects;
-- delete from storage.buckets where id = 'pointages';  -- seulement si vide
-- drop function if exists public.etat_pointage(text,uuid);
-- drop function if exists public.pointer(uuid,text,text,text);
-- drop function if exists public.declarer_depart(uuid,text,text,uuid,timestamptz);
-- drop function if exists public.corriger_presence(uuid,timestamptz,timestamptz,text);
-- drop function if exists public.ajouter_presence(uuid,timestamptz,timestamptz,text);
-- drop function if exists public.cloturer_presences_oubliees();
-- drop function if exists public.definir_pin(uuid,text);
-- drop function if exists public.enregistrer_appareil(text,text);
-- drop table if exists public.presences;
-- drop table if exists public.pointage_tentatives;
-- drop table if exists public.pointage_appareils;
-- drop table if exists public.pointage_settings;
-- alter table public.employees drop column if exists pin_hash;
-- ============================================================
