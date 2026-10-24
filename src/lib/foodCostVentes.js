// Food cost RÉEL : coût matière des ventes importées / CA HT réel.
// Règle clé : une ligne à 0 € (option de menu, offert) apporte du coût
// matière SANS CA. Les ignorer diviserait le food cost par deux (52 % des
// unités vendues en juin 2026 étaient des options à 0 €).
import { resoudreMapping } from './ventes.js';

// Coût unitaire d'une ligne résolue. Renvoie { cout } ou { raison }.
function coutLigne(m, articlesById, menuById, parRecette) {
  if (!m) return { raison: 'non_mappe' };
  if (m.menu_item_id) {
    const a = articlesById.get(m.menu_item_id);
    if (a) return a.coutMatiere === null ? { raison: 'sans_cout' } : { cout: a.coutMatiere };
    const mi = menuById.get(m.menu_item_id);
    // Menu sans base fixe (ex. Menu corndog : le corndog arrive en option).
    if (mi && !mi.recipe_id && mi.category === 'Menus') return { cout: 0, menuSansBase: mi.name };
    return { raison: 'sans_cout' };
  }
  if (m.recipe_id) {
    const r = parRecette[m.recipe_id];
    return r && r.coutMatiere !== null && r.coutMatiere !== undefined
      ? { cout: r.coutMatiere } : { raison: 'sans_cout' };
  }
  return { raison: 'non_mappe' };
}

export function foodCostReel({ lignesVente, mappings, articles, parRecette = {}, menuItems = [] }) {
  const articlesById = new Map((articles || []).map((a) => [a.articleId, a]));
  const menuById = new Map((menuItems || []).map((m) => [m.id, m]));
  const r = {
    caHt: 0, caHtCouvert: 0, coutPayants: 0, coutOptions: 0,
    optionsCouvertes: 0, optionsNonMappees: 0, optionsSansCout: 0,
    payantsNonMappes: 0, payantsSansCout: 0,
  };
  const menusSansBase = new Map();
  const aMapper = new Map();

  for (const l of lignesVente || []) {
    if (l.exclu_ca) continue;
    const q = Number(l.quantity) || 0;
    if (!q) continue;
    const m = resoudreMapping(l.abill_product_id, mappings);
    if (m && m.cible_type === 'ignorer') continue;
    const option = !(Number(l.total_ttc) > 0);
    const ht = Number(l.total_ht) || 0;
    if (!option) r.caHt += ht;

    const c = coutLigne(m, articlesById, menuById, parRecette);
    if (c.menuSansBase) menusSansBase.set(c.menuSansBase, (menusSansBase.get(c.menuSansBase) || 0) + q);

    if (option) {
      if (c.raison === 'non_mappe') {
        r.optionsNonMappees += q;
        aMapper.set(l.libelle, (aMapper.get(l.libelle) || 0) + q);
      } else if (c.raison === 'sans_cout') r.optionsSansCout += q;
      else { r.coutOptions += c.cout * q; r.optionsCouvertes += q; }
    } else if (c.raison === 'non_mappe') r.payantsNonMappes += q;
    else if (c.raison === 'sans_cout') r.payantsSansCout += q;
    else { r.coutPayants += c.cout * q; r.caHtCouvert += ht; }
  }

  const trier = (map, cle) => [...map.entries()]
    .map(([k, quantite]) => ({ [cle]: k, quantite }))
    .sort((a, b) => b.quantite - a.quantite);

  return {
    ...r,
    foodCostPct: r.caHtCouvert > 0 ? ((r.coutPayants + r.coutOptions) / r.caHtCouvert) * 100 : null,
    couverturePct: r.caHt > 0 ? (r.caHtCouvert / r.caHt) * 100 : null,
    menusSansBase: trier(menusSansBase, 'nom'),
    optionsAMapper: trier(aMapper, 'libelle'),
  };
}
