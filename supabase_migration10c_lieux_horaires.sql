-- ============================================================
-- MIGRATION 10c - Phase 6 : lieux, horaires reglables par le gerant, coupure oubliee
-- Plan : docs/superpowers/plans/2026-09-20-pointage-lot1.md (Tache 9 bis, lot A)
-- Prerequis : migrations 10 et 10b appliquees.
-- Additive : aucune donnee supprimee. Les fonctions remplacees gardent leur comportement,
-- elles ajoutent seulement le lieu. A coller UNE FOIS dans le SQL Editor de Supabase.
-- Tout passe ou rien ne passe.
-- ============================================================
-- Pourquoi :
-- 1. Marche de Noel : un stand EN PLUS du resto, chacun avec sa tablette et ses horaires.
-- 2. Les horaires bougent : le gerant les regle lui-meme, par lieu et par jour de la
--    semaine, avec une DATE D'EFFET. Une modification ne reecrit jamais le passe : le
--    recap applique a chaque jour les horaires en vigueur ce jour-la.
-- 3. Coupure oubliee : la borne pose une question (« Je pars » / « Je reviens pour le
--    soir ») quand le salarie est en poste depuis le midi et pointe a l'heure du retour,
--    ou quand il pointe sur un autre lieu que celui de son arrivee.

begin;

-- ─── 1. Lieux ───────────────────────────────────────────────
-- Le Restaurant a un identifiant FIXE : il sert de valeur par defaut aux colonnes
-- lieu_id, ce qu'une sous-requete ne permet pas.
create table if not exists public.pointage_lieux (
  id uuid primary key default uuid_generate_v4(),
  nom text not null,
  actif boolean not null default true,
  created_at timestamptz not null default now()
);
insert into public.pointage_lieux (id, nom)
  values ('00000000-0000-4000-8000-00000000a001', 'Restaurant')
  on conflict (id) do nothing;

alter table public.pointage_lieux enable row level security;
drop policy if exists pointage_lieux_read on public.pointage_lieux;
create policy pointage_lieux_read on public.pointage_lieux
  for select to authenticated using ( true );
-- Aucune policy d'ecriture : seule enregistrer_lieu() y ecrit (auditee).

alter table public.pointage_appareils add column if not exists lieu_id uuid
  not null default '00000000-0000-4000-8000-00000000a001' references public.pointage_lieux(id);
alter table public.presences add column if not exists lieu_id uuid
  not null default '00000000-0000-4000-8000-00000000a001' references public.pointage_lieux(id);
create index if not exists presences_lieu on public.presences (lieu_id);

