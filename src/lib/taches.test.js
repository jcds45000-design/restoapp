import { describe, it, expect } from 'vitest';
import { estRecurrente, classerTaches, badgeTaches, dateFenetre, titresManquants } from './taches.js';

const TODAY = '2026-08-27';
const templates = [{ title: 'Nettoyer la friteuse' }, { title: 'Vider les poubelles' }];
const tk = (over) => ({ id: 'x', title: 'Tâche', assignee: 'Ana', status: 'todo', dueDate: TODAY, ...over });

describe('estRecurrente', () => {
  it('kind explicite prioritaire (après migration 7)', () => {
    expect(estRecurrente(tk({ kind: 'recurrente', title: 'Hors catalogue' }), templates)).toBe(true);
    expect(estRecurrente(tk({ kind: 'ponctuelle', title: 'Nettoyer la friteuse' }), templates)).toBe(false);
  });
  it('sans kind : correspondance titre ↔ catalogue', () => {
    expect(estRecurrente(tk({ title: 'Nettoyer la friteuse' }), templates)).toBe(true);
    expect(estRecurrente(tk({ title: 'Appeler le plombier' }), templates)).toBe(false);
  });
});

describe('classerTaches — règle spec §55 : une quotidienne ancienne ne reste pas en retard', () => {
  it('récurrente passée => expirée, ponctuelle passée => en retard', () => {
    const tasks = [
      tk({ id: '1', title: 'Nettoyer la friteuse', dueDate: '2026-06-03' }), // récurrente ancienne
      tk({ id: '2', title: 'Appeler le plombier', dueDate: '2026-08-20' }), // ponctuelle passée
      tk({ id: '3', title: 'Vider les poubelles', dueDate: TODAY }),        // aujourd'hui
      tk({ id: '4', title: 'Nettoyer la friteuse', dueDate: '2026-08-01', status: 'done' }),
      tk({ id: '5', title: 'Vider les poubelles', dueDate: '2026-08-02', status: 'non_faite' }),
    ];
    const { enRetard, expirees } = classerTaches(tasks, templates, TODAY);
    expect(enRetard.map((t) => t.id)).toEqual(['2']);
    expect(expirees.map((t) => t.id)).toEqual(['1']);
  });
  it('les tâches du jour ou futures ne sont ni en retard ni expirées', () => {
    const tasks = [tk({ dueDate: TODAY }), tk({ dueDate: '2026-09-01' })];
    const { enRetard, expirees } = classerTaches(tasks, templates, TODAY);
    expect(enRetard).toHaveLength(0);
    expect(expirees).toHaveLength(0);
  });
});

describe('badgeTaches', () => {
  const tasks = [
    tk({ id: '1', title: 'Nettoyer la friteuse', dueDate: '2026-06-03' }),               // expirée : ne compte pas
    tk({ id: '2', title: 'Appeler le plombier', dueDate: '2026-08-20' }),                // retard : compte
    tk({ id: '3', title: 'Vider les poubelles', dueDate: TODAY }),                       // du jour : compte
    tk({ id: '4', title: 'Autre du jour', dueDate: TODAY, status: 'done' }),             // faite : non
    tk({ id: '5', title: 'Pour Bob', dueDate: TODAY, assignee: 'Bob' }),                 // du jour : compte
  ];
  it('gérant : du jour non faites + ponctuelles en retard (les expirées ne gonflent plus rien)', () => {
    expect(badgeTaches({ tasks, templates, today: TODAY })).toBe(3);
  });
  it('employé : seulement les siennes', () => {
    expect(badgeTaches({ tasks, templates, today: TODAY, pourNom: 'Bob' })).toBe(1);
    expect(badgeTaches({ tasks, templates, today: TODAY, pourNom: 'Ana' })).toBe(2);
  });
});

describe('dateFenetre', () => {
  it('60 jours par défaut', () => {
    expect(dateFenetre('2026-08-27')).toBe('2026-06-28');
  });
  it('paramétrable', () => {
    expect(dateFenetre('2026-08-27', 7)).toBe('2026-08-20');
  });
});

describe('titresManquants — anti-doublon du template du jour', () => {
  const catalogue = [{ title: 'A' }, { title: 'B' }, { title: 'C' }];
  it('double clic => plus rien à insérer', () => {
    const dejaChargees = [tk({ title: 'A' }), tk({ title: 'B' }), tk({ title: 'C' })];
    expect(titresManquants(catalogue, dejaChargees)).toHaveLength(0);
  });
  it('n\'insère que ce qui manque', () => {
    expect(titresManquants(catalogue, [tk({ title: 'B' })]).map((t) => t.title)).toEqual(['A', 'C']);
  });
  it('une tâche ponctuelle du jour ne bloque pas le catalogue', () => {
    expect(titresManquants(catalogue, [tk({ title: 'Hors catalogue' })])).toHaveLength(3);
  });
});
