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

// Résumé « sur place » d'un article de carte pour la liste. cout = coût matière (number) ou null.
export function resumeArticle({ prixTTC, cout, tva }) {
  const prixHT = ttcVersHT(Number(prixTTC) || 0, tva);
  if (cout === null || cout === undefined) return { prixHT, marge: null, foodCostPct: null };
  const marge = prixHT - cout;
  const foodCostPct = prixHT > 0 ? (cout / prixHT) * 100 : null;
  return { prixHT, marge, foodCostPct };
}

// --- Phase 1 : prix sourcés, emballages, coûts directs (v3) ---
//
// Distinction imposée : le FOOD COST reste matière première SEULE.
// Le ratio incluant emballage, huile et énergie s'appelle RATIO COÛT DIRECT.
// Ne jamais confondre les deux dans l'UI comme dans les calculs.

export const SOURCES_PRIX = {
  FACTURE: { id: 'FACTURE', libelle: 'Facture', rang: 1 },
  ANCIEN_TARIF: { id: 'ANCIEN_TARIF', libelle: 'Ancien tarif', rang: 2 },
  FICHE_RECETTE: { id: 'FICHE_RECETTE', libelle: 'Fiche recette', rang: 3 },
  ESTIMATION: { id: 'ESTIMATION', libelle: 'Estimation', rang: 4 },
};

export const SETTINGS_COUTS_DEFAUT = {
  seuil_food_cost_vert: 25,
  seuil_food_cost_orange: 30,
  seuil_prix_ancien_mois: 6,
  seuil_hausse_alerte_pct: 10,
  marge_min_pct: 60,
  cout_energie_defaut: 0,
};

// Ancienneté d'un prix en mois. La date du jour est injectable pour les tests.
export function moisDepuis(datePrix, aujourdHui = new Date()) {
  if (!datePrix) return null;
  const d = datePrix instanceof Date ? datePrix : new Date(datePrix);
  if (Number.isNaN(d.getTime())) return null;
  const mois = (aujourdHui.getFullYear() - d.getFullYear()) * 12
    + (aujourdHui.getMonth() - d.getMonth());
  return aujourdHui.getDate() < d.getDate() ? mois - 1 : mois;
}

// Un prix sans date est traité comme périmé : on ne présume jamais qu'il est frais.
export function prixPerime(datePrix, seuilMois, aujourdHui = new Date()) {
  const seuil = Number(seuilMois);
  if (!(seuil > 0)) return false;
  if (!datePrix) return true;
  const m = moisDepuis(datePrix, aujourdHui);
  return m === null ? true : m >= seuil;
}

// Variation en pourcentage. null si l'ancien prix est absent ou nul,
// pour ne pas afficher une hausse infinie sur une première saisie.
export function variationPct(ancien, nouveau) {
  const a = Number(ancien);
  const n = Number(nouveau);
  if (!Number.isFinite(a) || !Number.isFinite(n) || a === 0) return null;
  return ((n - a) / a) * 100;
}

// Prix d'un ingrédient avec sa provenance. Applique la priorité de la spec :
// 1. prix du fournisseur principal (sourcé), 2. repli mercuriale product.priceUnit.
// Retourne toujours un objet : prix null signifie « inconnu », jamais zéro.
export function infoPrixIngredient(product, productSuppliers, options = {}) {
  const { settings = SETTINGS_COUTS_DEFAUT, aujourdHui = new Date() } = options;
  const vide = {
    prix: null, prixParUniteRecette: null, source: null, datePrix: null,
    ancienneteMois: null, perime: true, fournisseurId: null,
  };
  if (!product) return vide;

  const pid = product._uuid ?? product.id;
  const primary = (productSuppliers || []).find((l) => l.product_id === pid && l.is_primary);
  const prixFournisseur =
    primary && primary.price_ht !== null && primary.price_ht !== undefined
      ? Number(primary.price_ht)
      : null;

  let prix = prixFournisseur;
  let source = prixFournisseur !== null ? (primary.source_prix || null) : null;
  let datePrix = prixFournisseur !== null ? (primary.date_prix || null) : null;
  let fournisseurId = prixFournisseur !== null ? (primary.supplier_id ?? null) : null;

  if (prix === null) {
    const mercuriale =
      product.priceUnit !== null && product.priceUnit !== undefined
        ? Number(product.priceUnit)
        : null;
    if (mercuriale === null || Number.isNaN(mercuriale)) return vide;
    prix = mercuriale;
    source = SOURCES_PRIX.FICHE_RECETTE.id;
    datePrix = null;
    fournisseurId = null;
  }

  if (Number.isNaN(prix)) return vide;

  return {
    prix,
    prixParUniteRecette: prix / facteurRecette(product.unit),
    source,
    datePrix,
    ancienneteMois: moisDepuis(datePrix, aujourdHui),
    perime: prixPerime(datePrix, settings.seuil_prix_ancien_mois, aujourdHui),
    fournisseurId,
  };
}