-- ─── 2. Horaires par lieu, jour de la semaine et date d'effet ──
-- Horaires applicables a un lieu et une date = la ligne de ce jour de la semaine dont
-- la date d'effet est la plus recente sans depasser la date. Midi ou soir vides = pas
-- de service ce jour-la. Pas de service apres minuit (22:00 au plus tard aujourd'hui).
create table if not exists public.pointage_horaires (
  id uuid primary key default uuid_generate_v4(),
  lieu_id uuid not null references public.pointage_lieux(id) on delete restrict,
  jour_semaine smallint not null check (jour_semaine between 1 and 7), -- 1 = lundi
  date_effet date not null,
  midi_debut time, midi_fin time,
  soir_debut time, soir_fin time,
  coupure_max time,  -- heure limite de depart en coupure
  retour_soir time,  -- heure habituelle de retour pour le soir
  auteur text not null default '',
  created_at timestamptz not null default now(),
  unique (lieu_id, jour_semaine, date_effet),
  check ((midi_debut is null) = (midi_fin is null) and (midi_debut is null or midi_debut < midi_fin)),
  check ((soir_debut is null) = (soir_fin is null) and (soir_debut is null or soir_debut < soir_fin)),
  check ((coupure_max is null) = (retour_soir is null) and (coupure_max is null or coupure_max < retour_soir))
);
alter table public.pointage_horaires enable row level security;
drop policy if exists pointage_horaires_read on public.pointage_horaires;
create policy pointage_horaires_read on public.pointage_horaires
  for select to authenticated using ( true );
-- Aucune policy d'ecriture : seule enregistrer_horaires() y ecrit (auditee).

-- Horaires initiaux du Restaurant, repris des creneaux repas actuels. Date d'effet au
-- 01/01/2026 pour couvrir tout le passe. Coupure 15:00 et retour 18:00 (JC, 21/10/2026).
insert into public.pointage_horaires
  (lieu_id, jour_semaine, date_effet, midi_debut, midi_fin, soir_debut, soir_fin,
   coupure_max, retour_soir, auteur)
select '00000000-0000-4000-8000-00000000a001', j, date '2026-01-01',
       s.midi_debut::time, s.midi_fin::time, s.soir_debut::time, s.soir_fin::time,
       time '15:00', time '18:00', 'migration 10c'
  from generate_series(1, 7) j, public.pointage_settings s
 where s.id = 1
on conflict (lieu_id, jour_semaine, date_effet) do nothing;

-- Marges de la question de coupure, autour de l'heure de retour.
alter table public.pointage_settings add column if not exists question_avant_min int not null default 30;
alter table public.pointage_settings add column if not exists question_apres_min int not null default 60;

create or replace function private.horaires_du_jour(p_lieu uuid, p_date date)
returns public.pointage_horaires language sql stable security definer
set search_path = public, private as $$
  select * from public.pointage_horaires
   where lieu_id = p_lieu and jour_semaine = extract(isodow from p_date)::int
     and date_effet <= p_date
   order by date_effet desc limit 1
$$;

-- ─── 3. Enregistrer les horaires d'une semaine (gerant seul) ──
-- p_semaine : tableau de 7 objets {jour_semaine, midi_debut, midi_fin, soir_debut,
-- soir_fin, coupure_max, retour_soir}, heures « HH:MM » ou null. Une date d'effet passee
-- est refusee : le passe ne se reecrit pas. Meme date d'effet = remplacement.
create or replace function public.enregistrer_horaires(
  p_lieu uuid, p_date_effet date, p_semaine jsonb
) returns void language plpgsql security definer
set search_path = public, private, extensions as $fn$
declare
  v_jour jsonb;
  v_avant jsonb;
  v_n int;
begin
  if not private.is_gerant() then raise exception 'non autorise'; end if;
  if not exists (select 1 from public.pointage_lieux where id = p_lieu) then
    raise exception 'lieu inconnu';
  end if;
  if p_date_effet is null or p_date_effet < (now() at time zone 'Europe/Paris')::date then
    raise exception 'date d effet passee';
  end if;
  if jsonb_typeof(p_semaine) <> 'array' or jsonb_array_length(p_semaine) <> 7 then
    raise exception 'il faut les 7 jours';
  end if;
  select count(distinct (j->>'jour_semaine')::int) into v_n
    from jsonb_array_elements(p_semaine) j
   where (j->>'jour_semaine')::int between 1 and 7;
  if v_n <> 7 then raise exception 'il faut les 7 jours'; end if;

  select jsonb_agg(to_jsonb(h)) into v_avant from public.pointage_horaires h
   where lieu_id = p_lieu and date_effet = p_date_effet;

  for v_jour in select * from jsonb_array_elements(p_semaine) loop
    -- Les contraintes de la table refusent un debut apres la fin, ou un champ seul.
    insert into public.pointage_horaires
      (lieu_id, jour_semaine, date_effet, midi_debut, midi_fin, soir_debut, soir_fin,
       coupure_max, retour_soir, auteur)
    values
      (p_lieu, (v_jour->>'jour_semaine')::int, p_date_effet,
       nullif(v_jour->>'midi_debut', '')::time, nullif(v_jour->>'midi_fin', '')::time,
       nullif(v_jour->>'soir_debut', '')::time, nullif(v_jour->>'soir_fin', '')::time,
       nullif(v_jour->>'coupure_max', '')::time, nullif(v_jour->>'retour_soir', '')::time,
       coalesce(private.jwt_email(), ''))
    on conflict (lieu_id, jour_semaine, date_effet) do update set
      midi_debut = excluded.midi_debut, midi_fin = excluded.midi_fin,
      soir_debut = excluded.soir_debut, soir_fin = excluded.soir_fin,
      coupure_max = excluded.coupure_max, retour_soir = excluded.retour_soir,
      auteur = excluded.auteur, created_at = now();
  end loop;

  perform public.log_audit('pointage', 'horaires', 'pointage_horaires', p_lieu::text,
    v_avant, p_semaine, 'horaires applicables a partir du ' || p_date_effet::text);
end $fn$;
revoke all on function public.enregistrer_horaires(uuid, date, jsonb) from public;
revoke execute on function public.enregistrer_horaires(uuid, date, jsonb) from anon;
grant execute on function public.enregistrer_horaires(uuid, date, jsonb) to authenticated;

-- ─── 4. Creer, renommer, activer ou fermer un lieu (gerant seul) ──
-- Fermer un lieu desactive ses bornes : plus aucun pointage n'y est possible, son
-- historique reste. Le rouvrir les reactive.
create or replace function public.enregistrer_lieu(p_lieu uuid, p_nom text, p_actif boolean)
returns uuid language plpgsql security definer
set search_path = public, private, extensions as $fn$
declare
  v_id uuid := p_lieu;
  v_avant jsonb;
begin
  if not private.is_gerant() then raise exception 'non autorise'; end if;
  if p_nom is null or btrim(p_nom) = '' then raise exception 'nom obligatoire'; end if;
  if v_id is null then
    insert into public.pointage_lieux (nom, actif) values (btrim(p_nom), coalesce(p_actif, true))
      returning id into v_id;
  else
    select to_jsonb(l) into v_avant from public.pointage_lieux l where id = v_id;
    if v_avant is null then raise exception 'lieu inconnu'; end if;
    update public.pointage_lieux set nom = btrim(p_nom), actif = coalesce(p_actif, actif)
      where id = v_id;
    update public.pointage_appareils set actif = coalesce(p_actif, actif) where lieu_id = v_id;
  end if;
  perform public.log_audit('pointage', 'lieu', 'pointage_lieux', v_id::text, v_avant,
    (select to_jsonb(l) from public.pointage_lieux l where id = v_id), '');
  return v_id;
end $fn$;
revoke all on function public.enregistrer_lieu(uuid, text, boolean) from public;
revoke execute on function public.enregistrer_lieu(uuid, text, boolean) from anon;
grant execute on function public.enregistrer_lieu(uuid, text, boolean) to authenticated;

-- ─── 5. Etat d'un salarie lu par la borne : + question de coupure ──
-- question_coupure est vrai dans deux cas :
--  'coupure'    : en poste depuis avant l'heure limite de coupure ce jour-la, et pointage
--                 entre (retour - question_avant_min) et (retour + question_apres_min) ;
--  'autre_lieu' : la presence ouverte a ete commencee sur un autre lieu que la borne.
-- Une journee continue qui finit a 22:00 n'est donc jamais interrogee.
create or replace function public.etat_pointage(p_jeton text, p_employee uuid)
returns jsonb language plpgsql stable security definer
set search_path = public, private, extensions as $fn$
declare
  v_appareil public.pointage_appareils%rowtype;
  v_ouverte public.presences%rowtype;
  v_oubli public.presences%rowtype;
  v_h public.pointage_horaires%rowtype;
  v_s public.pointage_settings%rowtype;
  v_maintenant timestamp := now() at time zone 'Europe/Paris';
  v_debut timestamp;
  v_motif text;
begin
  select * into v_appareil from public.pointage_appareils
    where actif and jeton_hash = crypt(p_jeton, jeton_hash) limit 1;
  if v_appareil.id is null then
    raise exception 'appareil non autorise';
  end if;

  select * into v_ouverte from public.presences
    where employee_id = p_employee and statut = 'ouverte' limit 1;
  select * into v_oubli from public.presences
    where employee_id = p_employee and statut = 'anomalie' and fin is null
    order by jour, debut limit 1;

  if v_ouverte.id is not null then
    if v_ouverte.lieu_id <> v_appareil.lieu_id then
      v_motif := 'autre_lieu';
    else
      v_debut := v_ouverte.debut at time zone 'Europe/Paris';
      select * into v_h from private.horaires_du_jour(v_appareil.lieu_id, v_maintenant::date);
      select * into v_s from public.pointage_settings where id = 1;
      if v_h.coupure_max is not null
         and v_debut::date = v_maintenant::date
         and v_debut::time < v_h.coupure_max
         and v_maintenant::time >= v_h.retour_soir - make_interval(mins => v_s.question_avant_min)
         and v_maintenant::time <= v_h.retour_soir + make_interval(mins => v_s.question_apres_min) then
        v_motif := 'coupure';
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'en_poste', v_ouverte.id is not null,
    'debut', v_ouverte.debut,
    'question_coupure', v_motif is not null,
    'motif_question', v_motif,
    'lieu_presence', (select nom from public.pointage_lieux where id = v_ouverte.lieu_id),
    'lieu_borne', (select nom from public.pointage_lieux where id = v_appareil.lieu_id),
    'a_regulariser', case when v_oubli.id is null then null else
      jsonb_build_object('id', v_oubli.id, 'jour', v_oubli.jour, 'debut', v_oubli.debut) end);
