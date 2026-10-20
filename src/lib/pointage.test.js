// src/lib/pointage.test.js
import { describe, it, expect } from 'vitest';
import { jourDeRattachement, dureeMinutes } from './pointage.js';

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
