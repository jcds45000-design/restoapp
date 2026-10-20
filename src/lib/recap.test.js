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
