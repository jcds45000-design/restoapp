import { describe, it, expect } from 'vitest';
import {
  recettesUtilisant, simuler, etatCouts, etatArticles, alertes, dashboard, NIVEAUX,
} from './pilotage.js';
import { grouperLignesParRecette } from './rentabilite.js';

const LE_JOUR = new Date('2026-08-27T12:00:00Z');

// Chaîne à trois niveaux : mayonnaise -> sauce crémeuse -> Crousty.
const produits = [
  { id: 'p_mayo', name: 'Mayonnaise', unit: 'L' },
  { id: 'p_creme', name: 'Crème fraîche', unit: 'L' },
  { id: 'p_riz', name: 'Riz', unit: 'kg' },
  { id: 'p_sel', name: 'Sel', unit: 'kg' },
];
const ps = [
  { product_id: 'p_mayo', supplier_id: 's1', price_ht: 4.73, is_primary: true, source_prix: 'FACTURE', date_prix: '2026-08-01' },
  { product_id: 'p_creme', supplier_id: 's1', price_ht: 4.36, is_primary: true, source_prix: 'ANCIEN_TARIF', date_prix: '2026-08-01' },
  { product_id: 'p_riz', supplier_id: 's1', price_ht: 1.75, is_primary: true, source_prix: 'FACTURE', date_prix: '2026-01-01' },
  { product_id: 'p_sel', supplier_id: 's1', price_ht: null, is_primary: true },
];
const recettes = [
  { id: 'r_sauce', nom: 'Sauce crémeuse', rendement_valeur: 2400, rendement_unite: 'g', sous_recette_seulement: true, cout_force: null },
  { id: 'r_crousty', nom: 'Crousty', rendement_valeur: 1, rendement_unite: 'portion', sous_recette_seulement: false, cout_force: null, prix_vente_ttc: 9.9 },
  { id: 'r_bol', nom: 'Bol de riz', rendement_valeur: 1, rendement_unite: 'portion', sous_recette_seulement: false, cout_force: null, prix_vente_ttc: 4.5 },
  { id: 'r_sale', nom: 'Plat salé', rendement_valeur: 1, rendement_unite: 'portion', sous_recette_seulement: false, cout_force: null, prix_vente_ttc: 5 },
];
const lignes = [
  { id: 'l1', recipe_id: 'r_sauce', product_id: 'p_creme', qty: 2000, unit: 'ml' },
  { id: 'l2', recipe_id: 'r_sauce', product_id: 'p_mayo', qty: 400, unit: 'ml' },
  { id: 'l3', recipe_id: 'r_crousty', sous_recette_id: 'r_sauce', qty: 40, unit: 'g' },
  { id: 'l4', recipe_id: 'r_crousty', product_id: 'p_riz', qty: 275, unit: 'g' },
  { id: 'l5', recipe_id: 'r_bol', product_id: 'p_riz', qty: 300, unit: 'g' },
  { id: 'l6', recipe_id: 'r_sale', product_id: 'p_sel', qty: 5, unit: 'g' },
];
const lignesByRecette = grouperLignesParRecette(lignes);
const packagings = [
  { id: 'k1', reference: 'EK430K', prix_unite_ht: 0.1998 },
  { id: 'k2', reference: 'SANSPRIX', prix_unite_ht: null },
];
const settings = { tva: 10, seuil_food_cost_vert: 25, seuil_food_cost_orange: 30,
  seuil_prix_ancien_mois: 6, seuil_hausse_alerte_pct: 10, marge_min_pct: 60 };
const base = { produits, productSuppliers: ps, recettes, lignes, packagings, settings, aujourdHui: LE_JOUR };

describe('recettesUtilisant', () => {
  it('trouve l usage direct', () => {
    const r = recettesUtilisant('p_riz', recettes, lignesByRecette);
    expect(r.directes.sort()).toEqual(['r_bol', 'r_crousty']);
  });
  it('remonte la chaîne des sous-recettes', () => {
    const r = recettesUtilisant('p_mayo', recettes, lignesByRecette);
    expect(r.directes).toEqual(['r_sauce']);
    expect(r.toutes.sort()).toEqual(['r_crousty', 'r_sauce']);
  });
  it('ne remonte rien pour un ingrédient inutilisé', () => {
    expect(recettesUtilisant('p_inconnu', recettes, lignesByRecette).toutes).toEqual([]);
  });
});

describe('etatCouts', () => {
  it('calcule coût, food cost et marge', () => {
    const e = etatCouts(base);
    const c = e.parRecette.r_crousty;
    // sauce : (2000 ml x 0,00436) + (400 ml x 0,00473) = 8,72 + 1,892 = 10,612 / 2400 g
    // crousty : 40 g de sauce + 275 g de riz
    expect(c.coutMatiere).toBeCloseTo((10.612 / 2400) * 40 + 0.00175 * 275, 5);
    expect(c.prixHT).toBeCloseTo(9, 2);
    expect(c.foodCostPct).toBeGreaterThan(0);
    expect(c.incomplet).toBe(false);
  });
  it('marque incomplet sans inventer de coût', () => {
    const e = etatCouts(base);
    expect(e.parRecette.r_sale.coutMatiere).toBeNull();
    expect(e.parRecette.r_sale.foodCostPct).toBeNull();
    expect(e.parRecette.r_sale.raisons).toContain('Sel');
  });
});

