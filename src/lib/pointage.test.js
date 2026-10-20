// src/lib/pointage.test.js
import { describe, it, expect } from 'vitest';
import { jourDeRattachement, dureeMinutes, qualiteHeures, repasDuJour } from './pointage.js';

describe('jourDeRattachement', () => {
  it('rattache la présence au jour de son DÉBUT, même si elle finit après minuit', () => {
    // Service du soir : 18h00 le 22, fin 00h30 le 23. Une seule journée travaillée.
    expect(jourDeRattachement('2026-09-22T16:00:00.000Z')).toBe('2026-09-22');
  });
  it('utilise le fuseau Europe/Paris et non UTC', () => {
    // 23h30 heure de Paris le 22 septembre = 21h30 UTC. Le jour reste le 22.
    expect(jourDeRattachement('2026-09-22T21:30:00.000Z')).toBe('2026-09-22');
    // 00h30 heure de Paris le 23 septembre = 22h30 UTC le 22. Le jour est le 23.
    expect(jourDeRattachement('2026-09-22T22:30:00.000Z')).toBe('2026-09-23');
  });
  it('refuse une date de début absente ou invalide', () => {
    expect(() => jourDeRattachement(null)).toThrow('date de début invalide');
    expect(() => jourDeRattachement(undefined)).toThrow('date de début invalide');
    expect(() => jourDeRattachement('abc')).toThrow('date de début invalide');
  });
  it('gère le passage à l’heure d’hiver (25 octobre 2026)', () => {
    expect(jourDeRattachement('2026-10-25T22:30:00.000Z')).toBe('2026-10-25');
    expect(jourDeRattachement('2026-10-25T23:30:00.000Z')).toBe('2026-10-26');
  });
  it('gère le passage à l’heure d’été (29 mars 2026)', () => {
    expect(jourDeRattachement('2026-03-28T23:00:00.000Z')).toBe('2026-03-29');
  });
});

describe('dureeMinutes', () => {
  it('compte les minutes exactes, sans arrondi', () => {
    expect(dureeMinutes({ debut: '2026-09-22T09:00:00.000Z', fin: '2026-09-22T12:53:00.000Z' }))
      .toBe(233);
  });
  it('une présence sans fin vaut 0 minute et n’est JAMAIS estimée', () => {
    expect(dureeMinutes({ debut: '2026-09-22T09:00:00.000Z', fin: null })).toBe(0);
  });
  it('une fin antérieure au début vaut 0 minute', () => {
    expect(dureeMinutes({ debut: '2026-09-22T12:00:00.000Z', fin: '2026-09-22T09:00:00.000Z' }))
      .toBe(0);
  });
  it('compte la durée réelle écoulée à travers la nuit du changement d’heure', () => {
    expect(dureeMinutes({ debut: '2026-10-24T20:00:00.000Z', fin: '2026-10-25T05:00:00.000Z' }))
      .toBe(540);
  });
  it('un début égal à la fin vaut 0 minute', () => {
    expect(dureeMinutes({ debut: '2026-09-22T09:00:00.000Z', fin: '2026-09-22T09:00:00.000Z' }))
      .toBe(0);
  });
  it('arrondit à la minute la plus proche pour chaque présence', () => {
    expect(dureeMinutes({ debut: '2026-09-22T09:00:00.000Z', fin: '2026-09-22T09:00:29.000Z' }))
      .toBe(0);
    expect(dureeMinutes({ debut: '2026-09-22T09:00:00.000Z', fin: '2026-09-22T09:00:30.000Z' }))
      .toBe(1);
  });
});

const p = (debut, fin, debutOrigine = 'borne', finOrigine = 'borne') => ({
  debut, fin, debut_origine: debutOrigine, fin_origine: finOrigine,
  statut: fin ? 'complete' : 'anomalie',
});

