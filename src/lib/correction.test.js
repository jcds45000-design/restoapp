// src/lib/correction.test.js
import { describe, it, expect } from 'vitest';
import {
  lireHeure, versInstant, versChamps, instantsSaisis, garderOrigine, composerMotif, chevauche,
  verifierSaisie, messageErreur, changementsLisibles,
} from './correction.js';

describe('lireHeure', () => {
  it('accepte les écritures courantes', () => {
    expect(lireHeure('21:55')).toBe('21:55');
    expect(lireHeure('21h55')).toBe('21:55');
    expect(lireHeure('21H')).toBe('21:00');
    expect(lireHeure('2155')).toBe('21:55');
    expect(lireHeure('955')).toBe('09:55');
    expect(lireHeure(' 9:05 ')).toBe('09:05');
  });
  it('refuse ce qui n’est pas une heure', () => {
    expect(lireHeure('')).toBeNull();
    expect(lireHeure('24:00')).toBeNull();
    expect(lireHeure('12:60')).toBeNull();
    expect(lireHeure('midi')).toBeNull();
    expect(lireHeure('9 PM')).toBeNull();
  });
});

describe('versInstant / versChamps (heure de Paris)', () => {
  it('hiver : Paris = UTC+1', () => {
    expect(versInstant('2026-11-10', '21:55')).toBe('2026-11-10T20:55:00.000Z');
  });
  it('été : Paris = UTC+2', () => {
    expect(versInstant('2026-07-10', '11:30')).toBe('2026-07-10T09:30:00.000Z');
  });
  it('juste après le passage à l’heure d’hiver (25/10/2026)', () => {
    expect(versInstant('2026-10-25', '12:00')).toBe('2026-10-25T11:00:00.000Z');
    expect(versInstant('2026-10-24', '12:00')).toBe('2026-10-24T10:00:00.000Z');
  });
  it('aller-retour', () => {
    expect(versChamps('2026-10-23T19:55:00.000Z')).toEqual({ jour: '2026-10-23', heure: '21:55' });
    expect(versChamps(versInstant('2026-03-29', '18:30'))).toEqual({ jour: '2026-03-29', heure: '18:30' });
  });
  it('rend null sur une saisie illisible', () => {
    expect(versInstant('2026-10-23', 'xx')).toBeNull();
    expect(versInstant('23/10/2026', '12:00')).toBeNull();
  });
});

describe('instantsSaisis', () => {
  it('départ le même jour', () => {
    expect(instantsSaisis({ jour: '2026-10-20', heureDebut: '18:00', heureFin: '22:30' }))
      .toEqual({ debut: '2026-10-20T16:00:00.000Z', fin: '2026-10-20T20:30:00.000Z', finLendemain: false });
  });
  it('départ après minuit = lendemain', () => {
    expect(instantsSaisis({ jour: '2026-10-20', heureDebut: '18:00', heureFin: '00:30' }))
      .toEqual({ debut: '2026-10-20T16:00:00.000Z', fin: '2026-10-20T22:30:00.000Z', finLendemain: true });
  });
  it('départ vide = pas de fin', () => {
    expect(instantsSaisis({ jour: '2026-10-20', heureDebut: '18:00', heureFin: '' }).fin).toBeNull();
  });
  it('départ illisible = undefined, distinct de vide', () => {
    expect(instantsSaisis({ jour: '2026-10-20', heureDebut: '18:00', heureFin: 'abc' }).fin).toBeUndefined();
  });
});

