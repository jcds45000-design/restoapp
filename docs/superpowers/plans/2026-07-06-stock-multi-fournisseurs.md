# Refonte stock multi-fournisseurs — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer la gestion de stock de restoapp par le modèle « inventaire physique régulier » avec fournisseurs multiples, alimenté par la mercuriale validée de JC.

**Architecture:** Deux nouvelles tables Supabase (`suppliers`, `product_suppliers`) + colonnes sur `stock_movements`, le tout créé et peuplé par UN script SQL généré depuis les Excel. Côté React : logique pure extraite dans `src/lib/stock.js` (testée vitest), trois nouveaux composants (`InventaireMode`, `FournisseursModal`, `ProduitFournisseurs`), `StocksModule` adapté. Le comptage employé passe par une fonction Postgres `enregistrer_comptage` (security definer), seule écriture ouverte aux non-gérants.

**Tech Stack:** React 19 + Vite, Supabase (Postgres + RLS), vitest, Playwright (scripts `pw_*.cjs` locaux), Python/pandas pour le générateur.

**Spec:** `docs/superpowers/specs/2026-07-06-stock-multi-fournisseurs-design.md`

**Dépendance :** `security/rls_hardening_2026-06-29.sql` doit avoir été exécuté (fait en prod le 05/07) : la migration réutilise `private.is_gerant()` et `private.jwt_email()`.

**⚠️ Donnée sensible / dépôt public :** `supabase_migration3_stock.sql` contient les fournisseurs et prix d'achat du restaurant. Le dépôt GitHub est PUBLIC. Le fichier est donc **gitignoré** (comme les `pw_*.cjs`). Si JC passe le dépôt en privé, on pourra le committer plus tard.

---

## Structure des fichiers

| Fichier | Rôle |
|---|---|
| `../../jarvis-starter-kit/context/import/generate_stock_migration.py` | Générateur one-shot (hors dépôt) : lit les 2 Excel, écrit la migration SQL |
| `supabase_migration3_stock.sql` (racine restoapp, **gitignoré**) | Structure + RLS + RPC + données. Exécuté une fois par JC dans Supabase SQL Editor |
| `src/lib/stock.js` (nouveau) | Logique pure : urgence, liste de courses groupée, texte de partage, progression d'inventaire |
| `src/lib/stock.test.js` (nouveau) | Tests vitest de `stock.js` |
| `src/RestoApp.jsx` (modif ~l.176-185, l.66, l.554) | Chargement suppliers/liaisons/sorties, seuil null préservé, nouvelles props |
| `src/components/StocksModule.jsx` (modif) | Badges, liste de courses par fournisseur, partage, sorties persistées, boutons Inventaire/Fournisseurs |
| `src/components/InventaireMode.jsx` (nouveau) | Mode comptage guidé plein écran |
| `src/components/FournisseursModal.jsx` (nouveau) | CRUD fournisseurs (gérant) |
| `src/components/ProduitFournisseurs.jsx` (nouveau) | Section fournisseurs de la modale d'édition produit |
| `pw_verif_stock.cjs` (racine, **gitignoré**) | Vérification Playwright de bout en bout |

Les chemins relatifs partent de `C:\Users\LENOVO P15S\Documents\Projets\restoapp`.

---

### Task 1 : Générateur Python → migration SQL

**Files:**
- Create: `C:\Users\LENOVO P15S\Documents\jarvis-starter-kit\context\import\generate_stock_migration.py`
- Create (généré): `supabase_migration3_stock.sql`
- Modify: `.gitignore`

Sources (dans `jarvis-starter-kit/context/import/`) :
- `rapprochement_fournisseurs_a_valider.xlsx`, feuille `Rapprochement a valider` (65 lignes). Colonnes utiles : `Categorie`, `Produit (mercuriale)`, `Unite`, `Prix mercuriale (HT)`, `-> Fournisseur principal (a valider)`, `-> Autres fournisseurs`.
- `Mercuriale_Kimiko(1).xlsx` : feuille `Emballages` (14 lignes, colonnes `Produit`, `Unité`, `Prix/pièce (€)`), feuille `Base coûts` (65 lignes, colonnes `Produit`, `Prix unitaire normalisé`, `Unité de calcul`).

- [ ] **Step 1 : Ajouter au .gitignore**

Ajouter à la fin de `.gitignore` (restoapp) :

```
# Migration stock : contient fournisseurs et prix d'achat (dépôt public)
supabase_migration3_stock.sql
```

- [ ] **Step 2 : Écrire le générateur**

`generate_stock_migration.py` (complet) :

