// Phase 1 du chantier Kimiko Pilotage : prix sourcés, emballages, coûts directs.
// Séparé de rentabilite.test.js pour garder les deux fichiers lisibles.
import { describe, it, expect } from 'vitest';
import {
  SOURCES_PRIX, moisDepuis, prixPerime, variationPct, infoPrixIngredient,
  coutEmballage, coutHuile, coutsDirects, analyseArticle, couleurFoodCostMatiere,
  coutRecette, grouperLignesParRecette,
} from './rentabilite.js';

const LE_JOUR = new Date('2026-08-27T12:00:00Z');

const poulet = { id: 'i_poulet', name: 'Filet de poulet AVS', unit: 'kg' };
const huile = { id: 'i_huile', name: 'Huile de tournesol', unit: 'L' };
const psPhase1 = [
  { product_id: 'i_poulet', supplier_id: 'sda', price_ht: 6.5, is_primary: true,
    source_prix: 'FACTURE', date_prix: '2026-08-20' },
  { product_id: 'i_huile', supplier_id: 'metro', price_ht: 1.7996, is_primary: true,
    source_prix: 'FACTURE', date_prix: '2026-01-15' },
];

const embPot = { id: 'k1', reference: 'POT-A', nom: 'Pot boisson', prix_unite_ht: 0.11111 };
const embCouv = { id: 'k2', reference: 'COUV-A', nom: 'Couvercle', prix_unite_ht: 0.06333 };
const embSansPrix = { id: 'k3', reference: 'ZZZ', nom: 'Sans prix', prix_unite_ht: null };

describe('moisDepuis et prixPerime', () => {
  it('compte les mois écoulés', () => {
    expect(moisDepuis('2026-02-27', LE_JOUR)).toBe(6);
    expect(moisDepuis('2026-08-20', LE_JOUR)).toBe(0);
  });
  it('ne compte pas un mois entamé', () => {
    expect(moisDepuis('2026-02-28', LE_JOUR)).toBe(5);
  });
  it('un prix daté de 6 mois est périmé au seuil de 6', () => {
    expect(prixPerime('2026-02-27', 6, LE_JOUR)).toBe(true);
    expect(prixPerime('2026-05-01', 6, LE_JOUR)).toBe(false);
  });
  it('un prix sans date est considéré périmé, jamais frais', () => {
    expect(prixPerime(null, 6, LE_JOUR)).toBe(true);
  });
});

describe('variationPct', () => {
  it('poulet 5,65 vers 6,50 donne +15,0 %', () => {
    expect(variationPct(5.65, 6.5)).toBeCloseTo(15.04, 1);
  });
  it('une baisse est négative', () => {
    expect(variationPct(10, 8)).toBeCloseTo(-20, 6);
  });
  it('sans ancien prix, aucune variation inventée', () => {
    expect(variationPct(null, 6.5)).toBeNull();
    expect(variationPct(0, 6.5)).toBeNull();
  });
});

describe('infoPrixIngredient', () => {
  it('expose le prix, sa source et sa date', () => {
    const i = infoPrixIngredient(poulet, psPhase1, { aujourdHui: LE_JOUR });
    expect(i.prix).toBe(6.5);
    expect(i.source).toBe(SOURCES_PRIX.FACTURE.id);
    expect(i.prixParUniteRecette).toBeCloseTo(0.0065, 6);
    expect(i.perime).toBe(false);
  });
  it('signale un prix de facture trop ancien', () => {
    const i = infoPrixIngredient(huile, psPhase1, { aujourdHui: LE_JOUR });
    expect(i.ancienneteMois).toBe(7);
    expect(i.perime).toBe(true);
  });
  it('replie sur la mercuriale en marquant la source FICHE_RECETTE', () => {
    const orphelin = { id: 'i_x', name: 'Sésame', unit: 'kg', priceUnit: 7.81 };
    const i = infoPrixIngredient(orphelin, psPhase1, { aujourdHui: LE_JOUR });
    expect(i.prix).toBe(7.81);
    expect(i.source).toBe(SOURCES_PRIX.FICHE_RECETTE.id);
  });
  it('sans aucun prix, retourne null et jamais 0', () => {
    const i = infoPrixIngredient({ id: 'i_z', name: 'Inconnu', unit: 'kg' }, psPhase1, { aujourdHui: LE_JOUR });
    expect(i.prix).toBeNull();
    expect(i.prixParUniteRecette).toBeNull();
  });
});

