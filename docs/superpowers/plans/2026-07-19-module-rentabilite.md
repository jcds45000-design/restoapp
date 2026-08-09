# Module Rentabilité — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** Ajouter à restoapp un module « Rentabilité » (gérant seul) : fiches recettes liées aux produits du Stock, coût matière, food cost, marges par canal de vente, prix d'équivalence et simulateur.

**Architecture :** Trois nouvelles tables Supabase (recipe_lines, menu_item_channel_prices, rentabilite_settings) protégées par `private.is_gerant()`. Logique pure dans `src/lib/rentabilite.js` (portage du calc.js validé du prototype kimiko-food-cost), UI dans `src/components/RentabiliteModule.jsx` (styles inline `t`/`F`, pattern StocksModule). La carte est importée depuis la base du site kimiko-orleans.fr par un script local non committé.

**Tech stack :** React 19 + Vite (JS, pas de TS), Supabase (RLS), vitest. Dépôt PUBLIC : la migration SQL et le script d'import ne sont JAMAIS committés.

**Spec :** `docs/superpowers/specs/2026-07-19-module-rentabilite-design.md`

**Rappels non négociables (CLAUDE.md restoapp) :**
- Aucun prix, secret ou identifiant dans un fichier committé.
- `null` ≠ 0 : un prix d'achat absent ne vaut jamais 0, il rend le coût « incomplet ».
- Validation visuelle de Jean-Claude en local AVANT tout push, y compris en 390x844.
- Commits en français `type(scope): message`, sans guillemets doubles dans `-m`.

---

## Carte des fichiers

| Fichier | Rôle | Committé ? |
|---|---|---|
| `supabase_migration4_rentabilite.sql` | Création tables + RLS | NON (gitignoré) |
| `import_carte.mjs` | Import carte du site → menu_items | NON (gitignoré) |
| `src/lib/rentabilite.js` | Logique pure (coûts, marges, équivalence) | oui |
| `src/lib/rentabilite.test.js` | Tests vitest de la logique | oui |
| `src/components/RentabiliteModule.jsx` | UI du module | oui |
| `src/RestoApp.jsx` | Onglet nav + rendu du module | oui (modifié) |
| `.gitignore` | Protéger les 2 fichiers sensibles | oui (modifié) |

---

### Task 1 : Protéger les fichiers sensibles dans .gitignore

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1 : Ajouter les motifs**

Ajouter à la fin de `.gitignore` :

```
# Module Rentabilité : jamais committés (dépôt public)
supabase_migration4_rentabilite.sql
import_carte.mjs
```

- [ ] **Step 2 : Vérifier**

Run : `git check-ignore supabase_migration4_rentabilite.sql import_carte.mjs`
Attendu : les deux noms s'affichent (donc ignorés).

- [ ] **Step 3 : Commit**

```bash
git add .gitignore
git commit -m "chore(rentabilite): gitignore migration et script d'import (depot public)"
```

---

### Task 2 : Migration SQL (locale, exécution manuelle Supabase)

**Files:**
- Create: `supabase_migration4_rentabilite.sql` (NON committé)

- [ ] **Step 1 : Écrire le fichier**

```sql
-- ============================================================
-- MIGRATION 4 : module Rentabilité (2026-07-19)
-- NE PAS COMMITTER (dépôt public). À exécuter UNE FOIS dans
-- Supabase SQL Editor. Prérequis : rls_hardening_2026-06-29.sql
-- (fonction private.is_gerant()) déjà exécuté.
-- ============================================================
begin;

-- 1. Lignes de recette d'un item du menu
create table if not exists public.recipe_lines (
  id uuid primary key default uuid_generate_v4(),
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  qty numeric not null check (qty > 0),
  unit text not null check (unit in ('g','ml','piece')),
  created_at timestamptz default now(),
  unique (menu_item_id, product_id)
);

-- 2. Prix de vente TTC par canal (absence de ligne = repli sur menu_items.price)
create table if not exists public.menu_item_channel_prices (
  id uuid primary key default uuid_generate_v4(),
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  channel text not null check (channel in ('sur_place','click_collect','uber_eats','deliveroo')),
  price_ttc numeric not null check (price_ttc >= 0),
  unique (menu_item_id, channel)
);

-- 3. Paramètres (une seule ligne)
create table if not exists public.rentabilite_settings (
  id int primary key default 1 check (id = 1),
  tva numeric not null default 10,
  seuil_food_cost numeric not null default 30,
  commissions jsonb not null default '{"sur_place":0,"click_collect":0,"uber_eats":30,"deliveroo":30}'
);
insert into public.rentabilite_settings (id) values (1) on conflict do nothing;

-- 4. RLS : gérant uniquement, lecture comme écriture (données de marge)
alter table public.recipe_lines enable row level security;
create policy recipe_lines_all on public.recipe_lines
  for all to authenticated
  using ( private.is_gerant() ) with check ( private.is_gerant() );

alter table public.menu_item_channel_prices enable row level security;
create policy micp_all on public.menu_item_channel_prices
  for all to authenticated
  using ( private.is_gerant() ) with check ( private.is_gerant() );

alter table public.rentabilite_settings enable row level security;
create policy rentabilite_settings_all on public.rentabilite_settings
  for all to authenticated
  using ( private.is_gerant() ) with check ( private.is_gerant() );

-- 5. menu_items : s'assurer que la RLS est active avec lecture gérant.
--    (Table du schéma initial, absente du hardening de juin.)
alter table public.menu_items enable row level security;
drop policy if exists menu_items_read on public.menu_items;
create policy menu_items_read on public.menu_items
  for select to authenticated using ( private.is_gerant() );
drop policy if exists menu_items_write on public.menu_items;
create policy menu_items_write on public.menu_items
  for all to authenticated
  using ( private.is_gerant() ) with check ( private.is_gerant() );

commit;
```

