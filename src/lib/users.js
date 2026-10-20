/**
 * Index de l'utilisateur dont l'email correspond au compte réellement connecté.
 * Renvoie -1 si aucune correspondance (ex. gérant externe sans email en base).
 * Comparaison insensible à la casse et aux espaces ; un email vide ne matche rien.
 */
export function findUserIndexByEmail(users, email) {
  const e = (email || '').trim().toLowerCase();
  if (!e) return -1;
  return (users || []).findIndex(u => (u.email || '').trim().toLowerCase() === e);
}

/**
 * Issue d'une tentative de suppression d'un salarié.
 * 23503 = violation de clé étrangère : il a un historique (présences) qui doit survivre,
 * donc on le désactive au lieu de le supprimer. Toute autre erreur est remontée telle quelle.
 */
export function issueSuppressionSalarie(error) {
  if (!error) return 'supprime';
  if (error.code === '23503') return 'desactiver';
  return 'erreur';
}

/** Un salarié est actif sauf si sa fiche dit explicitement le contraire (gérant externe : pas de champ). */
export function estActif(emp) {
  return emp?.active !== false;
}

/**
 * Un ancien salarié reste affiché sur une période (planning, équipe du jour) si elle commence
 * au plus tard à sa date de fin, ou si un créneau est saisi pour lui sur la période : on ne
 * masque jamais une donnée existante. Dates au format AAAA-MM-JJ, comparées en texte.
 */
export function visibleSurPeriode(emp, debut, fin, creneaux) {
  if (estActif(emp)) return true;
  if (emp.dateFin && emp.dateFin >= debut) return true;
  return Object.entries(creneaux || {}).some(([jour, shift]) => shift && jour >= debut && jour <= fin);
}

/** Date proposée pour une fin de contrat : celle du CDD si elle est déjà passée, sinon aujourd'hui. */
export function dateFinParDefaut(dateFin, today) {
  return dateFin && dateFin <= today ? dateFin : today;
}

/** Salariés désactivés, départ le plus récent en premier, ceux sans date en dernier. */
export function anciensSalaries(employees) {
  return (employees || [])
    .filter(emp => !estActif(emp))
    .sort((a, b) => (b.dateFin || '').localeCompare(a.dateFin || ''));
}
