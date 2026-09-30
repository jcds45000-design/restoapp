// ============================================================================
// Phase 2 du chantier Kimiko Pilotage : ventes Abill (spec maître §15-17).
// Moteur PUR : aucune écriture, aucune dépendance Supabase. Les composants
// l'appellent avec les données chargées, les scripts d'import aussi.
//
// Source de vérité du format d'entrée : l'API Fulle (api.fulleapps.io,
// GET /tickets → NoteTicket). L'import CSV de secours devra produire des
// objets de la même forme avant d'appeler normaliserTicket().
// ============================================================================

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : null;
};

// ─── Normalisation d'un ticket API → { ticket, lignes } ──────────────────────
// Ne décide rien : conserve le brut, aplatit les infos utiles.
export function normaliserTicket(t) {
  if (!t || (t.id === undefined && t.r_ticket === undefined)) {
    return { erreur: 'ticket sans identifiant', brut: t };
  }
  const dateSaisie = t.date || null;
  // date_service : la date métier du ticket. L'API filtre par service_date mais
  // ne la renvoie pas séparément : on la dérive de la date de saisie.
  const dateService = dateSaisie ? String(dateSaisie).slice(0, 10) : null;
  if (!dateService) return { erreur: 'ticket sans date', brut: t };

  const ticket = {
    abill_id: String(t.id ?? t.r_ticket),
    r_ticket: t.r_ticket != null ? String(t.r_ticket) : null,
    n_ticket: t.n_ticket != null ? String(t.n_ticket) : null,
    type_document: t.type_document != null ? String(t.type_document) : null,
    date_service: dateService,
    date_saisie: dateSaisie,
    canal_id: t.sale_method?.id ?? null,
    canal: t.sale_method?.name ?? null,
    n_lignes: t.n_lines ?? (Array.isArray(t.details) ? t.details.length : null),
    total_ttc: num(t.total_ttc),
    total_ht: num(t.total_ht),
    reverse: Boolean(t.reverse) || Boolean(t.reversal),
    paiements: Array.isArray(t.payments)
      ? t.payments.map((p) => ({
          mode: p.payment_mean?.name ?? null,
          montant: num(p.amount),
          quantite: num(p.quantity) ?? 1,
        }))
      : null,
    taxes: Array.isArray(t.taxes) ? t.taxes : null,
    brut: t,
  };

  const lignes = (Array.isArray(t.details) ? t.details : []).map((d) => ({
    abill_line_id: d.id != null ? String(d.id) : null,
    abill_product_id: d.id_product != null ? String(d.id_product) : null,
    libelle: d.name ?? '(sans libellé)',
    quantity: num(d.quantity_decimal) ?? num(d.quantity) ?? 1,
    unit_ttc: num(d.unit_ttc),
    total_ttc: num(d.total_ttc),
    unit_ht: num(d.unit_ht),
    total_ht: num(d.total_ht),
    remise_pct: num(d.discount),
    offert: Boolean(d.free),
    exclu_ca: Boolean(d.excluded),
    tva: Array.isArray(d.taxes) ? d.taxes : null,
    // Choix de menu et suppléments : les sous-details Abill, gardés tels quels.
    options: Array.isArray(d.details) && d.details.length
      ? d.details.map((o) => ({
          abill_product_id: o.id_product != null ? String(o.id_product) : null,
          libelle: o.name ?? null,
          quantity: num(o.quantity_decimal) ?? num(o.quantity) ?? 1,
          total_ttc: num(o.total_ttc),
        }))
      : null,
  }));

  return { ticket, lignes };
}

// ─── Déduplication (règle spec : ré-import ≠ double ventes) ──────────────────
// clesExistantes : Set des abill_id déjà en base.
export function dedupTickets(ticketsNormalises, clesExistantes) {
  const nouveaux = [];
  let doublons = 0;
  const vus = new Set();
  for (const tn of ticketsNormalises) {
    if (tn.erreur) continue;
    const cle = tn.ticket.abill_id;
    if (clesExistantes.has(cle) || vus.has(cle)) { doublons += 1; continue; }
    vus.add(cle);
    nouveaux.push(tn);
  }
  return { nouveaux, doublons };
}

// ─── Mapping Abill → recettes de l'app ───────────────────────────────────────
// mappings : lignes de abill_item_mapping. Renvoie la cible d'une ligne de
// vente, ou null si l'article n'est pas (ou pas encore) mappé.
export function resoudreMapping(abillProductId, mappings) {
  if (abillProductId == null) return null;
  const m = (mappings || []).find((x) => x.abill_product_id === String(abillProductId));
  if (!m || m.cible_type === 'a_mapper') return null;
  return m;
}

// Articles Abill rencontrés dans des lignes mais absents (ou non résolus) du
// mapping → matière des alertes « Article Abill non associé à une recette »
// et des lignes à créer dans abill_item_mapping (cible_type a_mapper).
export function articlesNonMappes(lignes, mappings) {
  const parId = new Map();
  for (const l of lignes || []) {
    if (l.abill_product_id == null) continue;
    const m = resoudreMapping(l.abill_product_id, mappings);
    if (m && m.cible_type === 'ignorer') continue;
    if (m) continue;
    const cur = parId.get(l.abill_product_id) || { abill_product_id: l.abill_product_id, libelle: l.libelle, occurrences: 0, quantite: 0 };
    cur.occurrences += 1;
    cur.quantite += l.quantity ?? 0;
    cur.libelle = l.libelle || cur.libelle;
    parId.set(l.abill_product_id, cur);
  }
  return [...parId.values()].sort((a, b) => b.occurrences - a.occurrences);
}

