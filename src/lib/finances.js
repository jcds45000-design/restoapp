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

// ─── Agrégats banque par semaine ───
// catégorie → colonne de finance_semaines. Les catégories absentes de la
// table (frais, charges, retraits, autre) ne participent pas aux totaux
// d'encaissement ; elles restent visibles ligne à ligne.

const COLONNE_PAR_CATEGORIE = {
  remise_cb: 'banque_cb',
  depot_especes: 'banque_depot_especes',
  versement_uber: 'banque_uber',
  versement_deliveroo: 'banque_deliveroo',
  direct_click_collect: 'banque_direct',
  titres_resto: 'banque_titres',
};

// lignes : [{ montant, categorie, semaineRattachee }]
// → { '2026-01-12': { banque_cb: 820, banque_depot_especes: 0, … } }
export function aggregateBanqueParSemaine(lignes) {
  const parSemaine = {};
  for (const l of lignes) {
    const colonne = COLONNE_PAR_CATEGORIE[l.categorie];
    if (!colonne) continue;
    if (!parSemaine[l.semaineRattachee]) {
      parSemaine[l.semaineRattachee] = {
        banque_cb: 0, banque_depot_especes: 0, banque_uber: 0,
        banque_deliveroo: 0, banque_direct: 0, banque_titres: 0,
      };
    }
    parSemaine[l.semaineRattachee][colonne] += l.montant;
  }
  return parSemaine;
}

// ─── Seuils par défaut ───
// Miroir de la table finance_settings. L'UI charge la table et passe les
// valeurs au moteur ; ces défauts ne servent qu'en secours et aux tests.
export const SEUILS_DEFAUT = {
  tolerance_cb: 10,
  plafond_coffre: 2000,
  anciennete_max_semaines: 4,
  bande_especes_min: 8,
  bande_especes_max: 18,
};

// ─── Coffre théorique d'espèces (cumul) ───
// « Combien d'espèces devraient être non déposées, là, maintenant, et
// depuis quand ». Tout l'espèces part au dépôt (pas de fond de caisse à
// soustraire). Les dépôts s'imputent en FIFO contre les semaines les
// plus anciennes ; le rapprochement espèces se ferme au niveau cumulé,
// pas semaine par semaine (le fils peut grouper les dépôts).

const EPSILON = 0.005; // tolérance d'arrondi centimes

export function computeCoffreTheorique(semaines, depots, aujourdHui, seuils = SEUILS_DEFAUT) {
  const triees = [...(semaines || [])]
    .filter((s) => s.caisse_especes !== null && s.caisse_especes !== undefined)
    .sort((a, b) => a.semaine_debut.localeCompare(b.semaine_debut));
  const totalEspeces = triees.reduce((t, s) => t + Number(s.caisse_especes), 0);
  const totalDepots = (depots || []).reduce((t, d) => t + Number(d.montant), 0);
  const solde = Math.round((totalEspeces - totalDepots) * 100) / 100;

  // Imputation FIFO : chaque dépôt couvre d'abord la semaine la plus ancienne.
  let reste = totalDepots;
  let semaineOrigine = null;
  const couvertes = {};
  for (const s of triees) {
    const du = Number(s.caisse_especes);
    if (reste >= du - EPSILON) { couvertes[s.semaine_debut] = true; reste -= du; }
    else {
      couvertes[s.semaine_debut] = false;
      if (semaineOrigine === null) semaineOrigine = s.semaine_debut;
    }
  }

  const ancienneteSemaines = semaineOrigine === null ? 0
    : Math.floor((new Date(`${aujourdHui}T12:00:00Z`) - new Date(`${semaineOrigine}T12:00:00Z`)) / (7 * 86400000));
  const alertes = [];
  if (solde > seuils.plafond_coffre) alertes.push('plafond_coffre');
  if (semaineOrigine !== null && ancienneteSemaines > seuils.anciennete_max_semaines) alertes.push('anciennete');
  return { solde, semaineOrigine, ancienneteSemaines, alertes, couvertes };
}

// ─── Rapprochement hebdomadaire et statuts ───

// Fenêtre d'attente des remises CB : au-delà de N jours après la FIN de la
// semaine, un manque côté banque n'est plus « en attente », c'est un écart.
export const DELAI_REMISES_JOURS = 10;

// semaine : ligne de finance_semaines. especesCouvertes : booléen issu de
// computeCoffreTheorique().couvertes[semaine_debut]. On ne compare que ce
// qui existe : sans totaux caisse, aucun écart n'est calculé.
export function computeReconciliation(semaine, especesCouvertes, seuils = SEUILS_DEFAUT, aujourdHui) {
  const vide = (v) => v === null || v === undefined;
  if (vide(semaine.caisse_cb)) {
    return { statut: 'en_cours', ecartCb: null, especesADeposer: null, alertes: [] };
  }
  const especesADeposer = Number(semaine.caisse_especes) || 0;
  const banqueCb = vide(semaine.banque_cb) ? 0 : Number(semaine.banque_cb);
  const ecartCb = Math.round((Number(semaine.caisse_cb) - banqueCb) * 100) / 100;
  const cbOk = Math.abs(ecartCb) <= Number(seuils.tolerance_cb);

  const finSemaine = new Date(`${semaine.semaine_debut}T12:00:00Z`);
  finSemaine.setUTCDate(finSemaine.getUTCDate() + 6);
  const joursDepuisFin = Math.floor((new Date(`${aujourdHui}T12:00:00Z`) - finSemaine) / 86400000);
  const fenetreOuverte = joursDepuisFin < DELAI_REMISES_JOURS;

  const alertes = [];
  let statut;
  if (cbOk && especesCouvertes) statut = 'reconciliee';
  else if (!cbOk && fenetreOuverte) statut = 'attente_banque';
  else if (!cbOk) {
    // Fenêtre passée et la banque ne colle toujours pas : le détecteur
    // d'anomalie « type janvier » (ventes en caisse jamais arrivées en banque).
    statut = 'ecart';
    alertes.push({ type: 'anomalie_cb', ecart: ecartCb });
  } else statut = 'a_deposer'; // CB ok, il ne manque que le dépôt d'espèces

  // Bande « normale » de la part d'espèces dans le CA de la semaine.
  const totalCaisse = ['caisse_cb', 'caisse_especes', 'caisse_uber', 'caisse_deliveroo', 'caisse_autres']
    .reduce((t, c) => t + (Number(semaine[c]) || 0), 0);
  if (totalCaisse > 0) {
    const part = (especesADeposer / totalCaisse) * 100;
    if (part < Number(seuils.bande_especes_min) || part > Number(seuils.bande_especes_max)) {
      alertes.push({ type: 'bande_especes', part: Math.round(part * 10) / 10 });
    }
  }
  return { statut, ecartCb, especesADeposer, alertes };
}
