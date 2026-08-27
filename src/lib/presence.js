// Statuts de présence (Phase 0, spec §5).
// Sans pointage (il arrive en Phase 6), on ne peut savoir que ce que le PLANNING dit :
//   non_planifie : aucune ligne de planning ce jour-là — ce n'est PAS une absence
//   prevu        : un créneau de travail est planifié
//   repos / conge / arret : absence légitime, posée dans le planning
//   absent       : absence injustifiée, marquée MANUELLEMENT dans le planning
// « present » et « retard » seront déduits du pointage réel en Phase 6.

export function statutPresence(shift) {
  if (!shift) return 'non_planifie';
  if (shift === 'repos') return 'repos';
  if (shift === 'conges' || shift === 'conge') return 'conge';
  if (shift === 'maladie') return 'arret';
  if (shift === 'absence') return 'absent';
  return 'prevu';
}

export const PRESENCE_LABELS = {
  non_planifie: 'Non planifié',
  prevu: 'Prévu',
  repos: 'Repos',
  conge: 'Congés',
  arret: 'Arrêt',
  absent: 'Absent',
  present: 'Présent',
  retard: 'En retard',
};

// Synthèse d'une journée pour le cockpit : qui est prévu, qui manque, et si le
// planning n'est simplement pas saisi (cas à afficher comme information, pas comme alerte rouge).
export function syntheseJour(employees, schedule, date) {
  const parStatut = { non_planifie: [], prevu: [], repos: [], conge: [], arret: [], absent: [] };
  for (const emp of employees) {
    const st = statutPresence(schedule[emp.name]?.[date]);
    parStatut[st].push(emp.name);
  }
  return {
    parStatut,
    prevus: parStatut.prevu.length,
    absents: parStatut.absent.length,
    aucunPlanning: employees.length > 0 && parStatut.non_planifie.length === employees.length,
  };
}
