// src/lib/recap.test.js
import { describe, it, expect } from 'vitest';
import {
  cleSemaine, moisDeRattachement, heuresSupplementaires, recapMensuel, semainesDuMois,
  lignesExport, versCSV, fenetreChargement, salariesDuRecap,
} from './recap.js';

describe('cleSemaine', () => {
  it('donne la semaine ISO, lundi comme premier jour', () => {
    expect(cleSemaine('2026-09-21')).toBe('2026-W39'); // lundi
    expect(cleSemaine('2026-09-27')).toBe('2026-W39'); // dimanche, même semaine
    expect(cleSemaine('2026-09-28')).toBe('2026-W40'); // lundi suivant
  });
  it('garde ENTIÈRE une semaine à cheval sur deux mois', () => {
    // 28 septembre au 4 octobre : une seule semaine, pas deux moitiés.
    expect(cleSemaine('2026-09-29')).toBe(cleSemaine('2026-10-04'));
    // Et la semaine s'arrête bien au dimanche : le lundi 5 octobre ouvre la suivante.
    expect(cleSemaine('2026-10-05')).not.toBe(cleSemaine('2026-10-04'));
  });
});

describe('moisDeRattachement', () => {
  it('rattache une semaine à cheval au mois où elle se TERMINE par défaut', () => {
    // Semaine du lundi 28/09 au dimanche 04/10 : elle appartient à octobre.
    expect(moisDeRattachement('2026-09-29', 'mois_fin')).toBe('2026-10');
    expect(moisDeRattachement('2026-10-01', 'mois_fin')).toBe('2026-10');
  });
  it('peut au contraire la rattacher au mois où elle COMMENCE', () => {
    expect(moisDeRattachement('2026-09-29', 'mois_debut')).toBe('2026-09');
    expect(moisDeRattachement('2026-10-01', 'mois_debut')).toBe('2026-09');
  });
  it('tous les jours d’une même semaine tombent dans le même mois', () => {
    const semaine = ['2026-09-28', '2026-09-30', '2026-10-02', '2026-10-04'];
    const mois = semaine.map((j) => moisDeRattachement(j, 'mois_fin'));
    expect(new Set(mois).size).toBe(1);
  });
});

describe('heuresSupplementaires', () => {
  it('temps plein : ce qui dépasse 35 h est supplémentaire, rien de complémentaire', () => {
    expect(heuresSupplementaires(39, 35)).toEqual({ supplementaires: 4, complementaires: 0 });
  });
  it('temps partiel : ce qui dépasse le contrat sous 35 h est complémentaire', () => {
    expect(heuresSupplementaires(30, 24)).toEqual({ supplementaires: 0, complementaires: 6 });
  });
  it('temps partiel qui dépasse 35 h : les deux natures coexistent et ne se mélangent pas', () => {
    expect(heuresSupplementaires(38, 24)).toEqual({ supplementaires: 3, complementaires: 11 });
  });
  it('en dessous du contrat : ni supplémentaires ni complémentaires, jamais de négatif', () => {
    expect(heuresSupplementaires(18, 24)).toEqual({ supplementaires: 0, complementaires: 0 });
  });
});

describe('heuresSupplementaires : seuil fixe de 35 h', () => {
  it('un contrat de 39 h : les heures 36 à 39 sont bien comptées', () => {
    expect(heuresSupplementaires(39, 39)).toEqual({ supplementaires: 4, complementaires: 0 });
    expect(heuresSupplementaires(41, 39)).toEqual({ supplementaires: 6, complementaires: 0 });
  });
  it('temps partiel : complémentaires jusqu’à 35 h, supplémentaires au-delà', () => {
    expect(heuresSupplementaires(38, 24)).toEqual({ supplementaires: 3, complementaires: 11 });
    expect(heuresSupplementaires(35, 24)).toEqual({ supplementaires: 0, complementaires: 11 });
  });
  it('un contrat à 0 h est accepté : tout est complémentaire jusqu’à 35 h', () => {
    expect(heuresSupplementaires(10, 0)).toEqual({ supplementaires: 0, complementaires: 10 });
  });
});

