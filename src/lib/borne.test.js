import { describe, it, expect } from 'vitest';
import { libelleBouton, dureeLisible, minutesDepuis, heureParis, messagePointage, messageErreurBorne, jourParis, departDeclare, messageRegularisation, genererJeton, jetonValide, messageErreurAppareil } from './borne';

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

describe('jourParis', () => {
  it('donne le jour en toutes lettres, à l’heure de Paris', () => {
    // 22:30 UTC le 20/10 = 00:30 le 21/10 à Paris
    expect(jourParis('2026-10-20T22:30:00Z')).toBe('mercredi 21 octobre');
    expect(jourParis('2026-10-20T09:00:00Z')).toBe('mardi 20 octobre');
  });
});

describe('departDeclare', () => {
  // Arrivée le mardi 20/10 à 11:02, heure de Paris (UTC+2 en octobre avant le 25)
  const debut = '2026-10-20T09:02:00Z';
  it('place l’heure saisie le jour de l’arrivée, à l’heure de Paris', () => {
    expect(departDeclare(debut, '2215')).toBe('2026-10-20T20:15:00.000Z');
  });
  it('passe au lendemain quand l’heure saisie précède l’arrivée (départ après minuit)', () => {
    expect(departDeclare('2026-10-20T16:00:00Z', '0030')).toBe('2026-10-20T22:30:00.000Z');
  });
  it('tient compte du passage à l’heure d’hiver (UTC+1 après le 25/10)', () => {
    expect(departDeclare('2026-10-26T10:00:00Z', '2200')).toBe('2026-10-26T21:00:00.000Z');
  });
  it('refuse une saisie incomplète ou une heure qui n’existe pas', () => {
    expect(departDeclare(debut, '221')).toBe(null);
    expect(departDeclare(debut, '2460')).toBe(null);
    expect(departDeclare(debut, '1275')).toBe(null);
    expect(departDeclare(debut, '')).toBe(null);
  });
  it('n’accepte jamais un départ égal à l’arrivée', () => {
    expect(departDeclare(debut, '1102')).toBe('2026-10-21T09:02:00.000Z');
  });
});

describe('messageRegularisation', () => {
  const oubli = { id: 'x', jour: '2026-10-20', debut: '2026-10-20T09:02:00Z' };
  it('confirme le départ déclaré, avec le jour de l’oubli', () => {
    expect(messageRegularisation({ action: 'regularise', salarie: 'Salarié A', heure: '2026-10-20T20:15:00Z' }, oubli))
      .toEqual({ ok: true, texte: 'Merci, départ du mardi 20 octobre enregistré à 22:15.' });
  });
  it('reste sur le code quand il est faux', () => {
    expect(messageRegularisation({ action: 'erreur', motif: 'code_invalide' }, oubli))
      .toEqual({ ok: false, etape: 'code', texte: 'Code incorrect. Réessaie.' });
  });
  it('renvoie vers l’heure quand le serveur la refuse', () => {
    const m = messageRegularisation({ action: 'erreur', motif: 'heure_invalide' }, oubli);
    expect(m.ok).toBe(false);
    expect(m.etape).toBe('heure');
    expect(m.texte).toMatch(/^Heure refusée/);
  });
  it('signale un oubli déjà corrigé par le responsable, sans erreur', () => {
    expect(messageRegularisation({ action: 'erreur', motif: 'presence_non_regularisable' }, oubli))
      .toEqual({ ok: true, texte: 'Cet oubli a déjà été corrigé par le responsable.' });
  });
  it('bloque après trop d’essais', () => {
    expect(messageRegularisation({ action: 'erreur', motif: 'trop_de_tentatives' }, oubli))
      .toEqual({ ok: false, texte: 'Trop d’essais. Patiente quelques minutes.' });
  });
  it('ne prétend jamais avoir régularisé sur une réponse inattendue', () => {
    expect(messageRegularisation(null, oubli).ok).toBe(false);
    expect(messageRegularisation({ action: 'autre' }, oubli).ok).toBe(false);
  });
});

// ─── Déclaration d'une tablette comme borne ───────────────────────
// enregistrer_appareil() (migrations 10 et 10c) exige un jeton d'au moins 32 caractères
// et un lieu ouvert. Le jeton n'est stocké qu'en empreinte : il reste sur la tablette.

describe('genererJeton', () => {
  it('produit 64 caractères hexadécimaux', () => {
    const j = genererJeton();
    expect(j).toMatch(/^[0-9a-f]{64}$/);
  });
  it('ne produit pas deux fois le même jeton', () => {
    expect(genererJeton()).not.toBe(genererJeton());
  });
  it('utilise la source d’aléa fournie', () => {
    const sourceNulle = { getRandomValues: (o) => o.fill(0) };
    expect(genererJeton(sourceNulle)).toBe('0'.repeat(64));
  });
});

describe('jetonValide', () => {
  it('exige au moins 32 caractères, comme la fonction SQL', () => {
    expect(jetonValide('a'.repeat(32))).toBe(true);
    expect(jetonValide('a'.repeat(31))).toBe(false);
    expect(jetonValide('')).toBe(false);
    expect(jetonValide(null)).toBe(false);
  });
});

describe('messageErreurAppareil', () => {
  it('traduit chaque refus de enregistrer_appareil()', () => {
    expect(messageErreurAppareil('jeton trop court')).toMatch(/jeton/i);
    expect(messageErreurAppareil('lieu inconnu ou ferme')).toMatch(/lieu/i);
    expect(messageErreurAppareil('non autorise')).toMatch(/gérant/);
  });
  it('n’affiche jamais le message technique brut', () => {
    const brut = 'permission denied for function enregistrer_appareil';
    expect(messageErreurAppareil(brut)).not.toContain('permission denied');
    expect(messageErreurAppareil(brut)).toMatch(/pas pu être déclarée/);
    expect(messageErreurAppareil()).toMatch(/pas pu être déclarée/);
  });
});
