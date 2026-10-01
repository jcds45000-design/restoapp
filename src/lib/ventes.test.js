import { describe, it, expect } from 'vitest';

import { normaliserTicket, dedupTickets, resoudreMapping, articlesNonMappes, ventesParJour, quantitesVendues, recapImport, preparerEnregistrement, valeurMapping, champsMapping } from './ventes.js';

// Ticket au format de l'API Fulle (openapi v379, schéma NoteTicket).
// Valeurs FICTIVES : aucun chiffre réel du restaurant ici (dépôt public).
const ticketApi = {
  id: 98001,
  r_ticket: 'T-98001',
  n_ticket: '42',
  type_document: 'ticket',
  date: '2026-08-29 12:31:05',
  n_lines: 2,
  total_ttc: '21.90',
  total_ht: '19.91',
  reverse: 0,
  sale_method: { id: 3, name: 'Uber Eats' },
  payments: [{ amount: '21.90', quantity: 1, payment_mean: { name: 'CB' } }],
  taxes: [{ rate: 10, amount: '1.99' }],
  details: [
    {
      id: 1, id_product: 501, name: 'MENU BONELESS X10', quantity: 1,
      unit_ttc: '15.90', total_ttc: '15.90', unit_ht: '14.45', total_ht: '14.45',
      discount: 0, free: 0, excluded: 0,
      details: [
        { id_product: 601, name: 'Frites', quantity: 1, total_ttc: '0' },
        { id_product: 602, name: 'Soda cola', quantity: 1, total_ttc: '0' },
      ],
    },
    {
      id: 2, id_product: 502, name: 'CORNDOG SAUCISSE', quantity: 2,
      unit_ttc: '3.00', total_ttc: '6.00', unit_ht: '2.73', total_ht: '5.46',
      discount: 0, free: 0, excluded: 0,
    },
  ],
};

describe('normaliserTicket', () => {
  it('aplatit un NoteTicket API en ticket + lignes', () => {
    const { ticket, lignes, erreur } = normaliserTicket(ticketApi);
    expect(erreur).toBeUndefined();
    expect(ticket.abill_id).toBe('98001');
    expect(ticket.date_service).toBe('2026-08-29');
    expect(ticket.canal).toBe('Uber Eats');
    expect(ticket.total_ttc).toBe(21.9);
    expect(ticket.reverse).toBe(false);
    expect(ticket.paiements).toEqual([{ mode: 'CB', montant: 21.9, quantite: 1 }]);
    expect(lignes).toHaveLength(2);
    expect(lignes[0].abill_product_id).toBe('501');
    expect(lignes[0].options).toHaveLength(2);
    expect(lignes[0].options[1].libelle).toBe('Soda cola');
    expect(lignes[1].quantity).toBe(2);
    expect(lignes[1].total_ttc).toBe(6);
  });

  it('accepte les nombres en chaîne avec virgule', () => {
    const { ticket } = normaliserTicket({ ...ticketApi, total_ttc: '21,90' });
    expect(ticket.total_ttc).toBe(21.9);
  });

  it('marque les extournes', () => {
    const { ticket } = normaliserTicket({ ...ticketApi, reverse: 1 });
    expect(ticket.reverse).toBe(true);
  });

  it('rejette un ticket sans identifiant ou sans date', () => {
    expect(normaliserTicket({ date: '2026-08-29' }).erreur).toBeTruthy();
    expect(normaliserTicket({ id: 1 }).erreur).toBeTruthy();
  });
});

describe('dedupTickets', () => {
  it('écarte les tickets déjà en base et les doublons du lot', () => {
    const a = normaliserTicket(ticketApi);
    const b = normaliserTicket({ ...ticketApi, id: 98002 });
    const { nouveaux, doublons } = dedupTickets([a, a, b], new Set(['98002']));
    expect(nouveaux).toHaveLength(1);
    expect(nouveaux[0].ticket.abill_id).toBe('98001');
    expect(doublons).toBe(2);
  });
});

const mappings = [
  { abill_product_id: '501', cible_type: 'menu', menu_item_id: 'mi-menu10', recipe_id: null },
  { abill_product_id: '502', cible_type: 'recette', menu_item_id: 'mi-corndog', recipe_id: 'r-corndog' },
  { abill_product_id: '999', cible_type: 'ignorer' },
  { abill_product_id: '777', cible_type: 'a_mapper' },
];

