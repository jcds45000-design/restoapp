import { describe, it, expect } from 'vitest';
import { libelleBouton, dureeLisible, minutesDepuis, heureParis, messagePointage, messageErreurBorne } from './borne';

describe('libelleBouton', () => {
  it('propose ARRIVÉE quand le salarié n’est pas en poste', () => {
    expect(libelleBouton({ en_poste: false })).toBe('ARRIVÉE');
  });
  it('propose DÉPART quand une présence est ouverte', () => {
    expect(libelleBouton({ en_poste: true, debut: '2026-10-21T09:00:00Z' })).toBe('DÉPART');
  });
  it('ne propose rien tant que l’état n’est pas connu', () => {
    expect(libelleBouton(null)).toBe(null);
  });
});

describe('dureeLisible', () => {
  it('affiche les minutes seules sous une heure', () => {
    expect(dureeLisible(45)).toBe('45 min');
  });
  it('affiche heures et minutes sur deux chiffres', () => {
    expect(dureeLisible(125)).toBe('2 h 05');
  });
  it('arrondit à la minute inférieure', () => {
    expect(dureeLisible(59.9)).toBe('59 min');
  });
  it('ne produit jamais de durée négative ni de NaN', () => {
    expect(dureeLisible(-3)).toBe('0 min');
    expect(dureeLisible(undefined)).toBe('0 min');
  });
});

describe('minutesDepuis', () => {
  it('compte les minutes écoulées depuis l’arrivée', () => {
    expect(minutesDepuis('2026-10-21T08:00:00Z', Date.parse('2026-10-21T10:15:00Z'))).toBe(135);
  });
});

describe('heureParis', () => {
  it('donne l’heure de Paris, pas celle de l’appareil', () => {
    // 15:32 UTC le 21/10/2026 = 17:32 à Paris (heure d'été jusqu'au 25/10)
    expect(heureParis('2026-10-21T15:32:00Z')).toBe('17:32');
  });
});

describe('messagePointage', () => {
  it('annonce une arrivée avec le prénom et l’heure', () => {
    const m = messagePointage({ action: 'arrivee', salarie: 'Salarié A', heure: '2026-10-21T07:58:00Z' }, true);
    expect(m).toEqual({ ok: true, texte: 'Bonjour Salarié A, arrivée enregistrée à 09:58', sansPhoto: false });
  });
  it('annonce un départ avec la durée de présence', () => {
    const m = messagePointage({ action: 'depart', salarie: 'Salarié B', heure: '2026-10-21T20:30:00Z', minutes: 372.4 }, true);
    expect(m.texte).toBe('Au revoir Salarié B, départ enregistré à 22:30 (6 h 12 de présence)');
    expect(m.ok).toBe(true);
  });
  it('signale un pointage sans photo', () => {
    const m = messagePointage({ action: 'arrivee', salarie: 'Salarié A', heure: '2026-10-21T07:58:00Z' }, false);
    expect(m.sansPhoto).toBe(true);
  });
  it('traite le double appui comme un succès, sans nouveau pointage', () => {
    expect(messagePointage({ action: 'ignore', salarie: 'Salarié A' }, true))
      .toEqual({ ok: true, texte: 'Pointage déjà enregistré à l’instant.', sansPhoto: false });
  });
  it('reste neutre sur un code faux', () => {
    expect(messagePointage({ action: 'erreur', motif: 'code_invalide' }, true))
      .toEqual({ ok: false, texte: 'Code incorrect. Réessaie.' });
  });
  it('explique le blocage après trop d’essais', () => {
    expect(messagePointage({ action: 'erreur', motif: 'trop_de_tentatives' }, true))
      .toEqual({ ok: false, texte: 'Trop d’essais. Patiente quelques minutes.' });
  });
  it('ne prétend jamais avoir pointé sur une réponse inattendue', () => {
    expect(messagePointage(null, true).ok).toBe(false);
    expect(messagePointage({ action: 'autre' }, true).ok).toBe(false);
  });
});

describe('messageErreurBorne', () => {
  it('refuse explicitement un appareil non enregistré', () => {
    expect(messageErreurBorne('appareil non autorise')).toBe('Cet appareil n’est pas la borne de pointage.');
  });
  it('dit franchement que le serveur est injoignable', () => {
    expect(messageErreurBorne('TypeError: Failed to fetch'))
      .toBe('Pointage indisponible, rien n’a été enregistré. Préviens le responsable.');
  });
  it('n’affiche jamais le message technique brut', () => {
    expect(messageErreurBorne('function public.pointer does not exist')).not.toMatch(/function|exist/);
    expect(messageErreurBorne(undefined)).toMatch(/Préviens le responsable/);
  });
});
