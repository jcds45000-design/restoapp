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

// Prix d'achat par unité recette (€/g, €/ml, €/pièce). Priorité au prix négocié
// du fournisseur principal ; à défaut, repli sur la mercuriale (product.priceUnit,
// le prix de référence saisi dans le Stock). null seulement si ni l'un ni l'autre.
export function prixParUniteRecette(product, productSuppliers) {
  if (!product) return null;
  const primary = (productSuppliers || []).find(
    (l) => l.product_id === (product._uuid ?? product.id) && l.is_primary
  );
  const prixFournisseur =
    primary && primary.price_ht !== null && primary.price_ht !== undefined
      ? Number(primary.price_ht)
      : null;
  const prix =
    prixFournisseur !== null
      ? prixFournisseur
      : product.priceUnit !== null && product.priceUnit !== undefined
        ? Number(product.priceUnit)
        : null;
  if (prix === null || Number.isNaN(prix)) return null;
  return prix / facteurRecette(product.unit);
}

// Coût matière d'une recette. Retourne { total, lignesSansPrix }.
export function coutMatiere(lines, products, productSuppliers) {
  let total = 0;
  const lignesSansPrix = [];
  for (const ligne of lines || []) {
    const produit = (products || []).find((p) => (p._uuid ?? p.id) === ligne.product_id);
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

// --- Recettes, sous-recettes et rendements (v2) ---

// Indexe les lignes de recette par recipe_id, pour un accès direct.
export function grouperLignesParRecette(lignes) {
  const map = {};
  for (const l of lignes || []) (map[l.recipe_id] ||= []).push(l);
  return map;
}

// Coût d'une recette (récursif). Retourne { total, coutParUnite, incomplet, raisons, force }.
// - un prix ou coût absent rend « incomplet », jamais 0.
// - une ligne peut cibler un produit OU une sous-recette (récursion), avec une quantité.
// - garde-fou anti-boucle via la pile des recettes déjà visitées.
export function coutRecette({ recette, recettesById, lignesByRecette, produits, productSuppliers, pile = [] }) {
  if (!recette) return { total: 0, coutParUnite: null, incomplet: true, raisons: ['recette introuvable'], force: false };
  if (pile.includes(recette.id)) return { total: 0, coutParUnite: null, incomplet: true, raisons: ['boucle détectée'], force: false };
  const rendement = Number(recette.rendement_valeur);
  if (recette.cout_force !== null && recette.cout_force !== undefined) {
    const total = Number(recette.cout_force);
    return {
      total, coutParUnite: rendement > 0 ? total / rendement : null,
      incomplet: !(rendement > 0), raisons: rendement > 0 ? [] : ['rendement manquant'], force: true,
    };
  }
  let total = 0; const raisons = []; let incomplet = false;
  for (const ligne of lignesByRecette[recette.id] || []) {
    if (ligne.cout_force !== null && ligne.cout_force !== undefined) { total += Number(ligne.cout_force); continue; }
    if (ligne.product_id) {
      const produit = (produits || []).find((p) => (p._uuid ?? p.id) === ligne.product_id);
      if (!produit) { incomplet = true; raisons.push('produit supprimé'); continue; }
      const prix = prixParUniteRecette(produit, productSuppliers);
      if (prix === null) { incomplet = true; raisons.push(produit.name); continue; }
      total += prix * (Number(ligne.qty) || 0);
    } else if (ligne.sous_recette_id) {
      const sous = recettesById[ligne.sous_recette_id];
      const r = coutRecette({ recette: sous, recettesById, lignesByRecette, produits, productSuppliers, pile: [...pile, recette.id] });
      if (r.incomplet || r.coutParUnite === null) { incomplet = true; raisons.push(...(r.raisons.length ? r.raisons : ['sous-recette incomplète'])); }
      else total += r.coutParUnite * (Number(ligne.qty) || 0);
    }
  }
  const coutParUnite = rendement > 0 ? total / rendement : null;
  if (!(rendement > 0)) { incomplet = true; raisons.push('rendement manquant'); }
  return { total, coutParUnite, incomplet, raisons, force: false };
}

// Coût matière d'un article de carte = coût par unité de sa recette × nombre d'unités vendues.
export function coutArticle({ menuItem, recettesById, lignesByRecette, produits, productSuppliers }) {
  if (!menuItem || !menuItem.recipe_id) return { total: null, incomplet: true, raisons: ['pas de recette'] };
  const recette = recettesById[menuItem.recipe_id];
  const r = coutRecette({ recette, recettesById, lignesByRecette, produits, productSuppliers });
  if (r.coutParUnite === null) return { total: null, incomplet: true, raisons: r.raisons };
  return { total: r.coutParUnite * (Number(menuItem.recipe_qty) || 0), incomplet: r.incomplet, raisons: r.raisons };
}

// Depuis le nom d'un article « Nom xN », propose { recette, qty }. null si rien de sûr.
// Ne propose jamais une recette « sous_recette_seulement ».
export function suggestionRattachement(nomArticle, recettes) {
  const nom = (nomArticle || '').trim();
  const m = nom.match(/^(.*?)\s*[x×]\s*(\d+)$/i);
  const base = (m ? m[1] : nom).trim().toLowerCase();
  const qty = m ? Number(m[2]) : 1;
  const recette = (recettes || []).find(
    (r) => !r.sous_recette_seulement && (r.nom || '').trim().toLowerCase() === base
  );
  return recette ? { recette, qty } : null;
}

// Pour l'écran liste : costue chaque recette. Retourne [{ recette, coutParUnite, incomplet, raisons }].
export function resumeRecettes(recettes, lignesByRecette, produits, productSuppliers) {
  const recettesById = Object.fromEntries((recettes || []).map((r) => [r.id, r]));
  return (recettes || []).map((recette) => {
    const r = coutRecette({ recette, recettesById, lignesByRecette, produits, productSuppliers });
    return { recette, coutParUnite: r.coutParUnite, incomplet: r.incomplet, raisons: r.raisons };
  });
}
