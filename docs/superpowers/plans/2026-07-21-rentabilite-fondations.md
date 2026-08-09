# Rentabilité v2 — Phase 1 : Fondations (schéma + logique) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** Poser en base le modèle recettes / sous-recettes / rendements, et implémenter en TDD la logique pure qui calcule le coût matière d'un article en remontant l'arbre des sous-recettes.

**Architecture :** Une table `recipes` (avec rendement), une refonte de `recipe_lines` (ligne = produit OU sous-recette), et deux colonnes sur `menu_items` (recette + facteur). La logique de calcul est pure (aucune dépendance UI/Supabase), récursive, avec détection de cycle et propagation de l'incomplétude. Les marges par canal existantes sont réutilisées telles quelles sur le coût matière calculé.

**Tech Stack :** Supabase (Postgres + RLS), React 19 + Vite (JS), vitest.

**Spec :** `docs/superpowers/specs/2026-07-21-rentabilite-sous-recettes-design.md`

**Règles non négociables :**
- Dépôt **public** : la migration SQL n'est **jamais committée** ; aucune vraie recette ni prix ne part sur le dépôt. Les jeux de test utilisent des données **neutres inventées**.
- `null` ≠ 0 : un prix ou un coût absent rend le résultat « incomplet », jamais 0.
- Commits en français `type(scope): message`, sans guillemets doubles dans `-m`.
- Rien n'est poussé sans l'accord de Jean-Claude.

---

## Carte des fichiers

| Fichier | Rôle | Committé ? |
|---|---|---|
| `supabase_migration5_rentabilite_recettes.sql` | Tables + colonnes + RLS | **NON** (gitignoré) |
| `src/lib/rentabilite.js` | Logique pure (étendue) | oui |
| `src/lib/rentabilite.test.js` | Tests vitest | oui |
| `.gitignore` | Protéger la migration 5 | oui (modifié) |

Jeu de test partagé (à placer en haut du fichier de test, **sous** les fixtures `produits`/`ps` déjà présentes — on les réutilise, aucune redéclaration) :

```js
// Rappel des produits déjà déclarés en tête du fichier :
//   p1 = 10 €/kg (0,01 €/g), p2 = 0,15 €/pièce, p4 = « Sans prix » (null).
const sauce = { id: 'r_sauce', nom: 'Sauce', rendement_valeur: 1,  rendement_unite: 'portion', cout_force: null };
const plat  = { id: 'r_plat',  nom: 'Plat',  rendement_valeur: 10, rendement_unite: 'piece',   cout_force: null };
const recettesById = { r_sauce: sauce, r_plat: plat };
const lignesRec = [
  { id: 'l1', recipe_id: 'r_sauce', product_id: 'p1', sous_recette_id: null, qty: 100, unit: 'g', cout_force: null },
  { id: 'l2', recipe_id: 'r_plat',  product_id: 'p2', sous_recette_id: null, qty: 2,   unit: 'piece', cout_force: null },
  { id: 'l3', recipe_id: 'r_plat',  product_id: null, sous_recette_id: 'r_sauce', qty: 0.5, unit: 'portion', cout_force: null },
];
```

Résultats attendus : Sauce = 100 g de p1 = 1,00 € → 1,00 €/portion. Plat = 2×0,15 + 0,5×1,00 = 0,80 € pour 10 pièces → 0,08 €/pièce.

---

### Task 1 : Migration SQL (locale, non committée)

**Files:**
- Create: `supabase_migration5_rentabilite_recettes.sql` (NON committé)
- Modify: `.gitignore`

- [ ] **Step 1 : Protéger le fichier dans `.gitignore`**

Ajouter à la fin de `.gitignore` :
```
# Rentabilité v2 : migration non committée (dépôt public)
supabase_migration5_rentabilite_recettes.sql
```

- [ ] **Step 2 : Écrire la migration**

