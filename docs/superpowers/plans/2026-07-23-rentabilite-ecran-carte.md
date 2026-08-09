# Rentabilité v2 — Phase 3 : Écran Rentabilité (carte + marges par canal) — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development ou superpowers:executing-plans. Steps en `- [ ]`.

**Goal :** Un 2e onglet « Rentabilité » (gérant) qui liste les articles de la carte avec food cost + marge, permet de rattacher chaque article à une recette (pré-rempli « Nom xN »), et montre au clic le détail par canal (marges Uber/Deliveroo + prix pour tenir la marge + simulateur).

**Architecture :** Composant `RentabiliteCarteModule.jsx` (charge menu_items, recipes, recipe_lines, menu_item_channel_prices, rentabilite_settings ; reçoit products + productSuppliers en props). Réutilise TOUTE la logique déjà en place dans `rentabilite.js` (coutArticle, rentabiliteCanal, prixEquivalence, prixConseille, prixCanal, couleurFoodCost, couleurMarge, suggestionRattachement, CANAUX, SETTINGS_DEFAUT). Visuel = maquette validée `maquette-module-rentabilite-v3.html` (écrans 2 et 3).

**Tech Stack :** React 19 + Vite, Supabase (RLS gérant), vitest.

**Rappels :** dépôt public (aucune vraie donnée committée) ; validation visuelle de JC avant commit ; `null`≠0 ; le module remappe products (`id`=index, vrai UUID dans `_uuid`) → toujours matcher par `p._uuid ?? p.id` (déjà géré dans rentabilite.js).

**Prérequis vérifié le 23/07 :** 85 menu_items en base, 0 rattaché ; tables `menu_item_channel_prices` et `rentabilite_settings` existent (migration 4). Recettes Marinade/Pâte/Wings/Boneless/3 corndogs en base.

---

## Carte des fichiers

