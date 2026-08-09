import { describe, it, expect } from 'vitest';
import { parseBankCSV, categorizeBankLine, extractSaleDateFromCB, mondayOf, attachToSaleWeek, dedupKey, dedupBankLines, aggregateBanqueParSemaine, SEUILS_DEFAUT, computeCoffreTheorique, computeReconciliation } from './finances.js';

// En-tête réel d'un export Caisse d'Épargne (vérifié le 09/08/2026).
const HEADER_CE = 'Date comptable;Libelle simplifie;Reference;Informations complementaires;Type operation;Debit;Credit;Date operation;Date de valeur;Pointage';

const CSV_OK = [
  HEADER_CE,
  '05/01/2026;CB KIMIKO 040126;12345620260104;CONTRAT 0000000 REM 123456;Remise CB;;+500,00;05/01/2026;06/01/2026;Non',
  '05/01/2026; CB COM KIMIKO 040126;;CONTRAT 0000000 REM 123456;Frais et extournes;-2,50;;05/01/2026;06/01/2026;Non',
  '',
].join('\n');

describe('parseBankCSV', () => {
  it('parse une remise CB : crédit positif, virgule décimale, date ISO', () => {
    const lignes = parseBankCSV(CSV_OK);
    expect(lignes).toHaveLength(2);
    expect(lignes[0]).toEqual({
      dateOperation: '2026-01-05',
      libelle: 'CB KIMIKO 040126',
      reference: '12345620260104',
      infos: 'CONTRAT 0000000 REM 123456',
      typeOperation: 'Remise CB',
      montant: 500,
    });
  });
  it('parse un débit en négatif et trime l\'espace en tête du libellé', () => {
    const lignes = parseBankCSV(CSV_OK);
    expect(lignes[1].montant).toBeCloseTo(-2.5, 6);
    expect(lignes[1].libelle).toBe('CB COM KIMIKO 040126');
  });
  it('accepte les fins de ligne CRLF et ignore les lignes vides', () => {
    expect(parseBankCSV(CSV_OK.replace(/\n/g, '\r\n'))).toHaveLength(2);
  });
  it('rejette un CSV sans les colonnes attendues, sans rien retourner', () => {
    expect(() => parseBankCSV('a;b;c\n1;2;3')).toThrow(/Format de CSV inattendu/);
  });
  it('rejette un fichier vide', () => {
    expect(() => parseBankCSV('')).toThrow(/Format de CSV inattendu/);
  });
  it('rejette une ligne au montant illisible', () => {
    const csv = [HEADER_CE, '05/01/2026;X;;;Remise CB;;abc;05/01/2026;;Non'].join('\n');
    expect(() => parseBankCSV(csv)).toThrow(/Format de CSV inattendu/);
  });
});

// Fabrique une ligne déjà parsée (même forme que la sortie de parseBankCSV).
const ligne = (typeOperation, libelle, extra = {}) =>
  ({ dateOperation: '2026-01-05', libelle, reference: '', infos: '', typeOperation, montant: 100, ...extra });

