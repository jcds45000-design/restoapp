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
