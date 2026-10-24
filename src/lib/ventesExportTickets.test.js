import { describe, it, expect } from 'vitest';
import { cleLibelle, normaliserCanal, ticketsDepuisExportTickets } from './ventesExportTickets.js';
import { normaliserTicket, recapImport } from './ventes.js';

// Reproduit la structure de l'export « Historique des tickets » du back-office
// (Documents > Tickets > Fichier Excel), lu en tableau de lignes.
// Valeurs FICTIVES : aucun chiffre réel ni nom de client ici (dépôt public).
const ENTETE = ['POINT DE VENTE', 'REFERENCE', 'DATE / HEURE', 'MODE DE VENTE', 'VENDEUR', 'CLIENTS', 'CLIENT',
  'Qté', 'PRODUIT', 'MONTANT TTC', 'OFFERT', 'Qté', 'REGLEMENT', 'MONTANT', 'TAXE 10 %', 'HT 10 %', 'TAXE 5.5 %', 'HT 5.5 %'];

// Une ligne de l'export : tête de ticket commune + colonnes spécifiques.
const tete = (ref, date, mode) => ['RESTO', ref, date, mode, 'USER DEFAULT', null, 'Client Fictif'];
const produit = (ref, date, mode, qte, lib, ttc, t10, ht10, t55 = null, ht55 = null) =>
  [...tete(ref, date, mode), qte, lib, ttc, 0, null, null, null, t10, ht10, t55, ht55];
const reglement = (ref, date, mode, nom, montant) =>
  [...tete(ref, date, mode), null, null, null, null, 1, nom, montant, null, null, null, null];

const R1 = '1-T00000001 / 1-N00000001';
const R2 = '1-T00000002 / 1-N00000002';
const D1 = '2026-08-29 12:31:05';
const D2 = '2026-08-29 19:02:40';

const lignesExport = [
  ENTETE,
  ['Journée du', '2026-08-29'],
  ['Service n°', 1],
  tete(R1, D1, 'SUR PLACE.'),
  produit(R1, D1, 'SUR PLACE.', 1, 'Mixte fictif (-30%)', 4.2, 0.38, 3.82),
  produit(R1, D1, 'SUR PLACE.', 1, 'SAUCE FICTIVE (-30%)', 0, 0, 0),
  produit(R1, D1, 'SUR PLACE.', 2, 'Boisson fictive', 5, null, null, 0.26, 4.74),
  reglement(R1, D1, 'SUR PLACE.', 'ESPECES', 10),
  reglement(R1, D1, 'SUR PLACE.', 'RENDU MONNAIE', -0.8),
  tete(R2, D2, 'EMPORTER'),
  produit(R2, D2, 'EMPORTER', 1, 'Plat fictif (ÉPICÉ)', 12.5, 1.14, 11.36),
  reglement(R2, D2, 'EMPORTER', "IMPUTATION D'ARRHE / CARTE BANCAIRE", 12.5),
  ['Total service', null, null, null, null, '=SUBTOTAL(9, F3:F9)'],
  ['Total journée'],
  ['Total période'],
];

describe('cleLibelle', () => {
  it('retire le suffixe de remise et unifie la casse', () => {
    expect(cleLibelle('Mixte fictif (-30%)')).toBe('MIXTE FICTIF');
    expect(cleLibelle('Mixte fictif (-19.97%)')).toBe('MIXTE FICTIF');
    expect(cleLibelle('  mixte   FICTIF ')).toBe('MIXTE FICTIF');
  });
  it('garde les variantes qui ne sont pas des remises', () => {
    expect(cleLibelle('Plat fictif (ÉPICÉ)')).toBe('PLAT FICTIF (ÉPICÉ)');
    expect(cleLibelle('Plat fictif (NON ÉPICÉ)')).toBe('PLAT FICTIF (NON ÉPICÉ)');
  });
});

describe('normaliserCanal', () => {
  it('fusionne les doublons de mode de vente à un point près', () => {
    expect(normaliserCanal('EMPORTER.')).toBe('EMPORTER');
    expect(normaliserCanal('EMPORTER')).toBe('EMPORTER');
    expect(normaliserCanal(' sur place. ')).toBe('SUR PLACE');
    expect(normaliserCanal(null)).toBeNull();
  });
});

describe('ticketsDepuisExportTickets', () => {
  const { tickets, erreurs } = ticketsDepuisExportTickets(lignesExport);

  it('regroupe les lignes par ticket et ignore titres et totaux', () => {
    expect(erreurs).toEqual([]);
    expect(tickets).toHaveLength(2);
    expect(tickets.map((t) => t.id)).toEqual([R1, R2]);
  });

  it('produit un ticket au format API, avec canal et totaux', () => {
    const t = tickets[0];
    expect(t.date).toBe(D1);
    expect(t.sale_method).toEqual({ id: null, name: 'SUR PLACE', brut: 'SUR PLACE.' });
    expect(t.total_ttc).toBeCloseTo(9.2, 2);
    expect(t.total_ht).toBeCloseTo(8.56, 2);
    expect(t.n_lines).toBe(3);
    expect(t.taxes).toEqual([{ rate: 10, amount: 0.38, ht: 3.82 }, { rate: 5.5, amount: 0.26, ht: 4.74 }]);
  });

  it('garde les règlements, rendu monnaie compris', () => {
    expect(tickets[0].payments).toEqual([
      { amount: 10, quantity: 1, payment_mean: { name: 'ESPECES' } },
      { amount: -0.8, quantity: 1, payment_mean: { name: 'RENDU MONNAIE' } },
    ]);
  });

  it('identifie le produit par son libellé sans remise, et garde la remise', () => {
    const [mixte, sauce, boisson] = tickets[0].details;
    expect(mixte).toMatchObject({ id_product: 'lib:MIXTE FICTIF', name: 'Mixte fictif', quantity: 1, total_ttc: 4.2, total_ht: 3.82, discount: 30, free: false });
    expect(boisson).toMatchObject({ id_product: 'lib:BOISSON FICTIVE', quantity: 2, unit_ttc: 2.5, total_ht: 4.74 });
    // Option incluse dans un menu : CA nul mais matière consommée, on la garde.
    expect(sauce).toMatchObject({ id_product: 'lib:SAUCE FICTIVE', total_ttc: 0, quantity: 1 });
  });

  it('ne recopie jamais les données personnelles (client, vendeur)', () => {
    const json = JSON.stringify(tickets);
    expect(json).not.toContain('Client Fictif');
    expect(json).not.toContain('USER DEFAULT');
  });

  it('se branche sur le moteur existant sans adaptation', () => {
    const normalises = tickets.map(normaliserTicket);
    const recap = recapImport(normalises, new Set(), []);
    expect(recap.nb_tickets).toBe(2);
    expect(recap.nb_lignes).toBe(4);
    expect(recap.total_ttc).toBeCloseTo(21.7, 2);
    expect(recap.jours[0].parCanal).toEqual({
      'SUR PLACE': { nb_tickets: 1, total_ttc: expect.closeTo(9.2, 2) },
      EMPORTER: { nb_tickets: 1, total_ttc: 12.5 },
    });
    expect(recap.non_mappes.map((a) => a.abill_product_id)).toContain('lib:SAUCE FICTIVE');
  });

  it('refuse un fichier qui n’est pas un export de tickets', () => {
    const r = ticketsDepuisExportTickets([['Rubrique', 'Produit', 'Quantité'], ['PLATS', 'X', 1]]);
    expect(r.tickets).toEqual([]);
    expect(r.erreurs[0]).toMatch(/en-tête/i);
  });
});