describe('resoudreMapping / articlesNonMappes', () => {
  it('résout un article mappé, ignore les a_mapper', () => {
    expect(resoudreMapping('502', mappings).menu_item_id).toBe('mi-corndog');
    expect(resoudreMapping(502, mappings)).not.toBeNull();
    expect(resoudreMapping('777', mappings)).toBeNull();
    expect(resoudreMapping('000', mappings)).toBeNull();
  });

  it('liste les articles inconnus, agrégés et triés par occurrences', () => {
    const lignes = [
      { abill_product_id: '777', libelle: 'NOUVEAU PLAT', quantity: 1 },
      { abill_product_id: '777', libelle: 'NOUVEAU PLAT', quantity: 2 },
      { abill_product_id: '999', libelle: 'POURBOIRE', quantity: 1 },
      { abill_product_id: '502', libelle: 'CORNDOG SAUCISSE', quantity: 1 },
      { abill_product_id: '888', libelle: 'AUTRE', quantity: 1 },
    ];
    const nm = articlesNonMappes(lignes, mappings);
    expect(nm.map((x) => x.abill_product_id)).toEqual(['777', '888']);
    expect(nm[0].quantite).toBe(3);
  });
});

describe('ventesParJour', () => {
  it('agrège par jour et par canal, en excluant les extournes', () => {
    const t1 = { date_service: '2026-08-29', canal: 'Sur place', total_ttc: 10, total_ht: 9.09, reverse: false };
    const t2 = { date_service: '2026-08-29', canal: 'Uber Eats', total_ttc: 20, total_ht: 18.18, reverse: false };
    const t3 = { date_service: '2026-08-30', canal: 'Sur place', total_ttc: 5, total_ht: 4.55, reverse: false };
    const extourne = { date_service: '2026-08-29', canal: 'Sur place', total_ttc: -10, reverse: true };
    const jours = ventesParJour([t1, t2, t3, extourne]);
    expect(jours).toHaveLength(2);
    expect(jours[0].date).toBe('2026-08-29');
    expect(jours[0].nb_tickets).toBe(2);
    expect(jours[0].total_ttc).toBe(30);
    expect(jours[0].parCanal['Uber Eats'].total_ttc).toBe(20);
  });
});

describe('quantitesVendues', () => {
  it('agrège les quantités par article avec cible résolue', () => {
    const lignes = [
      { abill_product_id: '502', libelle: 'CORNDOG SAUCISSE', quantity: 2, total_ttc: 6, exclu_ca: false },
      { abill_product_id: '502', libelle: 'CORNDOG SAUCISSE', quantity: 1, total_ttc: 3, exclu_ca: false },
      { abill_product_id: '999', libelle: 'POURBOIRE', quantity: 1, total_ttc: 2, exclu_ca: false },
      { abill_product_id: '501', libelle: 'MENU BONELESS X10', quantity: 1, total_ttc: 15.9, exclu_ca: false },
      { abill_product_id: '502', libelle: 'CORNDOG SAUCISSE', quantity: 5, total_ttc: 15, exclu_ca: true },
    ];
    const q = quantitesVendues(lignes, mappings);
    expect(q[0]).toMatchObject({ abill_product_id: '502', quantite: 3, total_ttc: 9, menu_item_id: 'mi-corndog' });
    expect(q.find((x) => x.abill_product_id === '999')).toBeUndefined();
    expect(q.find((x) => x.abill_product_id === '501').cible_type).toBe('menu');
  });

  it('exclut les lignes des tickets extournés', () => {
    const lignes = [
      { ticket_id: 'tk1', abill_product_id: '502', libelle: 'CORNDOG', quantity: 1, total_ttc: 3, exclu_ca: false },
      { ticket_id: 'tk2', abill_product_id: '502', libelle: 'CORNDOG', quantity: 1, total_ttc: 3, exclu_ca: false },
    ];
    const ticketsById = new Map([['tk1', { reverse: false }], ['tk2', { reverse: true }]]);
    const q = quantitesVendues(lignes, mappings, ticketsById);
    expect(q[0].quantite).toBe(1);
  });
});

describe('recapImport', () => {
  it('produit le récapitulatif complet avant enregistrement', () => {
    const lot = [
      normaliserTicket(ticketApi),
      normaliserTicket({ ...ticketApi, id: 98002, date: '2026-08-30 19:02:00', total_ttc: '9.90', details: [
        { id: 9, id_product: 777, name: 'NOUVEAU PLAT', quantity: 1, total_ttc: '9.90' },
      ] }),
      normaliserTicket({ id: 98003 }),          // sans date → erreur
      normaliserTicket(ticketApi),              // doublon du lot
    ];
    const r = recapImport(lot, new Set(), mappings);
    expect(r.nb_tickets).toBe(2);
    expect(r.nb_lignes).toBe(3);
    expect(r.nb_doublons).toBe(1);
    expect(r.nb_erreurs).toBe(1);
    expect(r.periode_debut).toBe('2026-08-29');
    expect(r.periode_fin).toBe('2026-08-30');
    expect(r.total_ttc).toBeCloseTo(31.8, 5);
    expect(r.non_mappes).toHaveLength(1);
    expect(r.non_mappes[0].abill_product_id).toBe('777');
  });
});

