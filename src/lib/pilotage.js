// Simulateur, alertes et tableau de bord des coûts.
// Logique pure : aucune dépendance UI ni Supabase, tout est injecté.
//
// Conventions reprises de rentabilite.js :
//   - un prix inconnu n'est JAMAIS compté 0, il rend le coût « incomplet »
//   - le food cost reste la MATIÈRE SEULE, jamais emballage ni énergie

import {
  coutRecette, grouperLignesParRecette, infoPrixIngredient,
  coutEmballage, coutHuile, ttcVersHT, variationPct, prixPerime,
  SETTINGS_COUTS_DEFAUT, SETTINGS_DEFAUT,
} from './rentabilite.js';

const idDe = (o) => (o ? (o._uuid ?? o.id) : null);

// ---------------------------------------------------------------- dépendances
// Quelles recettes utilisent cet ingrédient, directement ou via une
// sous-recette ? Remonte la chaîne : mayonnaise -> sauce crémeuse -> Crousty.
export function recettesUtilisant(productId, recettes, lignesByRecette) {
  const directes = new Set();
  for (const r of recettes || []) {
    for (const l of lignesByRecette[r.id] || []) {
      if (l.product_id === productId) directes.add(r.id);
    }
  }
  // Propagation ascendante, jusqu'à stabilisation.
  const touchees = new Set(directes);
  let encore = true;
  let garde = 0;
  while (encore && garde < 50) {
    encore = false;
    garde++;
    for (const r of recettes || []) {
      if (touchees.has(r.id)) continue;
      for (const l of lignesByRecette[r.id] || []) {
        if (l.sous_recette_id && touchees.has(l.sous_recette_id)) {
          touchees.add(r.id);
          encore = true;
          break;
        }
      }
    }
  }
  return { directes: [...directes], toutes: [...touchees] };
}

// ---------------------------------------------------------------- simulateur
// Applique des modifications TEMPORAIRES et renvoie l'impact chiffré.
// Ne mute jamais les tableaux reçus : la base n'est pas touchée tant que
// l'utilisateur n'a pas validé.
export function simuler({
  produits, productSuppliers, recettes, lignes,
  packagings = [], liensEmballage = [], menuItems = [], settings,
  changements = {},
}) {
  const s = { ...SETTINGS_DEFAUT, ...SETTINGS_COUTS_DEFAUT, ...(settings || {}) };
  const { prixIngredient = {}, grammage = {}, prixVente = {} } = changements;

  // Copie défensive des prix fournisseurs.
  const psSimule = (productSuppliers || []).map((l) => {
    const nouveau = prixIngredient[l.product_id];
    return nouveau !== undefined && l.is_primary ? { ...l, price_ht: nouveau } : l;
  });
  // Un ingrédient sans ligne fournisseur voit son prix simulé via la mercuriale.
  const produitsSimules = (produits || []).map((p) => {
    const nouveau = prixIngredient[idDe(p)];
    if (nouveau === undefined) return p;
    const aUneLigne = psSimule.some((l) => l.product_id === idDe(p) && l.is_primary);
    return aUneLigne ? p : { ...p, priceUnit: nouveau };
  });

  const lignesSimulees = (lignes || []).map((l) => (
    grammage[l.id] !== undefined ? { ...l, qty: grammage[l.id] } : l
  ));

  const avant = etatCouts({ produits, productSuppliers, recettes, lignes, packagings, liensEmballage, menuItems, settings: s });
  const apres = etatCouts({
    produits: produitsSimules, productSuppliers: psSimule, recettes,
    lignes: lignesSimulees, packagings, liensEmballage, menuItems, settings: s, prixVente,
  });

  const impacts = [];
  for (const r of recettes || []) {
    if (r.sous_recette_seulement) continue;
    const a = avant.parRecette[r.id];
    const b = apres.parRecette[r.id];
    if (!a || !b) continue;
    if (a.coutMatiere === null || b.coutMatiere === null) {
      if (a.coutMatiere !== b.coutMatiere) {
        impacts.push({ recetteId: r.id, nom: r.nom, avant: a, apres: b, delta: null, deltaPct: null, incomplet: true });
      }
      continue;
    }
    const delta = b.coutMatiere - a.coutMatiere;
    if (Math.abs(delta) < 1e-9 && (b.prixHT === a.prixHT)) continue;
    impacts.push({
      recetteId: r.id, nom: r.nom, categorie: r.categorie,
      avant: a, apres: b, delta,
      deltaPct: a.coutMatiere !== 0 ? (delta / a.coutMatiere) * 100 : null,
      incomplet: false,
    });
  }
  impacts.sort((x, y) => Math.abs(y.delta ?? 0) - Math.abs(x.delta ?? 0));

  return {
    impacts,
    nbAffectes: impacts.length,
    totalAvant: avant.totalMatiere,
    totalApres: apres.totalMatiere,
  };
}

