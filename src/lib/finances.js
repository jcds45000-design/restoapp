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

// ─── Rattachement à la semaine de VENTE ───
// Libellé « CB KIMIKO 180126 » : les 6 chiffres sont la date de vente
// (JJMMAA). C'est ce qui permet de rapprocher une remise CB de la bonne
// semaine, même si elle tombe en banque 1 à 3 jours plus tard.

export function extractSaleDateFromCB(libelle) {
  const m = /CB KIMIKO (\d{6})/.exec(libelle || '');
  if (!m) return null;
  const jj = m[1].slice(0, 2), mm = m[1].slice(2, 4), aa = m[1].slice(4, 6);
  if (Number(jj) < 1 || Number(jj) > 31 || Number(mm) < 1 || Number(mm) > 12) return null;
  return `20${aa}-${mm}-${jj}`;
}

// Lundi (ISO) de la semaine d'une date ISO. Calcul à midi UTC : aucun
// risque de bascule de jour liée au fuseau.
export function mondayOf(dateISO) {
  const d = new Date(`${dateISO}T12:00:00Z`);
  const decalage = (d.getUTCDay() + 6) % 7;   // lundi=0 … dimanche=6
  d.setUTCDate(d.getUTCDate() - decalage);
  return d.toISOString().slice(0, 10);
}

// → { semaineRattachee, dateEstimee }. Une remise CB se rattache à la
// semaine de la date de vente ; à défaut (date illisible → signalé),
// ou pour toute autre catégorie, à la semaine de la date d'opération.
export function attachToSaleWeek(l, categorie) {
  if (categorie === 'remise_cb') {
    const dateVente = extractSaleDateFromCB(l.libelle);
    if (dateVente) return { semaineRattachee: mondayOf(dateVente), dateEstimee: false };
    return { semaineRattachee: mondayOf(l.dateOperation), dateEstimee: true };
  }
  return { semaineRattachee: mondayOf(l.dateOperation), dateEstimee: false };
}

// ─── Dédoublonnage ───
// Clé métier (date, montant, libellé), identique à la contrainte unique
// de finance_banque_lignes : réimporter un CSV qui chevauche une période
// déjà importée ne compte JAMAIS deux fois une opération.

export function dedupKey(l) {
  return `${l.dateOperation}|${l.montant}|${l.libelle}`;
}

// clesExistantes : Set des clés déjà en base. → { nouvelles, doublons }
export function dedupBankLines(lignes, clesExistantes) {
  const vues = new Set(clesExistantes || []);
  const nouvelles = [];
  let doublons = 0;
  for (const l of lignes) {
    const cle = dedupKey(l);
    if (vues.has(cle)) { doublons++; continue; }
    vues.add(cle);
    nouvelles.push(l);
  }
  return { nouvelles, doublons };
}
