// src/lib/recap.test.js
import { describe, it, expect } from 'vitest';
import {
  cleSemaine, moisDeRattachement, heuresSupplementaires, recapMensuel,
} from './recap.js';

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

const CRENEAUX = { midiDebut: '11:30', midiFin: '14:30', soirDebut: '18:30', soirFin: '22:00' };
// Fixtures ANONYMISÉES : dépôt public, jamais de vrai nom ni de vrai taux.
const SALARIE = { id: 'emp-a', name: 'Salarié A', heures_hebdo: 24, contrat: 'CDI', taux_h: 12 };

// Présences construites en heures locales de Paris (UTC+2 en septembre).
const pres = (jour, hDeb, hFin, finOrigine = 'borne') => ({
  employee_id: 'emp-a', jour,
  debut: `${jour}T${String(Number(hDeb.slice(0, 2)) - 2).padStart(2, '0')}${hDeb.slice(2)}:00.000Z`,
  fin: hFin === null ? null
    : `${jour}T${String(Number(hFin.slice(0, 2)) - 2).padStart(2, '0')}${hFin.slice(2)}:00.000Z`,
  debut_origine: 'borne', fin_origine: hFin === null ? null : finOrigine,
  statut: hFin === null ? 'anomalie' : 'complete',
});

describe('recapMensuel', () => {
  it('assemble heures, qualité, repas et écart au contrat', () => {
    const r = recapMensuel({
      salarie: SALARIE,
      presences: [
        pres('2026-09-22', '11:30', '14:30'),  // 3 h, repas midi
        pres('2026-09-22', '18:30', '22:00'),  // 3,5 h, repas soir
        pres('2026-09-23', '11:30', '14:30'),  // 3 h, repas midi
      ],
      mois: '2026-09',
      creneaux: CRENEAUX,
    });
    expect(r.heuresTotales).toBe(9.5);
    expect(r.qualite.tauxFiabilite).toBe(100);
    expect(r.repas.total).toBe(3);
    expect(r.repas.midi).toBe(2);
    expect(r.repas.soir).toBe(1);
  });

  it('découpe en semaines et ne mélange jamais deux semaines', () => {
    const r = recapMensuel({
      salarie: SALARIE,
      presences: [
        pres('2026-09-15', '09:00', '19:00'), // semaine 38
        pres('2026-09-22', '09:00', '19:00'), // semaine 39
      ],
      mois: '2026-09',
      creneaux: CRENEAUX,
    });
    expect(r.semaines).toHaveLength(2);
    expect(r.semaines.map((s) => s.cle)).toEqual(['2026-W38', '2026-W39']);
  });

  it('remonte les anomalies sans jamais les compter en heures', () => {
    const r = recapMensuel({
      salarie: SALARIE,
      presences: [
        pres('2026-09-22', '11:30', '14:30'),
        pres('2026-09-23', '11:30', null), // oubli de départ
      ],
      mois: '2026-09',
      creneaux: CRENEAUX,
    });
    expect(r.heuresTotales).toBe(3);
    expect(r.qualite.anomalies).toBe(1);
    expect(r.anomalies).toHaveLength(1);
    expect(r.anomalies[0].jour).toBe('2026-09-23');
  });

  it('garde ENTIÈRE une semaine à cheval, sans la tronquer au changement de mois', () => {
    // Semaine du 28/09 au 04/10. Avec un rattachement au mois de fin, elle appartient
    // à OCTOBRE en entier, y compris ses journées de septembre.
    const presences = [
      pres('2026-09-29', '09:00', '19:00'), // 10 h, en septembre sur le calendrier
      pres('2026-10-01', '09:00', '19:00'), // 10 h, en octobre
    ];
    const septembre = recapMensuel({
      salarie: SALARIE, presences, mois: '2026-09', creneaux: CRENEAUX, regleSemaine: 'mois_fin',
    });
    const octobre = recapMensuel({
      salarie: SALARIE, presences, mois: '2026-10', creneaux: CRENEAUX, regleSemaine: 'mois_fin',
    });
    // La semaine n'est comptée qu'une fois, et elle est entière.
    expect(septembre.heuresTotales).toBe(0);
    expect(octobre.heuresTotales).toBe(20);
    expect(octobre.semaines).toHaveLength(1);
  });

  it('le rattachement au mois de début donne le résultat inverse, sans perdre d’heures', () => {
    const presences = [
      pres('2026-09-29', '09:00', '19:00'),
      pres('2026-10-01', '09:00', '19:00'),
    ];
    const septembre = recapMensuel({
      salarie: SALARIE, presences, mois: '2026-09', creneaux: CRENEAUX, regleSemaine: 'mois_debut',
    });
    expect(septembre.heuresTotales).toBe(20);
  });

  it('aucune heure ne disparaît ni n’est comptée deux fois sur douze mois', () => {
    // Garde-fou : la somme des récaps doit égaler le total des présences.
    const presences = [];
    for (let jour = 1; jour <= 28; jour += 1) {
      const j = `2026-09-${String(jour).padStart(2, '0')}`;
      presences.push(pres(j, '09:00', '12:00')); // 3 h par jour
    }
    const total = ['2026-08', '2026-09', '2026-10']
      .map((m) => recapMensuel({
        salarie: SALARIE, presences, mois: m, creneaux: CRENEAUX, regleSemaine: 'mois_fin',
      }).heuresTotales)
      .reduce((a, b) => a + b, 0);
    expect(total).toBe(28 * 3);
  });

  it('un mois sans aucune présence ne plante pas et rend des zéros', () => {
    const r = recapMensuel({ salarie: SALARIE, presences: [], mois: '2026-09', creneaux: CRENEAUX });
    expect(r.heuresTotales).toBe(0);
    expect(r.repas.total).toBe(0);
    expect(r.semaines).toEqual([]);
  });
});
