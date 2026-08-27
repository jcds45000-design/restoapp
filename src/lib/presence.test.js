import { describe, it, expect } from 'vitest';
import { statutPresence, syntheseJour, PRESENCE_LABELS } from './presence.js';

describe('statutPresence', () => {
  it('aucune ligne de planning => non_planifie, JAMAIS absent (règle spec §5)', () => {
    expect(statutPresence(undefined)).toBe('non_planifie');
    expect(statutPresence(null)).toBe('non_planifie');
    expect(statutPresence('')).toBe('non_planifie');
  });
  it('un créneau de travail => prevu (formats réels du planning)', () => {
    expect(statutPresence('11h30-14h / 18h-22h')).toBe('prevu');
    expect(statutPresence('11h30-22h')).toBe('prevu');
    expect(statutPresence('10h-12h / 13h30-16h45')).toBe('prevu');
  });
  it('absences légitimes distinguées', () => {
    expect(statutPresence('repos')).toBe('repos');
    expect(statutPresence('conges')).toBe('conge');
    expect(statutPresence('conge')).toBe('conge'); // ancienne valeur du CHECK initial
    expect(statutPresence('maladie')).toBe('arret');
  });
  it('absence injustifiée = marquage manuel uniquement', () => {
    expect(statutPresence('absence')).toBe('absent');
  });
  it('chaque statut a un libellé', () => {
    for (const st of ['non_planifie', 'prevu', 'repos', 'conge', 'arret', 'absent']) {
      expect(PRESENCE_LABELS[st]).toBeTruthy();
    }
  });
});

describe('syntheseJour', () => {
  const emps = [{ name: 'Ana' }, { name: 'Bob' }, { name: 'Caro' }, { name: 'Dan' }];
  it('classe chacun selon son planning du jour', () => {
    const schedule = {
      Ana: { '2026-08-27': '11h30-14h / 18h-22h' },
      Bob: { '2026-08-27': 'repos' },
      Caro: { '2026-08-27': 'absence' },
      // Dan : rien de saisi
    };
    const s = syntheseJour(emps, schedule, '2026-08-27');
    expect(s.parStatut.prevu).toEqual(['Ana']);
    expect(s.parStatut.repos).toEqual(['Bob']);
    expect(s.parStatut.absent).toEqual(['Caro']);
    expect(s.parStatut.non_planifie).toEqual(['Dan']);
    expect(s.prevus).toBe(1);
    expect(s.absents).toBe(1);
    expect(s.aucunPlanning).toBe(false);
  });
  it('planning entièrement vide => aucunPlanning, personne en absent', () => {
    const s = syntheseJour(emps, {}, '2026-08-27');
    expect(s.aucunPlanning).toBe(true);
    expect(s.absents).toBe(0);
    expect(s.parStatut.non_planifie).toHaveLength(4);
  });
  it('un autre jour planifié ne compte pas pour aujourd\'hui', () => {
    const schedule = { Ana: { '2026-08-26': '11h30-22h' } };
    const s = syntheseJour(emps, schedule, '2026-08-27');
    expect(s.parStatut.non_planifie).toContain('Ana');
  });
});
