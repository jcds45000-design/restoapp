import { describe, it, expect } from 'vitest';
import { findUserIndexByEmail, issueSuppressionSalarie, estActif, visibleSurPeriode, dateFinParDefaut, anciensSalaries, codePinValide, codePinFaible, messageErreurPin } from './users';

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

// ─── Code de pointage (PIN) ───────────────────────────────────────
// Le contrat vient de definir_pin() (migration 10) : 4 à 6 chiffres, unique sur
// TOUS les salariés, jamais relu. La borne accepte la même longueur.

describe('codePinValide', () => {
  it('accepte 4, 5 ou 6 chiffres', () => {
    expect(codePinValide('1234')).toBe(true);
    expect(codePinValide('12345')).toBe(true);
    expect(codePinValide('123456')).toBe(true);
  });
  it('refuse trop court ou trop long, comme la fonction SQL', () => {
    expect(codePinValide('123')).toBe(false);
    expect(codePinValide('1234567')).toBe(false);
  });
  it('refuse tout ce qui n’est pas uniquement des chiffres', () => {
    expect(codePinValide('12a4')).toBe(false);
    expect(codePinValide('12 34')).toBe(false);
    expect(codePinValide(' 1234')).toBe(false);
    expect(codePinValide('')).toBe(false);
    expect(codePinValide(null)).toBe(false);
    expect(codePinValide(undefined)).toBe(false);
  });
});

describe('codePinFaible', () => {
  it('signale un code devinable : chiffre répété ou suite', () => {
    expect(codePinFaible('0000')).toBe(true);
    expect(codePinFaible('1111')).toBe(true);
    expect(codePinFaible('1234')).toBe(true);
    expect(codePinFaible('123456')).toBe(true);
    expect(codePinFaible('4321')).toBe(true);
  });
  it('laisse passer un code ordinaire', () => {
    expect(codePinFaible('2706')).toBe(false);
    expect(codePinFaible('9184')).toBe(false);
    expect(codePinFaible('100200')).toBe(false);
  });
  it('ne juge pas un code invalide : ce n’est pas son rôle', () => {
    expect(codePinFaible('12')).toBe(false);
    expect(codePinFaible(null)).toBe(false);
  });
});

describe('messageErreurPin', () => {
  it('traduit chaque refus de definir_pin()', () => {
    expect(messageErreurPin('le code doit faire 4 a 6 chiffres')).toMatch(/4 à 6 chiffres/);
    expect(messageErreurPin('ce code est deja utilise')).toMatch(/déjà utilisé/);
    expect(messageErreurPin('non autorise')).toMatch(/gérant/);
    expect(messageErreurPin('salarie inconnu')).toMatch(/fiche/i);
  });
  it('n’affiche jamais le message technique brut', () => {
    const brut = 'duplicate key value violates unique constraint "employees_pkey"';
    expect(messageErreurPin(brut)).not.toContain('constraint');
    expect(messageErreurPin(brut)).toMatch(/pas pu être enregistré/);
    expect(messageErreurPin()).toMatch(/pas pu être enregistré/);
  });
});
