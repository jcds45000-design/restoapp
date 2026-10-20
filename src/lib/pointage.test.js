// src/lib/pointage.test.js
import { describe, it, expect } from 'vitest';
import { jourDeRattachement, dureeMinutes, qualiteHeures } from './pointage.js';

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
});
