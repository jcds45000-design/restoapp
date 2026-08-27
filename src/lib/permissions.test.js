import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ROLES, TOUTES_PERMISSIONS, roleEffectif, can, permissionsParDefaut } from './permissions.js';

describe('matrice des rôles (spec §3)', () => {
  it('admin a tout', () => {
    for (const p of TOUTES_PERMISSIONS) expect(can(null, p, 'gerant')).toBe(true);
  });
  it('manager : opérationnel oui, finances/salaires/paramètres non', () => {
    const profil = { role: 'manager', permissions: permissionsParDefaut('manager') };
    expect(can(profil, 'modifier_planning')).toBe(true);
    expect(can(profil, 'valider_commande')).toBe(true);
    expect(can(profil, 'voir_finances')).toBe(false);
    expect(can(profil, 'voir_salaires')).toBe(false);
    expect(can(profil, 'modifier_parametres')).toBe(false);
    expect(can(profil, 'modifier_prix_fournisseur')).toBe(false);
  });
  it('employe et lecture : rien par défaut, tout passe par dérogation', () => {
    for (const role of ['employe', 'lecture']) {
      expect(permissionsParDefaut(role)).toEqual([]);
    }
  });
  it('une dérogation serveur prime sur les défauts', () => {
    const profil = { role: 'employe', permissions: ['declarer_perte'] };
    expect(can(profil, 'declarer_perte')).toBe(true);
    expect(can(profil, 'voir_finances')).toBe(false);
  });
});

describe('compat avant migration 7 (pas de profil serveur)', () => {
  it('gerant => admin, autre => employe', () => {
    expect(roleEffectif(null, 'gerant')).toBe('admin');
    expect(roleEffectif(null, 'employe')).toBe('employe');
    expect(roleEffectif({ role: 'aucun' }, 'gerant')).toBe('admin');
    expect(roleEffectif({ role: 'manager' }, 'employe')).toBe('manager');
  });
});

describe('cohérence avec supabase_migration7_phase0.sql', () => {
  const sql = readFileSync(new URL('../../supabase_migration7_phase0.sql', import.meta.url), 'utf8');
  it('chaque permission du front existe dans le seed SQL', () => {
    for (const p of TOUTES_PERMISSIONS) {
      expect(sql, `permission ${p} absente du SQL`).toContain(`'${p}'`);
    }
  });
  it('les 4 rôles du front sont ceux du CHECK SQL', () => {
    for (const r of ROLES) expect(sql).toContain(`'${r}'`);
  });
  it('les défauts manager du front sont ceux de default_permissions()', () => {
    const bloc = sql.match(/when 'manager' then array\[([^\]]+)\]/);
    expect(bloc).toBeTruthy();
    const sqlPerms = [...bloc[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(sqlPerms).toEqual([...permissionsParDefaut('manager')].sort());
  });
});