// ---------------------------------------------------------------- état des coûts
// Calcule, pour chaque recette, coût matière, emballage, food cost et marges.
export function etatCouts({
  produits, productSuppliers, recettes, lignes,
  packagings = [], liensEmballage = [], menuItems = [],
  settings, prixVente = {}, aujourdHui = new Date(),
}) {
  const s = { ...SETTINGS_DEFAUT, ...SETTINGS_COUTS_DEFAUT, ...(settings || {}) };
  const recettesById = Object.fromEntries((recettes || []).map((r) => [r.id, r]));
  const lignesByRecette = grouperLignesParRecette(lignes);

  const parRecette = {};
  let totalMatiere = 0;
  let nbComplets = 0;

  for (const r of recettes || []) {
    const c = coutRecette({ recette: r, recettesById, lignesByRecette, produits, productSuppliers });
    const coutMatiere = c.incomplet ? null : c.coutParUnite;

    const liens = liensEmballage.filter((l) => l.menu_item_id === r.id);
    const emb = liens.length
      ? coutEmballage(r.id, liens, packagings)
      : (r.packaging_defaut_id
        ? coutEmballage(r.id, [{ menu_item_id: r.id, packaging_id: r.packaging_defaut_id, qty: 1 }], packagings)
        : { total: 0, incomplet: false, raisons: [] });

    // Le prix de vente vit dans menu_items. Un article peut représenter
    // plusieurs unités de recette (recipe_qty) : on ramène tout à l'unité.
    const article = (menuItems || []).find((m) => m.recipe_id === r.id);
    const qtyArticle = article && Number(article.recipe_qty) > 0 ? Number(article.recipe_qty) : 1;
    const ttcBrut = prixVente[r.id] !== undefined
      ? prixVente[r.id]
      : (article && article.price !== null && article.price !== undefined
        ? Number(article.price)
        : (r.prix_vente_ttc ?? null));
    const ttc = ttcBrut === null || ttcBrut === undefined ? null : Number(ttcBrut) / qtyArticle;
    const prixHT = ttc !== null ? ttcVersHT(ttc, s.tva) : null;
    const emballage = emb.incomplet ? null : emb.total;
    const coutDirect = coutMatiere !== null && emballage !== null ? coutMatiere + emballage : null;

    parRecette[r.id] = {
      nom: r.nom, categorie: r.categorie, sousRecette: !!r.sous_recette_seulement,
      coutMatiere, emballage, coutDirect, prixTTC: ttc ?? null, prixHT,
      foodCostPct: coutMatiere !== null && prixHT ? (coutMatiere / prixHT) * 100 : null,
      ratioCoutDirectPct: coutDirect !== null && prixHT ? (coutDirect / prixHT) * 100 : null,
      margeMatiere: coutMatiere !== null && prixHT !== null ? prixHT - coutMatiere : null,
      margeCoutDirect: coutDirect !== null && prixHT !== null ? prixHT - coutDirect : null,
      incomplet: c.incomplet || emb.incomplet,
      raisons: [...new Set([...c.raisons, ...emb.raisons])],
    };
    if (!r.sous_recette_seulement && coutMatiere !== null) { totalMatiere += coutMatiere; nbComplets++; }
  }
  return { parRecette, totalMatiere, nbComplets, aujourdHui };
}