describe('heuresSupplementaires : entrées invalides', () => {
  it('refuse un contrat absent ou invalide', () => {
    for (const mauvais of [null, undefined, 'abc', -1]) {
      expect(() => heuresSupplementaires(30, mauvais)).toThrow('heures contractuelles invalides : ' + mauvais);
    }
  });
  it('refuse des heures faites invalides', () => {
    for (const mauvais of ['abc', -1, null, undefined]) {
      expect(() => heuresSupplementaires(mauvais, 35)).toThrow('heures faites invalides : ' + mauvais);
    }
  });
});

describe('semaines : entrées invalides', () => {
  it('cleSemaine refuse un jour invalide', () => {
    expect(() => cleSemaine('abc')).toThrow('cleSemaine : jour invalide');
    expect(() => cleSemaine(undefined)).toThrow('cleSemaine : jour invalide');
  });
  it('moisDeRattachement refuse une règle inconnue mais garde son défaut si omise', () => {
    expect(() => moisDeRattachement('2026-09-29', 'mois_fn')).toThrow('regle de rattachement inconnue : mois_fn');
    expect(() => moisDeRattachement('2026-09-29', null)).toThrow('regle de rattachement inconnue : null');
    expect(moisDeRattachement('2026-09-29')).toBe('2026-10');
  });
});

describe('semaines : limites d’année', () => {
  it('respecte la numérotation ISO autour du 1er janvier', () => {
    expect(cleSemaine('2026-12-31')).toBe('2026-W53');
    expect(cleSemaine('2027-01-04')).toBe('2027-W01');
    expect(cleSemaine('2025-12-29')).toBe('2026-W01');
    expect(moisDeRattachement('2026-12-31', 'mois_fin')).toBe('2027-01');
  });
});

// Heures de pointe de Kimiko (décision du 23/10/2026).
const CRENEAUX = { midiDebut: '12:00', midiFin: '14:00', soirDebut: '19:00', soirFin: '21:00' };
// Fixtures ANONYMISÉES : dépôt public, jamais de vrai nom ni de vrai taux.
const SALARIE = { id: 'emp-a', name: 'Salarié A', heures_hebdo: 24, contrat: 'CDI', taux_h: 12 };

// Présences construites en heures locales de Paris (UTC+2 en septembre).
const pres = (jour, hDeb, hFin, finOrigine = 'borne') => ({
  employee_id: 'emp-a', jour,
  debut: `${jour}T${String(Number(hDeb.slice(0, 2)) - 2).padStart(2, '0')}${hDeb.slice(2)}:00.000Z`,
  fin: hFin === null ? null
    : `${jour}T${String(Number(hFin.slice(0, 2)) - 2).padStart(2, '0')}${hFin.slice(2)}:00.000Z`,
  debut_origine: 'borne', fin_origine: hFin === null ? null : finOrigine,
  statut: hFin === null ? 'anomalie' : 'complete',
});

