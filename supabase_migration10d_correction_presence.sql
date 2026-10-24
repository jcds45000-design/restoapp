-- ============================================================
-- MIGRATION 10d - Phase 6 : corriger_presence durcie avant son branchement a l'ecran
-- Plan : docs/superpowers/plans/2026-09-20-pointage-lot1.md (Tache 10, reste a)
-- Prerequis : migrations 10, 10b et 10c appliquees.
-- Additive : aucune donnee touchee, une seule fonction remplacee (meme signature).
-- A coller UNE FOIS dans le SQL Editor de Supabase. Tout passe ou rien ne passe.
-- ============================================================
-- Pourquoi, maintenant que l'ecran Pointage permet de corriger :
-- 1. Chevauchement : corriger une presence pour qu'elle recouvre une autre comptait les
--    memes heures deux fois. ajouter_presence le refusait deja, pas corriger_presence.
-- 2. Correction sans changement : elle passait quand meme corrigee = true, ce qui
--    bascule une presence mesuree par la borne en heures DECLAREES, sans raison.
-- 3. Arrivee dans le futur et duree au-dela de heures_avant_cloture (14 h) : refusees,
--    comme dans ajouter_presence. Au-dela, c'est une erreur de date, pas une journee.

begin;

create or replace function public.corriger_presence(
  p_presence uuid, p_debut timestamptz, p_fin timestamptz, p_motif text
) returns void language plpgsql security definer
set search_path = public, private, extensions as $fn$
declare
  v_avant public.presences%rowtype;
  v_heures int;
begin
  if not private.is_gerant() then raise exception 'non autorise'; end if;
  if p_motif is null or btrim(p_motif) = '' then
    raise exception 'motif obligatoire';
  end if;
  if p_debut is null then raise exception 'debut obligatoire'; end if;
  select * into v_avant from public.presences where id = p_presence;
  if v_avant.id is null then raise exception 'presence inconnue'; end if;
  if p_debut > now() then raise exception 'debut dans le futur'; end if;
  if p_fin is not null and p_fin <= p_debut then
    raise exception 'fin anterieure au debut';
  end if;
  if p_fin is not null and p_fin > now() then
    raise exception 'fin dans le futur';
  end if;
  if p_debut = v_avant.debut and p_fin is not distinct from v_avant.fin then
    raise exception 'aucune modification';
  end if;

  -- Plafond seulement quand la fin est connue : on doit pouvoir corriger l'arrivee
  -- d'une vieille anomalie sans fin sans buter sur l'ecart a maintenant.
  select coalesce(heures_avant_cloture, 14) into v_heures
    from public.pointage_settings where id = 1;
  if p_fin is not null
     and p_fin - p_debut > make_interval(hours => coalesce(v_heures, 14)) then
    raise exception 'presence trop longue, verifier la date';
  end if;

  -- Meme regle que ajouter_presence, la presence corrigee elle-meme exclue.
  -- La forme apres correction compte : sans fin, une presence qui reste ouverte occupe
  -- tout l'apres, une anomalie n'occupe que l'instant de son arrivee.
  if exists (
    select 1 from public.presences p
    where p.employee_id = v_avant.employee_id
      and p.id <> p_presence
      and p.debut < coalesce(p_fin,
            case when v_avant.statut = 'ouverte' then 'infinity'::timestamptz
                 else p_debut + interval '1 microsecond' end)
      and coalesce(p.fin,
            case when p.statut = 'ouverte' then 'infinity'::timestamptz
                 else p.debut + interval '1 microsecond' end) > p_debut
  ) then
    raise exception 'chevauche une presence existante, la corriger plutot';
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

commit;

-- ─── Retour arriere ─────────────────────────────────────────
-- Recoller le bloc « 8. Correction par le gerant » de supabase_migration10_phase6_pointage.sql.