describe('qualiteHeures', () => {
  it('sépare pointé, déclaré après coup et anomalie, et ne les additionne jamais', () => {
    const r = qualiteHeures([
      p('2026-09-22T09:00:00.000Z', '2026-09-22T11:00:00.000Z'),                     // 120 pointées
      p('2026-09-23T09:00:00.000Z', '2026-09-23T10:30:00.000Z', 'borne', 'declare'), // 90 déclarées
      p('2026-09-24T09:00:00.000Z', null),                                           // anomalie
    ]);
    expect(r.minutesPointees).toBe(120);
    expect(r.minutesDeclarees).toBe(90);
    expect(r.anomalies).toBe(1);
    expect(r.minutesTotales).toBe(210);
  });

  it('une présence est déclarée dès que l’un de ses deux bouts l’est', () => {
    const r = qualiteHeures([p('2026-09-22T09:00:00.000Z', '2026-09-22T11:00:00.000Z', 'declare')]);
    expect(r.minutesPointees).toBe(0);
    expect(r.minutesDeclarees).toBe(120);
  });

  it('une correction du gérant compte comme déclarée, pas comme mesurée', () => {
    const r = qualiteHeures([
      p('2026-09-22T09:00:00.000Z', '2026-09-22T11:00:00.000Z', 'borne', 'correction'),
    ]);
    expect(r.minutesPointees).toBe(0);
    expect(r.minutesDeclarees).toBe(120);
  });

  it('une clôture automatique est une anomalie, elle ne vaut aucune minute', () => {
    const r = qualiteHeures([
      { debut: '2026-09-22T09:00:00.000Z', fin: '2026-09-22T23:00:00.000Z',
        debut_origine: 'borne', fin_origine: 'cloture_auto', statut: 'anomalie' },
    ]);
    expect(r.minutesTotales).toBe(0);
    expect(r.anomalies).toBe(1);
  });

  it('un taux de fiabilité est fourni pour juger le chiffre', () => {
    const r = qualiteHeures([
      p('2026-09-22T09:00:00.000Z', '2026-09-22T11:00:00.000Z'),
      p('2026-09-23T09:00:00.000Z', '2026-09-23T11:00:00.000Z', 'borne', 'declare'),
    ]);
    expect(r.tauxFiabilite).toBe(50);
  });

  it('une clôture automatique est une anomalie même si le statut est complete et la fin renseignée', () => {
    const r = qualiteHeures([
      { debut: '2026-09-22T09:00:00.000Z', fin: '2026-09-22T23:00:00.000Z',
        debut_origine: 'borne', fin_origine: 'cloture_auto', statut: 'complete' },
    ]);
    expect(r.anomalies).toBe(1);
    expect(r.minutesTotales).toBe(0);
  });

  it('une liste vide donne des zéros', () => {
    expect(qualiteHeures([])).toEqual({
      minutesPointees: 0, minutesDeclarees: 0, anomalies: 0, enCours: 0,
      minutesTotales: 0, tauxFiabilite: 0,
    });
  });

  it('une fin antérieure au début est une anomalie, elle ne disparaît pas', () => {
    const r = qualiteHeures([
      { debut: '2026-09-22T20:00:00.000Z', fin: '2026-09-22T10:30:00.000Z',
        debut_origine: 'borne', fin_origine: 'correction', statut: 'complete' },
    ]);
    expect(r.anomalies).toBe(1);
    expect(r.minutesTotales).toBe(0);
  });

  it('une fin égale au début ou une date invalide est une anomalie', () => {
    const r = qualiteHeures([
      p('2026-09-22T09:00:00.000Z', '2026-09-22T09:00:00.000Z'),
      p('abc', '2026-09-22T09:00:00.000Z'),
      p('2026-09-22T09:00:00.000Z', 'abc'),
    ]);
    expect(r.anomalies).toBe(3);
  });

  it('une présence ouverte sans fin est en cours, ni anomalie ni minute', () => {
    const r = qualiteHeures([
      { debut: '2026-09-22T09:00:00.000Z', fin: null,
        debut_origine: 'borne', fin_origine: null, statut: 'ouverte' },
    ]);
    expect(r.enCours).toBe(1);
    expect(r.anomalies).toBe(0);
    expect(r.minutesTotales).toBe(0);
  });

  it('une présence complete sans fin reste une anomalie', () => {
    const r = qualiteHeures([
      { debut: '2026-09-22T09:00:00.000Z', fin: null,
        debut_origine: 'borne', fin_origine: null, statut: 'complete' },
    ]);
    expect(r.anomalies).toBe(1);
    expect(r.enCours).toBe(0);
  });

  it('une présence corrigée n’est jamais pointée, même borne/borne', () => {
    const r = qualiteHeures([
      { ...p('2026-09-22T09:00:00.000Z', '2026-09-22T11:00:00.000Z'), corrigee: true },
    ]);
    expect(r.minutesPointees).toBe(0);
    expect(r.minutesDeclarees).toBe(120);
  });
});

// Créneaux par défaut, en heure locale de Paris.
const CRENEAUX = { midiDebut: '11:30', midiFin: '14:30', soirDebut: '18:30', soirFin: '22:00' };