describe('recapMensuel', () => {
  it('assemble heures, qualité, repas et écart au contrat', () => {
    const r = recapMensuel({
      salarie: SALARIE,
      presences: [
        pres('2026-09-22', '11:30', '14:30'),  // 3 h, repas midi
        pres('2026-09-22', '18:30', '22:00'),  // 3,5 h, repas soir
        pres('2026-09-23', '11:30', '14:30'),  // 3 h, repas midi
      ],
      mois: '2026-09',
      creneaux: CRENEAUX,
    });
    expect(r.heuresTotales).toBe(9.5);
    expect(r.qualite.tauxFiabilite).toBe(100);
    expect(r.repas.total).toBe(3);
    expect(r.repas.midi).toBe(2);
    expect(r.repas.soir).toBe(1);
    expect(r.repas.horsPointe).toBe(0);
  });

  it('compte le repas hors pointe (5 h sans couvrir de pointe) dans le total', () => {
    const r = recapMensuel({
      salarie: SALARIE,
      presences: [
        pres('2026-09-22', '14:00', '19:00'),  // 5 h, aucune pointe : 1 repas hors pointe
        pres('2026-09-23', '11:30', '14:30'),  // repas midi
        pres('2026-09-24', '21:55', '21:58'),  // 3 minutes : rien
      ],
      mois: '2026-09',
      creneaux: CRENEAUX,
    });
    expect(r.repas).toEqual({ midi: 1, soir: 0, horsPointe: 1, total: 2 });
  });

  it('découpe en semaines et ne mélange jamais deux semaines', () => {
    const r = recapMensuel({
      salarie: SALARIE,
      presences: [
        pres('2026-09-15', '09:00', '19:00'), // semaine 38
        pres('2026-09-22', '09:00', '19:00'), // semaine 39
      ],
      mois: '2026-09',
      creneaux: CRENEAUX,
    });
    expect(r.semaines).toHaveLength(2);
    expect(r.semaines.map((s) => s.cle)).toEqual(['2026-W38', '2026-W39']);
  });

  it('remonte les anomalies sans jamais les compter en heures', () => {
    const r = recapMensuel({
      salarie: SALARIE,
      presences: [
        pres('2026-09-22', '11:30', '14:30'),
        pres('2026-09-23', '11:30', null), // oubli de départ
      ],
      mois: '2026-09',
      creneaux: CRENEAUX,
    });
    expect(r.heuresTotales).toBe(3);
    expect(r.qualite.anomalies).toBe(1);
    expect(r.anomalies).toHaveLength(1);
    expect(r.anomalies[0].jour).toBe('2026-09-23');
  });

  it('garde ENTIÈRE une semaine à cheval, sans la tronquer au changement de mois', () => {
    // Semaine du 28/09 au 04/10. Avec un rattachement au mois de fin, elle appartient
    // à OCTOBRE en entier, y compris ses journées de septembre.
    const presences = [
      pres('2026-09-29', '09:00', '19:00'), // 10 h, en septembre sur le calendrier
      pres('2026-10-01', '09:00', '19:00'), // 10 h, en octobre
    ];
    const septembre = recapMensuel({
      salarie: SALARIE, presences, mois: '2026-09', creneaux: CRENEAUX, regleSemaine: 'mois_fin',
    });
    const octobre = recapMensuel({
      salarie: SALARIE, presences, mois: '2026-10', creneaux: CRENEAUX, regleSemaine: 'mois_fin',
    });
    // La semaine n'est comptée qu'une fois, et elle est entière.
    expect(septembre.heuresTotales).toBe(0);
    expect(octobre.heuresTotales).toBe(20);
    expect(octobre.semaines).toHaveLength(1);
  });

  it('le rattachement au mois de début donne le résultat inverse, sans perdre d’heures', () => {
    const presences = [
      pres('2026-09-29', '09:00', '19:00'),
      pres('2026-10-01', '09:00', '19:00'),
    ];
    const septembre = recapMensuel({
      salarie: SALARIE, presences, mois: '2026-09', creneaux: CRENEAUX, regleSemaine: 'mois_debut',
    });
    expect(septembre.heuresTotales).toBe(20);
  });

  it('garde-fou : 400 jours consécutifs, aucune minute perdue ni doublée, pour les deux règles', () => {
    // Traverse le passage d'année 2026/2027 (semaine W53 incluse).
    const presences = [];
    const debut = new Date('2026-06-01T12:00:00.000Z');
    for (let i = 0; i < 400; i += 1) {
      const d = new Date(debut);
      d.setUTCDate(d.getUTCDate() + i);
      presences.push(pres(d.toISOString().slice(0, 10), '09:00', '12:20')); // 200 min
    }
    const mois = [];
    for (let a = 2026, m = 5; a < 2027 || m <= 8; m += 1) {
      if (m > 12) { m = 1; a += 1; }
      if (a === 2027 && m > 8) break;
      mois.push(`${a}-${String(m).padStart(2, '0')}`);
    }
    for (const regleSemaine of ['mois_fin', 'mois_debut']) {
      const total = mois
        .map((m) => recapMensuel({
          salarie: SALARIE, presences, mois: m, creneaux: CRENEAUX, regleSemaine,
        }).qualite.minutesTotales)
        .reduce((x, y) => x + y, 0);
      expect(total).toBe(400 * 200);
    }
  });

  it('valide le contrat dès l’entrée, même sans présence', () => {
    expect(() => recapMensuel({
      salarie: { id: 'emp-a', name: 'Salarié A' }, presences: [], mois: '2026-10', creneaux: CRENEAUX,
    })).toThrow('contrat manquant ou invalide pour Salarié A : undefined');
    expect(() => recapMensuel({
      salarie: { ...SALARIE, heures_hebdo: -1 }, presences: [], mois: '2026-10', creneaux: CRENEAUX,
    })).toThrow(/contrat manquant ou invalide/);
    expect(() => recapMensuel({
      salarie: { ...SALARIE, heures_hebdo: 0 }, presences: [], mois: '2026-10', creneaux: CRENEAUX,
    })).not.toThrow();
  });

  it('un mois sans aucune présence ne plante pas et rend des zéros', () => {
    const r = recapMensuel({ salarie: SALARIE, presences: [], mois: '2026-09', creneaux: CRENEAUX });
    expect(r.heuresTotales).toBe(0);
    expect(r.repas.total).toBe(0);
    expect(r.semaines).toEqual([]);
  });
});

