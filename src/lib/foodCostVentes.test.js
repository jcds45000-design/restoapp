import { describe, it, expect } from 'vitest';
import { foodCostReel } from './foodCostVentes.js';

// Coûts déjà calculés par etatArticles / etatCouts : on les injecte tels quels.
const articles = [
  { articleId: 'mi_box10', coutMatiere: 3 },
  { articleId: 'mi_mozza', coutMatiere: 0.8 },
  { articleId: 'mi_incomplet', coutMatiere: null },
];
const parRecette = {
  rc_frites: { coutMatiere: 0.15 },
  rc_glacage: { coutMatiere: null },
};
const menuItems = [
  { id: 'mi_box10', name: 'Boneless x10', category: 'Poulet frit', recipe_id: 'r_b10' },
  { id: 'mi_mozza', name: 'Mozzarella', category: 'Corndog', recipe_id: 'r_mozza' },
  { id: 'mi_menucd', name: 'Menu corndog', category: 'Menus', recipe_id: null },
  { id: 'mi_incomplet', name: 'Plat incomplet', category: 'Plats', recipe_id: 'r_x' },
];
const mappings = [
  { abill_product_id: 'lib:BONELESS X10', cible_type: 'recette', menu_item_id: 'mi_box10', recipe_id: 'r_b10' },
  { abill_product_id: 'lib:MOZZARELLA', cible_type: 'recette', menu_item_id: 'mi_mozza', recipe_id: 'r_mozza' },
  { abill_product_id: 'lib:MENU CORNDOG', cible_type: 'menu', menu_item_id: 'mi_menucd', recipe_id: null },
  { abill_product_id: 'lib:FRITES', cible_type: 'recette', menu_item_id: null, recipe_id: 'rc_frites' },
  { abill_product_id: 'lib:CARAMELISE', cible_type: 'recette', menu_item_id: null, recipe_id: 'rc_glacage' },
  { abill_product_id: 'lib:POURBOIRE', cible_type: 'ignorer', menu_item_id: null, recipe_id: null },
  { abill_product_id: 'lib:PLAT X', cible_type: 'recette', menu_item_id: 'mi_incomplet', recipe_id: 'r_x' },
  { abill_product_id: 'lib:KETCHUP', cible_type: 'a_mapper', menu_item_id: null, recipe_id: null },
];
const ligne = (id, quantity, total_ttc, total_ht, extra = {}) => ({
  abill_product_id: id, libelle: id.replace('lib:', ''), quantity, total_ttc, total_ht, exclu_ca: false, ...extra,
});
const base = { mappings, articles, parRecette, menuItems };

describe('foodCostReel', () => {
  it('pondère les articles payants par leur CA HT réel', () => {
    const r = foodCostReel({ ...base, lignesVente: [ligne('lib:BONELESS X10', 2, 22, 20)] });
    expect(r.caHt).toBe(20);
    expect(r.caHtCouvert).toBe(20);
    expect(r.coutPayants).toBe(6);
    expect(r.foodCostPct).toBeCloseTo(30, 6);
    expect(r.couverturePct).toBeCloseTo(100, 6);
  });

  it('ajoute le coût des options à 0 € sans leur donner de CA', () => {
    const r = foodCostReel({ ...base, lignesVente: [
      ligne('lib:BONELESS X10', 2, 22, 20),
      ligne('lib:FRITES', 2, 0, 0),
    ] });
    expect(r.caHt).toBe(20);
    expect(r.coutOptions).toBeCloseTo(0.3, 6);
    expect(r.optionsCouvertes).toBe(2);
    expect(r.foodCostPct).toBeCloseTo(31.5, 6);
  });

  it('compte une option non mappée à part, sans coût, et la liste', () => {
    const r = foodCostReel({ ...base, lignesVente: [
      ligne('lib:BONELESS X10', 1, 11, 10),
      ligne('lib:KETCHUP', 3, 0, 0),
    ] });
    expect(r.optionsNonMappees).toBe(3);
    expect(r.coutOptions).toBe(0);
    expect(r.optionsAMapper).toEqual([{ libelle: 'KETCHUP', quantite: 3 }]);
  });

  it('écarte entièrement une ligne mappée « ignorer », CA compris', () => {
    const r = foodCostReel({ ...base, lignesVente: [
      ligne('lib:BONELESS X10', 1, 11, 10),
      ligne('lib:POURBOIRE', 1, 2, 2),
    ] });
    expect(r.caHt).toBe(10);
    expect(r.couverturePct).toBeCloseTo(100, 6);
  });

  it('un menu sans recette compte 0 € de base et reste visible', () => {
    const r = foodCostReel({ ...base, lignesVente: [
      ligne('lib:MENU CORNDOG', 1, 8.8, 8),
      ligne('lib:MOZZARELLA', 1, 0, 0),
    ] });
    expect(r.caHtCouvert).toBe(8);
    expect(r.coutPayants).toBe(0);
    expect(r.coutOptions).toBeCloseTo(0.8, 6);
    expect(r.foodCostPct).toBeCloseTo(10, 6);
    expect(r.menusSansBase).toEqual([{ nom: 'Menu corndog', quantite: 1 }]);
  });

  it('un article payant non mappé fait baisser la couverture', () => {
    const r = foodCostReel({ ...base, lignesVente: [
      ligne('lib:BONELESS X10', 2, 22, 20),
      ligne('lib:INCONNU', 1, 11, 10),
    ] });
    expect(r.caHt).toBe(30);
    expect(r.caHtCouvert).toBe(20);
    expect(r.payantsNonMappes).toBe(1);
    expect(r.couverturePct).toBeCloseTo(66.6667, 3);
    expect(r.foodCostPct).toBeCloseTo(30, 6);
  });

  it('un article mappé au coût incalculable compte comme non couvert', () => {
    const r = foodCostReel({ ...base, lignesVente: [ligne('lib:PLAT X', 1, 11, 10)] });
    expect(r.payantsSansCout).toBe(1);
    expect(r.caHtCouvert).toBe(0);
    expect(r.foodCostPct).toBeNull();
  });

  it('une option visant une recette sans coût est comptée à part', () => {
    const r = foodCostReel({ ...base, lignesVente: [
      ligne('lib:BONELESS X10', 1, 11, 10),
      ligne('lib:CARAMELISE', 1, 0, 0),
    ] });
    expect(r.optionsSansCout).toBe(1);
    expect(r.coutOptions).toBe(0);
  });

  it('ignore les lignes exclues du CA et traite un offert comme une option', () => {
    const r = foodCostReel({ ...base, lignesVente: [
      ligne('lib:BONELESS X10', 1, 11, 10),
      ligne('lib:BONELESS X10', 5, 55, 50, { exclu_ca: true }),
      ligne('lib:BONELESS X10', 1, 0, 0, { offert: true }),
    ] });
    expect(r.caHt).toBe(10);
    expect(r.coutPayants).toBe(3);
    expect(r.coutOptions).toBe(3);
    expect(r.foodCostPct).toBeCloseTo(60, 6);
  });

  it('renvoie des zéros et un food cost null sans aucune vente', () => {
    const r = foodCostReel({ ...base, lignesVente: [] });
    expect(r.caHt).toBe(0);
    expect(r.foodCostPct).toBeNull();
    expect(r.couverturePct).toBeNull();
  });
});