```python
# -*- coding: utf-8 -*-
"""Génère supabase_migration3_stock.sql depuis la mercuriale validée.
Usage : python generate_stock_migration.py
Sortie : ../../Projets/restoapp/supabase_migration3_stock.sql + rapport console."""
import re, sys, unicodedata
import pandas as pd

sys.stdout.reconfigure(encoding='utf-8')
IMPORT_DIR = '.'
OUT = r'C:\Users\LENOVO P15S\Documents\Projets\restoapp\supabase_migration3_stock.sql'

SUPPLIERS = ['Metro', 'LX France', 'SDA Centre', 'Kedy Pack', 'Leclerc',
             'Pomme Rouge', 'Auchan', 'Carrefour', 'ABN Distribution', 'C Pro']

def norm(s):
    s = unicodedata.normalize('NFD', str(s).strip().lower())
    return ''.join(c for c in s if unicodedata.category(c) != 'Mn')

# Alias -> nom canonique (casse/variantes vues dans la validation de JC)
ALIAS = {norm(x): x for x in SUPPLIERS}
ALIAS.update({'sda': 'SDA Centre', 'lx france': 'LX France', 'pomme rouge': 'Pomme Rouge',
              'abn': 'ABN Distribution', 'abn distribution': 'ABN Distribution'})

# Catégorie mercuriale -> catégorie appli (les 6 larges)
CAT_MAP = {
    'Viandes': 'Viandes & Poissons', 'Poisson': 'Viandes & Poissons',
    'Sauces': 'Sauces & Condiments', 'Assaisonnement': 'Sauces & Condiments',
    'Huiles': 'Sauces & Condiments',
    'Produits laitiers': 'Légumes & Frais', 'Œufs': 'Légumes & Frais',
    'Fruits & légumes': 'Légumes & Frais', 'Entrées': 'Légumes & Frais',
    'Féculents': 'Sec & Féculents', 'Épicerie': 'Sec & Féculents',
    'Boulangerie': 'Sec & Féculents',
    'Boissons': 'Boissons', 'Boissons canettes': 'Boissons',
}
# Ventilation par produit de la catégorie "Corndog"
CORNDOG_MAP = {
    'Saucisses': 'Viandes & Poissons', 'Mozzarella pain': 'Légumes & Frais',
    'Panko': 'Sec & Féculents', 'Farine T45': 'Sec & Féculents',
    'Corn Flakes': 'Sec & Féculents',
}

def app_category(cat, produit):
    if cat == 'Corndog':
        return CORNDOG_MAP[produit]  # KeyError volontaire si produit inconnu
    return CAT_MAP[cat]              # KeyError volontaire si catégorie inconnue

def parse_cell(cell):
    """'Metro (3.69 HT) ; Carrefour (2.81 HT)' -> [('Metro', 3.69), ('Carrefour', 2.81)]
       'SDA; Metro' -> [('SDA Centre', None), ('Metro', None)]"""
    if pd.isna(cell) or not str(cell).strip():
        return []
    out = []
    for part in re.split(r'[;]', str(cell)):
        part = part.strip()
        if not part:
            continue
        m = re.match(r'^(.*?)\s*\(([\d.,]+)(?:\s*-\s*[\d.,]+)?\s*HT?\)?\s*$', part)
        price = None
        name = part
        if m:
            name = m.group(1).strip()
            price = float(m.group(2).replace(',', '.'))
        key = norm(name)
        if key not in ALIAS:
            print(f'  !! fournisseur inconnu ignoré : "{name}" (cellule : {cell})')
            continue
        out.append((ALIAS[key], price))
    return out

def sq(s):
    return str(s).replace("'", "''")

df = pd.read_excel(f'{IMPORT_DIR}/rapprochement_fournisseurs_a_valider.xlsx',
                   sheet_name='Rapprochement a valider')
base = pd.read_excel(f'{IMPORT_DIR}/Mercuriale_Kimiko(1).xlsx', sheet_name='Base coûts')
emb = pd.read_excel(f'{IMPORT_DIR}/Mercuriale_Kimiko(1).xlsx', sheet_name='Emballages')
prix_norm = {r['Produit']: r['Prix unitaire normalisé'] for _, r in base.iterrows()}

products, links, sans_fournisseur = [], [], []
seen = set()
for _, r in df.iterrows():
    name = str(r['Produit (mercuriale)']).strip()
    if name in seen:                     # doublon (ex: Sauce BBQ Colona x2)
        print(f'  !! doublon ignoré : {name}')
        continue
    seen.add(name)
    price = prix_norm.get(name)
    price = None if pd.isna(price) else round(float(price), 4)
    products.append((name, app_category(r['Categorie'], name), str(r['Unite']).strip(), price))
    fps = parse_cell(r['-> Fournisseur principal (a valider)'])
    others = parse_cell(r['-> Autres fournisseurs'])
    if not fps and not others:
        sans_fournisseur.append(name)
        continue
    seen_sup = set()
    for i, (sup, p) in enumerate(fps + others):
        if sup in seen_sup:
            continue
        seen_sup.add(sup)
        links.append((name, sup, p, i == 0))   # premier cité = principal

for _, r in emb.iterrows():
    name = str(r['Produit']).strip()
    price = r['Prix/pièce (€)']
    price = None if pd.isna(price) else round(float(price), 4)
    products.append((name, 'Emballages & Consommables', 'pièces', price))
    links.append((name, 'Kedy Pack', price, True))

# ── Rapport ──
n_princ = len({p for p, s, pr, ip in links if ip})
print(f'{len(products)} produits, {len(links)} liaisons, {n_princ} principaux, '
      f'{len(sans_fournisseur)} sans fournisseur : {sans_fournisseur}')
assert len(products) == 78, f'attendu 78 produits (65 - 1 doublon + 14), obtenu {len(products)}'
assert len(sans_fournisseur) == 2

# ── Émission SQL ──
L = ['-- ============================================================',
     '-- MIGRATION 3 : refonte stock multi-fournisseurs (2026-07-06)',
     '-- Généré par generate_stock_migration.py — NE PAS COMMITTER (dépôt public).',
     '-- À exécuter UNE FOIS dans Supabase SQL Editor. Transaction unique.',
     '-- Prérequis : security/rls_hardening_2026-06-29.sql déjà exécuté.',
     '-- ============================================================',
     'begin;', '',
     '-- 1. Structure',
     '''create table if not exists public.suppliers (
  id uuid primary key default uuid_generate_v4(),
  name text not null unique,
  active boolean default true,
  note text default '',
  created_at timestamptz default now()
);
create table if not exists public.product_suppliers (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid not null references public.products(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  price_ht numeric,
  is_primary boolean default false,
  note text default '',
  created_at timestamptz default now(),
  unique (product_id, supplier_id)
);
create unique index if not exists product_suppliers_one_primary
  on public.product_suppliers (product_id) where is_primary;
alter table public.products drop column if exists supplier;
alter table public.products alter column seuil set default null;
alter table public.products alter column seuil_orange set default null;
alter table public.stock_movements add column if not exists status text default 'validated'
  check (status in ('pending','validated','rejected'));
alter table public.stock_movements add column if not exists employee_name text default '';
alter table public.stock_movements add column if not exists qty_before numeric;
alter table public.stock_movements add column if not exists qty_after numeric;''', '',
     '-- 2. RLS',
     '''alter table public.suppliers enable row level security;
drop policy if exists suppliers_read on public.suppliers;
drop policy if exists suppliers_write on public.suppliers;
create policy suppliers_read on public.suppliers
  for select to authenticated using ( true );
create policy suppliers_write on public.suppliers
  for all to authenticated
  using ( private.is_gerant() ) with check ( private.is_gerant() );

alter table public.product_suppliers enable row level security;
drop policy if exists product_suppliers_read on public.product_suppliers;
drop policy if exists product_suppliers_write on public.product_suppliers;
create policy product_suppliers_read on public.product_suppliers
  for select to authenticated using ( true );
create policy product_suppliers_write on public.product_suppliers
  for all to authenticated
  using ( private.is_gerant() ) with check ( private.is_gerant() );

-- stock_movements : lecture connectée, insertion = déclaration de sortie
-- (pending) uniquement, validation/refus/suppression = gérant.
drop policy if exists stock_movements_rw on public.stock_movements;
drop policy if exists stock_movements_read on public.stock_movements;
drop policy if exists stock_movements_insert on public.stock_movements;
drop policy if exists stock_movements_update on public.stock_movements;
drop policy if exists stock_movements_delete on public.stock_movements;
create policy stock_movements_read on public.stock_movements
  for select to authenticated using ( true );
create policy stock_movements_insert on public.stock_movements
  for insert to authenticated
  with check ( type = 'out' and status = 'pending' );
create policy stock_movements_update on public.stock_movements
  for update to authenticated
  using ( private.is_gerant() ) with check ( private.is_gerant() );
create policy stock_movements_delete on public.stock_movements
  for delete to authenticated
  using ( private.is_gerant() );''', '',
     '-- 3. Fonction de comptage (seule écriture produits ouverte aux employés)',
     '''create or replace function public.enregistrer_comptage(p_product_id uuid, p_qty numeric)
returns void language plpgsql security definer set search_path = public, private as $fn$
declare
  v_name text;
  v_before numeric;
begin
  if p_qty is null or p_qty < 0 then
    raise exception 'quantite invalide';
  end if;
  select name into v_name from public.employees
    where lower(email) = private.jwt_email() and active;
  if v_name is null and not private.is_gerant() then
    raise exception 'non autorise';
  end if;
  select qty into v_before from public.products where id = p_product_id;
  if not found then
    raise exception 'produit inconnu';
  end if;
  update public.products set qty = p_qty, stock_current = p_qty
    where id = p_product_id;
  insert into public.stock_movements
    (product_id, type, quantity, reason, status, employee_name, qty_before, qty_after)
  values
    (p_product_id, 'adjustment', p_qty - coalesce(v_before, 0), 'comptage inventaire',
     'validated', coalesce(v_name, private.jwt_email()), v_before, p_qty);
end $fn$;
revoke all on function public.enregistrer_comptage(uuid, numeric) from public;
grant execute on function public.enregistrer_comptage(uuid, numeric) to authenticated;''', '',
     '-- 4. Données',
     'delete from public.product_suppliers;',
     'delete from public.stock_movements;',
     'delete from public.products;',
     'delete from public.suppliers;']

for s in SUPPLIERS:
    L.append(f"insert into public.suppliers (name) values ('{sq(s)}');")
L.append('')
for name, cat, unit, price in products:
    p = 'null' if price is None else price
    L.append(f"insert into public.products (name, category, unit, qty, seuil, seuil_orange, "
             f"stock_current, stock_min, price_unit) values ('{sq(name)}', '{sq(cat)}', "
             f"'{sq(unit)}', 0, null, null, 0, 0, {p});")
L.append('')
for name, sup, price, is_p in links:
    p = 'null' if price is None else price
    L.append(f"insert into public.product_suppliers (product_id, supplier_id, price_ht, is_primary) "
             f"select p.id, s.id, {p}, {str(is_p).lower()} from public.products p, public.suppliers s "
             f"where p.name = '{sq(name)}' and s.name = '{sq(sup)}';")
L += ['', '-- Vérifications (doivent rendre 10 / 78 / 76 principaux)',
      'do $ck$ declare c int; begin',
      "  select count(*) into c from public.suppliers; assert c = 10, 'suppliers: ' || c;",
      "  select count(*) into c from public.products; assert c = 78, 'products: ' || c;",
      "  select count(*) into c from public.product_suppliers where is_primary; "
      "assert c = 76, 'principaux: ' || c;",
      'end $ck$;', '', 'commit;']

with open(OUT, 'w', encoding='utf-8') as f:
    f.write('\n'.join(L) + '\n')
print(f'écrit : {OUT}')
```