describe('semainesDuMois', () => {
  it('octobre 2026 en mois_fin : W40 (28/09 au 04/10) à W43 (19/10 au 25/10)', () => {
    expect(semainesDuMois('2026-10', 'mois_fin'))
      .toEqual(['2026-W40', '2026-W41', '2026-W42', '2026-W43']);
  });
  it('octobre 2026 en mois_debut : W41 (05/10) à W44 (26/10), W40 part en septembre', () => {
    expect(semainesDuMois('2026-10', 'mois_debut'))
      .toEqual(['2026-W41', '2026-W42', '2026-W43', '2026-W44']);
  });
  it('novembre 2026 en mois_fin commence à W44 (26/10 au 01/11, finit en novembre)', () => {
    expect(semainesDuMois('2026-11', 'mois_fin')[0]).toBe('2026-W44');
  });
});

describe('recapMensuel : contrat du mois', () => {
  it('contrat sur le calendrier : une seule semaine pointée donne un écart négatif', () => {
    const r = recapMensuel({
      salarie: SALARIE, presences: [pres('2026-10-14', '09:00', '19:00')],
      mois: '2026-10', creneaux: CRENEAUX,
    });
    expect(r.heuresContractuellesMois).toBe(24 * 4);
    expect(r.ecartContratHeures).toBe(10 - 96);
  });
  it('mois sans présence : contrat plein, zéro heure', () => {
    const r = recapMensuel({ salarie: SALARIE, presences: [], mois: '2026-10', creneaux: CRENEAUX });
    expect(r.heuresContractuellesMois).toBe(96);
    expect(r.heuresTotales).toBe(0);
    expect(r.ecartContratHeures).toBe(-96);
  });
  it('date_entree au 20/10 : seule W43 compte (W44 appartient à novembre)', () => {
    const r = recapMensuel({
      salarie: { ...SALARIE, date_entree: '2026-10-20' }, presences: [],
      mois: '2026-10', creneaux: CRENEAUX,
    });
    expect(r.heuresContractuellesMois).toBe(24); // W43 seule
  });
  it('date_fin au 07/10 : les semaines après W41 sont exclues', () => {
    const r = recapMensuel({
      salarie: { ...SALARIE, date_fin: '2026-10-07' }, presences: [],
      mois: '2026-10', creneaux: CRENEAUX,
    });
    expect(r.heuresContractuellesMois).toBe(24 * 2); // W40 et W41
  });
});

