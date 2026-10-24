import { describe, it, expect } from 'vitest';
import {
  aujourdhuiParis, jourSemaine, dateCourte, hhmm, ligneApplicable, semaineVide, semaineDeVersion,
  versionsDuLieu, estFerme, copierLundi, erreursSemaine, semainePourRpc, messageErreurHoraires,
} from './horaires';

const RESTO = 'resto';
const STAND = 'stand';
const ligne = (lieu, jour, date, extra = {}) => ({
  lieu_id: lieu, jour_semaine: jour, date_effet: date,
  midi_debut: '11:30:00', midi_fin: '14:30:00', soir_debut: '18:30:00', soir_fin: '22:00:00',
  coupure_max: '15:00:00', retour_soir: '18:00:00', auteur: 'migration 10c', created_at: '2026-10-21T10:00:00Z',
  ...extra,
});
const semaineDe = (lieu, date, extra) => [1, 2, 3, 4, 5, 6, 7].map(j => ligne(lieu, j, date, extra));

describe('aujourdhuiParis', () => {
  it('donne la date de Paris, même quand il est déjà demain à Paris mais pas en UTC', () => {
    expect(aujourdhuiParis(new Date('2026-10-21T22:30:00Z'))).toBe('2026-10-22');
    expect(aujourdhuiParis(new Date('2026-10-21T21:30:00Z'))).toBe('2026-10-21');
  });
});

describe('jourSemaine et dateCourte', () => {
  it('numérote du lundi (1) au dimanche (7)', () => {
    expect(jourSemaine('2026-10-19')).toBe(1);
    expect(jourSemaine('2026-10-21')).toBe(3);
    expect(jourSemaine('2026-10-25')).toBe(7);
  });
  it('affiche la date à la française', () => {
    expect(dateCourte('2026-11-27')).toBe('27/11/2026');
  });
});

describe('hhmm', () => {
  it('coupe les secondes de Postgres et rend vide pour null', () => {
    expect(hhmm('11:30:00')).toBe('11:30');
    expect(hhmm('18:00')).toBe('18:00');
    expect(hhmm(null)).toBe('');
  });
});

describe('ligneApplicable', () => {
  const lignes = [
    ...semaineDe(RESTO, '2026-01-01'),
    ...semaineDe(RESTO, '2026-11-02', { midi_debut: '12:00:00' }),
    ...semaineDe(STAND, '2026-11-27', { midi_debut: '10:00:00' }),
  ];
  it('retient la version déjà commencée la plus récente', () => {
    expect(ligneApplicable(lignes, RESTO, '2026-10-21').midi_debut).toBe('11:30:00');
    expect(ligneApplicable(lignes, RESTO, '2026-11-02').midi_debut).toBe('12:00:00');
    expect(ligneApplicable(lignes, RESTO, '2026-12-15').midi_debut).toBe('12:00:00');
  });
  it('ne mélange pas les lieux, et rend null avant la première version', () => {
    expect(ligneApplicable(lignes, STAND, '2026-11-26')).toBeNull();
    expect(ligneApplicable(lignes, STAND, '2026-11-28').midi_debut).toBe('10:00:00');
  });
  it('prend la ligne du bon jour de la semaine', () => {
    const l = [ligne(RESTO, 1, '2026-01-01'), ligne(RESTO, 3, '2026-01-01', { soir_debut: null, soir_fin: null })];
    expect(ligneApplicable(l, RESTO, '2026-10-21').soir_debut).toBeNull();
    expect(ligneApplicable(l, RESTO, '2026-10-19').soir_debut).toBe('18:30:00');
  });
});

describe('semaineDeVersion', () => {
  it('rend les 7 jours au format HH:MM, vides pour un service absent', () => {
    const lignes = semaineDe(RESTO, '2026-01-01');
    lignes[6] = { ...lignes[6], midi_debut: null, midi_fin: null, soir_debut: null, soir_fin: null, coupure_max: null, retour_soir: null };
    const s = semaineDeVersion(lignes, RESTO, '2026-01-01');
    expect(s).toHaveLength(7);
    expect(s[0]).toMatchObject({ jour_semaine: 1, midi_debut: '11:30', soir_fin: '22:00', coupure_max: '15:00', retour_soir: '18:00' });
    expect(estFerme(s[6])).toBe(true);
    expect(estFerme(s[0])).toBe(false);
  });
});