// ─── Agrégats de ventes ──────────────────────────────────────────────────────
// tickets/lignes : déjà normalisés (ou relus en base, mêmes champs).
// Les extournes (reverse) et lignes exclues du CA sont écartées des totaux.
export function ventesParJour(tickets) {
  const parJour = new Map();
  for (const t of tickets || []) {
    if (t.reverse) continue;
    const cur = parJour.get(t.date_service) || { date: t.date_service, nb_tickets: 0, total_ttc: 0, total_ht: 0, parCanal: {} };
    cur.nb_tickets += 1;
    cur.total_ttc += t.total_ttc ?? 0;
    cur.total_ht += t.total_ht ?? 0;
    if (t.canal) {
      const c = cur.parCanal[t.canal] || { nb_tickets: 0, total_ttc: 0 };
      c.nb_tickets += 1;
      c.total_ttc += t.total_ttc ?? 0;
      cur.parCanal[t.canal] = c;
    }
    parJour.set(t.date_service, cur);
  }
  return [...parJour.values()].sort((a, b) => a.date < b.date ? -1 : 1);
}

// Quantités vendues par article Abill, avec cible résolue quand elle existe.
// C'est CETTE sortie qui pondérera enfin le dashboard de la Phase 1
// (dashboard(base, { ventes }) attend { menu_item_id, quantite }).
export function quantitesVendues(lignes, mappings, ticketsById) {
  const parProduit = new Map();
  for (const l of lignes || []) {
    if (l.exclu_ca) continue;
    if (ticketsById && l.ticket_id != null) {
      const t = ticketsById.get(l.ticket_id);
      if (t && t.reverse) continue;
    }
    const cle = l.abill_product_id ?? `libelle:${l.libelle}`;
    const m = resoudreMapping(l.abill_product_id, mappings);
    if (m && m.cible_type === 'ignorer') continue;
    const cur = parProduit.get(cle) || {
      abill_product_id: l.abill_product_id,
      libelle: l.libelle,
      quantite: 0,
      total_ttc: 0,
      menu_item_id: m?.menu_item_id ?? null,
      recipe_id: m?.recipe_id ?? null,
      cible_type: m?.cible_type ?? null,
    };
    cur.quantite += l.quantity ?? 0;
    cur.total_ttc += l.total_ttc ?? 0;
    parProduit.set(cle, cur);
  }
  return [...parProduit.values()].sort((a, b) => b.quantite - a.quantite);
}

// ─── Récapitulatif d'import (règle maison : récap AVANT enregistrement) ──────
export function recapImport(ticketsNormalises, clesExistantes, mappings) {
  const erreurs = ticketsNormalises.filter((t) => t.erreur);
  const { nouveaux, doublons } = dedupTickets(ticketsNormalises, clesExistantes);
  const lignes = nouveaux.flatMap((n) => n.lignes);
  const jours = ventesParJour(nouveaux.map((n) => n.ticket));
  return {
    nb_tickets: nouveaux.length,
    nb_lignes: lignes.length,
    nb_doublons: doublons,
    nb_erreurs: erreurs.length,
    erreurs,
    periode_debut: jours[0]?.date ?? null,
    periode_fin: jours[jours.length - 1]?.date ?? null,
    total_ttc: jours.reduce((s, j) => s + j.total_ttc, 0),
    non_mappes: articlesNonMappes(lignes, mappings),
    jours,
  };
}

// ─── Préparation de l'enregistrement en base ─────────────────────────────────
// La caisse donne une heure locale sans fuseau (« 2026-09-22 11:31:09 ») :
// interprétée dans le fuseau du navigateur, sinon Postgres la lirait en UTC.
function instantSaisie(date) {
  if (!date) return null;
  const s = String(date);
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(s)) {
    const d = new Date(s.replace(' ', 'T'));
    return Number.isNaN(d.getTime()) ? s : d.toISOString();
  }
  return s;
}

// nouveaux : sortie de dedupTickets (déjà filtrée). Les ids des tickets sont
// générés ici (genId) pour rattacher les lignes sans aller-retour en base.
// Renvoie les lignes prêtes pour sales_tickets, sales_lines et, pour les
// articles jamais vus, abill_item_mapping (en « à mapper » par défaut).
export function preparerEnregistrement(nouveaux, { importId, mappings, genId }) {
  const tickets = [];
  const lignes = [];
  for (const { ticket: tk, lignes: ls } of nouveaux) {
    const id = genId();
    const { brut, date_saisie, ...champs } = tk;
    tickets.push({ ...champs, id, date_saisie: instantSaisie(date_saisie), import_id: importId, brut });
    for (const l of ls) lignes.push({ ...l, ticket_id: id });
  }
  const connus = new Set((mappings || []).map((m) => m.abill_product_id));
  const nouveauxArticles = articlesNonMappes(lignes, mappings)
    .filter((a) => !connus.has(a.abill_product_id))
    .map((a) => ({ abill_product_id: a.abill_product_id, libelle_abill: a.libelle }));
  return { tickets, lignes, nouveauxArticles };
}
