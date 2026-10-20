// src/lib/recap.js
// Agrégation pure des présences pour le récap mensuel (spec §6).
// Aucun accès Supabase. Les entrées sont des présences déjà chargées.

// Semaine ISO 8601 : elle commence le lundi, et une semaine à cheval sur deux mois
// reste UNE semaine (spec §6.2). Sans ça, les compteurs d'heures sup sont faux.
export function cleSemaine(jour) {
  const d = new Date(`${jour}T12:00:00.000Z`);
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
  const d = new Date(`${jour}T12:00:00.000Z`);
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
export function heuresSupplementaires(heuresFaites, heuresContrat) {
  const contrat = Number(heuresContrat) || DUREE_LEGALE_HEBDO;
  const faites = Number(heuresFaites) || 0;
  const complementaires = contrat < DUREE_LEGALE_HEBDO
    ? Math.max(0, Math.min(faites, DUREE_LEGALE_HEBDO) - contrat)
    : 0;
  const supplementaires = Math.max(0, faites - Math.max(DUREE_LEGALE_HEBDO, contrat));
  return {
    supplementaires: Math.round(supplementaires * 100) / 100,
    complementaires: Math.round(complementaires * 100) / 100,
  };
}