describe('versionsDuLieu', () => {
  const lignes = [
    ...semaineDe(RESTO, '2026-01-01'),
    ...semaineDe(RESTO, '2026-10-01', { auteur: 'gerant@kimiko.fr' }),
    ...semaineDe(RESTO, '2026-11-02', { auteur: 'gerant@kimiko.fr' }),
    ...semaineDe(STAND, '2026-11-27'),
  ];
  it('trie de la plus récente à la plus ancienne avec le bon statut', () => {
    const v = versionsDuLieu(lignes, RESTO, '2026-10-21');
    expect(v.map(x => [x.date_effet, x.statut])).toEqual([
      ['2026-11-02', 'a_venir'], ['2026-10-01', 'en_vigueur'], ['2026-01-01', 'passee'],
    ]);
    expect(v[0].auteur).toBe('gerant@kimiko.fr');
  });
  it('une version qui commence aujourd’hui est en vigueur', () => {
    expect(versionsDuLieu(lignes, RESTO, '2026-11-02')[0].statut).toBe('en_vigueur');
  });
  it('un lieu sans version n’a pas d’historique', () => {
    expect(versionsDuLieu(lignes, 'autre', '2026-10-21')).toEqual([]);
  });
});

describe('copierLundi', () => {
  it('recopie le lundi en gardant le numéro de chaque jour', () => {
    const s = semaineVide();
    s[0] = { ...s[0], midi_debut: '10:00', midi_fin: '14:00' };
    const c = copierLundi(s);
    expect(c[6]).toMatchObject({ jour_semaine: 7, midi_debut: '10:00', midi_fin: '14:00' });
    expect(c[0]).toBe(s[0]);
  });
});

describe('erreursSemaine', () => {
  const ok = () => semaineDeVersion(semaineDe(RESTO, '2026-01-01'), RESTO, '2026-01-01');
  it('accepte les horaires actuels et une semaine entièrement fermée', () => {
    expect(erreursSemaine(ok())).toEqual([]);
    expect(erreursSemaine(semaineVide())).toEqual([]);
  });
  it('accepte une journée sans coupure (journée continue)', () => {
    const s = ok();
    s[2] = { ...s[2], coupure_max: '', retour_soir: '' };
    expect(erreursSemaine(s)).toEqual([]);
  });
  it('refuse un service incomplet ou à l’envers', () => {
    const s = ok();
    s[0] = { ...s[0], midi_fin: '' };
    s[1] = { ...s[1], soir_debut: '23:00' };
    expect(erreursSemaine(s)).toEqual([
      'Lundi : service du midi incomplet, il faut le début et la fin.',
      'Mardi : service du soir, le début doit précéder la fin.',
    ]);
  });
  it('refuse un soir qui commence avant la fin du midi', () => {
    const s = ok();
    s[4] = { ...s[4], soir_debut: '14:00' };
    expect(erreursSemaine(s)).toEqual(['Vendredi : le service du soir commence avant la fin du midi.']);
  });
  it('refuse une coupure incomplète ou à l’envers', () => {
    const s = ok();
    s[5] = { ...s[5], retour_soir: '' };
    s[6] = { ...s[6], coupure_max: '19:00' };
    expect(erreursSemaine(s)).toEqual([
      'Samedi : coupure incomplète, il faut l’heure limite de départ et l’heure de retour.',
      'Dimanche : coupure, le départ doit précéder le retour.',
    ]);
  });
});

describe('semainePourRpc', () => {
  it('envoie null pour un champ vide', () => {
    const r = semainePourRpc(semaineVide());
    expect(r).toHaveLength(7);
    expect(r[0]).toEqual({ jour_semaine: 1, midi_debut: null, midi_fin: null, soir_debut: null, soir_fin: null, coupure_max: null, retour_soir: null });
  });
});

describe('messageErreurHoraires', () => {
  it('traduit les refus du serveur', () => {
    expect(messageErreurHoraires('date d effet passee')).toMatch(/passée/);
    expect(messageErreurHoraires('non autorise')).toMatch(/gérant/);
    expect(messageErreurHoraires('new row violates check constraint "x"')).toMatch(/incohérents/);
    expect(messageErreurHoraires('TypeError: Failed to fetch')).toMatch(/connexion/);
    expect(messageErreurHoraires('autre chose')).toBe('Enregistrement impossible. Réessaie.');
  });
});