// ---------------------------------------------------------------- articles vendus
// Le food cost se juge sur l'ARTICLE VENDU, pas sur la recette : plusieurs
// articles peuvent partager une recette avec des quantités différentes
// (« Boneless x5 » et « Boneless x20 » pointent sur le même batch).
// Analyser au niveau recette donnerait un seul prix pour les quatre.
export function etatArticles({
  produits, productSuppliers, recettes, lignes, packagings = [],
  menuItems = [], liensEmballage = [], settings, prixVente = {}, aujourdHui = new Date(),
}) {
  const s = { ...SETTINGS_DEFAUT, ...SETTINGS_COUTS_DEFAUT, ...(settings || {}) };
  const etat = etatCouts({ produits, productSuppliers, recettes, lignes, packagings, liensEmballage, settings: s, aujourdHui });
  // L'huile absorbée est stockée en grammes : son coût suit le prix d'achat.
  const produitHuile = s.produit_huile_id
    ? (produits || []).find((p) => idDe(p) === s.produit_huile_id) || null
    : null;

  return (menuItems || [])
    .filter((m) => m.recipe_id)
    .map((m) => {
      const rec = etat.parRecette[m.recipe_id];
      const qty = Number(m.recipe_qty) > 0 ? Number(m.recipe_qty) : 1;
      const ttc = prixVente[m.id] !== undefined ? Number(prixVente[m.id]) : Number(m.price);
      const prixHT = Number.isFinite(ttc) ? ttcVersHT(ttc, s.tva) : null;
      const coutMatiere = rec && rec.coutMatiere !== null ? rec.coutMatiere * qty : null;
      // Emballage : les liens PAR ARTICLE (menu_item_packaging) priment — c'est
      // eux qui portent les emballages multiples (pot + couvercle) ou dépendant
      // de la quantité vendue. À défaut, repli sur l'emballage par défaut de la
      // recette calculé par etatCouts.
      const liensArt = (liensEmballage || []).filter((l) => l.menu_item_id === m.id);
      const embArt = liensArt.length ? coutEmballage(m.id, liensArt, packagings) : null;
      const emballage = embArt
        ? (embArt.incomplet ? null : embArt.total)
        : (rec ? rec.emballage : null);
      const raisonsEmb = embArt ? embArt.raisons : [];
      const h = coutHuile(m, produitHuile, productSuppliers, { settings: s, aujourdHui });
      const huile = h.total;
      const energie = m.cout_energie !== null && m.cout_energie !== undefined
        ? Number(m.cout_energie) : Number(s.cout_energie_defaut) || 0;
      const autres = Number(m.cout_autres) || 0;
      const coutDirect = coutMatiere !== null && emballage !== null && huile !== null
        ? coutMatiere + emballage + huile + energie + autres : null;
      return {
        articleId: m.id, nom: m.name, recetteId: m.recipe_id,
        recetteNom: rec ? rec.nom : null, qty,
        prixTTC: Number.isFinite(ttc) ? ttc : null, prixHT,
        coutMatiere, emballage, huile, energie, autres, coutDirect,
        foodCostPct: coutMatiere !== null && prixHT ? (coutMatiere / prixHT) * 100 : null,
        ratioCoutDirectPct: coutDirect !== null && prixHT ? (coutDirect / prixHT) * 100 : null,
        margeMatiere: coutMatiere !== null && prixHT !== null ? prixHT - coutMatiere : null,
        margeCoutDirect: coutDirect !== null && prixHT !== null ? prixHT - coutDirect : null,
        incomplet: !rec || rec.incomplet || h.incomplet || (embArt ? embArt.incomplet : false),
        raisons: [...new Set([...(rec ? rec.raisons : ['recette introuvable']), ...h.raisons, ...raisonsEmb])],
      };
    });
}