describe('simuler', () => {
  it('propage une hausse de mayonnaise jusqu au Crousty', () => {
    const r = simuler({ ...base, changements: { prixIngredient: { p_mayo: 6.0 } } });
    const crousty = r.impacts.find((x) => x.recetteId === 'r_crousty');
    expect(crousty).toBeDefined();
    // 400 ml de mayo sur 2400 g de sauce, dont 40 g dans le Crousty
    const attendu = ((6.0 - 4.73) / 1000) * 400 / 2400 * 40;
    expect(crousty.delta).toBeCloseTo(attendu, 6);
    expect(crousty.deltaPct).toBeGreaterThan(0);
  });
  it('n affecte pas les produits qui n utilisent pas l ingrédient', () => {
    const r = simuler({ ...base, changements: { prixIngredient: { p_mayo: 6.0 } } });
    expect(r.impacts.find((x) => x.recetteId === 'r_bol')).toBeUndefined();
  });
  it('classe les impacts du plus fort au plus faible', () => {
    const r = simuler({ ...base, changements: { prixIngredient: { p_riz: 3.5 } } });
    const deltas = r.impacts.map((x) => Math.abs(x.delta));
    expect(deltas).toEqual([...deltas].sort((a, b) => b - a));
  });
  it('simule un changement de grammage', () => {
    const r = simuler({ ...base, changements: { grammage: { l4: 400 } } });
    const c = r.impacts.find((x) => x.recetteId === 'r_crousty');
    expect(c.delta).toBeCloseTo(0.00175 * 125, 6);
  });
  it('simule un prix de vente sans toucher au coût', () => {
    const r = simuler({ ...base, changements: { prixVente: { r_crousty: 12 } } });
    const c = r.impacts.find((x) => x.recetteId === 'r_crousty');
    expect(c.delta).toBeCloseTo(0, 9);
    expect(c.apres.prixHT).toBeGreaterThan(c.avant.prixHT);
    expect(c.apres.foodCostPct).toBeLessThan(c.avant.foodCostPct);
  });
  it('ne modifie jamais les données d origine', () => {
    const copiePs = JSON.parse(JSON.stringify(ps));
    const copieLignes = JSON.parse(JSON.stringify(lignes));
    simuler({ ...base, changements: { prixIngredient: { p_mayo: 99 }, grammage: { l4: 999 } } });
    expect(ps).toEqual(copiePs);
    expect(lignes).toEqual(copieLignes);
  });
});

describe('alertes', () => {
  const historique = [
    { product_id: 'p_mayo', ancien_prix: 4, nouveau_prix: 4.73, variation_pct: 18.25 },
    { product_id: 'p_creme', ancien_prix: 4.36, nouveau_prix: 4.4, variation_pct: 0.92 },
  ];
  it('signale une hausse au-dessus du seuil, pas en dessous', () => {
    const a = alertes({ ...base, historique });
    const h = a.filter((x) => x.type === 'hausse_prix');
    expect(h).toHaveLength(1);
    expect(h[0].cible).toBe('Mayonnaise');
  });
  it('signale un ingrédient sans prix qui bloque des recettes', () => {
    const a = alertes({ ...base, historique });
    const s = a.find((x) => x.type === 'ingredient_sans_prix');
    expect(s.cible).toBe('Sel');
    expect(s.niveau).toBe(NIVEAUX.CRITIQUE);
  });
  it('signale un emballage sans prix', () => {
    const a = alertes({ ...base, historique });
    expect(a.find((x) => x.type === 'emballage_sans_prix').cible).toBe('SANSPRIX');
  });
  it('signale un prix périmé', () => {
    const a = alertes({ ...base, historique });
    expect(a.find((x) => x.type === 'prix_perime' && x.cible === 'Riz')).toBeDefined();
  });
  it('signale les recettes incomplètes', () => {
    const a = alertes({ ...base, historique });
    expect(a.find((x) => x.type === 'recette_incomplete' && x.cible === 'Plat salé')).toBeDefined();
  });
  it('trie par gravité décroissante', () => {
    const a = alertes({ ...base, historique });
    const n = a.map((x) => x.niveau);
    expect(n).toEqual([...n].sort((x, y) => y - x));
  });
});

