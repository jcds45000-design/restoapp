import { describe, it, expect } from 'vitest';
import { findUserIndexByEmail, issueSuppressionSalarie, estActif, visibleSurPeriode, dateFinParDefaut, anciensSalaries } from './users';

const users = [
  { name: 'Jean Claude', email: '' },
  { name: 'Yuna', email: 'yuna@kimiko.fr' },
  { name: 'Thomas', email: 'Thomas@Kimiko.fr' },
];

describe('findUserIndexByEmail', () => {
  it('trouve par email, insensible à la casse', () => {
    expect(findUserIndexByEmail(users, 'yuna@kimiko.fr')).toBe(1);
    expect(findUserIndexByEmail(users, 'thomas@kimiko.fr')).toBe(2);
    expect(findUserIndexByEmail(users, '  YUNA@KIMIKO.FR ')).toBe(1);
  });
  it('renvoie -1 si aucune correspondance', () => {
    expect(findUserIndexByEmail(users, 'inconnu@x.fr')).toBe(-1);
  });
  it('ignore un email vide ou nul (ne matche pas les entrées sans email)', () => {
    expect(findUserIndexByEmail(users, '')).toBe(-1);
    expect(findUserIndexByEmail(users, null)).toBe(-1);
    expect(findUserIndexByEmail(users, undefined)).toBe(-1);
  });
});

describe('issueSuppressionSalarie', () => {
  it('sans erreur : le salarié est supprimé', () => {
    expect(issueSuppressionSalarie(null)).toBe('supprime');
  });
  it('clé étrangère (23503, il a des présences) : à désactiver', () => {
    expect(issueSuppressionSalarie({ code: '23503', message: 'violates foreign key constraint' })).toBe('desactiver');
  });
  it('toute autre erreur reste une erreur', () => {
    expect(issueSuppressionSalarie({ code: '42501', message: 'permission denied' })).toBe('erreur');
  });
});

describe('estActif', () => {
  it('actif par défaut, y compris sans le champ (gérant externe)', () => {
    expect(estActif({ active: true })).toBe(true);
    expect(estActif({})).toBe(true);
  });
  it('inactif seulement si active vaut false', () => {
    expect(estActif({ active: false })).toBe(false);
  });
});

describe('visibleSurPeriode', () => {
  const ancien = { name: 'Salarié A', active: false, dateFin: '2026-10-15' };
  it('un actif est toujours visible', () => {
    expect(visibleSurPeriode({ active: true }, '2030-01-01', '2030-01-07', {})).toBe(true);
  });
  it('un ancien reste visible la semaine de son départ et avant', () => {
    expect(visibleSurPeriode(ancien, '2026-10-12', '2026-10-18', {})).toBe(true);
    expect(visibleSurPeriode(ancien, '2026-09-01', '2026-09-30', {})).toBe(true);
    expect(visibleSurPeriode(ancien, '2026-10-15', '2026-10-15', {})).toBe(true);
  });
  it('un ancien disparaît des périodes qui commencent après son départ', () => {
    expect(visibleSurPeriode(ancien, '2026-10-19', '2026-10-25', {})).toBe(false);
    expect(visibleSurPeriode(ancien, '2026-10-16', '2026-10-16', {})).toBe(false);
  });
  it('un créneau saisi sur la période le garde visible, pour ne rien masquer', () => {
    expect(visibleSurPeriode(ancien, '2026-10-19', '2026-10-25', { '2026-10-20': '11h30-14h' })).toBe(true);
  });
  it('un créneau hors période ou vide ne compte pas', () => {
    expect(visibleSurPeriode(ancien, '2026-10-19', '2026-10-25', { '2026-10-27': '11h30-14h', '2026-10-21': '' })).toBe(false);
  });
  it('un ancien sans date de fin et sans créneau est masqué', () => {
    expect(visibleSurPeriode({ active: false }, '2026-10-19', '2026-10-25', undefined)).toBe(false);
  });
});

describe('dateFinParDefaut', () => {
  it('CDD déjà échu : sa date de fin', () => {
    expect(dateFinParDefaut('2026-08-09', '2026-10-21')).toBe('2026-08-09');
  });
  it('fin future ou absente : aujourd\'hui', () => {
    expect(dateFinParDefaut('2026-12-31', '2026-10-21')).toBe('2026-10-21');
    expect(dateFinParDefaut('', '2026-10-21')).toBe('2026-10-21');
    expect(dateFinParDefaut(null, '2026-10-21')).toBe('2026-10-21');
  });
});

describe('anciensSalaries', () => {
  it('ne garde que les inactifs, départ le plus récent en premier, sans date en dernier', () => {
    const liste = [
      { name: 'Salarié A', active: true },
      { name: 'Salarié B', active: false, dateFin: '2026-08-09' },
      { name: 'Salarié C', active: false, dateFin: '' },
      { name: 'Salarié D', active: false, dateFin: '2026-09-30' },
    ];
    expect(anciensSalaries(liste).map(e => e.name)).toEqual(['Salarié D', 'Salarié B', 'Salarié C']);
  });
});