describe('categorizeBankLine', () => {
  it('Remise CB → remise_cb', () => {
    expect(categorizeBankLine(ligne('Remise CB', 'CB KIMIKO 040126'))).toBe('remise_cb');
  });
  it('Frais et extournes + CB COM → frais_cb', () => {
    expect(categorizeBankLine(ligne('Frais et extournes', 'CB COM KIMIKO 040126'))).toBe('frais_cb');
  });
  it('Frais et extournes sans CB COM → autre', () => {
    expect(categorizeBankLine(ligne('Frais et extournes', 'EXTOURNE DIVERSE'))).toBe('autre');
  });
  it('Depot especes → depot_especes', () => {
    expect(categorizeBankLine(ligne('Depot especes', 'DEPOT ESPECE GAB 0000000'))).toBe('depot_especes');
  });
  it('Retrait especes → retrait_especes', () => {
    expect(categorizeBankLine(ligne('Retrait especes', 'RETRAIT GAB'))).toBe('retrait_especes');
  });
  it('Virement Deliveroo → versement_deliveroo', () => {
    expect(categorizeBankLine(ligne('Virement', 'VIR SEPA DELIVEROO FR'))).toBe('versement_deliveroo');
  });
  it('Virement STICHTING CUSTODIAN UB → versement_uber (Uber ne dit jamais UBER)', () => {
    expect(categorizeBankLine(ligne('Virement', 'VIR SEPA STICHTING CUSTODIAN UB'))).toBe('versement_uber');
  });
  it('Virement STRIPE + réf FULLE → direct_click_collect', () => {
    expect(categorizeBankLine(ligne('Virement', 'VIR SEPA STRIPE', { reference: 'FULLE-000' }))).toBe('direct_click_collect');
  });
  it('Virement STRIPE sans FULLE → autre', () => {
    expect(categorizeBankLine(ligne('Virement', 'VIR SEPA STRIPE'))).toBe('autre');
  });
  it('titres resto : EDENRED, PLUXEE, UP COOP, SWILE → titres_resto', () => {
    for (const emetteur of ['EDENRED', 'PLUXEE', 'UP COOP', 'SWILE']) {
      expect(categorizeBankLine(ligne('Virement', `VIR SEPA ${emetteur} FRANCE`))).toBe('titres_resto');
    }
  });
  it('Virement inconnu → autre', () => {
    expect(categorizeBankLine(ligne('Virement', 'VIR SEPA QUELCONQUE'))).toBe('autre');
  });
  it('Prelevement SDD et Paiement CB → charges (hors rapprochement V1)', () => {
    expect(categorizeBankLine(ligne('Prelevement SDD', 'PRLV FOURNISSEUR'))).toBe('charges');
    expect(categorizeBankLine(ligne('Paiement CB', 'CUMUL DES DEBITS DIFFERES'))).toBe('charges');
  });
  it('Type operation inconnu → autre', () => {
    expect(categorizeBankLine(ligne('Cheque', 'CHEQUE 123'))).toBe('autre');
  });
});

describe('extractSaleDateFromCB', () => {
  it('lit la date de vente JJMMAA dans le libellé', () => {
    expect(extractSaleDateFromCB('CB KIMIKO 180126')).toBe('2026-01-18');
  });
  it('ne matche PAS un libellé de frais « CB COM KIMIKO … »', () => {
    expect(extractSaleDateFromCB('CB COM KIMIKO 180126')).toBeNull();
  });
  it('rejette une date impossible', () => {
    expect(extractSaleDateFromCB('CB KIMIKO 999999')).toBeNull();
  });
  it('rejette un libellé sans date', () => {
    expect(extractSaleDateFromCB('VIR SEPA QUELCONQUE')).toBeNull();
  });
});

describe('mondayOf', () => {
  it('un dimanche se rattache au lundi qui le précède', () => {
    expect(mondayOf('2026-01-18')).toBe('2026-01-12');
  });
  it('un lundi reste lui-même', () => {
    expect(mondayOf('2026-01-12')).toBe('2026-01-12');
  });
  it('traverse un changement de mois', () => {
    expect(mondayOf('2026-02-01')).toBe('2026-01-26');
  });
});

describe('attachToSaleWeek', () => {
  const remise = { dateOperation: '2026-01-20', libelle: 'CB KIMIKO 180126' };
  it('remise CB → semaine de la date de VENTE (pas de l\'opération)', () => {
    expect(attachToSaleWeek(remise, 'remise_cb'))
      .toEqual({ semaineRattachee: '2026-01-12', dateEstimee: false });
  });
  it('remise CB sans date lisible → semaine de l\'opération, signalée estimée', () => {
    const l = { dateOperation: '2026-01-20', libelle: 'CB KIMIKO SANSDATE' };
    expect(attachToSaleWeek(l, 'remise_cb'))
      .toEqual({ semaineRattachee: '2026-01-19', dateEstimee: true });
  });
  it('les autres catégories → semaine de l\'opération', () => {
    const depot = { dateOperation: '2026-01-21', libelle: 'DEPOT ESPECE GAB 0000000' };
    expect(attachToSaleWeek(depot, 'depot_especes'))
      .toEqual({ semaineRattachee: '2026-01-19', dateEstimee: false });
  });
});

