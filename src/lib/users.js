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