- [ ] **Step 2 : Faire exécuter par Jean-Claude dans Supabase**

Supabase Dashboard → projet restoapp → SQL Editor → coller → Run.
Attendu : `Success. No rows returned`.

- [ ] **Step 3 : Vérifier les tables**

Dans le SQL Editor :

```sql
select table_name from information_schema.tables
where table_schema = 'public'
  and table_name in ('recipe_lines','menu_item_channel_prices','rentabilite_settings');
select * from public.rentabilite_settings;
```

Attendu : 3 tables listées, 1 ligne de settings (tva 10, seuil 30).

Pas de commit (fichier gitignoré, vérifier avec `git status` qu'il n'apparaît pas).

---

### Task 3 : Logique pure `rentabilite.js` (TDD)

**Files:**
- Test: `src/lib/rentabilite.test.js`
- Create: `src/lib/rentabilite.js`

- [ ] **Step 1 : Écrire les tests (ils doivent échouer)**

```js
import { describe, it, expect } from 'vitest';
import {
  CANAUX, SETTINGS_DEFAUT, uniteRecettePour, prixParUniteRecette,
  coutMatiere, ttcVersHT, prixCanal, rentabiliteCanal,
  prixEquivalence, prixConseille, arrondi10ctsSup,
  couleurFoodCost, couleurMarge,
} from './rentabilite.js';

const produits = [
  { id: 'p1', name: 'Filet de poulet', unit: 'kg' },
  { id: 'p2', name: 'Barquette', unit: 'pièce' },
  { id: 'p3', name: 'Sauce soja', unit: 'L' },
  { id: 'p4', name: 'Sans prix', unit: 'kg' },
];
const ps = [
  { product_id: 'p1', supplier_id: 's1', price_ht: 10, is_primary: true },
  { product_id: 'p1', supplier_id: 's2', price_ht: 99, is_primary: false },
  { product_id: 'p2', supplier_id: 's1', price_ht: 0.15, is_primary: true },
  { product_id: 'p3', supplier_id: 's1', price_ht: 4, is_primary: true },
  { product_id: 'p4', supplier_id: 's1', price_ht: null, is_primary: true },
];

describe('prixParUniteRecette', () => {
  it('convertit kg en €/g (10 €/kg = 0,01 €/g)', () => {
    expect(prixParUniteRecette(produits[0], ps)).toBeCloseTo(0.01, 6);
  });
  it('pièce reste en €/pièce', () => {
    expect(prixParUniteRecette(produits[1], ps)).toBeCloseTo(0.15, 6);
  });
  it('L devient €/ml', () => {
    expect(prixParUniteRecette(produits[2], ps)).toBeCloseTo(0.004, 6);
  });
  it('prix null → null, jamais 0', () => {
    expect(prixParUniteRecette(produits[3], ps)).toBeNull();
  });
  it('ignore le fournisseur non principal', () => {
    expect(prixParUniteRecette(produits[0], ps)).not.toBeCloseTo(0.099, 3);
  });
});

describe('uniteRecettePour', () => {
  it.each([['kg','g'],['L','ml'],['pièce','piece'],['piece','piece'],['boîte','piece']])(
    '%s → %s', (achat, recette) => expect(uniteRecettePour(achat)).toBe(recette));
});

describe('coutMatiere', () => {
  const lignes = [
    { product_id: 'p1', qty: 100, unit: 'g' },     // 1,00 €
    { product_id: 'p2', qty: 1, unit: 'piece' },   // 0,15 €
  ];
  it('additionne les lignes (le piège du ×1000)', () => {
    const r = coutMatiere(lignes, produits, ps);
    expect(r.total).toBeCloseTo(1.15, 6);
    expect(r.lignesSansPrix).toEqual([]);
  });
  it('signale les produits sans prix au lieu de compter 0', () => {
    const r = coutMatiere([...lignes, { product_id: 'p4', qty: 50, unit: 'g' }], produits, ps);
    expect(r.total).toBeCloseTo(1.15, 6);
    expect(r.lignesSansPrix).toEqual(['Sans prix']);
  });
  it('signale un produit introuvable', () => {
    const r = coutMatiere([{ product_id: 'zombie', qty: 1, unit: 'g' }], produits, ps);
    expect(r.lignesSansPrix).toEqual(['produit supprimé']);
  });
});

describe('prix et marges par canal', () => {
  const item = { id: 'm1', price: 7 };
  const cp = [{ menu_item_id: 'm1', channel: 'uber_eats', price_ttc: 10 }];
  const settings = SETTINGS_DEFAUT;
  it('prixCanal : canal défini → son prix', () => {
    expect(prixCanal(item, cp, 'uber_eats')).toBe(10);
  });
  it('prixCanal : canal absent → repli sur menu_items.price', () => {
    expect(prixCanal(item, cp, 'deliveroo')).toBe(7);
  });
  it('rentabiliteCanal : cas vérifié du prototype (7,50 € TTC, 30 %, TVA 10 %)', () => {
    const r = rentabiliteCanal({ item: { id: 'm1', price: 7.5 }, channelPrices: [], cout: 0.69, settings, canalId: 'uber_eats' });
    expect(r.prixEncaisseTTC).toBeCloseTo(5.25, 2);
    expect(r.prixEncaisseHT).toBeCloseTo(4.77, 2);
    expect(r.margeNette).toBeCloseTo(4.08, 2);
    expect(r.margeNettePct).toBeCloseTo(85.5, 1);
  });
  it('équivalence : 7,00 € sur place à 30 % → 10,00 € TTC', () => {
    expect(prixEquivalence(7, 30)).toBeCloseTo(10.0, 2);
  });
  it('équivalence arrondie aux 10 cts supérieurs (8,50 € → 12,20 €)', () => {
    expect(prixEquivalence(8.5, 30)).toBeCloseTo(12.2, 2);
  });
});

describe('prixConseille', () => {
  it('cas vérifié du prototype : coût 0,69, marge 85 %, Uber 30 %, TVA 10 %', () => {
    // brut 7,2286 → arrondi 10 cts sup = 7,30
    expect(prixConseille(0.69, 85, 30, 10)).toBeCloseTo(7.3, 2);
  });
  it('marge ≥ 100 % → null', () => {
    expect(prixConseille(1, 100, 0, 10)).toBeNull();
  });
  it('commission ≥ 100 % → null', () => {
    expect(prixConseille(1, 50, 100, 10)).toBeNull();
  });
});

describe('arrondi10ctsSup', () => {
  it.each([[7.2286, 7.3], [10.0, 10.0], [12.14, 12.2]])('%f → %f',
    (input, out) => expect(arrondi10ctsSup(input)).toBeCloseTo(out, 6));
});

describe('couleurs', () => {
  it('food cost sous le seuil = success, seuil+10 = warning, au-delà = danger', () => {
    expect(couleurFoodCost(25, 30)).toBe('success');
    expect(couleurFoodCost(35, 30)).toBe('warning');
    expect(couleurFoodCost(45, 30)).toBe('danger');
  });
  it('marge > 65 success, 50-65 warning, < 50 danger', () => {
    expect(couleurMarge(70)).toBe('success');
    expect(couleurMarge(55)).toBe('warning');
    expect(couleurMarge(40)).toBe('danger');
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run : `npm test -- src/lib/rentabilite.test.js`
Attendu : FAIL, module `./rentabilite.js` introuvable.

- [ ] **Step 3 : Implémenter `src/lib/rentabilite.js`**

```js
// Logique pure du module Rentabilité. Aucune dépendance UI ni Supabase.
// Conventions restoapp : un prix d'achat null n'est JAMAIS coercé en 0 ;
// il rend le coût « incomplet » (lignesSansPrix) pour affichage d'une alerte.