// ---------------------------------------------------------------- alertes
export const NIVEAUX = { CRITIQUE: 3, IMPORTANT: 2, INFO: 1 };

export function alertes({
  produits, productSuppliers, recettes, lignes, packagings = [],
  historique = [], liensEmballage = [], menuItems = [], settings, aujourdHui = new Date(),
}) {
  const s = { ...SETTINGS_DEFAUT, ...SETTINGS_COUTS_DEFAUT, ...(settings || {}) };
  const out = [];
  const etat = etatCouts({ produits, productSuppliers, recettes, lignes, packagings, liensEmballage, menuItems, settings: s, aujourdHui });
  const lignesByRecette = grouperLignesParRecette(lignes);

  // 1. Hausse de prix supérieure au seuil
  for (const h of historique) {
    const v = h.variation_pct !== null && h.variation_pct !== undefined
      ? Number(h.variation_pct)
      : variationPct(h.ancien_prix, h.nouveau_prix);
    if (v === null || v <= Number(s.seuil_hausse_alerte_pct)) continue;
    const p = (produits || []).find((x) => idDe(x) === h.product_id);
    const { toutes } = recettesUtilisant(h.product_id, recettes, lignesByRecette);
    out.push({
      type: 'hausse_prix', niveau: v > 25 ? NIVEAUX.CRITIQUE : NIVEAUX.IMPORTANT,
      cible: p ? p.name : h.product_id,
      message: `${p ? p.name : 'ingrédient'} a augmenté de ${v.toFixed(1)} %`,
      detail: `${h.ancien_prix} -> ${h.nouveau_prix}. ${toutes.length} recette(s) concernée(s).`,
      valeur: v,
    });
  }

  // 2. Prix périmé. Les prix simplement SANS DATE sont regroupés en une
  //    seule ligne : 74 alertes identiques noient les vraies urgences.
  const sansDate = [];
  for (const p of produits || []) {
    const i = infoPrixIngredient(p, productSuppliers, { settings: s, aujourdHui });
    if (i.prix === null) continue;
    if (!prixPerime(i.datePrix, s.seuil_prix_ancien_mois, aujourdHui)) continue;
    if (!i.datePrix) { sansDate.push(p.name); continue; }
    out.push({
      type: 'prix_perime', niveau: NIVEAUX.INFO, cible: p.name,
      message: `Prix de ${p.name} daté de ${i.ancienneteMois} mois`,
      detail: `Source ${i.source || 'inconnue'}. Seuil : ${s.seuil_prix_ancien_mois} mois.`,
      valeur: i.ancienneteMois,
    });
  }
  if (sansDate.length) {
    out.push({
      type: 'prix_sans_date', niveau: NIVEAUX.INFO, cible: `${sansDate.length} ingrédients`,
      message: `${sansDate.length} prix sans date connue`,
      detail: `Impossible de savoir s'ils sont à jour. Exemples : ${sansDate.slice(0, 5).join(', ')}.`,
      valeur: sansDate.length, liste: sansDate,
    });
  }

  // 3. Ingrédient sans aucun prix, mais utilisé en recette
  for (const p of produits || []) {
    const i = infoPrixIngredient(p, productSuppliers, { settings: s, aujourdHui });
    if (i.prix !== null) continue;
    const { toutes } = recettesUtilisant(idDe(p), recettes, lignesByRecette);
    if (toutes.length === 0) continue;
    out.push({
      type: 'ingredient_sans_prix', niveau: NIVEAUX.CRITIQUE, cible: p.name,
      message: `${p.name} n'a aucun prix et bloque ${toutes.length} recette(s)`,
      detail: 'Le coût de ces recettes ne peut pas être calculé.',
      valeur: toutes.length,
    });
  }

  // 4. Emballage sans prix
  for (const k of packagings || []) {
    if (k.prix_unite_ht !== null && k.prix_unite_ht !== undefined) continue;
    out.push({
      type: 'emballage_sans_prix', niveau: NIVEAUX.IMPORTANT,
      cible: k.reference || k.nom,
      message: `Emballage ${k.reference || k.nom} sans prix`,
      detail: 'Le coût direct des produits qui l\'utilisent reste incomplet.',
    });
  }

  // 5. Recette incomplète
  for (const r of recettes || []) {
    const e = etat.parRecette[r.id];
    if (!e || !e.incomplet) continue;
    out.push({
      type: 'recette_incomplete',
      niveau: r.sous_recette_seulement ? NIVEAUX.IMPORTANT : NIVEAUX.CRITIQUE,
      cible: r.nom,
      message: `${r.nom} : coût incalculable`,
      detail: `Manque : ${e.raisons.join(', ')}`,
    });
  }

  // 6. Food cost au-dessus du seuil
  for (const r of recettes || []) {
    const e = etat.parRecette[r.id];
    if (!e || e.foodCostPct === null) continue;
    if (e.foodCostPct <= Number(s.seuil_food_cost_orange)) continue;
    out.push({
      type: 'food_cost_eleve',
      niveau: e.foodCostPct > Number(s.seuil_food_cost_orange) + 10 ? NIVEAUX.CRITIQUE : NIVEAUX.IMPORTANT,
      cible: r.nom,
      message: `${r.nom} : food cost ${e.foodCostPct.toFixed(1)} %`,
      detail: `Seuil : ${s.seuil_food_cost_orange} %.`,
      valeur: e.foodCostPct,
    });
  }

  // 7. Marge sous le minimum configuré
  for (const r of recettes || []) {
    const e = etat.parRecette[r.id];
    if (!e || e.prixHT === null || e.margeMatiere === null || e.prixHT === 0) continue;
    const margePct = (e.margeMatiere / e.prixHT) * 100;
    if (margePct >= Number(s.marge_min_pct)) continue;
    out.push({
      type: 'marge_faible', niveau: NIVEAUX.IMPORTANT, cible: r.nom,
      message: `${r.nom} : marge sur matière ${margePct.toFixed(1)} %`,
      detail: `Minimum attendu : ${s.marge_min_pct} %.`,
      valeur: margePct,
    });
  }

  out.sort((a, b) => b.niveau - a.niveau || (b.valeur ?? 0) - (a.valeur ?? 0));
  return out;
}

