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