describe('dedupBankLines', () => {
  const a = { dateOperation: '2026-01-05', libelle: 'CB KIMIKO 040126', montant: 500 };
  const b = { dateOperation: '2026-01-06', libelle: 'CB KIMIKO 050126', montant: 320 };
  it('réimport à l\'identique → zéro nouvelle ligne', () => {
    const existantes = new Set([dedupKey(a), dedupKey(b)]);
    expect(dedupBankLines([a, b], existantes)).toEqual({ nouvelles: [], doublons: 2 });
  });
  it('chevauchement partiel → seules les inconnues passent', () => {
    const existantes = new Set([dedupKey(a)]);
    const { nouvelles, doublons } = dedupBankLines([a, b], existantes);
    expect(nouvelles).toEqual([b]);
    expect(doublons).toBe(1);
  });
  it('doublon INTERNE au même fichier → une seule occurrence gardée', () => {
    const { nouvelles, doublons } = dedupBankLines([a, a], new Set());
    expect(nouvelles).toEqual([a]);
    expect(doublons).toBe(1);
  });
});

describe('aggregateBanqueParSemaine', () => {
  it('somme chaque catégorie d\'encaissement dans sa colonne, par semaine', () => {
    const lignes = [
      { montant: 500, categorie: 'remise_cb', semaineRattachee: '2026-01-12' },
      { montant: 320, categorie: 'remise_cb', semaineRattachee: '2026-01-12' },
      { montant: 600, categorie: 'depot_especes', semaineRattachee: '2026-01-19' },
      { montant: 250, categorie: 'versement_uber', semaineRattachee: '2026-01-12' },
      { montant: 90, categorie: 'titres_resto', semaineRattachee: '2026-01-12' },
    ];
    expect(aggregateBanqueParSemaine(lignes)).toEqual({
      '2026-01-12': { banque_cb: 820, banque_depot_especes: 0, banque_uber: 250, banque_deliveroo: 0, banque_direct: 0, banque_titres: 90 },
      '2026-01-19': { banque_cb: 0, banque_depot_especes: 600, banque_uber: 0, banque_deliveroo: 0, banque_direct: 0, banque_titres: 0 },
    });
  });
  it('ignore frais_cb, charges, retraits et « autre » (hors encaissements)', () => {
    const lignes = [
      { montant: -2.5, categorie: 'frais_cb', semaineRattachee: '2026-01-12' },
      { montant: -800, categorie: 'charges', semaineRattachee: '2026-01-12' },
      { montant: -100, categorie: 'retrait_especes', semaineRattachee: '2026-01-12' },
      { montant: 42, categorie: 'autre', semaineRattachee: '2026-01-12' },
    ];
    expect(aggregateBanqueParSemaine(lignes)).toEqual({});
  });
});

describe('computeCoffreTheorique', () => {
  const semaines = [
    { semaine_debut: '2026-01-05', caisse_especes: 500 },
    { semaine_debut: '2026-01-12', caisse_especes: 400 },
    { semaine_debut: '2026-01-19', caisse_especes: 300 },
  ];
  it('sans dépôt : solde = cumul, origine = semaine la plus ancienne', () => {
    const r = computeCoffreTheorique(semaines, [], '2026-01-26');
    expect(r.solde).toBe(1200);
    expect(r.semaineOrigine).toBe('2026-01-05');
    expect(r.couvertes).toEqual({ '2026-01-05': false, '2026-01-12': false, '2026-01-19': false });
  });
  it('un dépôt couvre la 1re semaine en FIFO, la 2e devient l\'origine', () => {
    const r = computeCoffreTheorique(semaines, [{ montant: 500 }], '2026-01-26');
    expect(r.solde).toBe(700);
    expect(r.semaineOrigine).toBe('2026-01-12');
    expect(r.couvertes['2026-01-05']).toBe(true);
    expect(r.couvertes['2026-01-12']).toBe(false);
  });
  it('un dépôt PARTIEL ne solde pas la semaine (origine inchangée)', () => {
    const r = computeCoffreTheorique(semaines, [{ montant: 300 }], '2026-01-26');
    expect(r.semaineOrigine).toBe('2026-01-05');
    expect(r.couvertes['2026-01-05']).toBe(false);
  });
  it('tout déposé : solde 0, pas d\'origine, pas d\'alerte', () => {
    const r = computeCoffreTheorique(semaines, [{ montant: 1200 }], '2026-06-01');
    expect(r.solde).toBe(0);
    expect(r.semaineOrigine).toBeNull();
    expect(r.alertes).toEqual([]);
  });
  it('alerte plafond quand le solde dépasse plafond_coffre', () => {
    const grosses = [{ semaine_debut: '2026-01-05', caisse_especes: 2500 }];
    const r = computeCoffreTheorique(grosses, [], '2026-01-12');
    expect(r.alertes).toContain('plafond_coffre');
  });
  it('alerte ancienneté au-delà de anciennete_max_semaines', () => {
    const r = computeCoffreTheorique(semaines, [], '2026-03-16'); // 10 semaines après le 05/01
    expect(r.ancienneteSemaines).toBe(10);
    expect(r.alertes).toContain('anciennete');
  });
  it('ignore les semaines sans saisie espèces (null)', () => {
    const avecTrou = [...semaines, { semaine_debut: '2026-01-26', caisse_especes: null }];
    expect(computeCoffreTheorique(avecTrou, [], '2026-02-02').solde).toBe(1200);
  });
});

