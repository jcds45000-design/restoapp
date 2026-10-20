// src/lib/recap.test.js
import { describe, it, expect } from 'vitest';
import { cleSemaine, moisDeRattachement, heuresSupplementaires } from './recap.js';

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