export const CANAUX = [
  { id: 'sur_place', nom: 'Sur place' },
  { id: 'click_collect', nom: 'Click & Collect' },
  { id: 'uber_eats', nom: 'Uber Eats' },
  { id: 'deliveroo', nom: 'Deliveroo' },
];

export const SETTINGS_DEFAUT = {
  tva: 10,
  seuil_food_cost: 30,
  commissions: { sur_place: 0, click_collect: 0, uber_eats: 30, deliveroo: 30 },
};

// Unité de saisie en recette selon l'unité d'achat du produit.
export function uniteRecettePour(uniteAchat) {
  const u = (uniteAchat || '').toLowerCase();
  if (u === 'kg') return 'g';
  if (u === 'l') return 'ml';
  return 'piece'; // pièce, piece, boîte, boite…
}

// facteur unité d'achat → unité recette (1 kg = 1000 g)
function facteurRecette(uniteAchat) {
  const u = (uniteAchat || '').toLowerCase();
  return (u === 'kg' || u === 'l') ? 1000 : 1;
}

// Prix d'achat du fournisseur principal, par unité recette (€/g, €/ml, €/pièce).
// null si aucun fournisseur principal ou prix non renseigné.
export function prixParUniteRecette(product, productSuppliers) {
  if (!product) return null;
  const primary = (productSuppliers || []).find(
    (l) => l.product_id === product.id && l.is_primary
  );
  if (!primary || primary.price_ht === null || primary.price_ht === undefined) return null;
  return Number(primary.price_ht) / facteurRecette(product.unit);
}

// Coût matière d'une recette. Retourne { total, lignesSansPrix }.
export function coutMatiere(lines, products, productSuppliers) {
  let total = 0;
  const lignesSansPrix = [];
  for (const ligne of lines || []) {
    const produit = (products || []).find((p) => p.id === ligne.product_id);
    if (!produit) { lignesSansPrix.push('produit supprimé'); continue; }
    const prix = prixParUniteRecette(produit, productSuppliers);
    if (prix === null) { lignesSansPrix.push(produit.name); continue; }
    total += prix * (Number(ligne.qty) || 0);
  }
  return { total, lignesSansPrix };
}

export function ttcVersHT(ttc, tva) {
  return ttc / (1 + (Number(tva) || 0) / 100);
}

// Prix TTC d'un item pour un canal : ligne dédiée sinon repli sur menu_items.price.
export function prixCanal(item, channelPrices, canalId) {
  const ligne = (channelPrices || []).find(
    (c) => c.menu_item_id === item.id && c.channel === canalId
  );
  if (ligne && ligne.price_ttc !== null && ligne.price_ttc !== undefined) {
    return Number(ligne.price_ttc);
  }
  return Number(item.price) || 0;
}