// Jours d'absence tels que le Planning les enregistre (table schedule).
const abs = (date, shift, autre = {}) => ({ employee_name: 'Salarié A', date, shift, ...autre });

describe('recapMensuel : base mensualisée et absences du planning (décision JC du 24/10/2026)', () => {
  it('donne la base mensualisée payée : horaire hebdo × 52 / 12', () => {
    const r = recapMensuel({ salarie: SALARIE, presences: [], mois: '2026-10', creneaux: CRENEAUX });
    expect(r.baseMensualisee).toBe(104);
    const r35 = recapMensuel({ salarie: { ...SALARIE, heures_hebdo: 35 }, presences: [], mois: '2026-10', creneaux: CRENEAUX });
    expect(r35.baseMensualisee).toBe(151.67);
  });
  it('l’écart reste calculé sur les semaines du mois, pas sur la base mensualisée', () => {
    const r = recapMensuel({ salarie: SALARIE, presences: [], mois: '2026-10', creneaux: CRENEAUX });
    expect(r.ecartContratHeures).toBe(-96); // 4 semaines × 24 h, et non -104
  });
  it('une semaine de congés (5 jours) est retirée du contrat', () => {
    const r = recapMensuel({
      salarie: SALARIE, presences: [], mois: '2026-10', creneaux: CRENEAUX,
      absences: ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'].map((d) => abs(d, 'conges')),
    });
    expect(r.absences).toEqual({ conges: 5, maladie: 0, injustifiees: 0 });
    expect(r.heuresAbsencesJustifiees).toBe(24); // 5 jours × 24 h / 5
    expect(r.ecartContratHeures).toBe(-(96 - 24));
  });
  it('maladie retirée du contrat, absence injustifiée comptée mais NON retirée', () => {
    const r = recapMensuel({
      salarie: SALARIE, presences: [], mois: '2026-10', creneaux: CRENEAUX,
      absences: [abs('2026-10-05', 'maladie'), abs('2026-10-06', 'maladie'), abs('2026-10-07', 'absence')],
    });
    expect(r.absences).toEqual({ conges: 0, maladie: 2, injustifiees: 1 });
    expect(r.heuresAbsencesJustifiees).toBe(9.6);
    expect(r.ecartContratHeures).toBe(-86.4);
  });
  it('une semaine entière marquée (7 jours) ne retire jamais plus que le contrat de la semaine', () => {
    const r = recapMensuel({
      salarie: SALARIE, presences: [], mois: '2026-10', creneaux: CRENEAUX,
      absences: ['12', '13', '14', '15', '16', '17', '18'].map((j) => abs(`2026-10-${j}`, 'conges')),
    });
    expect(r.absences.conges).toBe(7);
    expect(r.heuresAbsencesJustifiees).toBe(24);
  });
  it('ignore les absences d’une semaine rattachée à un autre mois, et celles d’un autre salarié', () => {
    const r = recapMensuel({
      salarie: SALARIE, presences: [], mois: '2026-10', creneaux: CRENEAUX,
      absences: [
        abs('2026-10-27', 'conges'), // semaine du 26/10, rattachée à novembre
        abs('2026-10-13', 'conges', { employee_name: 'Salarié B' }),
        abs('2026-10-14', 'conges', { employee_id: 'emp-b', employee_name: 'Salarié A' }),
      ],
    });
    expect(r.absences).toEqual({ conges: 0, maladie: 0, injustifiees: 0 });
    expect(r.heuresAbsencesJustifiees).toBe(0);
  });
  it('reconnaît le salarié par son identifiant quand le planning le porte', () => {
    const r = recapMensuel({
      salarie: SALARIE, presences: [], mois: '2026-10', creneaux: CRENEAUX,
      absences: [abs('2026-10-13', 'maladie', { employee_id: 'emp-a', employee_name: 'Ancien nom' })],
    });
    expect(r.absences.maladie).toBe(1);
  });
  it('un même jour saisi deux fois compte une fois ; l’ancienne valeur « conge » vaut congés', () => {
    const r = recapMensuel({
      salarie: SALARIE, presences: [], mois: '2026-10', creneaux: CRENEAUX,
      absences: [abs('2026-10-13', 'conge'), abs('2026-10-13', 'conge'), abs('2026-10-14', 'midi')],
    });
    expect(r.absences).toEqual({ conges: 1, maladie: 0, injustifiees: 0 });
  });
  it('ignore les absences des semaines hors contrat (avant l’entrée)', () => {
    const r = recapMensuel({
      salarie: { ...SALARIE, date_entree: '2026-10-20' }, presences: [], mois: '2026-10', creneaux: CRENEAUX,
      absences: [abs('2026-10-13', 'conges')],
    });
    expect(r.absences.conges).toBe(0);
    expect(r.ecartContratHeures).toBe(-24);
  });
});