describe('dashboard', () => {
  it('pondère le food cost par les ventes quand elles existent', () => {
    const d = dashboard({ ...base, ventes: { r_crousty: 300, r_bol: 10 } });
    expect(d.methodeFoodCost).toContain('pondéré');
    const simple = dashboard({ ...base });
    expect(simple.methodeFoodCost).toContain('NON pondérée');
    expect(d.foodCostMoyen).not.toBeCloseTo(simple.foodCostMoyen, 3);
  });
  it('avertit explicitement quand la moyenne n est pas pondérée', () => {
    const d = dashboard({ ...base });
    expect(d.methodeFoodCost).toMatch(/prudence/);
  });
  it('classe les blocages par nombre de produits touchés', () => {
    const d = dashboard({ ...base });
    expect(d.blocagesParFrequence[0].cause).toBe('Sel');
    expect(d.blocagesParFrequence[0].produits).toBe(1);
  });
  it('compte les produits complets', () => {
    const d = dashboard({ ...base });
    expect(d.nbProduits).toBe(3);
    expect(d.nbComplets).toBe(2);
  });
  it('remonte les plus fortes hausses', () => {
    const d = dashboard({ ...base, historique: [
      { product_id: 'p_mayo', ancien_prix: 4, nouveau_prix: 4.73, variation_pct: 18.25 },
      { product_id: 'p_riz', ancien_prix: 1, nouveau_prix: 1.75, variation_pct: 75 },
    ] });
    expect(d.plusFortesHausses[0].nom).toBe('Riz');
    expect(d.plusFortesHausses[0].variation).toBe(75);
  });
});

describe('etatArticles : plusieurs articles pour une même recette', () => {
  // Cas réel Kimiko : une recette batch, quatre formats de vente.
  const menuItems = [
    { id: 'm5', name: 'Bol x1', price: 4.5, recipe_id: 'r_bol', recipe_qty: 1 },
    { id: 'm10', name: 'Bol x2', price: 8.0, recipe_id: 'r_bol', recipe_qty: 2 },
  ];
  it('calcule un coût et un food cost par article, pas par recette', () => {
    const a = etatArticles({ ...base, menuItems });
    expect(a).toHaveLength(2);
    const x1 = a.find((x) => x.articleId === 'm5');
    const x2 = a.find((x) => x.articleId === 'm10');
    expect(x2.coutMatiere).toBeCloseTo(x1.coutMatiere * 2, 6);
    // deux prix distincts, donc deux food costs distincts
    expect(x1.foodCostPct).not.toBeCloseTo(x2.foodCostPct, 3);
  });
  it('le dashboard s appuie sur les articles quand ils existent', () => {
    const d = dashboard({ ...base, menuItems });
    expect(d.nbArticlesRattaches).toBe(2);
    expect(d.nbDansMoyenne).toBe(2);
  });
  it('signale une moyenne non représentative', () => {
    const d = dashboard({ ...base, menuItems: [menuItems[0]] });
    expect(d.representatif).toBe(false);
  });
});

describe('etatArticles : emballages par article (menu_item_packaging)', () => {
  // Cas réel Kimiko : une boisson = un pot + son couvercle (prix fictifs). Les liens par
  // article priment sur l emballage par défaut de la recette (un seul possible).
  const pkgs = [
    { id: 'kpot', reference: 'POT-A', prix_unite_ht: 0.11111 },
    { id: 'kcouv', reference: 'COUV-A', prix_unite_ht: 0.06333 },
    { id: 'kdef', reference: 'DEFAUT', prix_unite_ht: 0.5 },
  ];
  const recettesPkg = [{ ...recettes[2], packaging_defaut_id: 'kdef' }]; // r_bol
  const menuItems = [{ id: 'mb', name: 'Boisson', price: 4.5, recipe_id: 'r_bol', recipe_qty: 1 }];
  it('additionne pot + couvercle quand les liens par article existent', () => {
    const liensEmballage = [
      { menu_item_id: 'mb', packaging_id: 'kpot', qty: 1 },
      { menu_item_id: 'mb', packaging_id: 'kcouv', qty: 1 },
    ];
    const a = etatArticles({ ...base, recettes: recettesPkg, packagings: pkgs, menuItems, liensEmballage });
    expect(a[0].emballage).toBeCloseTo(0.17444, 5);
  });
  it('sans lien par article, repli sur l emballage par défaut de la recette', () => {
    const a = etatArticles({ ...base, recettes: recettesPkg, packagings: pkgs, menuItems, liensEmballage: [] });
    expect(a[0].emballage).toBeCloseTo(0.5, 6);
  });
  it('un lien vers un emballage sans prix rend l article incomplet, jamais gratuit', () => {
    const liensEmballage = [{ menu_item_id: 'mb', packaging_id: 'kinconnu', qty: 1 }];
    const a = etatArticles({ ...base, recettes: recettesPkg, packagings: pkgs, menuItems, liensEmballage });
    expect(a[0].emballage).toBe(null);
    expect(a[0].incomplet).toBe(true);
  });
});