```sql
-- MIGRATION 5 : recettes, sous-recettes, rendements (2026-07-21)
-- NE PAS COMMITTER (dépôt public). Exécuter UNE FOIS dans Supabase SQL Editor.
-- Prérequis : private.is_gerant() (migration RLS de juin) déjà en place.
begin;

create table if not exists public.recipes (
  id uuid primary key default uuid_generate_v4(),
  nom text not null,
  rendement_valeur numeric not null check (rendement_valeur > 0),
  rendement_unite text not null check (rendement_unite in ('piece','portion','kg','l')),
  sous_recette_seulement boolean not null default false,
  cout_force numeric null,
  categorie text null,
  created_at timestamptz default now()
);

-- recipe_lines est vierge : on repart proprement.
drop table if exists public.recipe_lines;
create table public.recipe_lines (
  id uuid primary key default uuid_generate_v4(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  product_id uuid null references public.products(id) on delete restrict,
  sous_recette_id uuid null references public.recipes(id) on delete restrict,
  qty numeric not null check (qty > 0),
  unit text not null,
  cout_force numeric null,
  created_at timestamptz default now(),
  constraint recipe_line_cible check (
    (product_id is not null and sous_recette_id is null) or
    (product_id is null and sous_recette_id is not null)
  )
);

alter table public.menu_items add column if not exists recipe_id uuid null references public.recipes(id) on delete set null;
alter table public.menu_items add column if not exists recipe_qty numeric null check (recipe_qty is null or recipe_qty > 0);

alter table public.recipes enable row level security;
drop policy if exists recipes_all on public.recipes;
create policy recipes_all on public.recipes for all to authenticated
  using (private.is_gerant()) with check (private.is_gerant());

alter table public.recipe_lines enable row level security;
drop policy if exists recipe_lines_all on public.recipe_lines;
create policy recipe_lines_all on public.recipe_lines for all to authenticated
  using (private.is_gerant()) with check (private.is_gerant());

commit;
```

- [ ] **Step 3 : Vérifier le gitignore**

Run : `git check-ignore supabase_migration5_rentabilite_recettes.sql`
Expected : le nom du fichier s'affiche (donc ignoré).

- [ ] **Step 4 : Faire exécuter par Jean-Claude dans Supabase**

Supabase → projet restoapp → SQL Editor → coller → Run. Attendu : `Success. No rows returned`.
Vérification (dans le SQL Editor) :
```sql
select table_name from information_schema.tables
where table_schema='public' and table_name in ('recipes','recipe_lines');
select column_name from information_schema.columns
where table_name='menu_items' and column_name in ('recipe_id','recipe_qty');
```
Attendu : 2 tables, 2 colonnes.

- [ ] **Step 5 : Commit du .gitignore uniquement**

```bash
git add .gitignore
git commit -m "chore(rentabilite): gitignore migration 5 (depot public)"
```

---

### Task 2 : Coût d'une recette simple (produits + rendement)

**Files:**
- Test: `src/lib/rentabilite.test.js`
- Modify: `src/lib/rentabilite.js`

- [ ] **Step 1 : Écrire les tests (échouent)**

Ajouter dans le fichier de test (avec le jeu neutre en tête) :
```js
import { grouperLignesParRecette, coutRecette } from './rentabilite.js';

describe('grouperLignesParRecette', () => {
  it('indexe les lignes par recette', () => {
    const m = grouperLignesParRecette(lignesRec);
    expect(m['r_sauce']).toHaveLength(1);
    expect(m['r_plat']).toHaveLength(2);
  });
});

describe('coutRecette : recette simple', () => {
  const lignesByRecette = grouperLignesParRecette(lignesRec);
  it('Sauce : 100 g de p1 à 0,01 €/g = 1,00 € pour 1 portion', () => {
    const r = coutRecette({ recette: sauce, recettesById, lignesByRecette, produits, productSuppliers: ps });
    expect(r.total).toBeCloseTo(1.0, 6);
    expect(r.coutParUnite).toBeCloseTo(1.0, 6);
    expect(r.incomplet).toBe(false);
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run : `npm test -- src/lib/rentabilite.test.js --run`
Expected : FAIL (`grouperLignesParRecette` / `coutRecette` non définis).

- [ ] **Step 3 : Implémenter (ajouter à la fin de `src/lib/rentabilite.js`)**

```js
// --- Recettes, sous-recettes et rendements (v2) ---