// Rentabilité d'un item sur un canal. cout = coût matière (number).
export function rentabiliteCanal({ item, channelPrices, cout, settings, canalId }) {
  const s = settings || SETTINGS_DEFAUT;
  const commission = Number(s.commissions?.[canalId]) || 0;
  const prixTTC = prixCanal(item, channelPrices, canalId);
  const prixEncaisseTTC = prixTTC * (1 - commission / 100);
  const prixEncaisseHT = ttcVersHT(prixEncaisseTTC, s.tva);
  const margeNette = prixEncaisseHT - cout;
  const margeNettePct = prixEncaisseHT > 0 ? (margeNette / prixEncaisseHT) * 100 : 0;
  return { canalId, commission, prixTTC, prixEncaisseTTC, prixEncaisseHT, margeNette, margeNettePct };
}

export function arrondi10ctsSup(x) {
  return Math.ceil((x - 1e-9) * 10) / 10;
}

// Prix TTC à afficher sur un canal à commission pour encaisser autant que le
// prix sur place donné. Arrondi aux 10 centimes supérieurs.
export function prixEquivalence(prixSurPlaceTTC, commissionPct) {
  const c = Number(commissionPct) || 0;
  if (c >= 100) return null;
  return arrondi10ctsSup(Number(prixSurPlaceTTC) / (1 - c / 100));
}

// Prix TTC conseillé pour atteindre une marge nette cible sur un canal.
export function prixConseille(cout, margeCiblePct, commissionPct, tva) {
  const t = Number(margeCiblePct) || 0;
  const c = Number(commissionPct) || 0;
  if (t >= 100 || c >= 100) return null;
  const prixNetHT = Number(cout) / (1 - t / 100);
  const prixTTC = (prixNetHT * (1 + (Number(tva) || 0) / 100)) / (1 - c / 100);
  return arrondi10ctsSup(prixTTC);
}

// Seuils de couleur identiques au prototype validé.
export function couleurFoodCost(pct, seuil) {
  if (pct <= seuil) return 'success';
  if (pct <= seuil + 10) return 'warning';
  return 'danger';
}
export function couleurMarge(pct) {
  if (pct > 65) return 'success';
  if (pct >= 50) return 'warning';
  return 'danger';
}
```

- [ ] **Step 4 : Vérifier le vert**

Run : `npm test -- src/lib/rentabilite.test.js`
Attendu : PASS, tous les tests verts.

- [ ] **Step 5 : Commit**

```bash
git add src/lib/rentabilite.js src/lib/rentabilite.test.js
git commit -m "feat(rentabilite): logique pure couts, marges par canal, equivalence (TDD)"
```

---

### Task 4 : Script d'import de la carte (local, non committé)

**Files:**
- Create: `import_carte.mjs` (NON committé)

- [ ] **Step 1 : Écrire le script**

```js
// import_carte.mjs — recopie la carte du site kimiko-orleans.fr vers
// restoapp.menu_items (upsert par nom). NE PAS COMMITTER (dépôt public).
// Usage (PowerShell) :
//   $env:RESTOAPP_EMAIL='...'; $env:RESTOAPP_PASSWORD='...'; node import_carte.mjs
// Les identifiants sont ceux d'un compte gérant restoapp (RLS menu_items).
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

function envDe(fichier, cle) {
  const ligne = readFileSync(fichier, 'utf8').split('\n').find((l) => l.startsWith(cle + '='));
  if (!ligne) throw new Error(`${cle} introuvable dans ${fichier}`);
  return ligne.slice(cle.length + 1).trim();
}

// Site (lecture publique du menu)
const SITE = 'C:/Users/LENOVO P15S/Documents/Projets/kimiko-site-next/.env.local';
const site = createClient(
  envDe(SITE, 'NEXT_PUBLIC_SUPABASE_URL'),
  envDe(SITE, 'NEXT_PUBLIC_SUPABASE_ANON_KEY')
);

// restoapp (écriture gérant authentifié)
const resto = createClient(
  envDe('.env', 'VITE_SUPABASE_URL'),
  envDe('.env', 'VITE_SUPABASE_ANON_KEY')
);
const { error: authErr } = await resto.auth.signInWithPassword({
  email: process.env.RESTOAPP_EMAIL,
  password: process.env.RESTOAPP_PASSWORD,
});
if (authErr) { console.error('Connexion restoapp échouée :', authErr.message); process.exit(1); }

const { data: cats, error: e1 } = await site.from('menu_categories').select('id,label');
if (e1) { console.error(e1.message); process.exit(1); }
const { data: items, error: e2 } = await site
  .from('menu_items').select('name,price,category_id,is_published');
if (e2) { console.error(e2.message); process.exit(1); }

const labelDe = Object.fromEntries(cats.map((c) => [c.id, c.label]));
const publies = items.filter((i) => i.is_published !== false);

// Détection de doublons (même nom, insensible à la casse) : signalés, 1er gardé
const vus = new Map();
const doublons = [];
for (const it of publies) {
  const cle = it.name.trim().toLowerCase();
  if (vus.has(cle)) doublons.push(it.name);
  else vus.set(cle, it);
}
if (doublons.length) console.log('DOUBLONS carte du site (à nettoyer dans l\'admin) :', doublons);

const sansPrix = [...vus.values()].filter((i) => i.price === null || i.price === undefined);
if (sansPrix.length) console.log('SANS PRIX (importés à 0, à corriger) :', sansPrix.map((i) => i.name));