describe('exemple chiffré de la spec', () => {
  it('120 g de poulet à 6,50 euros/kg donne 0,78 euro', () => {
    const i = infoPrixIngredient(poulet, psPhase1, { aujourdHui: LE_JOUR });
    expect(i.prixParUniteRecette * 120).toBeCloseTo(0.78, 6);
  });
});

describe('coutEmballage', () => {
  const liens = [
    { menu_item_id: 'm1', packaging_id: 'k1', qty: 1 },
    { menu_item_id: 'm1', packaging_id: 'k2', qty: 1 },
  ];
  it('additionne le pot et son couvercle : pot + couvercle = 0,17444', () => {
    const r = coutEmballage('m1', liens, [embPot, embCouv]);
    expect(r.total).toBeCloseTo(0.17444, 6);
    expect(r.incomplet).toBe(false);
    expect(r.detail).toHaveLength(2);
  });
  it('un emballage sans prix rend le coût incomplet, pas nul', () => {
    const r = coutEmballage('m1', [{ menu_item_id: 'm1', packaging_id: 'k3', qty: 1 }], [embSansPrix]);
    expect(r.incomplet).toBe(true);
    expect(r.raisons).toContain('ZZZ');
  });
  it('aucun emballage rattaché donne 0 et reste complet', () => {
    expect(coutEmballage('m9', [], []).total).toBe(0);
  });
});

describe('coutHuile', () => {
  it('le coût suit le prix d achat : 20 g à 1,7996 euros/L', () => {
    const r = coutHuile({ huile_absorbee_g: 20 }, huile, psPhase1, { aujourdHui: LE_JOUR });
    expect(r.total).toBeCloseTo(0.036, 3);
  });
  it('sans huile absorbée, coût nul et complet', () => {
    expect(coutHuile({}, huile, psPhase1).total).toBe(0);
  });
  it('produit huile non paramétré rend le coût incomplet', () => {
    const r = coutHuile({ huile_absorbee_g: 20 }, null, psPhase1);
    expect(r.total).toBeNull();
    expect(r.incomplet).toBe(true);
  });
});

describe('coutsDirects', () => {
  it('somme emballage, huile, énergie et autres', () => {
    const r = coutsDirects({
      menuItem: { id: 'm1', huile_absorbee_g: 20, cout_energie: 0.02, cout_autres: 0.01 },
      liens: [{ menu_item_id: 'm1', packaging_id: 'k1', qty: 1 }],
      packagings: [embPot], produitHuile: huile, productSuppliers: psPhase1,
      aujourdHui: LE_JOUR,
    });
    expect(r.emballage).toBeCloseTo(0.11111, 5);
    expect(r.energie).toBe(0.02);
    expect(r.autres).toBe(0.01);
    expect(r.total).toBeCloseTo(0.11111 + 0.036 + 0.02 + 0.01, 3);
  });
  it('propage l incomplétude au lieu de sous-estimer le coût', () => {
    const r = coutsDirects({
      menuItem: { id: 'm1' },
      liens: [{ menu_item_id: 'm1', packaging_id: 'k3', qty: 1 }],
      packagings: [embSansPrix], produitHuile: huile, productSuppliers: psPhase1,
    });
    expect(r.total).toBeNull();
    expect(r.incomplet).toBe(true);
  });
});

describe('analyseArticle : food cost matière contre ratio coût direct', () => {
  const menuItem = { id: 'm1', price: 6, huile_absorbee_g: 20, cout_energie: 0.02, cout_autres: 0 };
  const liens = [
    { menu_item_id: 'm1', packaging_id: 'k1', qty: 1 },
    { menu_item_id: 'm1', packaging_id: 'k2', qty: 1 },
  ];
  const base = {
    menuItem, liens, packagings: [embPot, embCouv], produitHuile: huile,
    productSuppliers: psPhase1, settings: { tva: 10 }, aujourdHui: LE_JOUR,
  };

  it('sépare les deux ratios : le food cost ignore emballage et énergie', () => {
    const a = analyseArticle({ ...base, coutMatiere: 1.5 });
    expect(a.prixHT).toBeCloseTo(5.4545, 3);
    expect(a.foodCostMatierePct).toBeCloseTo(27.5, 1);
    expect(a.coutDirectTotal).toBeCloseTo(1.5 + 0.17444 + 0.036 + 0.02, 2);
    expect(a.ratioCoutDirectPct).toBeGreaterThan(a.foodCostMatierePct);
  });

  it('distingue les deux marges', () => {
    const a = analyseArticle({ ...base, coutMatiere: 1.5 });
    expect(a.margeApresMatiere).toBeCloseTo(3.9545, 3);
    expect(a.margeApresCoutsDirects).toBeLessThan(a.margeApresMatiere);
    expect(a.margeApresCoutsDirects).toBeCloseTo(3.7241, 2);
  });

  it('une recette incomplète ne produit jamais un food cost de 0', () => {
    const a = analyseArticle({ ...base, coutMatiere: null });
    expect(a.foodCostMatierePct).toBeNull();
    expect(a.coutDirectTotal).toBeNull();
    expect(a.incomplet).toBe(true);
  });
});

