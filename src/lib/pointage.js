// src/lib/pointage.js
// Logique pure du pointage (spec §6). Aucun accès Supabase, aucun JSX.
// Une présence = { id, employee_id, jour, debut, fin, statut, debut_origine, fin_origine }
// debut et fin sont des chaînes ISO ; fin peut être null (présence en cours ou anomalie).

const FUSEAU = 'Europe/Paris';

// Le jour de rattachement est TOUJOURS celui du début : un service qui finit à 00h30
// est une seule journée de travail, pas deux (spec §6.5).
export function jourDeRattachement(debutISO) {
  const d = debutISO ? new Date(debutISO) : null;
  if (!d || Number.isNaN(d.getTime())) {
    throw new Error('jourDeRattachement : date de début invalide');
  }
  // en-CA donne directement le format AAAA-MM-JJ
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSEAU, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

// Minutes entières, arrondies à la minute la plus proche pour chaque présence (les horodatages restent exacts en base, spec §6.6). Une présence sans fin vaut 0 :
// on ne devine pas une heure de départ, on la déclare en anomalie (spec §6.7).
export function dureeMinutes(presence) {
  if (!presence?.debut || !presence?.fin) return 0;
  const delta = new Date(presence.fin).getTime() - new Date(presence.debut).getTime();
  if (!Number.isFinite(delta) || delta <= 0) return 0;
  return Math.round(delta / 60000);
}