let ok = 0;
for (const it of vus.values()) {
  const ligne = {
    name: it.name.trim(),
    category: labelDe[it.category_id] || 'Autre',
    price: Number(it.price) || 0,
    available: true,
  };
  const { data: existant } = await resto.from('menu_items').select('id').eq('name', ligne.name).maybeSingle();
  const { error } = existant
    ? await resto.from('menu_items').update(ligne).eq('id', existant.id)
    : await resto.from('menu_items').insert(ligne);
  if (error) { console.error(`Échec ${ligne.name} :`, error.message); process.exit(1); }
  ok++;
}
console.log(`Import terminé : ${ok} items (carte du site → restoapp.menu_items).`);
const { count } = await resto.from('menu_items').select('*', { count: 'exact', head: true });
console.log(`Total en base restoapp : ${count} items.`);
```

- [ ] **Step 2 : Exécuter (Jean-Claude fournit les identifiants en variables d'environnement)**

PowerShell :
```powershell
$env:RESTOAPP_EMAIL='<email gerant>'; $env:RESTOAPP_PASSWORD='<mdp>'; node import_carte.mjs
```

Attendu : liste des doublons signalés (« Matcha fraise »…), items sans prix
signalés, puis `Import terminé : ~76 items` et le total en base.

- [ ] **Step 3 : Vérifier en base (preuve)**

Supabase SQL Editor :
```sql
select category, count(*) from public.menu_items group by category order by 2 desc;
```
Attendu : ~13 catégories, ~76 lignes au total. Pas de commit (script gitignoré).

---

### Task 5 : UI `RentabiliteModule.jsx` + intégration navigation

**Files:**
- Create: `src/components/RentabiliteModule.jsx`
- Modify: `src/RestoApp.jsx` (3 endroits : lazy import ligne ~8, navItems gérant ligne ~403, rendu des sections vers ligne ~576)

- [ ] **Step 1 : Créer le composant**

Écrire `src/components/RentabiliteModule.jsx`. Structure imposée (styles inline
`t`/`F` comme StocksModule, mobile d'abord) :

```jsx
import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { F } from '../lib/foundation.jsx';
import {
  CANAUX, SETTINGS_DEFAUT, uniteRecettePour, coutMatiere, ttcVersHT,
  prixCanal, rentabiliteCanal, prixEquivalence, prixConseille,
  couleurFoodCost, couleurMarge,
} from '../lib/rentabilite.js';

const eur = (n) => `${(Number(n) || 0).toFixed(2)} €`;
const pct = (n) => `${(Number(n) || 0).toFixed(1)} %`;