// Helper : construit une présence à partir d'heures LOCALES de Paris (UTC+2 en septembre).
const pLocale = (jour, hDebut, hFin) => ({
  jour,
  debut: `${jour}T${String(Number(hDebut.slice(0, 2)) - 2).padStart(2, '0')}${hDebut.slice(2)}:00.000Z`,
  fin: hFin === null ? null
    : `${jour}T${String(Number(hFin.slice(0, 2)) - 2).padStart(2, '0')}${hFin.slice(2)}:00.000Z`,
  debut_origine: 'borne', fin_origine: hFin === null ? null : 'borne',
  statut: hFin === null ? 'anomalie' : 'complete',
});

describe('repasDuJour', () => {
  it('service du midi seul = 1 repas', () => {
    const r = repasDuJour([pLocale('2026-09-22', '11:30', '14:30')], CRENEAUX);
    expect(r).toEqual({ midi: 1, soir: 0, total: 1 });
  });
  it('service du soir seul = 1 repas', () => {
    const r = repasDuJour([pLocale('2026-09-22', '18:30', '22:00')], CRENEAUX);
    expect(r).toEqual({ midi: 0, soir: 1, total: 1 });
  });
  it('coupure midi ET soir = 2 repas, même en deux présences distinctes', () => {
    const r = repasDuJour([
      pLocale('2026-09-22', '11:30', '14:30'),
      pLocale('2026-09-22', '18:30', '22:00'),
    ], CRENEAUX);
    expect(r).toEqual({ midi: 1, soir: 1, total: 2 });
  });
  it('journée continue qui couvre les deux services = 2 repas', () => {
    const r = repasDuJour([pLocale('2026-09-26', '11:30', '22:00')], CRENEAUX);
    expect(r).toEqual({ midi: 1, soir: 1, total: 2 });
  });
  it('présence hors des deux créneaux = 0 repas', () => {
    const r = repasDuJour([pLocale('2026-09-22', '15:00', '17:00')], CRENEAUX);
    expect(r).toEqual({ midi: 0, soir: 0, total: 0 });
  });
  it('un simple contact du créneau ne suffit pas, il faut un vrai chevauchement', () => {
    // Part à 11h30 pile : il n'a pas travaillé pendant le service du midi.
    const r = repasDuJour([pLocale('2026-09-22', '09:00', '11:30')], CRENEAUX);
    expect(r).toEqual({ midi: 0, soir: 0, total: 0 });
  });
  it('une présence en anomalie ne donne aucun repas', () => {
    const r = repasDuJour([pLocale('2026-09-22', '11:30', null)], CRENEAUX);
    expect(r).toEqual({ midi: 0, soir: 0, total: 0 });
  });
  it('une présence en cours (sans fin) ne donne aucun repas tant qu’elle n’est pas terminée', () => {
    const enCours = { ...pLocale('2026-09-22', '11:30', null), statut: 'ouverte' };
    expect(repasDuJour([enCours], CRENEAUX)).toEqual({ midi: 0, soir: 0, total: 0 });
  });
  it('deux présences touchant toutes deux le midi = 1 seul repas', () => {
    const r = repasDuJour([
      pLocale('2026-09-22', '09:00', '12:00'),
      pLocale('2026-09-22', '13:00', '15:00'),
    ], CRENEAUX);
    expect(r).toEqual({ midi: 1, soir: 0, total: 1 });
  });
  it('heure d’hiver (UTC+1) : 11h30 à 14h30 à Paris = 1 repas du midi', () => {
    const r = repasDuJour([{
      jour: '2026-11-10',
      debut: '2026-11-10T10:30:00.000Z', fin: '2026-11-10T13:30:00.000Z',
      debut_origine: 'borne', fin_origine: 'borne', statut: 'complete',
    }], CRENEAUX);
    expect(r).toEqual({ midi: 1, soir: 0, total: 1 });
  });
  it('créneau au format Postgres HH:MM:SS accepté', () => {
    const c = { midiDebut: '11:30:00', midiFin: '14:30:00', soirDebut: '18:30:00', soirFin: '22:00:00' };
    expect(repasDuJour([pLocale('2026-09-22', '11:30', '14:30')], c).midi).toBe(1);
  });
  it('créneau mal formé refusé', () => {
    expect(() => repasDuJour([], { ...CRENEAUX, midiDebut: '11h30' })).toThrow('creneau repas invalide');
    expect(() => repasDuJour([], { ...CRENEAUX, soirFin: '25:00' })).toThrow('creneau repas invalide');
    expect(() => repasDuJour([], { ...CRENEAUX, soirFin: '22:60' })).toThrow('creneau repas invalide');
  });
  it('créneaux absents refusés', () => {
    expect(() => repasDuJour([], undefined)).toThrow('creneaux repas manquants');
  });
});
