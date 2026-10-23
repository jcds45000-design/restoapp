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

// ─── Code de pointage (PIN) ───────────────────────────────────────
// Contrat repris de definir_pin() (migration 10) : 4 à 6 chiffres, unique sur TOUS
// les salariés y compris les anciens, jamais relu. La borne accepte la même longueur.
// Ces fonctions ne valident rien à la place du serveur : elles évitent un aller-retour
// et donnent au gérant un message lisible.

/** Un code valide est fait de 4 à 6 chiffres, sans espace ni autre caractère. */
export function codePinValide(code) {
  return /^[0-9]{4,6}$/.test(code || '');
}

/**
 * Code devinable par un collègue : même chiffre répété, ou suite croissante ou
 * décroissante. Le serveur les accepte ; on prévient sans bloquer, parce qu'un code
 * facile permet de pointer à la place de quelqu'un d'autre.
 */
export function codePinFaible(code) {
  if (!codePinValide(code)) return false;
  const c = [...code].map(Number);
  const identiques = c.every((n) => n === c[0]);
  const suite = (pas) => c.every((n, i) => i === 0 || n === c[i - 1] + pas);
  return identiques || suite(1) || suite(-1);
}

/** Refus de definir_pin() traduit pour le gérant : jamais le message technique brut. */
export function messageErreurPin(brut = '') {
  const m = String(brut || '');
  if (m.includes('le code doit faire 4 a 6 chiffres')) return 'Le code doit faire 4 à 6 chiffres.';
  if (m.includes('ce code est deja utilise')) return 'Ce code est déjà utilisé par un autre salarié, même ancien. Choisis-en un autre.';
  if (m.includes('non autorise')) return 'Seul le gérant peut attribuer un code de pointage.';
  if (m.includes('salarie inconnu')) return 'Fiche introuvable : enregistre d’abord la fiche du salarié.';
  return 'Le code n’a pas pu être enregistré. Réessaie.';
}
