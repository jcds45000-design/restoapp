// ============================================================================
// Phase 2 : import des ventes depuis l'export « Historique des tickets » du
// back-office Abill (Documents > Tickets > Fichier Excel), en attendant l'API.
//
// Moteur PUR : reçoit le fichier déjà lu en tableau de lignes (une ligne =
// un tableau de cellules), ne dépend d'aucune librairie Excel. Produit des
// tickets AU FORMAT DE L'API Fulle, pour que normaliserTicket() et tout le
// moteur de ventes.js s'appliquent sans adaptation.
//
// Particularités de l'export, relevées sur un fichier réel (semaine du
// 22-26/09/2026, rapproché au centime de la synthèse quotidienne) :
// - une ligne par produit ET une ligne par règlement, répétant la tête du
//   ticket (référence, date, mode de vente) ; plus une ligne de tête nue ;
// - des lignes de titre (« Journée du », « Service n° ») et de total
//   (formules SUBTOTAL) à ignorer ;
// - aucun identifiant produit : on identifie par le libellé, dont on retire
//   le suffixe de remise « (-30%) » ;
// - les options incluses aux menus sont des lignes à 0 € : gardées, c'est de
//   la matière consommée ;
// - colonnes CLIENT, CLIENTS et VENDEUR : jamais lues (données personnelles,
//   inutiles au food cost).
// ============================================================================

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : null;
};
const cents = (n) => Math.round(n * 100) / 100;
const texte = (v) => (v === null || v === undefined ? '' : String(v)).trim();

const REMISE = /\(\s*-\s*(\d+(?:[.,]\d+)?)\s*%\s*\)\s*$/;

// Libellé sans remise, espaces normalisés, casse d'origine (pour l'affichage).
function libelleSansRemise(libelle) {
  return texte(libelle).replace(REMISE, '').replace(/\s+/g, ' ').trim();
}

// Clé d'identification d'un produit : tient lieu d'identifiant Abill.
export function cleLibelle(libelle) {
  return libelleSansRemise(libelle).toUpperCase();
}

// « EMPORTER. » et « EMPORTER » coexistent dans la caisse : même canal.
export function normaliserCanal(mode) {
  const t = texte(mode).replace(/\.+$/, '').replace(/\s+/g, ' ').trim().toUpperCase();
  return t || null;
}

function colonnes(entete) {
  const noms = entete.map((c) => texte(c).toUpperCase());
  const idx = (nom) => noms.indexOf(nom);
  const qtes = noms.map((n, i) => (n.startsWith('QT') ? i : -1)).filter((i) => i >= 0);
  return {
    ref: idx('REFERENCE'),
    date: idx('DATE / HEURE'),
    mode: idx('MODE DE VENTE'),
    qteProduit: qtes[0] ?? -1,
    produit: idx('PRODUIT'),
    ttc: idx('MONTANT TTC'),
    offert: idx('OFFERT'),
    qteReglement: qtes[1] ?? -1,
    reglement: idx('REGLEMENT'),
    montant: idx('MONTANT'),
    taxe10: idx('TAXE 10 %'),
    ht10: idx('HT 10 %'),
    taxe55: idx('TAXE 5.5 %'),
    ht55: idx('HT 5.5 %'),
  };
}

const OBLIGATOIRES = ['ref', 'date', 'mode', 'produit', 'ttc', 'reglement', 'montant'];

export function ticketsDepuisExportTickets(rows) {
  const lignes = Array.isArray(rows) ? rows : [];
  const iEntete = lignes.findIndex((r) => Array.isArray(r) && r.some((c) => texte(c).toUpperCase() === 'REFERENCE'));
  const col = iEntete >= 0 ? colonnes(lignes[iEntete]) : null;
  if (!col || OBLIGATOIRES.some((k) => col[k] < 0)) {
    return { tickets: [], erreurs: ['En-tête d’export de tickets introuvable : ce fichier n’est pas un « Historique des tickets ».'] };
  }

  const parRef = new Map();
  const erreurs = [];
  for (let i = iEntete + 1; i < lignes.length; i += 1) {
    const r = lignes[i];
    if (!Array.isArray(r)) continue;
    const ref = texte(r[col.ref]);
    const date = texte(r[col.date]);
    if (!ref || !date) continue; // titres et totaux

    let t = parRef.get(ref);
    if (!t) {
      const [rT, nT] = ref.split('/').map((s) => s.trim());
      t = {
        id: ref,
        r_ticket: rT || null,
        n_ticket: nT || null,
        type_document: 'ticket',
        date,
        sale_method: { id: null, name: normaliserCanal(r[col.mode]), brut: texte(r[col.mode]) || null },
        payments: [],
        details: [],
        _taxes: { 10: { amount: 0, ht: 0, vu: false }, 5.5: { amount: 0, ht: 0, vu: false } },
      };
      parRef.set(ref, t);
    }

    const libelle = texte(r[col.produit]);
    if (libelle) {
      const quantite = num(r[col.qteProduit]) ?? 1;
      const totalTtc = num(r[col.ttc]);
      if (totalTtc === null) { erreurs.push(`Ligne ${i + 1} : montant illisible pour « ${libelle} ».`); continue; }
      const ht = (num(r[col.ht10]) ?? 0) + (col.ht55 >= 0 ? num(r[col.ht55]) ?? 0 : 0);
      for (const [taux, cT, cH] of [[10, col.taxe10, col.ht10], [5.5, col.taxe55, col.ht55]]) {
        if (cH < 0 || num(r[cH]) === null) continue;
        const acc = t._taxes[taux];
        acc.vu = true;
        acc.amount += num(r[cT]) ?? 0;
        acc.ht += num(r[cH]);
      }
      const remise = libelle.match(REMISE);
      t.details.push({
        id: t.details.length + 1,
        id_product: `lib:${cleLibelle(libelle)}`,
        name: libelleSansRemise(libelle),
        quantity: quantite,
        unit_ttc: quantite ? cents(totalTtc / quantite) : null,
        total_ttc: totalTtc,
        total_ht: cents(ht),
        discount: remise ? parseFloat(remise[1].replace(',', '.')) : 0,
        free: (num(r[col.offert]) ?? 0) > 0,
        excluded: false,
      });
    }

    const reglement = texte(r[col.reglement]);
    if (reglement) {
      t.payments.push({
        amount: num(r[col.montant]),
        quantity: num(r[col.qteReglement]) ?? 1,
        payment_mean: { name: reglement },
      });
    }
  }

  const tickets = [...parRef.values()].map(({ _taxes, ...t }) => ({
    ...t,
    n_lines: t.details.length,
    total_ttc: cents(t.details.reduce((s, d) => s + d.total_ttc, 0)),
    total_ht: cents(t.details.reduce((s, d) => s + d.total_ht, 0)),
    taxes: Object.entries(_taxes)
      .filter(([, v]) => v.vu)
      .map(([taux, v]) => ({ rate: Number(taux), amount: cents(v.amount), ht: cents(v.ht) }))
      .sort((a, b) => b.rate - a.rate),
  }));
  return { tickets, erreurs };
}
