// Logique pure du module Finances. Aucune dépendance UI ni Supabase.
// Dépôt PUBLIC : aucun libellé bancaire réel, montant réel ni numéro de
// contrat dans ce fichier ni dans les tests (jeux synthétiques).

// ─── Parsing du CSV Caisse d'Épargne ───
// Format réel vérifié (09/08/2026) : en-tête en ligne 1 (pas de préambule),
// délimiteur ';', dates JJ/MM/AAAA, Credit préfixé '+', Debit préfixé '-',
// colonnes Debit/Credit mutuellement exclusives, libellés parfois précédés
// d'un espace parasite.

const COLONNES_REQUISES = ['Date comptable', 'Type operation', 'Debit', 'Credit', 'Date operation'];

function parseDateFR(jjmmaaaa) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((jjmmaaaa || '').trim());
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function parseMontantFR(s) {
  const clean = (s || '').trim().replace(/\+/g, '').replace(/\s/g, '').replace(',', '.');
  if (!clean) return null;
  const n = Number(clean);
  return Number.isNaN(n) ? null : n;
}

// → [{ dateOperation:'2026-01-05', libelle, reference, infos,
//      typeOperation:'Remise CB', montant: 500 }]  (débits en négatif)
// Jette une Error('Format de CSV inattendu…') au moindre doute :
// on n'enregistre RIEN plutôt que d'enregistrer faux.
export function parseBankCSV(text) {
  const lignes = (text || '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (!lignes.length) throw new Error('Format de CSV inattendu : fichier vide.');
  const entete = lignes[0].split(';').map((c) => c.trim());
  const idx = {};
  for (const col of COLONNES_REQUISES) {
    const i = entete.indexOf(col);
    if (i === -1) throw new Error(`Format de CSV inattendu : colonne « ${col} » absente.`);
    idx[col] = i;
  }
  const iLibelle = entete.indexOf('Libelle simplifie');
  const iRef = entete.indexOf('Reference');
  const iInfos = entete.indexOf('Informations complementaires');
  const resultat = [];
  for (const brute of lignes.slice(1)) {
    const c = brute.split(';');
    const dateOperation = parseDateFR(c[idx['Date operation']]) || parseDateFR(c[idx['Date comptable']]);
    const credit = parseMontantFR(c[idx['Credit']]);
    const debit = parseMontantFR(c[idx['Debit']]);
    const montant = credit !== null ? credit : debit;
    if (dateOperation === null || montant === null) {
      throw new Error(`Format de CSV inattendu : ligne illisible « ${brute.slice(0, 40)} »`);
    }
    resultat.push({
      dateOperation,
      libelle: (c[iLibelle] || '').trim(),
      reference: (c[iRef] || '').trim(),
      infos: (c[iInfos] || '').trim(),
      typeOperation: (c[idx['Type operation']] || '').trim(),
      montant,
    });
  }
  return resultat;
}

// ─── Classification ───
// D'abord par « Type operation » (colonne fiable de la banque), puis
// affinage par libellé. Les règles vivent dans un objet unique, faciles
// à ajuster ici ; un éditeur in-app est en phase 2 si besoin.

export const REGLES_VIREMENT = [
  { categorie: 'versement_deliveroo', motif: /DELIVEROO/i },
  { categorie: 'versement_uber', motif: /STICHTING CUSTODIAN UB/i },   // Uber ne dit jamais « UBER »
  { categorie: 'titres_resto', motif: /(EDENRED|PLUXEE|UP COOP|SWILE)/i },
];

export function categorizeBankLine(l) {
  const type = (l.typeOperation || '').toLowerCase();
  const texte = `${l.libelle} ${l.infos} ${l.reference}`;
  if (type === 'remise cb') return 'remise_cb';
  if (type === 'frais et extournes') return /CB COM/i.test(l.libelle) ? 'frais_cb' : 'autre';
  if (type === 'depot especes') return 'depot_especes';
  if (type === 'retrait especes') return 'retrait_especes';
  if (type === 'virement') {
    for (const r of REGLES_VIREMENT) if (r.motif.test(texte)) return r.categorie;
    // Direct / click & collect : Stripe encaisse pour le webshop Fülle.
    if (/STRIPE/i.test(texte) && /FULLE/i.test(texte)) return 'direct_click_collect';
    return 'autre';
  }
  if (type === 'prelevement sdd' || type === 'paiement cb') return 'charges';
  return 'autre';
}