describe('computeReconciliation', () => {
  // Une semaine saine : CB caisse 1000 / banque 998, 12 % d'espèces.
  const saine = {
    semaine_debut: '2026-01-05',
    caisse_cb: 1000, caisse_especes: 150, caisse_uber: 80, caisse_deliveroo: 20, caisse_autres: 0,
    banque_cb: 998,
  };
  it('totaux caisse absents → en_cours, AUCUN écart calculé (pas de faux positif)', () => {
    const r = computeReconciliation({ semaine_debut: '2026-01-05', caisse_cb: null, banque_cb: 500 }, true, SEUILS_DEFAUT, '2026-02-01');
    expect(r).toEqual({ statut: 'en_cours', ecartCb: null, especesADeposer: null, alertes: [] });
  });
  it('CB dans la tolérance + espèces couvertes → reconciliee', () => {
    const r = computeReconciliation(saine, true, SEUILS_DEFAUT, '2026-02-01');
    expect(r.statut).toBe('reconciliee');
    expect(r.ecartCb).toBe(2);
    expect(r.alertes).toEqual([]);
  });
  it('CB ok mais espèces non couvertes → a_deposer, avec le montant à déposer', () => {
    const r = computeReconciliation(saine, false, SEUILS_DEFAUT, '2026-02-01');
    expect(r.statut).toBe('a_deposer');
    expect(r.especesADeposer).toBe(150);
  });
  it('CB manquant en banque PENDANT la fenêtre → attente_banque, pas d\'alerte', () => {
    const enAttente = { ...saine, banque_cb: 400 };
    const r = computeReconciliation(enAttente, true, SEUILS_DEFAUT, '2026-01-13'); // 2 jours après la fin de semaine
    expect(r.statut).toBe('attente_banque');
    expect(r.alertes).toEqual([]);
  });
  it('CB manquant APRÈS la fenêtre → ecart + alerte anomalie (cas janvier)', () => {
    const fictive = { ...saine, caisse_cb: 5000, banque_cb: 1000 };
    const r = computeReconciliation(fictive, true, SEUILS_DEFAUT, '2026-02-15');
    expect(r.statut).toBe('ecart');
    expect(r.alertes.some((a) => a.type === 'anomalie_cb')).toBe(true);
  });
  it('part d\'espèces hors bande → alerte bande_especes (sans casser le statut)', () => {
    const bizarre = { ...saine, caisse_especes: 600 }; // ~35 % d'espèces
    const r = computeReconciliation(bizarre, false, SEUILS_DEFAUT, '2026-02-01');
    expect(r.alertes.some((a) => a.type === 'bande_especes')).toBe(true);
  });
  it('banque_cb null pendant la fenêtre → attente d\'import, pas un écart', () => {
    const fraiche = { ...saine, banque_cb: null };
    const r = computeReconciliation(fraiche, true, SEUILS_DEFAUT, '2026-01-12');
    expect(r.statut).toBe('attente_banque');
  });
});