// ---------------------------------------------------------------- dashboard
// Le food cost du restaurant est pondéré par les volumes vendus dès qu'ils
// existent. Une moyenne simple donnerait autant de poids à un onigiri
// vendu 3 fois qu'à un corndog vendu 300 fois : le chiffre serait faux.
export function dashboard({
  produits, productSuppliers, recettes, lignes, packagings = [],
  ventes = null, historique = [], liensEmballage = [], menuItems = [], settings, aujourdHui = new Date(),
}) {
  const s = { ...SETTINGS_DEFAUT, ...SETTINGS_COUTS_DEFAUT, ...(settings || {}) };
  const etat = etatCouts({ produits, productSuppliers, recettes, lignes, packagings, liensEmballage, menuItems, settings: s, aujourdHui });
  const lignesByRecette = grouperLignesParRecette(lignes);

  const vendus = (recettes || []).filter((r) => !r.sous_recette_seulement);
  // Priorité aux articles vendus : c'est là que vit le prix réel.
  const articles = etatArticles({ produits, productSuppliers, recettes, lignes,
    packagings, menuItems, liensEmballage, settings: s, aujourdHui });
  const avecFoodCost = articles.length
    ? articles.filter((x) => x.foodCostPct !== null).map((x) => ({ id: x.articleId, ...x }))
    : vendus.map((r) => ({ id: r.id, ...etat.parRecette[r.id] })).filter((x) => x.foodCostPct !== null);

  let foodCostMoyen = null;
  let methode = 'indisponible';
  let baseMoyenne = avecFoodCost.length;
  if (avecFoodCost.length) {
    if (ventes && Object.keys(ventes).length) {
      let numCout = 0, denCA = 0, couverts = 0;
      for (const x of avecFoodCost) {
        const q = Number(ventes[x.id]) || 0;
        if (!q || x.prixHT === null) continue;
        numCout += x.coutMatiere * q;
        denCA += x.prixHT * q;
        couverts += q;
      }
      if (denCA > 0) {
        foodCostMoyen = (numCout / denCA) * 100;
        methode = `pondéré par les ventes (${couverts} unités)`;
      }
    }
    if (foodCostMoyen === null) {
      foodCostMoyen = avecFoodCost.reduce((a, x) => a + x.foodCostPct, 0) / avecFoodCost.length;
      methode = 'moyenne simple, NON pondérée : à interpréter avec prudence';
    }
  }

  const classables = avecFoodCost.filter((x) => x.margeMatiere !== null);
  const parMarge = [...classables].sort((a, b) => b.margeMatiere - a.margeMatiere);

  const hausses = (historique || [])
    .map((h) => {
      const v = h.variation_pct !== null && h.variation_pct !== undefined
        ? Number(h.variation_pct) : variationPct(h.ancien_prix, h.nouveau_prix);
      const p = (produits || []).find((x) => idDe(x) === h.product_id);
      return v === null ? null : { nom: p ? p.name : '?', variation: v, ancien: h.ancien_prix, nouveau: h.nouveau_prix };
    })
    .filter(Boolean)
    .sort((a, b) => b.variation - a.variation)
    .slice(0, 5);

  const incompletes = vendus
    .map((r) => ({ nom: r.nom, raisons: etat.parRecette[r.id]?.raisons || [] }))
    .filter((x) => x.raisons.length);

  // Ce qui bloque le plus de produits en premier : c'est l'ordre d'action utile.
  const blocages = {};
  for (const i of incompletes) for (const r of i.raisons) blocages[r] = (blocages[r] || 0) + 1;

  const aActualiser = (produits || []).filter((p) => {
    const i = infoPrixIngredient(p, productSuppliers, { settings: s, aujourdHui });
    if (i.prix === null) return false;
    if (!prixPerime(i.datePrix, s.seuil_prix_ancien_mois, aujourdHui)) return false;
    return recettesUtilisant(idDe(p), recettes, lignesByRecette).toutes.length > 0;
  }).map((p) => p.name);

  // Un pourcentage calculé sur 2 produits sur 30 n'est pas un indicateur
  // de restaurant : on expose toujours l'assiette du calcul.
  const univers = articles.length || vendus.length;
  const representatif = baseMoyenne >= Math.max(3, univers * 0.5);

  return {
    foodCostMoyen, methodeFoodCost: methode,
    nbDansMoyenne: baseMoyenne, nbVendusTotal: articles.length || vendus.length,
    nbArticlesRattaches: articles.length, representatif,
    coutDirectMoyen: (() => {
      const l = vendus.map((r) => etat.parRecette[r.id]).filter((x) => x && x.coutDirect !== null);
      return l.length ? l.reduce((a, x) => a + x.coutDirect, 0) / l.length : null;
    })(),
    nbProduits: vendus.length,
    nbComplets: vendus.filter((r) => !etat.parRecette[r.id]?.incomplet).length,
    plusRentables: parMarge.slice(0, 5),
    moinsRentables: parMarge.slice(-5).reverse(),
    plusFortesHausses: hausses,
    recettesIncompletes: incompletes,
    blocagesParFrequence: Object.entries(blocages).sort((a, b) => b[1] - a[1]).map(([cause, n]) => ({ cause, produits: n })),
    prixAActualiser: aActualiser,
  };
}
