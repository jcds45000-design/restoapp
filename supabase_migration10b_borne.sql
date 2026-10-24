-- ============================================================
-- MIGRATION 10b - Phase 6 lot 1 : liste des salaries affichee sur la borne
-- Plan : docs/superpowers/plans/2026-09-20-pointage-lot1.md (Tache 8)
-- Prerequis : migration 10 appliquee (pointage_appareils, pin_hash, pgcrypto).
-- Additive uniquement. A coller UNE FOIS dans le SQL Editor de Supabase.
-- ============================================================
-- Pourquoi : la borne ne peut pas lire la table employees. La RLS (employees_read,
-- migration 7) ne montre toutes les fiches qu'a un gerant, un manager ou un compte
-- lecture : sur un compte employe, la grille n'afficherait qu'une personne. Et une
-- tablette en libre acces connectee en gerant donnerait acces a toute l'application,
-- emails, taux horaires et empreintes des codes compris.
-- Cette fonction ne renvoie que ce que la grille affiche (id, nom, couleur), et seul
-- le jeton d'une borne enregistree l'ouvre, comme etat_pointage().

begin;

create or replace function public.salaries_borne(p_jeton text)
returns jsonb language plpgsql stable security definer
set search_path = public, private, extensions as $fn$
declare
  v_appareil uuid;
begin
  select id into v_appareil from public.pointage_appareils
    where actif and jeton_hash = crypt(p_jeton, jeton_hash) limit 1;
  if v_appareil is null then
    raise exception 'appareil non autorise';
  end if;

  -- Seuls les salaries actifs ET munis d'un code : les autres ne pourraient pas pointer,
  -- leur case ne ferait qu'encombrer la grille.
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', id, 'nom', name, 'couleur', color) order by name)
      from public.employees
      where active is not false and pin_hash is not null
  ), '[]'::jsonb);
end $fn$;
revoke all on function public.salaries_borne(text) from public;
revoke execute on function public.salaries_borne(text) from anon;
grant execute on function public.salaries_borne(text) to authenticated;

commit;

-- ============================================================
-- ROLLBACK (a garder, non execute)
-- drop function if exists public.salaries_borne(text);
-- ============================================================