| Fichier | Rôle | Committé ? |
|---|---|---|
| `src/lib/rentabilite.js` | Ajout helper pur `resumeArticle` (coût+food cost+marge d'un article) | oui |
| `src/lib/rentabilite.test.js` | Test du helper | oui |
| `src/components/RentabiliteCarteModule.jsx` | Écran Rentabilité (liste + détail canal + params) | oui |
| `src/RestoApp.jsx` | Onglet « Rentabilité » (gérant), à côté de « Recettes » | oui (modifié) |

---

### Task 1 : Helper pur `resumeArticle` (TDD)

Pour la liste : à partir d'un menu_item + son coût matière + les settings, renvoie food cost % et marge sur place.

**Files:** Test `src/lib/rentabilite.test.js`, Modify `src/lib/rentabilite.js`

- [ ] **Step 1 : Test (échoue)**

```js
import { resumeArticle } from './rentabilite.js';

describe('resumeArticle', () => {
  it('food cost et marge sur place (prix 6,00 € TTC, coût 1,05 €, TVA 10 %)', () => {
    const r = resumeArticle({ prixTTC: 6, cout: 1.05, tva: 10 });
    expect(r.prixHT).toBeCloseTo(5.4545, 3);
    expect(r.marge).toBeCloseTo(4.4045, 3);
    expect(r.foodCostPct).toBeCloseTo(19.25, 1);
  });
  it('coût null (article sans recette) -> valeurs nulles, pas 0', () => {
    const r = resumeArticle({ prixTTC: 6, cout: null, tva: 10 });
    expect(r.foodCostPct).toBeNull();
    expect(r.marge).toBeNull();
  });
});
```

- [ ] **Step 2 : Échec** — `npm test -- src/lib/rentabilite.test.js --run` → FAIL.

- [ ] **Step 3 : Implémenter (ajouter à `rentabilite.js`)**

```js
// Résumé « sur place » d'un article pour la liste. cout = coût matière (number) ou null.
export function resumeArticle({ prixTTC, cout, tva }) {
  const prixHT = ttcVersHT(Number(prixTTC) || 0, tva);
  if (cout === null || cout === undefined) return { prixHT, marge: null, foodCostPct: null };
  const marge = prixHT - cout;
  const foodCostPct = prixHT > 0 ? (cout / prixHT) * 100 : null;
  return { prixHT, marge, foodCostPct };
}
```

- [ ] **Step 4 : Vert** — `npm test -- src/lib/rentabilite.test.js --run` → PASS.
- [ ] **Step 5 : Commit (sur accord JC)** — `feat(rentabilite): helper resumeArticle`.

---

### Task 2 : Composant `RentabiliteCarteModule.jsx` — chargement + vue liste + rattachement

**Files:** Create `src/components/RentabiliteCarteModule.jsx`

Comportement (visuel = maquette écran 2) :
- **Chargement** (useEffect) : `menu_items` (id,name,price,category,recipe_id,recipe_qty), `recipes` (*), `recipe_lines` (*), `menu_item_channel_prices` (*), `rentabilite_settings` (id=1). products/productSuppliers en props.
- **Coût d'un article** : `coutArticle({ menuItem, recettesById, lignesByRecette, produits: products, productSuppliers })` (rattachement via `menuItem.recipe_id` + `recipe_qty`).
- **Liste** : chaque article → nom, `price` €, coût matière, marge € (`resumeArticle`), food cost coloré (`couleurFoodCost(foodCostPct, settings.seuil_food_cost)`). Ligne « Recette : X × N ✎ » modifiable ; si pas de recette : bouton **Rattacher** + suggestion pré-remplie (`suggestionRattachement(menuItem.name, recipes)`), badge « à compléter ». Recherche + tri (par food cost décroissant).
- **Rattachement** : `majRattachement(itemId, recipeId, qty)` → `supabase.from('menu_items').update({ recipe_id, recipe_qty }).eq('id', itemId)` puis recharge. Bouton « détacher » (recipe_id null).
- Clic sur un article → ouvre la **vue détail** (Task 3).

Data-access + états (squelette à compléter en implémentation, mêmes patterns que RecettesModule) :
```jsx
import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  CANAUX, SETTINGS_DEFAUT, grouperLignesParRecette, coutArticle, resumeArticle,
  rentabiliteCanal, prixCanal, prixEquivalence, prixConseille, couleurFoodCost, couleurMarge,
  suggestionRattachement,
} from '../lib/rentabilite.js';
// états : menuItems, recipes, lignes, channelPrices, settings, chargement, erreur, ouvert(id|null), recherche
// recettesById = Object.fromEntries(recipes.map(r=>[r.id,r])) ; lignesByRecette = grouperLignesParRecette(lignes)
// coutDe(item) = coutArticle({ menuItem:item, recettesById, lignesByRecette, produits:products, productSuppliers }).total
```

- [ ] **Step 1** : créer le fichier avec le chargement + la vue liste + le rattachement (pré-remplissage inclus), style inline `t` comme RecettesModule/maquette. Un article sans recette montre la suggestion « Nom xN → recette, Valider/Modifier ».
- [ ] **Step 2** : `npm run build` → OK (la vue détail arrive en Task 3 ; brancher un placeholder si besoin).

---

### Task 3 : Vue détail par canal + simulateur (dans le même fichier)

Comportement (visuel = maquette écran 3) :
- En tête : article, recette rattachée, **coût matière**.
- **Une carte par canal** (`CANAUX`) : prix de vente (éditable → `menu_item_channel_prices`), commission (`settings.commissions[canal]`), montant prélevé, encaissé HT, marge € + % colorée. Calcul via `rentabiliteCanal({ item:{id,price}, channelPrices, cout, settings, canalId })`.
- **Conseil** : si commission > 0, afficher `prixEquivalence(prixSurPlaceTTC, commission)` = « pour tenir ta marge sur-place, vends à X € » + bouton **Appliquer** (écrit le prix canal).
- **Prix par canal** : `majPrixCanal(itemId, canal, valeur)` → upsert/delete dans `menu_item_channel_prices` (vide = supprime → repli sur `menu_items.price`).
- **Simulateur** : marge cible (slider) + canal → `prixConseille(cout, margeCible, commission, settings.tva)`.

- [ ] **Step 1** : ajouter la vue détail (cartes canaux empilées + simulateur) au composant.
- [ ] **Step 2** : `npm run build` → OK.

---

### Task 4 : Paramètres + onglet dans `RestoApp.jsx`

- [ ] **Step 1 : Paramètres** (dans le module, en haut de la liste ou repliable) : TVA, seuil food cost, commissions par canal, écrits dans `rentabilite_settings` (id=1) via `majSettings(champ, valeur)`.

- [ ] **Step 2 : Onglet** dans `RestoApp.jsx` (3 modifs, comme pour Recettes) :
```js
const RentabiliteCarteModule = lazy(() => import('./components/RentabiliteCarteModule'));
```
navItems gérant, après l'entrée `recettes` :
```js
    { id: "rentabilite", label: "Rentabilité", icon: I.euro },
```
Rendu (après le bloc RECETTES) :
```jsx
        {effectiveSection === "rentabilite" && isGerant && (
          <Suspense fallback={<Loading />}><RentabiliteCarteModule t={t}
  products={products} productSuppliers={productSuppliers} /></Suspense>
        )}
```
Et ajouter `"rentabilite"` à la liste des sections connues du placeholder.

- [ ] **Step 3** : `npm run build` → OK.

---

### Task 5 : Vérification + validation visuelle de JC

- [ ] **Step 1** : `npm test -- --run` (tout vert) + `npm run build`.
- [ ] **Step 2 : `npm run dev`**, gérant, onglet **Rentabilité** :
  - Les 85 articles listés avec prix ; ceux sans recette = « à compléter ».
  - **Rattacher « Boneless x5 »** → la suggestion propose Boneless × 5 ; valider → coût ~1,30 €, food cost affiché.
  - Ouvrir l'article → détail par canal : mettre un prix Uber, voir la marge chuter, cliquer « Appliquer » l'équivalence.
  - Vérifier desktop + 390×844.
- [ ] **Step 3 : VALIDATION VISUELLE DE JC (bloquant)** — rien de committé avant son accord.
- [ ] **Step 4 : Commit + push (sur accord)** — `feat(rentabilite): ecran Rentabilite (carte, marges par canal, simulateur)`.

---

## Auto-revue
- Couverture : liste articles costés + food cost/marge (Tasks 1-2), rattachement pré-rempli (Task 2), détail par canal + équivalence + simulateur (Task 3), paramètres + onglet (Task 4), validation (Task 5). Toute la logique de calcul existe déjà (phase 1), la phase 3 est surtout de l'UI + data-access + le rattachement.
- Réutilise `coutArticle`, `rentabiliteCanal`, `prixEquivalence`, `prixConseille`, `suggestionRattachement` tels que définis et testés en phase 1.
- Le rattachement écrit `menu_items.recipe_id` + `recipe_qty` (colonnes créées migration 5).