end $fn$;
-- Meme signature : les droits poses par la migration 10 restent valables.

-- ─── 6. Pointage : identique a la migration 10, + lieu de la borne ──
create or replace function public.pointer(
  p_employee uuid, p_pin text, p_jeton text, p_photo text default null
) returns jsonb language plpgsql security definer
set search_path = public, private, extensions as $fn$
declare
  v_appareil uuid;
  v_lieu uuid;
  v_emp public.employees%rowtype;
  v_ouverte public.presences%rowtype;
  v_echecs int;
  v_now timestamptz := now();
begin
  select id, lieu_id into v_appareil, v_lieu from public.pointage_appareils
    where actif and jeton_hash = crypt(p_jeton, jeton_hash) limit 1;
  if v_appareil is null then
    raise exception 'appareil non autorise';
  end if;

  select count(*) into v_echecs from public.pointage_tentatives
    where appareil_id = v_appareil and at > v_now - interval '5 minutes';
  if v_echecs >= 5 then
    return jsonb_build_object('action','erreur','motif','trop_de_tentatives');
  end if;

  -- Code faux RETOURNE et non leve : une exception annulerait l'enregistrement de la
  -- tentative, et le compteur resterait a zero (voir migration 10).
  select * into v_emp from public.employees
    where id = p_employee and active is not false
      and pin_hash is not null and pin_hash = crypt(p_pin, pin_hash);
  if v_emp.id is null then
    insert into public.pointage_tentatives (appareil_id) values (v_appareil);
    return jsonb_build_object('action','erreur','motif','code_invalide');
  end if;
  delete from public.pointage_tentatives where appareil_id = v_appareil;

  select * into v_ouverte from public.presences
    where employee_id = v_emp.id and statut = 'ouverte' limit 1;

  if v_ouverte.id is not null then
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

  if exists (select 1 from public.presences
             where employee_id = v_emp.id and fin_origine = 'borne'
               and fin > v_now - interval '1 minute') then
    return jsonb_build_object('action','ignore','salarie',v_emp.name);
  end if;

  insert into public.presences
    (employee_id, jour, debut, debut_origine, debut_appareil, debut_photo, statut, lieu_id)
  values
    (v_emp.id, (v_now at time zone 'Europe/Paris')::date, v_now, 'borne',
     v_appareil, p_photo, 'ouverte', v_lieu);
  return jsonb_build_object('action','arrivee','salarie',v_emp.name,'heure',v_now);