describe('export comptable', () => {
  const recap = {
    salarie: { name: 'Salarié A', heures_hebdo: 24 },
    mois: '2026-09',
    heuresTotales: 9.5, heuresPointees: 9.5, heuresDeclarees: 0,
    qualite: { anomalies: 0, tauxFiabilite: 100 },
    repas: { midi: 2, soir: 1, horsPointe: 1, total: 4 },
    absences: { conges: 3, maladie: 1, injustifiees: 2 },
    semaines: [{ cle: '2026-W39', heures: 9.5, supplementaires: 0, complementaires: 0 }],
  };

  it('produit une ligne par salarié avec heures, natures et repas', () => {
    const [ligne] = lignesExport([recap]);
    expect(ligne.salarie).toBe('Salarié A');
    expect(ligne.heuresTotales).toBe(9.5);
    expect(ligne.heuresComplementaires).toBe(0);
    expect(ligne.repasHorsPointe).toBe(1);
    expect(ligne.repasTotal).toBe(4);
    expect(ligne.joursConges).toBe(3);
    expect(ligne.joursMaladie).toBe(1);
    expect(ligne.joursAbsenceInjustifiee).toBe(2);
    expect(ligne.anomalies).toBe(0);
  });

  it('somme les heures supplémentaires SEMAINE PAR SEMAINE, pas sur le total du mois', () => {
    const surDeuxSemaines = {
      ...recap,
      semaines: [
        { cle: '2026-W39', heures: 30, supplementaires: 0, complementaires: 6 },
        { cle: '2026-W40', heures: 38, supplementaires: 3, complementaires: 11 },
      ],
    };
    const [ligne] = lignesExport([surDeuxSemaines]);
    expect(ligne.heuresSupplementaires).toBe(3);
    expect(ligne.heuresComplementaires).toBe(17);
  });

  it('le CSV utilise le point-virgule et la virgule décimale, lisibles par Excel FR', () => {
    const csv = versCSV(lignesExport([recap]));
    expect(csv.split('\n')[0]).toContain('Salarié;Heures totales');
    expect(csv.split('\n')[1]).toContain('9,5');
    expect(csv.split('\n')[1]).not.toContain('9.5');
    expect(csv.split('\n')[1].split(';')).toHaveLength(16);
    expect(csv.split('\n')[0]).toContain('Congés (jours);Maladie (jours);Absences injustifiées (jours)');
    expect(csv.split('\n')[0]).toContain('Repas soir;Repas hors pointe (5 h);Repas total');
  });

  describe('échappement CSV et injection de formule', () => {
    const csvPour = (name) => versCSV(lignesExport([{ ...recap, salarie: { ...recap.salarie, name } }]));
    const premiereCellule = (csv) => csv.split('\n').slice(1).join('\n').split(';')[0];

    // Découpe en enregistrements en respectant les guillemets.
    const enregistrements = (csv) => {
      const res = [];
      let cur = '';
      let dansGuillemets = false;
      for (const c of csv) {
        if (c === '"') dansGuillemets = !dansGuillemets;
        if (c === '\n' && !dansGuillemets) { res.push(cur); cur = ''; } else cur += c;
      }
      res.push(cur);
      return res;
    };

    it('met entre guillemets un nom contenant un point-virgule', () => {
      const csv = csvPour('Dupont;Jean');
      expect(csv.split('\n')[1].startsWith('"Dupont;Jean";')).toBe(true);
    });

    it('double les guillemets internes', () => {
      expect(premiereCellule(csvPour('Jean "JC" D'))).toBe('"Jean ""JC"" D"');
    });

    it('neutralise les débuts de formule avec une apostrophe', () => {
      expect(premiereCellule(csvPour('=1+1'))).toBe("'=1+1");
      expect(premiereCellule(csvPour('@SUM(A1)'))).toBe("'@SUM(A1)");
      expect(premiereCellule(csvPour('+1'))).toBe("'+1");
      expect(premiereCellule(csvPour('-1'))).toBe("'-1");
      expect(premiereCellule(csvPour('\tX'))).toBe("'\tX");
    });

    it('garde un saut de ligne dans une seule cellule entre guillemets', () => {
      const csv = csvPour('Jean\nDupont');
      expect(enregistrements(csv)).toHaveLength(2);
      expect(csv).toContain('"Jean\nDupont"');
    });

    it('ne touche pas aux nombres', () => {
      expect(csvPour('Salarié A').split('\n')[1]).toContain('9,5');
    });
  });
});

