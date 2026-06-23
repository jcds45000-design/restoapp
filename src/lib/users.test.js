import { describe, it, expect } from 'vitest';
import { findUserIndexByEmail } from './users';

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