describe('couleurFoodCostMatiere', () => {
  it('applique les seuils 25 et 30 par défaut', () => {
    expect(couleurFoodCostMatiere(24)).toBe('success');
    expect(couleurFoodCostMatiere(25)).toBe('success');
    expect(couleurFoodCostMatiere(27)).toBe('warning');
    expect(couleurFoodCostMatiere(30)).toBe('warning');
    expect(couleurFoodCostMatiere(31)).toBe('danger');
  });
  it('les seuils restent configurables', () => {
    const s = { seuil_food_cost_vert: 20, seuil_food_cost_orange: 26 };
    expect(couleurFoodCostMatiere(24, s)).toBe('warning');
    expect(couleurFoodCostMatiere(27, s)).toBe('danger');
  });
  it('food cost inconnu donne neutre, pas vert', () => {
    expect(couleurFoodCostMatiere(null)).toBe('neutral');
  });
});

describe('propagation d un changement de prix', () => {
  // Exigence de la spec : si le prix de la mayonnaise change,
  // la sauce crémeuse est recalculée, donc le Crousty aussi.
  const mayo = { id: 'p_mayo', name: 'Mayonnaise', unit: 'L' };
  const creme = { id: 'p_creme', name: 'Crème fraîche', unit: 'L' };
  const produits = [mayo, creme];

  const sauceCremeuse = { id: 'r_sauce', nom: 'Sauce crémeuse', rendement_valeur: 2400,
    rendement_unite: 'portion', cout_force: null };
  const crousty = { id: 'r_crousty', nom: 'Crousty', rendement_valeur: 1,
    rendement_unite: 'piece', cout_force: null };
  const recettesById = { r_sauce: sauceCremeuse, r_crousty: crousty };
  const lignes = grouperLignesParRecette([
    { recipe_id: 'r_sauce', product_id: 'p_creme', qty: 2000, unit: 'ml' },
    { recipe_id: 'r_sauce', product_id: 'p_mayo', qty: 400, unit: 'ml' },
    { recipe_id: 'r_crousty', sous_recette_id: 'r_sauce', qty: 40, unit: 'portion' },
  ]);

  const coutCrousty = (prixMayo) => coutRecette({
    recette: crousty, recettesById, lignesByRecette: lignes, produits,
    productSuppliers: [
      { product_id: 'p_creme', price_ht: 4.36, is_primary: true },
      { product_id: 'p_mayo', price_ht: prixMayo, is_primary: true },
    ],
  }).total;

  it('le coût du Crousty augmente quand la mayonnaise augmente', () => {
    const avant = coutCrousty(4.73);
    const apres = coutCrousty(6.0);
    expect(apres).toBeGreaterThan(avant);
    // 400 ml de mayo sur 2400 g de sauce, dont 40 g dans le Crousty
    const deltaAttendu = ((6.0 - 4.73) / 1000) * 400 / 2400 * 40;
    expect(apres - avant).toBeCloseTo(deltaAttendu, 6);
  });

  it('un prix de mayonnaise absent rend le Crousty incomplet, pas moins cher', () => {
    const r = coutRecette({
      recette: crousty, recettesById, lignesByRecette: lignes, produits,
      productSuppliers: [
        { product_id: 'p_creme', price_ht: 4.36, is_primary: true },
        { product_id: 'p_mayo', price_ht: null, is_primary: true },
      ],
    });
    expect(r.incomplet).toBe(true);
    expect(r.raisons).toContain('Mayonnaise');
  });
});
