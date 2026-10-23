// Horaires du pointage par lieu, jour de la semaine et date d'effet (migration 10c).
// Logique pure : la carte « Horaires du pointage » et le récap s'appuient dessus.
// Une ligne de pointage_horaires vaut pour un lieu et un jour de la semaine (1 = lundi)
// à partir de sa date d'effet, jusqu'à la date d'effet suivante.

// Identifiant FIXE du Restaurant (migration 10c), valeur par défaut des colonnes lieu_id.
export const LIEU_RESTAURANT = '00000000-0000-4000-8000-00000000a001';
export const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
export const CHAMPS = ['midi_debut', 'midi_fin', 'soir_debut', 'soir_fin', 'coupure_max', 'retour_soir'];

/** « 2026-10-21 », date de Paris, quelle que soit l'horloge de l'appareil. */
export function aujourdhuiParis(maintenant = new Date()) {
  return maintenant.toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
}

/** Jour de la semaine ISO (1 = lundi … 7 = dimanche) d'une date « AAAA-MM-JJ ». */
export function jourSemaine(dateIso) {
  const j = new Date(`${dateIso}T12:00:00Z`).getUTCDay();
  return j === 0 ? 7 : j;
}

/** « 21/10/2026 » à partir de « 2026-10-21 ». */
export function dateCourte(dateIso) {
  const [a, m, j] = String(dateIso).split('-');
  return `${j}/${m}/${a}`;
}

/** « 11:30:00 » (Postgres) ou « 11:30 » → « 11:30 » ; vide ou null → ''. */
export function hhmm(valeur) {
  return valeur ? String(valeur).slice(0, 5) : '';
}

/** Ligne applicable à un lieu et une date : date d'effet la plus récente sans dépasser la date. */
export function ligneApplicable(lignes, lieuId, dateIso) {
  const js = jourSemaine(dateIso);
  let retenue = null;
  for (const l of lignes) {
    if (l.lieu_id !== lieuId || Number(l.jour_semaine) !== js || l.date_effet > dateIso) continue;
    if (!retenue || l.date_effet > retenue.date_effet) retenue = l;
  }
  return retenue;
}

/** Semaine vide : 7 jours sans service ni coupure. */
export function semaineVide() {
  return JOURS.map((_, i) => ({ jour_semaine: i + 1, ...Object.fromEntries(CHAMPS.map(c => [c, ''])) }));
}

/** Les 7 lignes d'une version (même lieu, même date d'effet), au format du formulaire. */
export function semaineDeVersion(lignes, lieuId, dateEffet) {
  const semaine = semaineVide();
  for (const l of lignes) {
    if (l.lieu_id !== lieuId || l.date_effet !== dateEffet) continue;
    const jour = semaine[Number(l.jour_semaine) - 1];
    if (jour) for (const c of CHAMPS) jour[c] = hhmm(l[c]);
  }
  return semaine;
}

/**
 * Versions d'horaires d'un lieu, la plus récente d'abord, avec leur statut à la date
 * du jour : « a_venir », « en_vigueur » (la plus récente déjà commencée) ou « passee ».
 */
export function versionsDuLieu(lignes, lieuId, aujourdhui) {
  const parDate = new Map();
  for (const l of lignes) {
    if (l.lieu_id !== lieuId) continue;
    const v = parDate.get(l.date_effet) || { date_effet: l.date_effet, auteur: l.auteur || '', creee: l.created_at || '' };
    if ((l.created_at || '') > v.creee) { v.creee = l.created_at; v.auteur = l.auteur || ''; }
    parDate.set(l.date_effet, v);
  }
  const versions = [...parDate.values()].sort((a, b) => (a.date_effet < b.date_effet ? 1 : -1));
  let vigueurTrouvee = false;
  for (const v of versions) {
    if (v.date_effet > aujourdhui) v.statut = 'a_venir';
    else if (!vigueurTrouvee) { v.statut = 'en_vigueur'; vigueurTrouvee = true; }
    else v.statut = 'passee';
  }
  return versions;
}

/** Un jour sans midi ni soir n'a pas de service. */
export function estFerme(jour) {
  return !jour.midi_debut && !jour.midi_fin && !jour.soir_debut && !jour.soir_fin;
}

/** Recopie les horaires du lundi sur les 6 autres jours. */
export function copierLundi(semaine) {
  const lundi = semaine[0];
  return semaine.map((j, i) => (i === 0 ? j : { ...lundi, jour_semaine: j.jour_semaine }));
}

const avant = (a, b) => a < b; // « HH:MM » se compare comme du texte

/**
 * Erreurs d'une semaine saisie, en français, une par problème. Reprend les contraintes
 * de la table (paire complète, début avant fin) et ajoute : le soir commence après le midi.
 */
export function erreursSemaine(semaine) {
  const erreurs = [];
  semaine.forEach((j, i) => {
    const nom = JOURS[i];
    const paire = (deb, fin, quoi) => {
      if (Boolean(j[deb]) !== Boolean(j[fin])) erreurs.push(`${nom} : ${quoi} incomplet, il faut le début et la fin.`);
      else if (j[deb] && !avant(j[deb], j[fin])) erreurs.push(`${nom} : ${quoi}, le début doit précéder la fin.`);
    };
    paire('midi_debut', 'midi_fin', 'service du midi');
    paire('soir_debut', 'soir_fin', 'service du soir');
    if (j.midi_fin && j.soir_debut && j.midi_debut && j.soir_fin && avant(j.soir_debut, j.midi_fin)) {
      erreurs.push(`${nom} : le service du soir commence avant la fin du midi.`);
    }
    if (Boolean(j.coupure_max) !== Boolean(j.retour_soir)) {
      erreurs.push(`${nom} : coupure incomplète, il faut l’heure limite de départ et l’heure de retour.`);
    } else if (j.coupure_max && !avant(j.coupure_max, j.retour_soir)) {
      erreurs.push(`${nom} : coupure, le départ doit précéder le retour.`);
    }
  });
  return erreurs;
}

/** Semaine au format attendu par enregistrer_horaires() : heures « HH:MM » ou null. */
export function semainePourRpc(semaine) {
  return semaine.map(j => ({
    jour_semaine: j.jour_semaine,
    ...Object.fromEntries(CHAMPS.map(c => [c, j[c] || null])),
  }));
}

/** Traduit une erreur de enregistrer_horaires() ou enregistrer_lieu(). */
export function messageErreurHoraires(brut = '') {
  const m = String(brut);
  if (m.includes('date d effet passee')) return 'La date d’application ne peut pas être passée : le passé ne se réécrit pas.';
  if (m.includes('non autorise')) return 'Seul un gérant peut modifier les horaires.';
  if (m.includes('nom obligatoire')) return 'Donne un nom au lieu.';
  if (m.includes('lieu inconnu')) return 'Ce lieu n’existe plus. Recharge la page.';
  if (m.includes('check constraint') || m.includes('violates')) return 'Horaires incohérents : vérifie que chaque début précède sa fin.';
  if (m.includes('Failed to fetch') || m.includes('NetworkError')) return 'Pas de connexion. Réessaie.';
  return 'Enregistrement impossible. Réessaie.';
}
