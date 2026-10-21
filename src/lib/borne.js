// Logique pure de la borne de pointage (spec §5.1 et §8). Aucun accès Supabase :
// les réponses des fonctions pointer() et etat_pointage() sont traduites ici en textes.

/** Libellé du bouton UNIQUE, déduit de etat_pointage(). null tant que l'état est inconnu. */
export function libelleBouton(etat) {
  if (!etat) return null;
  return etat.en_poste ? 'DÉPART' : 'ARRIVÉE';
}

/** « 45 min » ou « 2 h 05 ». Jamais négatif, jamais NaN. */
export function dureeLisible(minutes) {
  const total = Math.max(0, Math.floor(Number(minutes) || 0));
  if (total < 60) return `${total} min`;
  return `${Math.floor(total / 60)} h ${String(total % 60).padStart(2, '0')}`;
}

/** Minutes écoulées depuis une heure ISO (durée en poste affichée sur le clavier). */
export function minutesDepuis(iso, maintenant = Date.now()) {
  return (maintenant - new Date(iso).getTime()) / 60000;
}

/** Heure de Paris, quelle que soit l'horloge de l'appareil : l'heure vient du serveur. */
export function heureParis(iso) {
  return new Date(iso).toLocaleTimeString('fr-FR',
    { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
}

/**
 * Traduit la réponse de pointer(). Le code faux revient en VALEUR et non en exception
 * (voir la migration 10) : sinon le compteur de tentatives serait annulé avec la transaction.
 */
export function messagePointage(data, avecPhoto) {
  const sansPhoto = !avecPhoto;
  switch (data?.action) {
    case 'arrivee':
      return { ok: true, texte: `Bonjour ${data.salarie}, arrivée enregistrée à ${heureParis(data.heure)}`, sansPhoto };
    case 'depart':
      return {
        ok: true,
        texte: `Au revoir ${data.salarie}, départ enregistré à ${heureParis(data.heure)} (${dureeLisible(data.minutes)} de présence)`,
        sansPhoto,
      };
    case 'ignore':
      return { ok: true, texte: 'Pointage déjà enregistré à l’instant.', sansPhoto };
    case 'erreur':
      return {
        ok: false,
        texte: data.motif === 'trop_de_tentatives'
          ? 'Trop d’essais. Patiente quelques minutes.'
          : 'Code incorrect. Réessaie.',
      };
    default:
      return { ok: false, texte: messageErreurBorne() };
  }
}

/** Erreur levée par une fonction de la borne : jamais le message technique brut. */
export function messageErreurBorne(brut = '') {
  if (brut.includes('appareil non autorise')) return 'Cet appareil n’est pas la borne de pointage.';
  return 'Pointage indisponible, rien n’a été enregistré. Préviens le responsable.';
}