describe('fenetreChargement', () => {
  it('élargit le mois de 7 jours de chaque côté, pour les semaines à cheval', () => {
    expect(fenetreChargement('2026-10')).toEqual({ debut: '2026-09-24', fin: '2026-11-07' });
  });
  it('passe correctement d’une année à l’autre', () => {
    expect(fenetreChargement('2026-01')).toEqual({ debut: '2025-12-25', fin: '2026-02-07' });
    expect(fenetreChargement('2026-12')).toEqual({ debut: '2026-11-24', fin: '2027-01-07' });
  });
  it('refuse un mois invalide', () => {
    expect(fenetreChargement('2026-13')).toBeNull();
    expect(fenetreChargement('octobre')).toBeNull();
    expect(fenetreChargement(null)).toBeNull();
  });
});

describe('salariesDuRecap : qui entre dans le récap du mois', () => {
  const actif = { id: 'emp-a', name: 'Salarié A', active: true };
  const parti = { id: 'emp-b', name: 'Salarié B', active: false };
  const partiSansRien = { id: 'emp-c', name: 'Salarié C', active: false };

  it('garde les actifs, écarte un ancien salarié sans activité dans le mois', () => {
    expect(salariesDuRecap([actif, partiSansRien], [], []).map((e) => e.id)).toEqual(['emp-a']);
  });
  it('garde un ancien salarié qui a pointé dans le mois', () => {
    const r = salariesDuRecap([parti], [{ employee_id: 'emp-b' }], []);
    expect(r.map((e) => e.id)).toEqual(['emp-b']);
  });
  it('garde un ancien salarié dont une absence est posée au planning ce mois-là (cas réel de mai 2026)', () => {
    expect(salariesDuRecap([parti], [], [{ employee_name: 'Salarié B', date: '2026-05-04', shift: 'maladie' }])
      .map((e) => e.id)).toEqual(['emp-b']);
    expect(salariesDuRecap([parti], [], [{ employee_id: 'emp-b', employee_name: 'Autre', date: '2026-05-04', shift: 'maladie' }])
      .map((e) => e.id)).toEqual(['emp-b']);
  });
});