end $fn$;
-- Meme signature : les droits poses par la migration 10 restent valables.

-- ─── 7. Coupure oubliee, declaree par le salarie sur la borne ──
-- Ferme la presence ouverte a l'heure DECLAREE (fin_origine = 'declare', donc comptee en
-- heures declarees dans le recap) et ouvre une presence maintenant, sur le lieu de la
-- borne. Meme protection que pointer() : jeton, compteur de tentatives, code faux
-- renvoye en valeur.
create or replace function public.declarer_coupure(
  p_employee uuid, p_pin text, p_jeton text, p_fin timestamptz, p_photo text default null
) returns jsonb language plpgsql security definer
set search_path = public, private, extensions as $fn$
declare
  v_appareil uuid;
  v_lieu uuid;
  v_emp public.employees%rowtype;
  v_ouverte public.presences%rowtype;
  v_echecs int;
  v_heures int;
  v_now timestamptz := now();
begin
  select id, lieu_id into v_appareil, v_lieu from public.pointage_appareils
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

  select * into v_ouverte from public.presences
    where employee_id = v_emp.id and statut = 'ouverte' limit 1;
  if v_ouverte.id is null then
    return jsonb_build_object('action','erreur','motif','pas_en_poste');
  end if;

  -- Heure plausible : apres l'arrivee, au moins 15 min avant maintenant (sinon ce n'est
  -- pas une coupure), et pas au-dela du delai de cloture automatique.
  select coalesce(heures_avant_cloture, 14) into v_heures
    from public.pointage_settings where id = 1;
  if p_fin is null or p_fin <= v_ouverte.debut or p_fin > v_now - interval '15 minutes'
     or p_fin > v_ouverte.debut + make_interval(hours => coalesce(v_heures, 14)) then
    return jsonb_build_object('action','erreur','motif','heure_invalide');
  end if;

  update public.presences set
    fin = p_fin, fin_origine = 'declare', fin_appareil = v_appareil, statut = 'complete'
    where id = v_ouverte.id;
  insert into public.presences
    (employee_id, jour, debut, debut_origine, debut_appareil, debut_photo, statut, lieu_id)
  values
    (v_emp.id, (v_now at time zone 'Europe/Paris')::date, v_now, 'borne',
     v_appareil, p_photo, 'ouverte', v_lieu);
  return jsonb_build_object('action','coupure','salarie',v_emp.name,'fin',p_fin,'heure',v_now);
