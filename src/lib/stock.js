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