// Indexe les lignes de recette par recipe_id.
export function grouperLignesParRecette(lignes) {
  const map = {};
  for (const l of lignes || []) (map[l.recipe_id] ||= []).push(l);
  return map;
}

// Coût d'une recette (récursif). Retourne { total, coutParUnite, incomplet, raisons, force }.
export function coutRecette({ recette, recettesById, lignesByRecette, produits, productSuppliers, pile = [] }) {
  if (!recette) return { total: 0, coutParUnite: null, incomplet: true, raisons: ['recette introuvable'], force: false };
  if (pile.includes(recette.id)) return { total: 0, coutParUnite: null, incomplet: true, raisons: ['boucle détectée'], force: false };
  const rendement = Number(recette.rendement_valeur);
  if (recette.cout_force !== null && recette.cout_force !== undefined) {
    const total = Number(recette.cout_force);
    return { total, coutParUnite: rendement > 0 ? total / rendement : null,
      incomplet: !(rendement > 0), raisons: rendement > 0 ? [] : ['rendement manquant'], force: true };
  }
  let total = 0; const raisons = []; let incomplet = false;
  for (const ligne of lignesByRecette[recette.id] || []) {
    if (ligne.cout_force !== null && ligne.cout_force !== undefined) { total += Number(ligne.cout_force); continue; }
    if (ligne.product_id) {
      const produit = (produits || []).find((p) => p.id === ligne.product_id);
      if (!produit) { incomplet = true; raisons.push('produit supprimé'); continue; }
      const prix = prixParUniteRecette(produit, productSuppliers);
      if (prix === null) { incomplet = true; raisons.push(produit.name); continue; }
      total += prix * (Number(ligne.qty) || 0);
    } else if (ligne.sous_recette_id) {
      const sous = recettesById[ligne.sous_recette_id];
      const r = coutRecette({ recette: sous, recettesById, lignesByRecette, produits, productSuppliers, pile: [...pile, recette.id] });
      if (r.incomplet || r.coutParUnite === null) { incomplet = true; raisons.push(...(r.raisons.length ? r.raisons : ['sous-recette incomplète'])); }
      else total += r.coutParUnite * (Number(ligne.qty) || 0);
    }
  }
  const coutParUnite = rendement > 0 ? total / rendement : null;
  if (!(rendement > 0)) { incomplet = true; raisons.push('rendement manquant'); }
  return { total, coutParUnite, incomplet, raisons, force: false };
}
```

- [ ] **Step 4 : Vérifier le vert**

Run : `npm test -- src/lib/rentabilite.test.js --run`
Expected : PASS (nouveaux tests verts, anciens toujours verts).

- [ ] **Step 5 : Commit**

```bash
git add src/lib/rentabilite.js src/lib/rentabilite.test.js
git commit -m "feat(rentabilite): cout d'une recette simple avec rendement (TDD)"
```

---

### Task 3 : Sous-recettes récursives et fractions

**Files:**
- Test: `src/lib/rentabilite.test.js`

- [ ] **Step 1 : Écrire les tests**

```js
describe('coutRecette : sous-recette et fraction', () => {
  const lignesByRecette = grouperLignesParRecette(lignesRec);
  it('Plat = 2 pièces p2 (0,30) + 0,5 portion Sauce (0,50) = 0,80 € pour 10 pièces -> 0,08 €/pièce', () => {
    const r = coutRecette({ recette: plat, recettesById, lignesByRecette, produits, productSuppliers: ps });
    expect(r.total).toBeCloseTo(0.8, 6);
    expect(r.coutParUnite).toBeCloseTo(0.08, 6);
    expect(r.incomplet).toBe(false);
  });
  it('l\'incomplétude d\'une sous-recette remonte', () => {
    const sauceKO = { id: 'r_sko', nom: 'SauceKO', rendement_valeur: 1, rendement_unite: 'portion', cout_force: null };
    const platKO = { id: 'r_pko', nom: 'PlatKO', rendement_valeur: 1, rendement_unite: 'piece', cout_force: null };
    const rById = { ...recettesById, r_sko: sauceKO, r_pko: platKO };
    const lg = grouperLignesParRecette([
      { id: 'a', recipe_id: 'r_sko', product_id: 'p4', sous_recette_id: null, qty: 10, unit: 'g', cout_force: null }, // p4 = « Sans prix »
      { id: 'b', recipe_id: 'r_pko', product_id: null, sous_recette_id: 'r_sko', qty: 1, unit: 'portion', cout_force: null },
    ]);
    const r = coutRecette({ recette: platKO, recettesById: rById, lignesByRecette: lg, produits, productSuppliers: ps });
    expect(r.incomplet).toBe(true);
    expect(r.raisons).toContain('Sans prix');
  });
});
```

- [ ] **Step 2 : Vérifier le vert**

Run : `npm test -- src/lib/rentabilite.test.js --run`
Expected : PASS (le code de la Task 2 gère déjà la récursion et la propagation).

- [ ] **Step 3 : Commit**

```bash
git add src/lib/rentabilite.test.js
git commit -m "test(rentabilite): sous-recettes recursives et propagation de l'incomplet"
```

---

### Task 4 : Garde-fous (cycle, rendement manquant)

**Files:**
- Test: `src/lib/rentabilite.test.js`

- [ ] **Step 1 : Écrire les tests**

```js
describe('coutRecette : garde-fous', () => {
  it('boucle A->B->A -> incomplet, pas d\'infini', () => {
    const A = { id: 'A', nom: 'A', rendement_valeur: 1, rendement_unite: 'portion', cout_force: null };
    const B = { id: 'B', nom: 'B', rendement_valeur: 1, rendement_unite: 'portion', cout_force: null };
    const rById = { A, B };
    const lg = grouperLignesParRecette([
      { id: 'x', recipe_id: 'A', product_id: null, sous_recette_id: 'B', qty: 1, unit: 'portion', cout_force: null },
      { id: 'y', recipe_id: 'B', product_id: null, sous_recette_id: 'A', qty: 1, unit: 'portion', cout_force: null },
    ]);
    const r = coutRecette({ recette: A, recettesById: rById, lignesByRecette: lg, produits, productSuppliers: ps });
    expect(r.incomplet).toBe(true);
    expect(r.raisons).toContain('boucle détectée');
  });
  it('rendement 0 -> incomplet "rendement manquant"', () => {
    const sans = { id: 'z', nom: 'Z', rendement_valeur: 0, rendement_unite: 'piece', cout_force: null };
    const r = coutRecette({ recette: sans, recettesById: { z: sans }, lignesByRecette: {}, produits, productSuppliers: ps });
    expect(r.coutParUnite).toBeNull();
    expect(r.incomplet).toBe(true);
    expect(r.raisons).toContain('rendement manquant');
  });
});
```

- [ ] **Step 2 : Vérifier le vert**

Run : `npm test -- src/lib/rentabilite.test.js --run`
Expected : PASS (garde-fous déjà codés en Task 2).

- [ ] **Step 3 : Commit**

```bash
git add src/lib/rentabilite.test.js
git commit -m "test(rentabilite): garde-fous cycle et rendement manquant"
```

---

### Task 5 : Overrides (coût forcé ligne et recette)

**Files:**
- Test: `src/lib/rentabilite.test.js`

- [ ] **Step 1 : Écrire les tests**

```js
describe('coutRecette : overrides', () => {
  it('coût forcé sur une ligne écrase le calcul', () => {
    const rById = { r_sauce: sauce };
    const lg = grouperLignesParRecette([
      { id: 'f', recipe_id: 'r_sauce', product_id: 'p1', sous_recette_id: null, qty: 100, unit: 'g', cout_force: 0.09 },
    ]);
    const r = coutRecette({ recette: sauce, recettesById: rById, lignesByRecette: lg, produits, productSuppliers: ps });
    expect(r.total).toBeCloseTo(0.09, 6); // 0,09 forcé, pas 1,00 calculé
  });
  it('coût forcé sur la recette écrase tout et se répartit sur le rendement', () => {
    const forced = { id: 'g', nom: 'Forcee', rendement_valeur: 5, rendement_unite: 'piece', cout_force: 2.5 };
    const r = coutRecette({ recette: forced, recettesById: { g: forced }, lignesByRecette: {}, produits, productSuppliers: ps });
    expect(r.force).toBe(true);
    expect(r.total).toBeCloseTo(2.5, 6);
    expect(r.coutParUnite).toBeCloseTo(0.5, 6);
  });
});
```

- [ ] **Step 2 : Vérifier le vert**

Run : `npm test -- src/lib/rentabilite.test.js --run`
Expected : PASS (overrides déjà codés en Task 2).

- [ ] **Step 3 : Commit**

```bash
git add src/lib/rentabilite.test.js
git commit -m "test(rentabilite): overrides cout force ligne et recette"
```

---

### Task 6 : Coût d'un article de carte (recette × facteur)

**Files:**
- Test: `src/lib/rentabilite.test.js`
- Modify: `src/lib/rentabilite.js`

- [ ] **Step 1 : Écrire les tests**

```js
import { coutArticle } from './rentabilite.js';