describe('garderOrigine', () => {
  const pointee = { debut: '2026-10-23T19:55:37.412Z', fin: '2026-10-23T19:58:12.000Z' };
  it('une heure non touchée garde ses secondes d’origine', () => {
    expect(garderOrigine(pointee, { debut: '2026-10-23T19:55:00.000Z', fin: '2026-10-23T20:10:00.000Z' }))
      .toEqual({ debut: '2026-10-23T19:55:37.412Z', fin: '2026-10-23T20:10:00.000Z' });
    expect(garderOrigine(pointee, { debut: '2026-10-23T19:55:00.000Z', fin: '2026-10-23T19:58:00.000Z' }))
      .toEqual(pointee);
  });
  it('une heure modifiée part telle quelle', () => {
    expect(garderOrigine(pointee, { debut: '2026-10-23T19:50:00.000Z', fin: null }))
      .toEqual({ debut: '2026-10-23T19:50:00.000Z', fin: null });
  });
  it('sans présence d’origine (ajout), rien ne change', () => {
    expect(garderOrigine(null, { debut: 'x', fin: 'y' })).toEqual({ debut: 'x', fin: 'y' });
  });
});

describe('composerMotif', () => {
  it('assemble type et précision', () => {
    expect(composerMotif('Oubli au départ', 'parti à 22 h')).toBe('Oubli au départ : parti à 22 h');
    expect(composerMotif('Oubli au départ', '  ')).toBe('Oubli au départ');
  });
  it('« Autre » n’a de sens qu’avec une précision', () => {
    expect(composerMotif('Autre', '')).toBe('');
    expect(composerMotif('Autre', 'formation en salle')).toBe('formation en salle');
  });
  it('sans type, pas de motif', () => {
    expect(composerMotif('', 'texte')).toBe('');
  });
});

const midi = { id: 'a', debut: '2026-10-20T09:00:00Z', fin: '2026-10-20T12:30:00Z', statut: 'complete' };
const soir = { id: 'b', debut: '2026-10-20T16:00:00Z', fin: '2026-10-20T20:00:00Z', statut: 'complete' };
const anomalie = { id: 'c', debut: '2026-10-21T16:00:00Z', fin: null, statut: 'anomalie' };
const enPoste = { id: 'o', debut: '2026-10-24T08:00:00Z', fin: null, statut: 'ouverte' };

describe('chevauche (même règle que la base)', () => {
  it('bout à bout n’est pas un chevauchement', () => {
    expect(chevauche({ debut: '2026-10-20T12:30:00Z', fin: '2026-10-20T16:00:00Z' }, [midi, soir])).toBe(false);
  });
  it('recouvrement partiel', () => {
    expect(chevauche({ debut: '2026-10-20T12:00:00Z', fin: '2026-10-20T13:00:00Z' }, [midi])).toBe(true);
  });
  it('une anomalie n’occupe que l’instant de son arrivée', () => {
    expect(chevauche({ debut: '2026-10-21T15:00:00Z', fin: '2026-10-21T16:00:00Z' }, [anomalie])).toBe(false);
    expect(chevauche({ debut: '2026-10-21T15:00:00Z', fin: '2026-10-21T17:00:00Z' }, [anomalie])).toBe(true);
  });
  it('une présence en cours occupe tout l’après', () => {
    expect(chevauche({ debut: '2026-10-24T12:00:00Z', fin: '2026-10-24T13:00:00Z' }, [enPoste])).toBe(true);
  });
  it('une saisie restant ouverte occupe tout l’après', () => {
    expect(chevauche({ debut: '2026-10-20T08:00:00Z', fin: null, resteOuverte: true }, [soir])).toBe(true);
  });
});