export default function RentabiliteModule({ t, products, productSuppliers }) {
  const [menuItems, setMenuItems] = useState([]);
  const [recipeLines, setRecipeLines] = useState([]);
  const [channelPrices, setChannelPrices] = useState([]);
  const [settings, setSettings] = useState(SETTINGS_DEFAUT);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [itemOuvert, setItemOuvert] = useState(null); // id d'item ou null
  const [recherche, setRecherche] = useState('');
  const [margeCible, setMargeCible] = useState(70);
  const [canalCible, setCanalCible] = useState('uber_eats');

  useEffect(() => {
    (async () => {
      const [mi, rl, cp, st] = await Promise.all([
        supabase.from('menu_items').select('*').order('category').order('name'),
        supabase.from('recipe_lines').select('*'),
        supabase.from('menu_item_channel_prices').select('*'),
        supabase.from('rentabilite_settings').select('*').eq('id', 1).maybeSingle(),
      ]);
      const err = mi.error || rl.error || cp.error || st.error;
      if (err) { setErreur(err.message); setChargement(false); return; }
      setMenuItems(mi.data || []);
      setRecipeLines(rl.data || []);
      setChannelPrices(cp.data || []);
      if (st.data) setSettings({ ...SETTINGS_DEFAUT, ...st.data });
      setChargement(false);
    })();
  }, []);

  const lignesDe = (itemId) => recipeLines.filter((l) => l.menu_item_id === itemId);
  const resume = (item) => {
    const { total, lignesSansPrix } = coutMatiere(lignesDe(item.id), products, productSuppliers);
    const prixTTC = prixCanal(item, channelPrices, 'sur_place');
    const prixHT = ttcVersHT(prixTTC, settings.tva);
    const foodCost = prixHT > 0 ? (total / prixHT) * 100 : 0;
    const marge = prixHT - total;
    const margePct = prixHT > 0 ? (marge / prixHT) * 100 : 0;
    return { cout: total, lignesSansPrix, prixTTC, prixHT, foodCost, marge, margePct, sansRecette: lignesDe(item.id).length === 0 };
  };

  // --- actions Supabase (chacune : requête, puis mise à jour de l'état local) ---
  const ajouterLigne = async (itemId, productId) => {
    const produit = products.find((p) => p.id === productId);
    if (!produit) return;
    const ligne = { menu_item_id: itemId, product_id: productId, qty: 1, unit: uniteRecettePour(produit.unit) };
    const { data, error } = await supabase.from('recipe_lines').insert(ligne).select().single();
    if (error) { setErreur(error.message); return; }
    setRecipeLines((prev) => [...prev, data]);
  };
  const majQte = async (ligneId, qty) => {
    const q = Number(qty);
    if (!(q > 0)) return;
    const { error } = await supabase.from('recipe_lines').update({ qty: q }).eq('id', ligneId);
    if (error) { setErreur(error.message); return; }
    setRecipeLines((prev) => prev.map((l) => (l.id === ligneId ? { ...l, qty: q } : l)));
  };
  const retirerLigne = async (ligneId) => {
    const { error } = await supabase.from('recipe_lines').delete().eq('id', ligneId);
    if (error) { setErreur(error.message); return; }
    setRecipeLines((prev) => prev.filter((l) => l.id !== ligneId));
  };
  const majPrixCanal = async (itemId, canalId, valeur) => {
    const prix = Number(valeur);
    const existante = channelPrices.find((c) => c.menu_item_id === itemId && c.channel === canalId);
    if (valeur === '' || Number.isNaN(prix)) {
      if (existante) {
        const { error } = await supabase.from('menu_item_channel_prices').delete().eq('id', existante.id);
        if (error) { setErreur(error.message); return; }
        setChannelPrices((prev) => prev.filter((c) => c.id !== existante.id));
      }
      return;
    }
    if (existante) {
      const { error } = await supabase.from('menu_item_channel_prices').update({ price_ttc: prix }).eq('id', existante.id);
      if (error) { setErreur(error.message); return; }
      setChannelPrices((prev) => prev.map((c) => (c.id === existante.id ? { ...c, price_ttc: prix } : c)));
    } else {
      const { data, error } = await supabase.from('menu_item_channel_prices')
        .insert({ menu_item_id: itemId, channel: canalId, price_ttc: prix }).select().single();
      if (error) { setErreur(error.message); return; }
      setChannelPrices((prev) => [...prev, data]);
    }
  };
  const majSettings = async (champ, valeur) => {
    const maj = { ...settings, [champ]: valeur };
    setSettings(maj);
    const { error } = await supabase.from('rentabilite_settings')
      .update({ tva: maj.tva, seuil_food_cost: maj.seuil_food_cost, commissions: maj.commissions })
      .eq('id', 1);
    if (error) setErreur(error.message);
  };

  const coul = (nom) => ({ success: t.success, warning: t.warning, danger: t.danger }[nom] || t.textMuted);

  if (chargement) return <div style={{ padding: 24, color: t.textMuted, fontFamily: F }}>Chargement…</div>;
  if (erreur) return <div style={{ padding: 24, color: t.danger, fontFamily: F }}>Erreur : {erreur}</div>;

  // ---------- Vue liste (tableau de bord du module) ----------
  if (!itemOuvert) {
    const visibles = menuItems.filter((m) => m.name.toLowerCase().includes(recherche.toLowerCase()));
    return (
      <div style={{ fontFamily: F }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 14 }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0, flex: 1 }}>Rentabilité par produit</h2>
          <input value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Rechercher…"
            style={{ padding: '8px 12px', borderRadius: 8, border: `1px solid ${t.border}`, fontFamily: F, fontSize: 13 }} />
        </div>

        {/* Paramètres */}
        <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: 14, marginBottom: 14, display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center' }}>
          <label style={{ fontSize: 13 }}>TVA %
            <input type="number" value={settings.tva} onChange={(e) => majSettings('tva', Number(e.target.value))}
              style={{ width: 60, marginLeft: 6, padding: 6, borderRadius: 6, border: `1px solid ${t.border}` }} /></label>
          <label style={{ fontSize: 13 }}>Seuil food cost %
            <input type="number" value={settings.seuil_food_cost} onChange={(e) => majSettings('seuil_food_cost', Number(e.target.value))}
              style={{ width: 60, marginLeft: 6, padding: 6, borderRadius: 6, border: `1px solid ${t.border}` }} /></label>
          {CANAUX.filter((c) => c.id !== 'sur_place').map((c) => (
            <label key={c.id} style={{ fontSize: 13 }}>{c.nom} %
              <input type="number" value={settings.commissions[c.id] ?? 0}
                onChange={(e) => majSettings('commissions', { ...settings.commissions, [c.id]: Number(e.target.value) })}
                style={{ width: 55, marginLeft: 6, padding: 6, borderRadius: 6, border: `1px solid ${t.border}` }} /></label>
          ))}
        </div>

        {/* Liste des items : cartes empilées (lisible en 390px) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {visibles.map((item) => {
            const r = resume(item);
            return (
              <button key={item.id} onClick={() => setItemOuvert(item.id)}
                style={{ textAlign: 'left', cursor: 'pointer', background: t.surface, border: `1px solid ${t.border}`, borderRadius: 12, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, fontFamily: F }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{item.name}</div>
                  <div style={{ fontSize: 12, color: t.textMuted }}>{item.category} · {eur(item.price)} sur place</div>
                </div>
                {r.sansRecette ? (
                  <span style={{ fontSize: 12, color: t.textMuted }}>recette à compléter</span>
                ) : (
                  <>
                    {r.lignesSansPrix.length > 0 && <span title={`Prix d'achat manquant : ${r.lignesSansPrix.join(', ')}`} style={{ fontSize: 12, color: t.warning, fontWeight: 700 }}>coût incomplet</span>}
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{eur(r.cout)}</div>
                      <div style={{ fontSize: 12, color: coul(couleurFoodCost(r.foodCost, settings.seuil_food_cost)), fontWeight: 700 }}>{pct(r.foodCost)} FC</div>
                    </div>
                    <div style={{ textAlign: 'right', minWidth: 66 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: coul(couleurMarge(r.margePct)) }}>{eur(r.marge)}</div>
                      <div style={{ fontSize: 12, color: t.textMuted }}>{pct(r.margePct)}</div>
                    </div>
                  </>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ---------- Vue fiche recette ----------
  const item = menuItems.find((m) => m.id === itemOuvert);
  const lignes = lignesDe(item.id);
  const r = resume(item);
  const dejaDedans = new Set(lignes.map((l) => l.product_id));
  const choixProduits = products.filter((p) => p.active !== false && !dejaDedans.has(p.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  const commissionCible = Number(settings.commissions[canalCible]) || 0;
  const conseil = prixConseille(r.cout, margeCible, commissionCible, settings.tva);

  return (
    <div style={{ fontFamily: F }}>
      <button onClick={() => setItemOuvert(null)} style={{ background: 'none', border: 'none', color: t.primary, fontWeight: 700, cursor: 'pointer', fontFamily: F, padding: 0, marginBottom: 10 }}>← Retour à la liste</button>
      <h2 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 2px' }}>{item.name}</h2>
      <div style={{ fontSize: 13, color: t.textMuted, marginBottom: 14 }}>{item.category} · prix sur place {eur(item.price)}</div>

      {/* Recette */}
      <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: 14, marginBottom: 14 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 10px' }}>Recette</h3>
        {lignes.length === 0 && <div style={{ fontSize: 13, color: t.textMuted, marginBottom: 8 }}>Aucun ingrédient. Ajoute les ingrédients et emballages depuis le Stock.</div>}
        {lignes.map((l) => {
          const p = products.find((x) => x.id === l.product_id);
          return (
            <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: `1px solid ${t.border}` }}>
              <div style={{ flex: 1, fontSize: 14 }}>{p ? p.name : 'produit supprimé'}</div>
              <input type="number" min="0.01" step="any" defaultValue={l.qty}
                onBlur={(e) => majQte(l.id, e.target.value)}
                style={{ width: 80, padding: 6, borderRadius: 6, border: `1px solid ${t.border}`, textAlign: 'right' }} />
              <span style={{ fontSize: 12, color: t.textMuted, width: 34 }}>{l.unit === 'piece' ? 'pce' : l.unit}</span>
              <button onClick={() => retirerLigne(l.id)} title="Retirer"
                style={{ border: 'none', background: 'none', color: t.danger, cursor: 'pointer', fontSize: 16 }}>✕</button>
            </div>
          );
        })}
        <select value="" onChange={(e) => e.target.value && ajouterLigne(item.id, e.target.value)}
          style={{ marginTop: 10, padding: 8, borderRadius: 8, border: `1px solid ${t.border}`, fontFamily: F, maxWidth: '100%' }}>
          <option value="">+ Ajouter un ingrédient ou un emballage…</option>
          {choixProduits.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>)}
        </select>
        <div style={{ marginTop: 12, fontWeight: 800, fontSize: 15 }}>
          Coût matière : {eur(r.cout)}
          {r.lignesSansPrix.length > 0 && <span style={{ color: t.warning, fontSize: 12, fontWeight: 700, marginLeft: 8 }}>incomplet ({r.lignesSansPrix.join(', ')} sans prix d'achat)</span>}
        </div>
      </div>

      {/* Prix par canal + rentabilité */}
      <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: 14, marginBottom: 14, overflowX: 'auto' }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 10px' }}>Rentabilité par canal</h3>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 560, fontSize: 13 }}>
          <thead><tr style={{ color: t.textMuted, textAlign: 'right' }}>
            <th style={{ textAlign: 'left', padding: 6 }}>Canal</th><th>Prix TTC</th><th>Commission</th><th>Encaissé HT</th><th>Écart vs place</th><th>Marge nette</th><th>Marge %</th>
          </tr></thead>
          <tbody>
            {CANAUX.map((c) => {
              const rc = rentabiliteCanal({ item, channelPrices, cout: r.cout, settings, canalId: c.id });
              const surPlace = rentabiliteCanal({ item, channelPrices, cout: r.cout, settings, canalId: 'sur_place' });
              const ecart = rc.prixEncaisseHT - surPlace.prixEncaisseHT;
              const equiv = c.id === 'sur_place' ? null : prixEquivalence(prixCanal(item, channelPrices, 'sur_place'), rc.commission);
              const prixSaisi = channelPrices.find((x) => x.menu_item_id === item.id && x.channel === c.id);
              return (
                <tr key={c.id} style={{ borderTop: `1px solid ${t.border}`, textAlign: 'right' }}>
                  <td style={{ textAlign: 'left', padding: 6, fontWeight: 600 }}>{c.nom}</td>
                  <td style={{ padding: 6 }}>
                    {c.id === 'sur_place' ? eur(item.price) : (
                      <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                        <input type="number" step="0.1" min="0" placeholder={eur(prixCanal(item, channelPrices, c.id))}
                          defaultValue={prixSaisi ? prixSaisi.price_ttc : ''}
                          onBlur={(e) => majPrixCanal(item.id, c.id, e.target.value)}
                          style={{ width: 76, padding: 5, borderRadius: 6, border: `1px solid ${t.border}`, textAlign: 'right' }} />
                        {rc.commission > 0 && equiv !== null && (
                          <button onClick={() => majPrixCanal(item.id, c.id, String(equiv))}
                            style={{ border: 'none', background: 'none', color: t.primary, cursor: 'pointer', fontSize: 11, padding: 0, fontFamily: F }}>
                            équiv. {eur(equiv)} — appliquer</button>
                        )}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: 6 }}>{pct(rc.commission)}</td>
                  <td style={{ padding: 6 }}>{eur(rc.prixEncaisseHT)}</td>
                  <td style={{ padding: 6, color: ecart < -0.005 ? t.danger : t.textMuted, fontWeight: ecart < -0.005 ? 700 : 400 }}>
                    {c.id === 'sur_place' ? '—' : eur(ecart)}</td>
                  <td style={{ padding: 6, fontWeight: 700 }}>{eur(rc.margeNette)}</td>
                  <td style={{ padding: 6, fontWeight: 700, color: coul(couleurMarge(rc.margeNettePct)) }}>{pct(rc.margeNettePct)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Simulateur */}
      <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: 14 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 10px' }}>Simulateur de prix conseillé</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center' }}>
          <label style={{ fontSize: 13 }}>Marge nette cible : <b>{margeCible} %</b><br />
            <input type="range" min="30" max="90" value={margeCible} onChange={(e) => setMargeCible(Number(e.target.value))} style={{ width: 180 }} /></label>
          <label style={{ fontSize: 13 }}>Canal<br />
            <select value={canalCible} onChange={(e) => setCanalCible(e.target.value)}
              style={{ padding: 6, borderRadius: 6, border: `1px solid ${t.border}`, fontFamily: F }}>
              {CANAUX.map((c) => <option key={c.id} value={c.id}>{c.nom} · {settings.commissions[c.id] ?? 0} %</option>)}
            </select></label>
          <div style={{ background: t.primary + '14', borderRadius: 10, padding: '10px 16px' }}>
            <div style={{ fontSize: 12, color: t.textMuted }}>Prix TTC conseillé</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: t.primary }}>{conseil === null ? '—' : eur(conseil)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2 : Brancher dans `src/RestoApp.jsx`**

Trois modifications exactes :

1. Après la ligne 8 (`const StocksModule = lazy(...)`) ajouter :
```js
const RentabiliteModule = lazy(() => import('./components/RentabiliteModule'));
```
2. Dans le tableau `navItems` du gérant (ligne ~403), après l'entrée `stocks`, ajouter :
```js
    { id: "rentabilite", label: "Rentabilité", icon: I.euro },
```
(NE PAS l'ajouter au tableau employé ni aux onglets mobiles employé ; pour la
barre mobile gérant, l'entrée est accessible via « Plus ».)
3. Dans le rendu des sections (après le bloc `{/* STOCKS */}` vers la ligne 576) ajouter :
```jsx
        {/* RENTABILITÉ (gérant seul) */}
        {effectiveSection === "rentabilite" && isGerant && (
          <Suspense fallback={<Loading />}><RentabiliteModule t={t}
  products={products} productSuppliers={productSuppliers} /></Suspense>
        )}
```

- [ ] **Step 3 : Tests et build**

Run : `npm test` puis `npm run build`
Attendu : tests verts (dont rentabilite.test.js), build sans nouvelle erreur
(3 erreurs eslint pré-existantes StocksModule tolérées).

- [ ] **Step 4 : Vérification navigateur (desktop ET mobile 390x844)**

Run : `npm run dev` puis vérifier en local, connecté en gérant :
- L'onglet « Rentabilité » apparaît (gérant) et n'apparaît PAS pour un employé.
- La liste montre les items importés ; un item sans recette affiche « recette à compléter ».
- Créer la recette « Corn dog saucisse » de test : la saisie recalcule le coût en direct.
- Le test du ×1000 : produit à 10 €/kg, 100 g → 1,00 € exactement.
- Prix Uber vide → placeholder = prix sur place ; bouton « équiv. » l'aligne.
- Viewport 390x844 : la liste reste lisible, le tableau des canaux défile horizontalement.

- [ ] **Step 5 : VALIDATION VISUELLE DE JEAN-CLAUDE en local (bloquant)**

Ne rien committer avant son accord explicite sur le rendu.

- [ ] **Step 6 : Commit**

```bash
git add src/components/RentabiliteModule.jsx src/RestoApp.jsx
git commit -m "feat(rentabilite): module marges par canal, equivalence et simulateur (gerant seul)"
```

---

### Task 6 : Vérifications finales et mise en production

- [ ] **Step 1 : Boucle de vérification complète**

Run : `npm test` et `npm run build` une dernière fois. Attendu : verts.
`git status` : vérifier que `supabase_migration4_rentabilite.sql` et
`import_carte.mjs` n'apparaissent PAS dans les fichiers suivis.

- [ ] **Step 2 : Push et déploiement**

```bash
git push origin main
```
Attendu : Vercel déploie sous ~5 min sur restoapp-khaki.vercel.app.
Si rien après 5 min : commit vide et re-push (règle maison).

- [ ] **Step 3 : Re-vérifier EN PROD comme un vrai utilisateur**

Sur restoapp-khaki.vercel.app, connecté gérant : onglet Rentabilité présent,
recette de test visible avec les bons chiffres. Puis connecté employé :
l'onglet est absent et une requête directe sur les tables (console réseau)
ne renvoie rien (RLS).

- [ ] **Step 4 : Mise en service des données (avec Jean-Claude, hors code)**

1. Ajouter les ~10 emballages de la mercuriale (feuille Emballages) au module
   Stock avec leur fournisseur et prix (unité « pièce »).
2. Saisir les recettes des produits à plus forte rotation d'abord
   (corn dogs, boneless), le reste au fil de l'eau.
3. Nettoyer les doublons de la carte dans l'admin du site
   (« Matcha fraise » x2, « Matcha mangue » x2, « ONIGIRI UBER »).
```

---

## Auto-revue effectuée

- Couverture spec : coûts depuis le Stock (Task 3), recettes liées au menu
  (Tasks 2, 5), prix par canal + équivalence + simulateur (Tasks 3, 5),
  RLS gérant (Task 2), import carte (Task 4), emballages et nettoyage
  doublons (Task 6 step 4). Hors périmètre respecté (pas de CA, pas
  d'historisation, pas d'import CSV).
- Aucun placeholder : chaque étape porte son code ou sa commande complète.
- Cohérence des signatures entre rentabilite.js, ses tests et le module
  vérifiée (coutMatiere → {total, lignesSansPrix} ; rentabiliteCanal →
  objet nommé ; prixConseille(cout, marge, commission, tva)).