describe('coutArticle', () => {
  const lignesByRecette = grouperLignesParRecette(lignesRec);
  it('article = 5 pièces de Plat (0,08 €/pièce) = 0,40 €', () => {
    const item = { id: 'm1', recipe_id: 'r_plat', recipe_qty: 5 };
    const r = coutArticle({ menuItem: item, recettesById, lignesByRecette, produits, productSuppliers: ps });
    expect(r.total).toBeCloseTo(0.4, 6);
    expect(r.incomplet).toBe(false);
  });
  it('article sans recette -> incomplet "pas de recette"', () => {
    const item = { id: 'm2', recipe_id: null, recipe_qty: null };
    const r = coutArticle({ menuItem: item, recettesById, lignesByRecette, produits, productSuppliers: ps });
    expect(r.total).toBeNull();
    expect(r.incomplet).toBe(true);
    expect(r.raisons).toContain('pas de recette');
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run : `npm test -- src/lib/rentabilite.test.js --run`
Expected : FAIL (`coutArticle` non défini).

- [ ] **Step 3 : Implémenter (ajouter à `src/lib/rentabilite.js`)**

```js
// Coût matière d'un article de carte = coût par unité de sa recette × nombre d'unités vendues.
export function coutArticle({ menuItem, recettesById, lignesByRecette, produits, productSuppliers }) {
  if (!menuItem || !menuItem.recipe_id) return { total: null, incomplet: true, raisons: ['pas de recette'] };
  const recette = recettesById[menuItem.recipe_id];
  const r = coutRecette({ recette, recettesById, lignesByRecette, produits, productSuppliers });
  if (r.coutParUnite === null) return { total: null, incomplet: true, raisons: r.raisons };
  return { total: r.coutParUnite * (Number(menuItem.recipe_qty) || 0), incomplet: r.incomplet, raisons: r.raisons };
}
```

- [ ] **Step 4 : Vérifier le vert**

Run : `npm test -- src/lib/rentabilite.test.js --run`
Expected : PASS.

- [ ] **Step 5 : Commit**

```bash
git add src/lib/rentabilite.js src/lib/rentabilite.test.js
git commit -m "feat(rentabilite): cout matiere d'un article (recette x facteur)"
```

---

### Task 7 : Suggestion de rattachement depuis le nom

**Files:**
- Test: `src/lib/rentabilite.test.js`
- Modify: `src/lib/rentabilite.js`

- [ ] **Step 1 : Écrire les tests**

```js
import { suggestionRattachement } from './rentabilite.js';

describe('suggestionRattachement', () => {
  const recs = [
    { id: 'r1', nom: 'Wings', sous_recette_seulement: false },
    { id: 'r2', nom: 'Marinade', sous_recette_seulement: true },
  ];
  it('"Wings x5" -> recette Wings, qty 5', () => {
    const s = suggestionRattachement('Wings x5', recs);
    expect(s.recette.id).toBe('r1'); expect(s.qty).toBe(5);
  });
  it('accepte le × typographique et la casse : "wings × 10"', () => {
    const s = suggestionRattachement('wings × 10', recs);
    expect(s.recette.id).toBe('r1'); expect(s.qty).toBe(10);
  });
  it('nom simple -> facteur 1', () => {
    const s = suggestionRattachement('Wings', recs);
    expect(s.recette.id).toBe('r1'); expect(s.qty).toBe(1);
  });
  it('ne propose jamais une sous-recette seulement', () => {
    expect(suggestionRattachement('Marinade', recs)).toBeNull();
  });
  it('nom inconnu -> null', () => {
    expect(suggestionRattachement('Frites', recs)).toBeNull();
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run : `npm test -- src/lib/rentabilite.test.js --run`
Expected : FAIL (`suggestionRattachement` non défini).

- [ ] **Step 3 : Implémenter (ajouter à `src/lib/rentabilite.js`)**

```js
// Depuis le nom d'un article "Nom xN", propose { recette, qty }. null si rien de sûr.
// N'a jamais recours à une recette "sous_recette_seulement".
export function suggestionRattachement(nomArticle, recettes) {
  const nom = (nomArticle || '').trim();
  const m = nom.match(/^(.*?)\s*[x×]\s*(\d+)$/i);
  const base = (m ? m[1] : nom).trim().toLowerCase();
  const qty = m ? Number(m[2]) : 1;
  const recette = (recettes || []).find(
    (r) => !r.sous_recette_seulement && (r.nom || '').trim().toLowerCase() === base
  );
  return recette ? { recette, qty } : null;
}
```

- [ ] **Step 4 : Vérifier le vert**

Run : `npm test -- src/lib/rentabilite.test.js --run`
Expected : PASS.

- [ ] **Step 5 : Commit**

```bash
git add src/lib/rentabilite.js src/lib/rentabilite.test.js
git commit -m "feat(rentabilite): suggestion de rattachement article -> recette depuis le nom"
```

---

### Task 8 : Vérification finale de la phase

- [ ] **Step 1 : Toute la suite verte**

Run : `npm test -- --run`
Expected : tous les tests passent (les 34 existants + les nouveaux).

- [ ] **Step 2 : Build**

Run : `npm run build`
Expected : build OK (les 3 erreurs eslint pré-existantes de StocksModule restent tolérées, aucune nouvelle).

- [ ] **Step 3 : Contrôle dépôt public**

Run : `git status`
Vérifier que `supabase_migration5_rentabilite_recettes.sql` **n'apparaît pas** dans les fichiers suivis.

- [ ] **Step 4 : Push (sur accord de Jean-Claude)**

```bash
git push origin main
```
Ne pousser qu'après l'accord explicite de JC. La logique pure est sûre à pousser (aucune donnée sensible, aucun rendu visuel modifié).

---

## Auto-revue effectuée

- **Couverture spec** : schéma recipes/recipe_lines/menu_items (Task 1), coût récursif + rendement (Tasks 2-3), garde-fous cycle/rendement (Task 4), overrides ligne+recette (Task 5), coût article (Task 6), pré-remplissage du rattachement (Task 7). Les marges par canal restent l'existant (rien à refaire ici). Les écrans sont hors périmètre de cette phase (phases 2 et 3).
- **Pas de placeholder** : chaque step porte son code ou sa commande.
- **Cohérence des signatures** : `coutRecette({recette, recettesById, lignesByRecette, produits, productSuppliers, pile})` renvoie toujours `{total, coutParUnite, incomplet, raisons, force}` ; `coutArticle` consomme `coutParUnite` ; `grouperLignesParRecette` produit l'objet attendu par les deux ; `suggestionRattachement` filtre `sous_recette_seulement`. Noms identiques entre tests et implémentations.