describe('verifierSaisie', () => {
  const maintenant = new Date('2026-10-24T12:00:00Z').getTime();
  const base = { maintenant, autres: [midi, soir, anomalie], motif: 'Oubli au départ' };

  it('accepte la réparation d’une anomalie', () => {
    expect(verifierSaisie({ ...base, mode: 'corriger', presence: anomalie,
      debut: anomalie.debut, fin: '2026-10-21T20:30:00Z' })).toBeNull();
  });
  it('refuse une correction sans changement (la borne deviendrait du déclaré)', () => {
    expect(verifierSaisie({ ...base, mode: 'corriger', presence: midi, debut: midi.debut, fin: midi.fin }))
      .toMatch(/Rien n’a changé/);
  });
  it('exige le départ pour corriger une présence terminée', () => {
    expect(verifierSaisie({ ...base, mode: 'corriger', presence: anomalie, debut: '2026-10-21T15:30:00Z', fin: null }))
      .toMatch(/départ/);
  });
  it('laisse en poste un salarié dont on corrige l’arrivée', () => {
    expect(verifierSaisie({ ...base, autres: [enPoste], mode: 'corriger', presence: enPoste,
      debut: '2026-10-24T07:30:00Z', fin: null })).toBeNull();
  });
  it('exige le motif', () => {
    expect(verifierSaisie({ ...base, motif: ' ', mode: 'corriger', presence: anomalie,
      debut: anomalie.debut, fin: '2026-10-21T20:30:00Z' })).toMatch(/motif/);
  });
  it('refuse le chevauchement, la présence corrigée exclue', () => {
    expect(verifierSaisie({ ...base, mode: 'corriger', presence: midi,
      debut: midi.debut, fin: '2026-10-20T13:00:00Z' })).toBeNull();
    expect(verifierSaisie({ ...base, mode: 'corriger', presence: midi,
      debut: midi.debut, fin: '2026-10-20T17:00:00Z' })).toMatch(/recouvrent/);
  });
  it('refuse le futur et plus de 14 h', () => {
    expect(verifierSaisie({ ...base, mode: 'ajouter', debut: '2026-10-24T13:00:00Z', fin: null })).toMatch(/futur/);
    expect(verifierSaisie({ ...base, mode: 'ajouter', debut: '2026-10-22T01:00:00Z', fin: '2026-10-22T16:00:00Z' }))
      .toMatch(/14 h/);
  });
  it('ajout sans départ : seulement si la personne peut encore être en poste', () => {
    expect(verifierSaisie({ ...base, mode: 'ajouter', debut: '2026-10-24T08:00:00Z', fin: null })).toBeNull();
    expect(verifierSaisie({ ...base, mode: 'ajouter', debut: '2026-10-22T08:00:00Z', fin: null })).toMatch(/départ/);
  });
  it('signale une heure illisible', () => {
    expect(verifierSaisie({ ...base, mode: 'ajouter', debut: null, fin: null })).toMatch(/arrivée illisible/);
    expect(verifierSaisie({ ...base, mode: 'ajouter', debut: '2026-10-22T08:00:00Z', fin: undefined }))
      .toMatch(/départ illisible/);
  });
});

describe('messageErreur', () => {
  it('traduit les refus de la base', () => {
    expect(messageErreur('chevauche une presence existante, la corriger plutot')).toMatch(/recouvrent/);
    expect(messageErreur('non autorise')).toMatch(/admin/);
    expect(messageErreur('panne réseau')).toBe('Enregistrement refusé : panne réseau');
  });
});

describe('changementsLisibles', () => {
  it('départ ajouté sur une anomalie', () => {
    expect(changementsLisibles({
      before: { debut: '2026-10-21T16:00:00+00:00', fin: null },
      after: { debut: '2026-10-21T16:00:00+00:00', fin: '2026-10-21T20:30:00+00:00' },
    })).toEqual(['départ — → 22:30']);
  });
  it('arrivée déplacée à un autre jour', () => {
    expect(changementsLisibles({
      before: { debut: '2026-10-21T16:00:00+00:00', fin: null },
      after: { debut: '2026-10-22T16:00:00+00:00', fin: '2026-10-22T20:00:00+00:00' },
    })).toEqual(['arrivée 18:00 → 18:00 (jour changé : 2026-10-21 → 2026-10-22)', 'départ — → 22:00']);
  });
  it('présence ajoutée', () => {
    expect(changementsLisibles({ before: null, after: { debut: '2026-10-21T16:00:00Z', fin: null } }))
      .toEqual(['présence ajoutée : 18:00 → —']);
  });
  it('même instant écrit différemment = pas de changement', () => {
    expect(changementsLisibles({
      before: { debut: '2026-10-21T16:00:00+00:00', fin: '2026-10-21T20:00:00+00:00' },
      after: { debut: '2026-10-21T16:00:00.000Z', fin: '2026-10-21T21:00:00+00:00' },
    })).toEqual(['départ 22:00 → 23:00']);
  });
});