// Coût emballage d'un article vendu. Plusieurs emballages possibles
// (un pot et son couvercle comptent pour une boisson).
export function coutEmballage(menuItemId, liens, packagings) {
  const miens = (liens || []).filter((l) => l.menu_item_id === menuItemId);
  if (miens.length === 0) return { total: 0, incomplet: false, raisons: [], detail: [] };

  let total = 0;
  const raisons = [];
  const detail = [];
  for (const lien of miens) {
    const pkg = (packagings || []).find((p) => p.id === lien.packaging_id);
    if (!pkg) { raisons.push('emballage supprimé'); continue; }
    if (pkg.prix_unite_ht === null || pkg.prix_unite_ht === undefined) {
      raisons.push(pkg.reference || pkg.nom);
      continue;
    }
    const ligne = Number(pkg.prix_unite_ht) * (Number(lien.qty) || 0);
    total += ligne;
    detail.push({ reference: pkg.reference, nom: pkg.nom, qty: Number(lien.qty) || 0, cout: ligne });
  }
  return { total, incomplet: raisons.length > 0, raisons, detail };
}

// Coût de l'huile absorbée. Stockée en grammes pour que le coût suive
// automatiquement le prix d'achat de l'huile, comme n'importe quel ingrédient.
export function coutHuile(menuItem, produitHuile, productSuppliers, options = {}) {
  const g = Number(menuItem?.huile_absorbee_g);
  if (!(g > 0)) return { total: 0, incomplet: false, raisons: [] };
  if (!produitHuile) return { total: null, incomplet: true, raisons: ['produit huile non paramétré'] };
  const info = infoPrixIngredient(produitHuile, productSuppliers, options);
  if (info.prixParUniteRecette === null) {
    return { total: null, incomplet: true, raisons: [produitHuile.name || 'huile'] };
  }
  return { total: info.prixParUniteRecette * g, incomplet: false, raisons: [] };
}

// Somme des coûts directs hors matière première.
export function coutsDirects({ menuItem, liens, packagings, produitHuile, productSuppliers, settings, aujourdHui }) {
  const s = { ...SETTINGS_COUTS_DEFAUT, ...(settings || {}) };
  const emb = coutEmballage(menuItem?.id, liens, packagings);
  const huile = coutHuile(menuItem, produitHuile, productSuppliers, { settings: s, aujourdHui });

  const energie = menuItem?.cout_energie !== null && menuItem?.cout_energie !== undefined
    ? Number(menuItem.cout_energie)
    : Number(s.cout_energie_defaut) || 0;
  const autres = Number(menuItem?.cout_autres) || 0;

  const incomplet = emb.incomplet || huile.incomplet;
  const total = incomplet ? null : emb.total + huile.total + energie + autres;

  return {
    emballage: emb.incomplet ? null : emb.total,
    emballageDetail: emb.detail,
    huile: huile.total,
    energie,
    autres,
    total,
    incomplet,
    raisons: [...emb.raisons, ...huile.raisons],
  };
}

// Analyse complète d'un article vendu : c'est ce que l'écran de coûts affiche.
// coutMatiere est fourni par coutArticle() ; null = recette incomplète.
export function analyseArticle({ menuItem, coutMatiere: cout, prixTTC, liens, packagings, produitHuile, productSuppliers, settings, aujourdHui }) {
  const s = { ...SETTINGS_COUTS_DEFAUT, ...SETTINGS_DEFAUT, ...(settings || {}) };
  const ttc = Number(prixTTC ?? menuItem?.price) || 0;
  const prixHT = ttcVersHT(ttc, s.tva);
  const directs = coutsDirects({ menuItem, liens, packagings, produitHuile, productSuppliers, settings: s, aujourdHui });

  const matiereConnue = cout !== null && cout !== undefined;
  const coutDirectTotal = matiereConnue && directs.total !== null ? cout + directs.total : null;

  return {
    prixTTC: ttc,
    prixHT,
    coutMatiere: matiereConnue ? cout : null,
    emballage: directs.emballage,
    huile: directs.huile,
    energie: directs.energie,
    autres: directs.autres,
    coutDirectTotal,
    // Food cost = matière première seule, jamais l'emballage ni l'énergie.
    foodCostMatierePct: matiereConnue && prixHT > 0 ? (cout / prixHT) * 100 : null,
    ratioCoutDirectPct: coutDirectTotal !== null && prixHT > 0 ? (coutDirectTotal / prixHT) * 100 : null,
    margeApresMatiere: matiereConnue ? prixHT - cout : null,
    margeApresCoutsDirects: coutDirectTotal !== null ? prixHT - coutDirectTotal : null,
    tauxMargeMatierePct: matiereConnue && prixHT > 0 ? ((prixHT - cout) / prixHT) * 100 : null,
    incomplet: !matiereConnue || directs.incomplet,
    raisons: directs.raisons,
  };
}

// Feu tricolore du food cost matière. Seuils configurables (25 / 30 par défaut).
export function couleurFoodCostMatiere(pct, settings) {
  if (pct === null || pct === undefined) return 'neutral';
  const s = { ...SETTINGS_COUTS_DEFAUT, ...(settings || {}) };
  if (pct <= Number(s.seuil_food_cost_vert)) return 'success';
  if (pct <= Number(s.seuil_food_cost_orange)) return 'warning';
  return 'danger';
}