Notes importantes encodées ci-dessus :
- **78 produits, pas 79** : « Sauce BBQ Colona » apparaît 2 fois dans la validation (lignes 18-19), le doublon est ignoré. 64 matières + 14 emballages = 78. **76 liaisons principales** = 78 − 2 sans fournisseur.
- Prix normalisé depuis la feuille `Base coûts` (tout HT). Emballages : `Prix/pièce (€)` (factures Kedy Pack, HT).
- `assert` Python : le script plante si les comptes bougent (sécurité si l'Excel change).

- [ ] **Step 3 : Exécuter le générateur et relire la sortie**

Run (PowerShell) : `cd "C:\Users\LENOVO P15S\Documents\jarvis-starter-kit\context\import"; python generate_stock_migration.py`
Expected : `78 produits, ~90+ liaisons, 76 principaux, 2 sans fournisseur : ['Sriracha Flying Goose', 'Matcha premium']` puis `écrit : ...supabase_migration3_stock.sql`. Aucun `!! fournisseur inconnu` inattendu (le doublon BBQ est attendu).

Relire le SQL généré : échantillonner 5 produits (Filet de poulet → ABN principal ; Fécule → LX France principal + Pomme Rouge ; Limonade Steff → Metro avec prix 2.52 ; un emballage → Kedy Pack ; Sriracha → aucune liaison).

- [ ] **Step 4 : Commit (générateur non committé, .gitignore seulement)**

```powershell
git add .gitignore
git commit -m "chore(stock): ignore la migration stock generee (donnees fournisseurs, depot public)"
```

---

### CHECKPOINT 1 — Action JC

**JC exécute `supabase_migration3_stock.sql` dans Supabase SQL Editor** (une seule fois). Vérification intégrée : le bloc `do $ck$` plante si les comptes sont faux.

Effet transitoire assumé : l'UI actuellement en prod affichera les 78 produits à 0 avec seuil 0 (donc en rouge) jusqu'au déploiement de la suite. Le stock n'étant pas utilisé au quotidien, c'est acceptable.

---

### Task 2 : Logique pure `src/lib/stock.js` (TDD)

**Files:**
- Create: `src/lib/stock.js`
- Test: `src/lib/stock.test.js`

- [ ] **Step 1 : Écrire les tests (échouants)**

`src/lib/stock.test.js` :

```javascript
import { describe, it, expect } from 'vitest';
import { getUrgency, computeShoppingList, formatShoppingListText, countedTodayIds } from './stock';

const P = (over) => ({ _uuid: 'u1', name: 'Poulet', category: 'Viandes & Poissons',
  unit: 'kg', qty: 0, seuil: null, seuilOrange: null, priceUnit: null, ...over });

describe('getUrgency', () => {
  it('seuil null = jamais en alerte, même à 0', () => {
    expect(getUrgency(P({ qty: 0, seuil: null }))).toBe('none');
  });
  it('qty <= seuil = high', () => {
    expect(getUrgency(P({ qty: 2, seuil: 2, seuilOrange: 4 }))).toBe('high');
  });
  it('qty <= seuilOrange = medium', () => {
    expect(getUrgency(P({ qty: 3, seuil: 2, seuilOrange: 4 }))).toBe('medium');
  });
  it('au-dessus = ok', () => {
    expect(getUrgency(P({ qty: 5, seuil: 2, seuilOrange: 4 }))).toBe('ok');
  });
  it('seuilOrange null : ok au-dessus du seuil', () => {
    expect(getUrgency(P({ qty: 3, seuil: 2, seuilOrange: null }))).toBe('ok');
  });
});

describe('computeShoppingList', () => {
  const suppliers = [{ id: 's1', name: 'Metro', active: true }, { id: 's2', name: 'ABN Distribution', active: true }];
  const links = [
    { product_id: 'u1', supplier_id: 's2', price_ht: 5.65, is_primary: true },
    { product_id: 'u1', supplier_id: 's1', price_ht: null, is_primary: false },
    { product_id: 'u2', supplier_id: 's1', price_ht: 2, is_primary: true },
  ];
  const products = [
    P({ _uuid: 'u1', name: 'Poulet', qty: 1, seuil: 5, seuilOrange: 8 }),
    P({ _uuid: 'u2', name: 'Œufs', unit: 'pièces', qty: 0, seuil: 30, seuilOrange: null }),
    P({ _uuid: 'u3', name: 'Sriracha', qty: 0, seuil: 2, seuilOrange: null }),   // sans fournisseur
    P({ _uuid: 'u4', name: 'Riz', qty: 10, seuil: 5, seuilOrange: 8 }),          // pas en alerte
    P({ _uuid: 'u5', name: 'Matcha', qty: 0, seuil: null }),                     // seuil à définir
  ];
  const groups = computeShoppingList(products, links, suppliers);

  it('ne prend que les produits en alerte rouge avec seuil défini', () => {
    const names = groups.flatMap(g => g.items.map(i => i.product.name));
    expect(names.sort()).toEqual(['Poulet', 'Sriracha', 'Œufs']);
  });
  it('groupe par fournisseur principal, sans-fournisseur en dernier', () => {
    expect(groups.map(g => g.supplier ? g.supplier.name : null))
      .toEqual(['ABN Distribution', 'Metro', null]);
  });
  it('toOrder = remonter au-dessus du seuil orange (ou seuil) + 20 %', () => {
    const poulet = groups[0].items[0];
    expect(poulet.toOrder).toBe(Math.ceil((8 - 1) * 1.2)); // 9
    const oeufs = groups[1].items[0];
    expect(oeufs.toOrder).toBe(Math.ceil((30 - 0) * 1.2)); // 36 (seuilOrange null -> seuil)
  });
  it('coût estimé HT du groupe quand le prix est connu', () => {
    expect(groups[0].totalHt).toBeCloseTo(9 * 5.65);
    expect(groups[2].totalHt).toBe(null); // Sriracha sans prix
  });
});

describe('formatShoppingListText', () => {
  it('produit un texte partageable par fournisseur', () => {
    const txt = formatShoppingListText([
      { supplier: { name: 'Metro' }, totalHt: 12,
        items: [{ product: { name: 'Œufs', unit: 'pièces' }, toOrder: 36 }] },
      { supplier: null, totalHt: null,
        items: [{ product: { name: 'Sriracha', unit: 'kg' }, toOrder: 3 }] },
    ]);
    expect(txt).toContain('METRO');
    expect(txt).toContain('- Œufs : 36 pièces');
    expect(txt).toContain('SANS FOURNISSEUR');
  });
});

describe('countedTodayIds', () => {
  it('extrait les produits comptés depuis les mouvements du jour', () => {
    const ids = countedTodayIds([
      { product_id: 'u1', type: 'adjustment' },
      { product_id: 'u2', type: 'out' },
      { product_id: 'u1', type: 'adjustment' },
    ]);
    expect([...ids].sort()).toEqual(['u1']);
  });
});
```

- [ ] **Step 2 : Vérifier que les tests échouent**

Run : `npm test`
Expected : FAIL, `Cannot find module './stock'` (les 2 suites existantes `taskDispatch` et `users` restent vertes).

- [ ] **Step 3 : Implémenter `src/lib/stock.js`**

```javascript
// Logique pure du stock : urgence, liste de courses, partage, progression.
// Convention : seuil === null -> « à définir », jamais en alerte.

export const getUrgency = (p) => {
  if (p.seuil == null) return 'none';
  if (p.qty <= p.seuil) return 'high';
  if (p.seuilOrange != null && p.qty <= p.seuilOrange) return 'medium';
  return 'ok';
};

// Liaisons d'un produit, triées principal d'abord, fournisseurs actifs seulement.
export const supplierLinksOf = (productUuid, links, suppliers) =>
  links
    .filter(l => l.product_id === productUuid)
    .map(l => ({ ...l, supplier: suppliers.find(s => s.id === l.supplier_id) }))
    .filter(l => l.supplier && l.supplier.active !== false)
    .sort((a, b) => (b.is_primary === true) - (a.is_primary === true));

// Produits en alerte rouge (seuil défini), groupés par fournisseur principal.
// Retour : [{ supplier|null, items: [{ product, toOrder, priceHt }], totalHt|null }]
// trié par nom de fournisseur, groupe « sans fournisseur » en dernier.
export const computeShoppingList = (products, links, suppliers) => {
  const byKey = new Map();
  products.filter(p => p.seuil != null && p.qty <= p.seuil).forEach(p => {
    const primary = supplierLinksOf(p._uuid, links, suppliers).find(l => l.is_primary);
    const target = p.seuilOrange != null ? p.seuilOrange : p.seuil;
    const toOrder = Math.max(1, Math.ceil((target - p.qty) * 1.2));
    const key = primary ? primary.supplier.id : '';
    if (!byKey.has(key)) byKey.set(key, { supplier: primary ? primary.supplier : null, items: [] });
    byKey.get(key).items.push({ product: p, toOrder, priceHt: primary ? primary.price_ht : null });
  });
  return [...byKey.values()]
    .map(g => {
      const costs = g.items.map(i => i.priceHt != null ? i.priceHt * i.toOrder : null);
      const known = costs.filter(c => c != null);
      return { ...g, totalHt: known.length ? known.reduce((a, b) => a + b, 0) : null };
    })
    .sort((a, b) => {
      if (!a.supplier) return 1;
      if (!b.supplier) return -1;
      return a.supplier.name.localeCompare(b.supplier.name);
    });
};

// Texte prêt à coller dans WhatsApp/SMS.
export const formatShoppingListText = (groups) =>
  groups.map(g => {
    const head = (g.supplier ? g.supplier.name : 'Sans fournisseur').toUpperCase()
      + (g.totalHt != null ? ` (~${g.totalHt.toFixed(0)} € HT)` : '');
    const lines = g.items.map(i => `- ${i.product.name} : ${i.toOrder} ${i.product.unit}`);
    return [head, ...lines].join('\n');
  }).join('\n\n');

// Produits déjà comptés (mouvements type adjustment passés en paramètre).
export const countedTodayIds = (movements) =>
  new Set(movements.filter(m => m.type === 'adjustment').map(m => m.product_id));
```

- [ ] **Step 4 : Vérifier que les tests passent**

Run : `npm test`
Expected : PASS (3 fichiers de test, 0 échec).

- [ ] **Step 5 : Commit**

```powershell
git add src/lib/stock.js src/lib/stock.test.js
git commit -m "feat(stock): logique pure urgence/liste de courses multi-fournisseurs (TDD)"
```

---

### Task 3 : Chargement des données dans `RestoApp.jsx`

**Files:**
- Modify: `src/RestoApp.jsx` (l.66 état, l.176-185 chargement, l.554 props)

- [ ] **Step 1 : Ajouter les états**

Près de `const [sorties, setSorties] = useState(initialSorties);` (l.66) :

```javascript
const [suppliers, setSuppliers] = useState([]);
const [productSuppliers, setProductSuppliers] = useState([]);
```

- [ ] **Step 2 : Adapter le chargement produits (seuil null préservé) et charger le reste**

Remplacer le bloc « Produits » (l.176-185) par :

```javascript
// Produits (seuil null = « à définir », ne pas le convertir en 0)
const { data: pData } = await supabase.from('products').select('*').order('name');
if (pData?.length) {
  setProducts(pData.map((p, i) => ({
    id: i + 1, _uuid: p.id,
    name: p.name, category: p.category, unit: p.unit,
    qty: parseFloat(p.qty) || 0,
    seuil: p.seuil == null ? null : parseFloat(p.seuil),
    seuilOrange: p.seuil_orange == null ? null : parseFloat(p.seuil_orange),
    priceUnit: p.price_unit == null ? null : parseFloat(p.price_unit),
  })));
}
// Fournisseurs + liaisons produit-fournisseur
const { data: supData } = await supabase.from('suppliers').select('*').order('name');
if (supData) setSuppliers(supData);
const { data: psData } = await supabase.from('product_suppliers').select('*');
if (psData) setProductSuppliers(psData);
// Sorties (persistées dans stock_movements, type 'out')
const { data: mvData } = await supabase.from('stock_movements')
  .select('*').eq('type', 'out').order('created_at');
if (mvData?.length) {
  setSorties(mvData.map(m => ({
    id: m.id, productUuid: m.product_id, qty: Math.abs(parseFloat(m.quantity) || 0),
    empName: m.employee_name || '', date: (m.created_at || '').slice(0, 10),
    time: (m.created_at || '').slice(11, 16).replace(':', 'h'),
    status: m.status || 'validated', note: m.reason || '',
  })));
}
```

Note : les sorties passent de `productId` (entier local) à **`productUuid`** (uuid produit). `StocksModule` est adapté en Task 4.

- [ ] **Step 3 : Passer les nouvelles props (l.554)**

```javascript
<Suspense fallback={<Loading />}><StocksModule t={t} products={products} setProducts={setProducts}
  sorties={sorties} setSorties={setSorties} suppliers={suppliers} setSuppliers={setSuppliers}
  productSuppliers={productSuppliers} setProductSuppliers={setProductSuppliers}
  isGerant={isGerant} currentUserName={currentUser.name} /></Suspense>
```

- [ ] **Step 4 : Vérifier build + tests**

Run : `npm test; npm run build`
Expected : tests PASS, build OK (StocksModule ignore encore les nouvelles props, sans erreur).

- [ ] **Step 5 : Commit**

```powershell
git add src/RestoApp.jsx
git commit -m "feat(stock): chargement fournisseurs, liaisons et sorties persistees"
```

---

### Task 4 : Adapter `StocksModule.jsx`

**Files:**
- Modify: `src/components/StocksModule.jsx`

- [ ] **Step 1 : Brancher la logique pure et les nouvelles props**

- Signature : `const StocksModule = ({ t, products, setProducts, sorties, setSorties, suppliers, setSuppliers, productSuppliers, setProductSuppliers, isGerant, currentUserName }) => {`
- Import : `import { getUrgency, computeShoppingList, formatShoppingListText, supplierLinksOf } from '../lib/stock';`
- Supprimer la fonction locale `getUrgency` (l.39-43).
- Remplacer les calculs (l.46-47) par :

```javascript
const alertProducts = products.filter(p => p.seuil != null && p.qty <= p.seuil);
const sansSeuil = products.filter(p => p.seuil == null);
const shoppingGroups = computeShoppingList(products, productSuppliers, suppliers);
```

- [ ] **Step 2 : Inventaire — badges et état neutre**

Dans `InventoryView` (l.120-165) :
- La pastille et le fond utilisent `getUrgency` importé ; pour `urg === 'none'` : pastille grise (`t.border`), pas de fond d'alerte.
- Sous le nom, remplacer `Seuil : {p.seuil} {p.unit}` par :

```javascript
<div style={{ fontSize: 12, color: t.textMuted }}>
  {p.seuil == null ? 'Seuil à définir' : `Seuil : ${p.seuil} ${p.unit}`}
  {supplierLinksOf(p._uuid, productSuppliers, suppliers).length === 0 && ' · sans fournisseur'}
</div>
```

- Ajouter un filtre « Seuil à définir » à côté du filtre catégorie (un `<select>` existant reçoit une option ou un bouton toggle `sansSeuilOnly`) : quand actif, `filtered = products.filter(p => p.seuil == null)`.

- [ ] **Step 3 : Sorties persistées**

- `submitSortie` : insertion Supabase au lieu du state seul :

```javascript
const submitSortie = async () => {
  if (!spProduct || !spQty) return;   // spProduct contient désormais le _uuid produit
  const { data, error } = await supabase.from('stock_movements').insert({
    product_id: spProduct, type: 'out', quantity: parseFloat(spQty),
    reason: spNote, status: 'pending', employee_name: currentUserName,
  }).select().single();
  if (error) { alert('Erreur : ' + error.message); return; }
  setSorties(prev => [...prev, { id: data.id, productUuid: spProduct, qty: parseFloat(spQty),
    empName: currentUserName, date: TODAY, time: (data.created_at || '').slice(11, 16).replace(':', 'h'),
    status: 'pending', note: spNote }]);
  setSpProduct(''); setSpQty(''); setSpNote(''); setShowSortieModal(false);
};
```

- Le `<select>` produit de la modale sortie utilise `value={p._uuid}`.
- `validateSortie` : update du statut en base + décrément produit (droits gérant) :

```javascript
const validateSortie = async (sid) => {
  const sortie = sorties.find(s => s.id === sid);
  if (!sortie) return;
  const prod = products.find(p => p._uuid === sortie.productUuid);
  if (!prod) return;
  const newQty = Math.max(0, Math.round((prod.qty - sortie.qty) * 100) / 100);
  const { error } = await supabase.from('stock_movements')
    .update({ status: 'validated', qty_before: prod.qty, qty_after: newQty }).eq('id', sid);
  if (error) { alert('Erreur : ' + error.message); return; }
  await supabase.from('products').update({ qty: newQty, stock_current: newQty }).eq('id', prod._uuid);
  setSorties(prev => prev.map(s => s.id === sid ? { ...s, status: 'validated' } : s));
  setProducts(prev => prev.map(p => p._uuid === prod._uuid ? { ...p, qty: newQty } : p));
};
const rejectSortie = async (sid) => {
  const { error } = await supabase.from('stock_movements').update({ status: 'rejected' }).eq('id', sid);
  if (error) { alert('Erreur : ' + error.message); return; }
  setSorties(prev => prev.map(s => s.id === sid ? { ...s, status: 'rejected' } : s));
};
```

- Dans `SortiesView`, les lookups `products.find(p => p.id === s.productId)` deviennent `products.find(p => p._uuid === s.productUuid)`.

- [ ] **Step 4 : Liste de courses par fournisseur + partage**

Remplacer `ShoppingView` par un rendu de `shoppingGroups` : un bloc par groupe (en-tête = nom fournisseur ou « Sans fournisseur », compte d'items, `totalHt` affiché `≈ X € HT` si non null), lignes = produit, reste/seuil, `≈ toOrder unit`. En bas :

```javascript
<button onClick={() => {
  navigator.clipboard.writeText(formatShoppingListText(shoppingGroups));
  alert('Liste copiée, prête à coller dans WhatsApp/SMS.');
}} style={{ /* style bouton primaire existant */ }}>📤 Partager la liste (texte)</button>
```

- [ ] **Step 5 : Boutons « Faire l'inventaire » et « Fournisseurs »**

Dans la barre d'actions (l.262-266) :
- `<button onClick={() => setShowInventaire(true)}>📋 Faire l'inventaire</button>` visible pour TOUT utilisateur connecté.
- `{isGerant && <button onClick={() => setShowFournisseurs(true)}>Fournisseurs</button>}`.
- Les états `showInventaire` / `showFournisseurs` rendent `<InventaireMode …>` / `<FournisseursModal …>` (composants créés en Tasks 5-6 ; à ce stade, les créer en stub qui rend `null` pour garder le build vert).

- [ ] **Step 6 : Vérifier build + tests, puis commit**

Run : `npm test; npm run build`
Expected : PASS + build OK.

```powershell
git add src/components/StocksModule.jsx src/components/InventaireMode.jsx src/components/FournisseursModal.jsx
git commit -m "feat(stock): courses par fournisseur, sorties persistees, badges seuil/fournisseur"
```

---

### Task 5 : Mode inventaire guidé `InventaireMode.jsx`

**Files:**
- Modify (remplace le stub): `src/components/InventaireMode.jsx`

- [ ] **Step 1 : Implémenter le composant**

Props : `{ t, products, setProducts, stockCategories, onClose, currentUserName }`.

```javascript
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { countedTodayIds } from '../lib/stock';
import { F } from '../lib/foundation';

// Mode inventaire guidé : sommaire des catégories -> comptage produit par produit.
// Chaque saisie est enregistrée immédiatement via le RPC enregistrer_comptage
// (seul canal d'écriture ouvert aux employés). « Passer » ne touche pas la quantité.
const InventaireMode = ({ t, products, setProducts, stockCategories, onClose }) => {
  const [counted, setCounted] = useState(new Set()); // _uuid des produits comptés aujourd'hui
  const [cat, setCat] = useState(null);              // null = sommaire
  const [idx, setIdx] = useState(0);
  const [val, setVal] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Reprise : produits déjà comptés aujourd'hui (traces stock_movements)
  useEffect(() => {
    const load = async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { data } = await supabase.from('stock_movements')
        .select('product_id, type').eq('type', 'adjustment').gte('created_at', today);
      if (data) setCounted(countedTodayIds(data));
    };
    load();
  }, []);

  const catProducts = cat ? products.filter(p => p.category === cat) : [];
  const current = catProducts[idx];

  const openCat = (c) => {
    const list = products.filter(p => p.category === c);
    const first = list.findIndex(p => !counted.has(p._uuid));
    setCat(c); setIdx(first === -1 ? 0 : first); setVal(''); setError('');
  };

  const advance = () => {
    if (idx + 1 < catProducts.length) { setIdx(idx + 1); setVal(''); setError(''); }
    else { setCat(null); }             // catégorie finie -> retour sommaire
  };

  const save = async () => {
    if (val === '' || saving) return;
    const q = parseFloat(String(val).replace(',', '.'));
    if (isNaN(q) || q < 0) { setError('Quantité invalide'); return; }
    setSaving(true); setError('');
    const { error: e } = await supabase.rpc('enregistrer_comptage',
      { p_product_id: current._uuid, p_qty: q });
    setSaving(false);
    if (e) { setError('Échec, réessaie : ' + e.message); return; }
    setProducts(prev => prev.map(p => p._uuid === current._uuid ? { ...p, qty: q } : p));
    setCounted(prev => new Set(prev).add(current._uuid));
    advance();
  };

  // ── Rendu ──
  const overlay = { position: 'fixed', inset: 0, background: t.bg || '#fff', zIndex: 1200,
    overflowY: 'auto', padding: 20, fontFamily: F };
  const done = products.filter(p => counted.has(p._uuid)).length;

  if (!cat) return (
    <div style={overlay}>
      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Inventaire</h2>
          <span style={{ fontSize: 12, background: t.surfaceAlt, borderRadius: 10, padding: '3px 10px' }}>
            {done} / {products.length} comptés</span>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 16 }}>✕</button>
        </div>
        {stockCategories.map(c => {
          const list = products.filter(p => p.category === c);
          if (!list.length) return null;
          const n = list.filter(p => counted.has(p._uuid)).length;
          const full = n === list.length;
          return (
            <button key={c} onClick={() => openCat(c)} style={{ display: 'flex', width: '100%',
              justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', marginBottom: 8,
              borderRadius: 12, border: `1px solid ${t.border}`, background: t.surface, cursor: 'pointer',
              fontFamily: F, fontSize: 14, fontWeight: 600, color: t.text }}>
              <span>{full ? '✅' : '📦'} {c}</span>
              <span style={{ color: full ? t.success : t.textMuted, fontWeight: 500 }}>{n} / {list.length}</span>
            </button>
          );
        })}
        <button onClick={onClose} style={{ width: '100%', marginTop: 12, padding: '12px 0', borderRadius: 10,
          border: `1px solid ${t.border}`, background: t.surface, color: t.textMuted, cursor: 'pointer',
          fontFamily: F, fontWeight: 600 }}>Terminer pour aujourd'hui</button>
      </div>
    </div>
  );

  return (
    <div style={overlay}>
      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <button onClick={() => setCat(null)} style={{ border: 'none', background: 'none', cursor: 'pointer',
            color: t.primary, fontFamily: F, fontWeight: 600 }}>← Catégories</button>
          <span style={{ fontSize: 12, color: t.textMuted }}>{cat} · {idx + 1} / {catProducts.length}</span>
        </div>
        <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 16, padding: 24 }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{current.name}
            {counted.has(current._uuid) && <span style={{ fontSize: 12, color: t.success, marginLeft: 8 }}>déjà compté ✓</span>}
          </div>
          <div style={{ fontSize: 13, color: t.textMuted, marginBottom: 16 }}>
            La dernière fois : {current.qty} {current.unit}</div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <input value={val} onChange={e => setVal(e.target.value)} type="number" step="0.1" min="0"
              autoFocus inputMode="decimal" placeholder="0"
              onKeyDown={e => { if (e.key === 'Enter') save(); }}
              style={{ flex: 1, fontSize: 24, textAlign: 'center', padding: '12px 8px', borderRadius: 10,
                border: `1px solid ${t.border}`, fontFamily: F, background: t.surface, color: t.text }} />
            <span style={{ fontSize: 15, color: t.textMuted }}>{current.unit}</span>
          </div>
          {error && <div style={{ color: t.danger, fontSize: 13, marginTop: 10 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <button onClick={save} disabled={saving || val === ''} style={{ flex: 2, padding: '14px 0',
              borderRadius: 10, border: 'none', background: val === '' ? t.border : t.primary,
              color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: F }}>
              {saving ? '…' : '✓ Suivant'}</button>
            <button onClick={advance} style={{ flex: 1, padding: '14px 0', borderRadius: 10,
              border: `1px solid ${t.border}`, background: t.surface, color: t.textMuted,
              fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: F }}>Passer</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InventaireMode;
```

- [ ] **Step 2 : Brancher dans StocksModule**

```javascript
{showInventaire && <InventaireMode t={t} products={products} setProducts={setProducts}
  stockCategories={stockCategories} onClose={() => setShowInventaire(false)} />}
```

- [ ] **Step 3 : Vérifier build + tests, puis commit**

Run : `npm test; npm run build`
Expected : PASS + build OK.

```powershell
git add src/components/InventaireMode.jsx src/components/StocksModule.jsx
git commit -m "feat(stock): mode inventaire guide avec sommaire categories et reprise"
```

---

### Task 6 : `FournisseursModal.jsx` + `ProduitFournisseurs.jsx`

**Files:**
- Modify (remplace le stub): `src/components/FournisseursModal.jsx`
- Create: `src/components/ProduitFournisseurs.jsx`
- Modify: `src/components/StocksModule.jsx` (modale d'édition produit)

- [ ] **Step 1 : Implémenter FournisseursModal (CRUD gérant)**

Props : `{ t, suppliers, setSuppliers, productSuppliers, onClose }`. Comportement :
- Liste des fournisseurs (nom + nb de produits liés + badge « inactif »).
- Ajouter : input nom + `supabase.from('suppliers').insert({ name }).select().single()` → push dans l'état. Erreur d'unicité → `alert`.
- Renommer : édition inline, `update({ name }).eq('id', …)`.
- Supprimer / désactiver :

```javascript
const removeSupplier = async (s) => {
  const linked = productSuppliers.some(l => l.supplier_id === s.id);
  if (linked) {
    const { error } = await supabase.from('suppliers').update({ active: false }).eq('id', s.id);
    if (error) { alert('Erreur : ' + error.message); return; }
    setSuppliers(prev => prev.map(x => x.id === s.id ? { ...x, active: false } : x));
  } else {
    const { error } = await supabase.from('suppliers').delete().eq('id', s.id);
    if (error) { alert('Erreur : ' + error.message); return; }
    setSuppliers(prev => prev.filter(x => x.id !== s.id));
  }
};
```

- Réactiver un inactif : `update({ active: true })`.
- Style : même patron de modale que « Ajouter un produit » (overlay fixed + carte 440px).

- [ ] **Step 2 : Implémenter ProduitFournisseurs (section de la modale d'édition)**

Props : `{ t, product, suppliers, productSuppliers, setProductSuppliers }`. Comportement :
- Liste `supplierLinksOf(product._uuid, productSuppliers, suppliers)` : ⭐ sur le principal, prix HT éditable (input number, `update({ price_ht })` au blur), bouton ✕ pour retirer une liaison (`delete().eq('id', link.id)`).
- « Définir principal » : deux updates séquentiels pour respecter l'index unique :

```javascript
const setPrimary = async (link) => {
  const old = productSuppliers.find(l => l.product_id === product._uuid && l.is_primary && l.id !== link.id);
  if (old) await supabase.from('product_suppliers').update({ is_primary: false }).eq('id', old.id);
  const { error } = await supabase.from('product_suppliers').update({ is_primary: true }).eq('id', link.id);
  if (error) { alert('Erreur : ' + error.message); return; }
  setProductSuppliers(prev => prev.map(l =>
    l.product_id !== product._uuid ? l : { ...l, is_primary: l.id === link.id }));
};
```

- « + Ajouter un fournisseur » : select des fournisseurs actifs non déjà liés + prix optionnel → `insert({ product_id, supplier_id, price_ht, is_primary: <true si première liaison> })`.
- Affiche aussi « Prix mercuriale : X € HT/unité » depuis `product.priceUnit` si non null.

- [ ] **Step 3 : Brancher dans la modale d'édition produit de StocksModule**

Dans la modale « Modifier le produit » (après le bloc quantité actuelle, l.340) :

```javascript
<ProduitFournisseurs t={t} product={editingProduct} suppliers={suppliers}
  productSuppliers={productSuppliers} setProductSuppliers={setProductSuppliers} />
```

Corriger au passage `deleteProduct` (l.110-114) qui ne supprime qu'en local : ajouter `await supabase.from('products').delete().eq('id', editingProduct._uuid);` (cascade sur les liaisons).

- [ ] **Step 4 : Vérifier build + tests, puis commit**

Run : `npm test; npm run build`
Expected : PASS + build OK.

```powershell
git add src/components/FournisseursModal.jsx src/components/ProduitFournisseurs.jsx src/components/StocksModule.jsx
git commit -m "feat(stock): gestion des fournisseurs et liaisons produit-fournisseur"
```

---

### Task 7 : Vérification de bout en bout (local)

**Files:**
- Create: `pw_verif_stock.cjs` (racine, gitignoré par `pw_*.cjs`)

- [ ] **Step 1 : Écrire le script Playwright**

Identifiants via variables d'environnement (`RESTOAPP_EMAIL` / `RESTOAPP_PASSWORD`), jamais en dur. Scénario :

```javascript
// Vérification stock multi-fournisseurs — lance `npm run dev` avant.
// Usage : $env:RESTOAPP_EMAIL='…'; $env:RESTOAPP_PASSWORD='…'; node pw_verif_stock.cjs
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const shot = (n) => page.screenshot({ path: `.verif-stock/${n}.png`, fullPage: true });
  await page.goto('http://localhost:5173');
  await page.fill('input[type="email"]', process.env.RESTOAPP_EMAIL);
  await page.fill('input[type="password"]', process.env.RESTOAPP_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);
  // 1. Onglet Stocks : badges "Seuil à définir"
  await page.click('text=Stocks');
  await page.waitForSelector('text=Seuil à définir');
  await shot('01-inventaire-badges');
  // 2. Liste de courses groupée
  await page.click('text=Liste de courses');
  await shot('02-courses');
  // 3. Mode inventaire : sommaire + comptage d'un produit
  await page.click('text=Faire l\'inventaire');
  await page.waitForSelector('text=/ 78 comptés');
  await shot('03-sommaire');
  await page.click('text=Viandes & Poissons');
  await page.fill('input[type="number"]', '4');
  await page.click('text=✓ Suivant');
  await page.waitForTimeout(1000);
  await shot('04-comptage');
  // 4. Fournisseurs (gérant)
  await page.click('text=← Catégories'); await page.click('text=Terminer pour aujourd\'hui');
  await page.click('text=Fournisseurs');
  await page.waitForSelector('text=Metro');
  await shot('05-fournisseurs');
  console.log('OK — captures dans .verif-stock/');
  await browser.close();
})().catch(e => { console.error('ECHEC :', e.message); process.exit(1); });
```

- [ ] **Step 2 : Exécuter la vérification**

Run : `npm run dev` (arrière-plan) puis `node pw_verif_stock.cjs` avec les identifiants gérant en variables d'env.
Expected : `OK`, 5 captures cohérentes (badges gris, groupes fournisseurs, sommaire 6 catégories, comptage enregistré, liste des 10 fournisseurs).

- [ ] **Step 3 : Vérifier la RLS (requêtes directes)**

Script Node jetable (ou curl) avec la clé **anon sans login** :
- `GET /rest/v1/suppliers` → `[]` ou 401 (bloqué). Idem `product_suppliers`, `products`, `stock_movements`.

Avec un login **employé** (compte non-gérant) :
- `PATCH /rest/v1/products?id=eq.<uuid>` body `{"seuil": 99}` → 0 ligne modifiée (bloqué par RLS).
- `rpc/enregistrer_comptage` avec `p_qty: 5` → 200, la quantité change.
- `rpc/enregistrer_comptage` avec `p_qty: -1` → erreur `quantite invalide`.

Expected : les 3 comportements confirmés. Sinon STOP et corriger la migration avant de continuer.

- [ ] **Step 4 : Suite complète + build**

Run : `npm test; npm run lint; npm run build`
Expected : tout vert.

---

### CHECKPOINT 2 — Validation visuelle JC (AVANT tout push)

JC teste en local (`npm run dev`) : inventaire guidé complet d'une catégorie sur son téléphone (réseau local) ou navigateur, liste de courses, partage texte, fiche produit avec fournisseurs, CRUD fournisseur, déclaration + validation d'une sortie. **Aucun push avant son OK.**

---

### Task 8 : Mise en prod

- [ ] **Step 1 : Push**

```powershell
git push
```

Vercel déploie automatiquement depuis `main`.

- [ ] **Step 2 : Re-vérification en prod**

Sur `https://restoapp-khaki.vercel.app` (compte gérant) : les 78 produits s'affichent, badges corrects, mode inventaire fonctionne (compter 1 produit puis le recompter à la bonne valeur), liste de courses groupée, fournisseurs listés.

- [ ] **Step 3 : Documentation**

Ajouter une section « Stock multi-fournisseurs » à `docs/EXPLOITATION.md` (tables, RPC, règle seuil null, où est le SQL non committé et pourquoi) + mise à jour de la mémoire Jarvis.

---

## Self-review du plan (faite)

- **Couverture spec :** §3 modèle → Task 1 ; §4 import → Task 1 ; §5.1 → Task 5 ; §5.2 → Task 4 ; §5.3 → Task 6 ; §5.4 → Task 6 ; §5.5 → Task 4 ; §6 RLS → Tasks 1+7 ; §7 cas limites → Tasks 2/5 (passer≠0, null) + Task 1 (transaction) ; §8 vérification → Task 7 + checkpoints.
- **Écart vs spec assumé :** la spec disait 79 produits ; le doublon « Sauce BBQ Colona » ramène à **78** (65 − 1 doublon + 14). Les compteurs du plan (78/76) en tiennent compte.
- **Types cohérents :** `sorties[].productUuid` (Task 3) utilisé dans Task 4 ; `supplierLinksOf/computeShoppingList/formatShoppingListText/countedTodayIds` définis Task 2, consommés Tasks 4-6 ; props `suppliers/productSuppliers` passées Task 3, signature Task 4.
