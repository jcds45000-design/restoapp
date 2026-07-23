import { describe, it, expect } from 'vitest';
import {
  CANAUX, SETTINGS_DEFAUT, uniteRecettePour, prixParUniteRecette,
  coutMatiere, ttcVersHT, prixCanal, rentabiliteCanal,
  prixEquivalence, prixConseille, arrondi10ctsSup,
  couleurFoodCost, couleurMarge,
  grouperLignesParRecette, coutRecette, coutArticle, suggestionRattachement, resumeRecettes,
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

// Recettes de test (réutilisent produits/ps ci-dessus) :
//   p1 = 10 €/kg (0,01 €/g), p2 = 0,15 €/pièce, p4 = « Sans prix » (null).
const sauce = { id: 'r_sauce', nom: 'Sauce', rendement_valeur: 1,  rendement_unite: 'portion', cout_force: null };
const plat  = { id: 'r_plat',  nom: 'Plat',  rendement_valeur: 10, rendement_unite: 'piece',   cout_force: null };
const recettesById = { r_sauce: sauce, r_plat: plat };
const lignesRec = [
  { id: 'l1', recipe_id: 'r_sauce', product_id: 'p1', sous_recette_id: null, qty: 100, unit: 'g', cout_force: null },
  { id: 'l2', recipe_id: 'r_plat',  product_id: 'p2', sous_recette_id: null, qty: 2,   unit: 'piece', cout_force: null },
  { id: 'l3', recipe_id: 'r_plat',  product_id: null, sous_recette_id: 'r_sauce', qty: 0.5, unit: 'portion', cout_force: null },
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

describe('prixParUniteRecette : repli sur la mercuriale (price_unit)', () => {
  it('utilise la mercuriale quand le fournisseur principal n\'a pas de prix (8 €/kg = 0,008 €/g)', () => {
    const p = { id: 'm1', name: 'Poulet', unit: 'kg', priceUnit: 8 };
    const psLoc = [{ product_id: 'm1', supplier_id: 's1', price_ht: null, is_primary: true }];
    expect(prixParUniteRecette(p, psLoc)).toBeCloseTo(0.008, 6);
  });
  it('le prix du fournisseur principal prime sur la mercuriale', () => {
    const p = { id: 'm2', name: 'Poulet', unit: 'kg', priceUnit: 99 };
    const psLoc = [{ product_id: 'm2', supplier_id: 's1', price_ht: 10, is_primary: true }];
    expect(prixParUniteRecette(p, psLoc)).toBeCloseTo(0.01, 6);
  });
  it('utilise la mercuriale même sans aucun fournisseur lié', () => {
    const p = { id: 'm3', name: 'Sauce', unit: 'L', priceUnit: 4 };
    expect(prixParUniteRecette(p, [])).toBeCloseTo(0.004, 6);
  });
  it('mercuriale en pièce reste en €/pièce', () => {
    const p = { id: 'm4', name: 'Coca', unit: 'pièce', priceUnit: 0.52 };
    expect(prixParUniteRecette(p, [])).toBeCloseTo(0.52, 6);
  });
  it('ni prix fournisseur ni mercuriale → null', () => {
    const p = { id: 'm5', name: 'Rien', unit: 'kg' };
    const psLoc = [{ product_id: 'm5', supplier_id: 's1', price_ht: null, is_primary: true }];
    expect(prixParUniteRecette(p, psLoc)).toBeNull();
  });
});

describe('uniteRecettePour', () => {
  it.each([['kg', 'g'], ['L', 'ml'], ['pièce', 'piece'], ['piece', 'piece'], ['boîte', 'piece']])(
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
  it('un produit sans prix fournisseur mais avec mercuriale n\'est plus signalé « sans prix »', () => {
    const produitsMerc = [{ id: 'p4', name: 'Sans prix', unit: 'kg', priceUnit: 5 }];
    const r = coutMatiere([{ product_id: 'p4', qty: 100, unit: 'g' }], produitsMerc, ps);
    expect(r.total).toBeCloseTo(0.5, 6); // 5 €/kg = 0,005 €/g × 100 g
    expect(r.lignesSansPrix).toEqual([]);
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

describe('CANAUX', () => {
  it('expose les 4 canaux dans l\'ordre attendu', () => {
    expect(CANAUX.map((c) => c.id)).toEqual(['sur_place', 'click_collect', 'uber_eats', 'deliveroo']);
  });
});

describe('ttcVersHT', () => {
  it('7,00 € TTC à 10 % → 6,36 € HT', () => {
    expect(ttcVersHT(7, 10)).toBeCloseTo(6.36, 2);
  });
});

// --- Recettes, sous-recettes et rendements (v2) ---

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
      { id: 'a', recipe_id: 'r_sko', product_id: 'p4', sous_recette_id: null, qty: 10, unit: 'g', cout_force: null },
      { id: 'b', recipe_id: 'r_pko', product_id: null, sous_recette_id: 'r_sko', qty: 1, unit: 'portion', cout_force: null },
    ]);
    const r = coutRecette({ recette: platKO, recettesById: rById, lignesByRecette: lg, produits, productSuppliers: ps });
    expect(r.incomplet).toBe(true);
    expect(r.raisons).toContain('Sans prix');
  });
});

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

describe('coutRecette : overrides', () => {
  it('coût forcé sur une ligne écrase le calcul', () => {
    const rById = { r_sauce: sauce };
    const lg = grouperLignesParRecette([
      { id: 'f', recipe_id: 'r_sauce', product_id: 'p1', sous_recette_id: null, qty: 100, unit: 'g', cout_force: 0.09 },
    ]);
    const r = coutRecette({ recette: sauce, recettesById: rById, lignesByRecette: lg, produits, productSuppliers: ps });
    expect(r.total).toBeCloseTo(0.09, 6);
  });
  it('coût forcé sur la recette écrase tout et se répartit sur le rendement', () => {
    const forced = { id: 'g', nom: 'Forcee', rendement_valeur: 5, rendement_unite: 'piece', cout_force: 2.5 };
    const r = coutRecette({ recette: forced, recettesById: { g: forced }, lignesByRecette: {}, produits, productSuppliers: ps });
    expect(r.force).toBe(true);
    expect(r.total).toBeCloseTo(2.5, 6);
    expect(r.coutParUnite).toBeCloseTo(0.5, 6);
  });
});

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

describe('resumeRecettes', () => {
  it('costue chaque recette et remonte l\'état', () => {
    const rs = resumeRecettes([sauce, plat], grouperLignesParRecette(lignesRec), produits, ps);
    const parId = Object.fromEntries(rs.map((x) => [x.recette.id, x]));
    expect(parId['r_sauce'].coutParUnite).toBeCloseTo(1.0, 6);
    expect(parId['r_plat'].coutParUnite).toBeCloseTo(0.08, 6);
    expect(parId['r_plat'].incomplet).toBe(false);
  });
});
