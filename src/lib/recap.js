// src/lib/recap.js
// Agrégation pure des présences pour le récap mensuel (spec §6).
// Aucun accès Supabase. Les entrées sont des présences déjà chargées.

// Date UTC à midi pour un jour AAAA-MM-JJ réel, sinon null (refuse aussi 2026-02-30).
function dateValide(jour) {
  if (typeof jour !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(jour)) return null;
  const d = new Date(`${jour}T12:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== jour) return null;
  return d;
}

// Semaine ISO 8601 : elle commence le lundi, et une semaine à cheval sur deux mois
// reste UNE semaine (spec §6.2). Sans ça, les compteurs d'heures sup sont faux.
export function cleSemaine(jour) {
  const d = dateValide(jour);
  if (!d) throw new Error('cleSemaine : jour invalide');
  const jourSemaine = (d.getUTCDay() + 6) % 7; // 0 = lundi
  d.setUTCDate(d.getUTCDate() - jourSemaine + 3); // jeudi de la semaine ISO
  const annee = d.getUTCFullYear();
  const premierJeudi = new Date(Date.UTC(annee, 0, 4));
  const decalage = (premierJeudi.getUTCDay() + 6) % 7;
  premierJeudi.setUTCDate(premierJeudi.getUTCDate() - decalage + 3);
  const numero = 1 + Math.round((d - premierJeudi) / (7 * 24 * 3600 * 1000));
  return `${annee}-W${String(numero).padStart(2, '0')}`;
}

// Mois auquel appartient la SEMAINE contenant ce jour. Une semaine n'est jamais coupée
// en deux par un changement de mois : elle est rattachée en entier, soit au mois de son
// lundi, soit au mois de son dimanche (réglage `semaine_a_cheval`, spec §4.3).
// Règle à confirmer avec le comptable, elle se change dans les réglages sans toucher au code.
export function moisDeRattachement(jour, regle = 'mois_fin') {
  if (regle !== 'mois_fin' && regle !== 'mois_debut') {
    throw new Error('regle de rattachement inconnue : ' + regle);
  }
  const d = dateValide(jour);
  if (!d) throw new Error('moisDeRattachement : jour invalide');
  const jourSemaine = (d.getUTCDay() + 6) % 7; // 0 = lundi
  const reference = new Date(d);
  reference.setUTCDate(reference.getUTCDate() - jourSemaine + (regle === 'mois_fin' ? 6 : 0));
  return reference.toISOString().slice(0, 7);
}

const DUREE_LEGALE_HEBDO = 35;

// Supplémentaires et complémentaires ne sont PAS la même chose et ne s'additionnent pas.
// Temps plein : au-delà de 35 h => supplémentaires.
// Temps partiel : au-delà du contrat et sous 35 h => complémentaires ; au-delà de 35 h
// => supplémentaires. Les deux peuvent coexister la même semaine.
function nombreValide(v) {
  return v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0;
}

// Le seuil des supplémentaires est 35 h pour TOUT contrat (spec §6.3). Un contrat à 0 h
// est accepté (extra) ; un contrat absent ou invalide lève une erreur, jamais de 35 h muet.
export function heuresSupplementaires(heuresFaites, heuresContrat) {
  if (!nombreValide(heuresContrat)) throw new Error('heures contractuelles invalides : ' + heuresContrat);
  if (!nombreValide(heuresFaites)) throw new Error('heures faites invalides : ' + heuresFaites);
  const contrat = Number(heuresContrat);
  const faites = Number(heuresFaites);
  const complementaires = contrat < DUREE_LEGALE_HEBDO
    ? Math.max(0, Math.min(faites, DUREE_LEGALE_HEBDO) - contrat)
    : 0;
  const supplementaires = Math.max(0, faites - DUREE_LEGALE_HEBDO);
  return {
    supplementaires: Math.round(supplementaires * 100) / 100,
    complementaires: Math.round(complementaires * 100) / 100,
  };
}