describe('preparerEnregistrement', () => {
  const lot = [
    normaliserTicket(ticketApi),
    normaliserTicket({ ...ticketApi, id: 98002, details: [
      { id: 9, id_product: 777, name: 'NOUVEAU PLAT', quantity: 1, total_ttc: '9.90' },
      { id: 10, id_product: 888, name: 'AUTRE NOUVEAU', quantity: 1, total_ttc: '2.00' },
    ] }),
  ];
  let n = 0;
  const genId = () => `id-${++n}`;
  const p = preparerEnregistrement(lot, { importId: 'imp-1', mappings, genId });

  it('prépare les tickets aux colonnes de sales_tickets, rattachés à l’import', () => {
    expect(p.tickets).toHaveLength(2);
    expect(p.tickets[0]).toMatchObject({ id: 'id-1', abill_id: '98001', date_service: '2026-08-29',
      canal: 'Uber Eats', total_ttc: 21.9, import_id: 'imp-1', n_lignes: 2, reverse: false });
    expect(p.tickets[0].paiements).toEqual([{ mode: 'CB', montant: 21.9, quantite: 1 }]);
    expect(p.tickets[0].brut).toBe(ticketApi);
  });

  it('convertit l’heure locale de caisse en instant absolu', () => {
    expect(p.tickets[0].date_saisie).toBe(new Date('2026-08-29T12:31:05').toISOString());
  });

  it('prépare les lignes aux colonnes de sales_lines, rattachées à leur ticket', () => {
    expect(p.lignes).toHaveLength(4);
    expect(p.lignes.filter((l) => l.ticket_id === 'id-1')).toHaveLength(2);
    expect(p.lignes[0]).toMatchObject({ abill_product_id: '501', libelle: 'MENU BONELESS X10', quantity: 1,
      total_ttc: 15.9, remise_pct: 0, offert: false, exclu_ca: false });
    expect(Object.keys(p.lignes[0]).sort()).toEqual(['abill_line_id', 'abill_product_id', 'exclu_ca', 'libelle',
      'offert', 'options', 'quantity', 'remise_pct', 'ticket_id', 'total_ht', 'total_ttc', 'tva', 'unit_ht', 'unit_ttc']);
  });

  it('ne crée à mapper que les articles absents du mapping', () => {
    // 777 existe déjà (a_mapper) : pas de doublon ; 888 est nouveau.
    expect(p.nouveauxArticles).toEqual([{ abill_product_id: '888', libelle_abill: 'AUTRE NOUVEAU' }]);
  });
});

describe('valeurMapping / champsMapping', () => {
  const menuItems = [
    { id: 'mi1', name: 'Boneless x10', category: 'Poulet frit', recipe_id: 'r1' },
    { id: 'mi2', name: 'Menu corndog', category: 'Menus', recipe_id: null },
    { id: 'mi3', name: 'Coca', category: 'Boissons', recipe_id: null },
  ];
  const recettes = [{ id: 'rc1', nom: 'Portion frites', rendement_unite: 'portion' }];

  it('valeurMapping encode la cible courante', () => {
    expect(valeurMapping({ cible_type: 'a_mapper' })).toBe('');
    expect(valeurMapping({ cible_type: 'ignorer' })).toBe('__ignorer');
    expect(valeurMapping({ cible_type: 'recette', menu_item_id: 'mi1', recipe_id: 'r1' })).toBe('mi:mi1');
    expect(valeurMapping({ cible_type: 'recette', menu_item_id: null, recipe_id: 'rc1' })).toBe('rc:rc1');
  });

  it('champsMapping : article de carte (recopie la recette)', () => {
    expect(champsMapping('mi:mi1', menuItems, recettes))
      .toEqual({ cible_type: 'recette', menu_item_id: 'mi1', recipe_id: 'r1' });
    expect(champsMapping('mi:mi2', menuItems, recettes))
      .toEqual({ cible_type: 'menu', menu_item_id: 'mi2', recipe_id: null });
    expect(champsMapping('mi:mi3', menuItems, recettes))
      .toEqual({ cible_type: 'produit', menu_item_id: 'mi3', recipe_id: null });
  });

  it('champsMapping : recette portion, ignorer, remise à mapper', () => {
    expect(champsMapping('rc:rc1', menuItems, recettes))
      .toEqual({ cible_type: 'recette', menu_item_id: null, recipe_id: 'rc1' });
    expect(champsMapping('__ignorer', menuItems, recettes))
      .toEqual({ cible_type: 'ignorer', menu_item_id: null, recipe_id: null });
    expect(champsMapping('', menuItems, recettes))
      .toEqual({ cible_type: 'a_mapper', menu_item_id: null, recipe_id: null });
  });

  it('champsMapping renvoie null pour une cible inconnue', () => {
    expect(champsMapping('mi:absent', menuItems, recettes)).toBeNull();
    expect(champsMapping('rc:absent', menuItems, recettes)).toBeNull();
  });
});
