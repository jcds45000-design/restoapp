// src/lib/mois.test.js
import { describe, it, expect } from 'vitest';
import { decalerMois, libelleMois, MOIS_COURTS } from './mois.js';

describe('decalerMois', () => {
  it('avance et recule d’un mois', () => {
    expect(decalerMois('2026-10', 1)).toBe('2026-11');
    expect(decalerMois('2026-10', -1)).toBe('2026-09');
  });
  it('change d’année dans les deux sens', () => {
    expect(decalerMois('2026-12', 1)).toBe('2027-01');
    expect(decalerMois('2026-01', -1)).toBe('2025-12');
    expect(decalerMois('2026-10', -12)).toBe('2025-10');
  });
  it('refuse un mois mal formé', () => {
    expect(() => decalerMois('10/2026', 1)).toThrow('mois invalide');
    expect(() => decalerMois('2026-13', 1)).toThrow('mois invalide');
  });
});

describe('libelleMois', () => {
  it('écrit le mois en français, quelle que soit la langue du navigateur', () => {
    expect(libelleMois('2026-10')).toBe('octobre 2026');
    expect(libelleMois('2027-02')).toBe('février 2027');
    expect(libelleMois('2026-08')).toBe('août 2026');
  });
});

describe('MOIS_COURTS', () => {
  it('donne les 12 abréviations françaises dans l’ordre', () => {
    expect(MOIS_COURTS).toHaveLength(12);
    expect(MOIS_COURTS[0]).toBe('janv.');
    expect(MOIS_COURTS[11]).toBe('déc.');
  });
});
