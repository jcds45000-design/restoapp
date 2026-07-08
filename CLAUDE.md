# CLAUDE.md — restoapp

Application de gestion interne du restaurant Kimiko (fast-food coréen, Orléans) : tâches, planning, équipe, stocks, finances. Utilisateur final : le gérant et ~7 salariés, **surtout sur téléphone**.

## Stack et commandes

- React 19 + Vite (JavaScript, pas de TypeScript), Supabase (auth + Postgres + RLS), déployé sur Vercel (`restoapp-khaki.vercel.app`) à chaque push sur `main`.
- `npm run dev` (port 5173) · `npm test` (vitest) · `npm run lint` · `npm run build`
- Si la prod ne change pas ~5 min après un push : le webhook Vercel a probablement raté le commit, faire un commit vide et re-pousser.

## Conventions

- **Tout en français** : UI, commentaires, messages de commit (`type(scope): message`). Pas de tirets longs.
- Styles inline avec l'objet thème `t` et la police `F` (voir `src/lib/foundation.jsx`). Pas de CSS externe.
- Produits : `id` = entier local d'affichage, `_uuid` = clé Supabase. Toujours joindre sur `_uuid`.
- **Seuil `null` = « à définir »** : ne JAMAIS coercer en 0 (`0 <= null` vaut true en JS). Toute logique d'alerte passe par `src/lib/stock.js` (`getUrgency`, `alertProductsOf`).
- Logique pure dans `src/lib/` avec tests vitest ; composants dans `src/components/` (RestoApp.jsx est le coordinateur, ne pas le faire grossir).

## Sécurité (dépôt PUBLIC)

- Ne jamais committer : secrets, identifiants, `supabase_migration3_stock.sql` (prix d'achat, gitignoré), scripts `pw_*.cjs`/`verif_*.mjs` (gitignorés).
- Identifiants de test uniquement via variables d'environnement (`RESTOAPP_EMAIL`, `RESTOAPP_PASSWORD`), jamais en dur dans un fichier.
- RLS active sur toutes les tables (voir `security/rls_hardening_2026-06-29.sql`). Écriture `products`/`suppliers` = gérant seul ; le comptage employé passe par la fonction `enregistrer_comptage` (security definer). Toute nouvelle table doit avoir ses policies.

## Vérification avant push (boucle rodée)

1. `npm test` + `npm run build` verts (3 erreurs eslint pré-existantes connues dans StocksModule : composants internes, ne pas bloquer dessus).
2. Vérification navigateur via la skill `/verif <module>` (Playwright, captures dans `.verif-<module>/`).
3. **Validation visuelle du gérant en local AVANT tout push.**
4. Push → Vercel déploie → re-vérifier en prod.

## Documentation

- `docs/EXPLOITATION.md` : doc d'exploitation pour la passation (NON committée volontairement).
- `docs/superpowers/specs/` et `docs/superpowers/plans/` : specs et plans des chantiers.