end $fn$;
revoke all on function public.declarer_coupure(uuid, text, text, timestamptz, text) from public;
revoke execute on function public.declarer_coupure(uuid, text, text, timestamptz, text) from anon;
grant execute on function public.declarer_coupure(uuid, text, text, timestamptz, text) to authenticated;

-- ─── 8. Borne et presence ajoutee par le gerant : + lieu ──
-- Nouvelle signature avec un parametre de plus : l'ancienne est supprimee, sinon les
-- deux versions coexisteraient et l'appel deviendrait ambigu. Aucun ecran ne les
-- appelle encore (taches 10 et 13).
drop function if exists public.enregistrer_appareil(text, text);
create or replace function public.enregistrer_appareil(
  p_libelle text, p_jeton text, p_lieu uuid default '00000000-0000-4000-8000-00000000a001'
) returns uuid language plpgsql security definer
set search_path = public, private, extensions as $fn$
declare v_id uuid;
begin
  if not private.is_gerant() then raise exception 'non autorise'; end if;
  if p_jeton is null or length(p_jeton) < 32 then
    raise exception 'jeton trop court';
  end if;
  if not exists (select 1 from public.pointage_lieux where id = p_lieu and actif) then
    raise exception 'lieu inconnu ou ferme';
  end if;
  insert into public.pointage_appareils (libelle, jeton_hash, lieu_id)
    values (p_libelle, crypt(p_jeton, gen_salt('bf')), p_lieu) returning id into v_id;
  return v_id;
