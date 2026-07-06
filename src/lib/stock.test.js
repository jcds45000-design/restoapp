import { describe, it, expect } from 'vitest';
import { getUrgency, computeShoppingList, formatShoppingListText, countedTodayIds, supplierLinksOf, alertProductsOf } from './stock';

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

describe('supplierLinksOf', () => {
  const suppliers = [
    { id: 's1', name: 'Metro', active: true },
    { id: 's2', name: 'ABN Distribution', active: false }, // inactif
  ];
  const links = [
    { product_id: 'u1', supplier_id: 's1', is_primary: false },
    { product_id: 'u1', supplier_id: 's2', is_primary: true },  // inactif, principal déclaré
    { product_id: 'u1', supplier_id: 'sX', is_primary: false }, // fournisseur inconnu
  ];
  it('exclut les fournisseurs inactifs et inconnus', () => {
    const result = supplierLinksOf('u1', links, suppliers);
    expect(result).toHaveLength(1);
    expect(result[0].supplier.id).toBe('s1');
  });
  it('liste vide si aucun lien', () => {
    expect(supplierLinksOf('u99', links, suppliers)).toHaveLength(0);
  });
  it('principal en premier', () => {
    const both = [
      { product_id: 'u1', supplier_id: 's1', is_primary: false },
      { product_id: 'u1', supplier_id: 's3', is_primary: true },
    ];
    const sups = [
      { id: 's1', name: 'Metro', active: true },
      { id: 's3', name: 'Leclerc', active: true },
    ];
    expect(supplierLinksOf('u1', both, sups)[0].supplier.id).toBe('s3');
  });
});

describe('computeShoppingList — prix partiels', () => {
  it('totalHt = somme des seuls prix connus dans un groupe', () => {
    const p2 = [
      P({ _uuid: 'u1', name: 'A', qty: 1, seuil: 5, seuilOrange: 8 }),
      P({ _uuid: 'u2', name: 'B', qty: 0, seuil: 5, seuilOrange: null }),
    ];
    const l2 = [
      { product_id: 'u1', supplier_id: 's1', price_ht: 10, is_primary: true },
      { product_id: 'u2', supplier_id: 's1', price_ht: null, is_primary: true },
    ];
    const s2 = [{ id: 's1', name: 'Metro', active: true }];
    const g2 = computeShoppingList(p2, l2, s2);
    expect(g2).toHaveLength(1);
    expect(g2[0].totalHt).toBeCloseTo(Math.ceil((8 - 1) * 1.2) * 10); // seulement A
  });
});

describe('alertProductsOf', () => {
  it('ignore les produits sans seuil, compte les produits sous le seuil', () => {
    const products = [
      P({ _uuid: 'u1', qty: 0, seuil: null }),               // à définir -> ignoré
      P({ _uuid: 'u2', qty: 0, seuil: 2 }),                  // alerte
      P({ _uuid: 'u3', qty: 5, seuil: 2 }),                  // ok
      P({ _uuid: 'u4', qty: 2, seuil: 2 }),                  // alerte (égalité)
    ];
    expect(alertProductsOf(products).map(p => p._uuid)).toEqual(['u2', 'u4']);
  });
});