end $fn$;
revoke all on function public.enregistrer_appareil(text, text, uuid) from public;
revoke execute on function public.enregistrer_appareil(text, text, uuid) from anon;
grant execute on function public.enregistrer_appareil(text, text, uuid) to authenticated;

drop function if exists public.ajouter_presence(uuid, timestamptz, timestamptz, text);
create or replace function public.ajouter_presence(
  p_employee uuid, p_debut timestamptz, p_fin timestamptz, p_motif text,
  p_lieu uuid default '00000000-0000-4000-8000-00000000a001'
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
  if not exists (select 1 from public.pointage_lieux where id = p_lieu) then
    raise exception 'lieu inconnu';
  end if;
  if p_debut > v_now then raise exception 'debut dans le futur'; end if;
  if p_fin is not null and p_fin <= p_debut then
    raise exception 'fin anterieure au debut';
  end if;
  if p_fin is not null and p_fin > v_now then
    raise exception 'fin dans le futur';
  end if;

  select coalesce(heures_avant_cloture, 14) into v_heures
    from public.pointage_settings where id = 1;
  if coalesce(p_fin, v_now) - p_debut > make_interval(hours => coalesce(v_heures, 14)) then
    raise exception 'presence trop longue, verifier la date';
  end if;

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
    (employee_id, jour, debut, fin, statut, debut_origine, fin_origine, corrigee, lieu_id)
  values
    (p_employee, (p_debut at time zone 'Europe/Paris')::date, p_debut, p_fin,
     case when p_fin is null then 'ouverte' else 'complete' end,
     'correction',
     case when p_fin is null then null else 'correction' end,
     true, p_lieu)
  returning id into v_id;

  perform public.log_audit(
    'pointage', 'ajout', 'presences', v_id::text,
    null,
    (select to_jsonb(p) from public.presences p where p.id = v_id),
    p_motif);
  return v_id;
end $fn$;
revoke all on function public.ajouter_presence(uuid, timestamptz, timestamptz, text, uuid) from public;
revoke execute on function public.ajouter_presence(uuid, timestamptz, timestamptz, text, uuid) from anon;
grant execute on function public.ajouter_presence(uuid, timestamptz, timestamptz, text, uuid) to authenticated;

revoke all on function private.horaires_du_jour(uuid, date) from public;

commit;

-- ============================================================
-- ROLLBACK (a garder, non execute). Remettre ensuite etat_pointage, pointer,
-- enregistrer_appareil et ajouter_presence depuis supabase_migration10_phase6_pointage.sql.
-- drop function if exists public.declarer_coupure(uuid,text,text,timestamptz,text);
-- drop function if exists public.enregistrer_lieu(uuid,text,boolean);
-- drop function if exists public.enregistrer_horaires(uuid,date,jsonb);
-- drop function if exists public.enregistrer_appareil(text,text,uuid);
-- drop function if exists public.ajouter_presence(uuid,timestamptz,timestamptz,text,uuid);
-- drop function if exists private.horaires_du_jour(uuid,date);
-- alter table public.pointage_settings drop column if exists question_avant_min;
-- alter table public.pointage_settings drop column if exists question_apres_min;
-- drop table if exists public.pointage_horaires;
-- alter table public.presences drop column if exists lieu_id;
-- alter table public.pointage_appareils drop column if exists lieu_id;
-- drop table if exists public.pointage_lieux;
-- ============================================================
