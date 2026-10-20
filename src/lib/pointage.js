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

// Minutes entières, arrondies à la minute la plus proche pour chaque présence
// (les horodatages restent exacts en base, spec §6.6). Une présence sans fin vaut 0 :
// on ne devine pas une heure de départ, on la déclare en anomalie (spec §6.7).
export function dureeMinutes(presence) {
  if (!presence?.debut || !presence?.fin) return 0;
  const delta = new Date(presence.fin).getTime() - new Date(presence.debut).getTime();
  if (!Number.isFinite(delta) || delta <= 0) return 0;
  return Math.round(delta / 60000);
}

// Une présence n'est « mesurée » que si ses DEUX bouts ont été pointés sur la borne
// au moment où ça se passait. Tout le reste est du déclaratif : croyable, invérifiable.
export function estMesuree(presence) {
  return presence?.debut_origine === 'borne' && presence?.fin_origine === 'borne'
    && !presence?.corrigee;
}

// Une anomalie ne vaut AUCUNE minute : ni estimée, ni complétée depuis le planning
// (spec §3). C'est ce qui empêche le système de produire un total propre et faux.
export function estAnomalie(presence) {
  // Une présence en cours (salarié en poste) n'est pas une anomalie (spec §4.2).
  if (estEnCours(presence)) return false;
  if (!presence?.fin) return true;
  if (presence.statut === 'anomalie' || presence.fin_origine === 'cloture_auto') return true;
  // Une fin absente de sens (invalide, égale ou antérieure au début) ne doit pas
  // disparaître en silence : elle est signalée.
  const debut = new Date(presence.debut).getTime();
  const fin = new Date(presence.fin).getTime();
  return !(Number.isFinite(debut) && Number.isFinite(fin) && fin > debut);
}

export function estEnCours(presence) {
  return presence?.statut === 'ouverte' && !presence?.fin;
}

// Sépare ce qui a été mesuré de ce qui a été déclaré, et compte les trous.
// Les trois valeurs sont rendues distinctes : le récap ne les additionne jamais.
export function qualiteHeures(presences = []) {
  let minutesPointees = 0;
  let minutesDeclarees = 0;
  let anomalies = 0;
  let enCours = 0;

  for (const presence of presences) {
    if (estEnCours(presence)) { enCours += 1; continue; }
    if (estAnomalie(presence)) { anomalies += 1; continue; }
    const minutes = dureeMinutes(presence);
    if (estMesuree(presence)) minutesPointees += minutes;
    else minutesDeclarees += minutes;
  }

  const minutesTotales = minutesPointees + minutesDeclarees;
  return {
    minutesPointees,
    minutesDeclarees,
    anomalies,
    enCours,
    // Somme pointées + déclarées : sert aux seuils hebdomadaires et au taux. Ne JAMAIS l'afficher seule dans le récap (spec §5.3).
    minutesTotales,
    // Part réellement mesurée du total. Un taux bas veut dire que le chiffre ne vaut rien,
    // et c'est une information aussi importante que le chiffre lui-même.
    tauxFiabilite: minutesTotales === 0 ? 0
      : Math.round((minutesPointees / minutesTotales) * 100),
  };
}

// Minutes écoulées depuis minuit, en heure de Paris, pour un instant ISO donné.
function minutesLocales(iso) {
  const parties = new Intl.DateTimeFormat('fr-FR', {
    timeZone: FUSEAU, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const h = Number(parties.find((p) => p.type === 'hour').value);
  const m = Number(parties.find((p) => p.type === 'minute').value);
  return h * 60 + m;
}

function enMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// Chevauchement STRICT : partir à 11h30 pile quand le service commence à 11h30
// ne donne pas droit à un repas.
function chevauche(presence, debutCreneau, finCreneau) {
  const debut = minutesLocales(presence.debut);
  let fin = minutesLocales(presence.fin);
  // Service qui déborde sur le lendemain : on prolonge au-delà de minuit.
  if (fin <= debut) fin += 24 * 60;
  return debut < finCreneau && fin > debutCreneau;
}

// Un repas par service effectivement travaillé, quel que soit le nombre de présences
// (spec §6.4). La coupure produit deux présences et deux repas, la journée continue
// produit une présence et deux repas.
export function repasDuJour(presencesDuJour = [], creneaux) {
  const midiDebut = enMinutes(creneaux.midiDebut);
  const midiFin = enMinutes(creneaux.midiFin);
  const soirDebut = enMinutes(creneaux.soirDebut);
  const soirFin = enMinutes(creneaux.soirFin);

  let midi = 0;
  let soir = 0;
  for (const presence of presencesDuJour) {
    // Anomalie ou présence en cours : pas de fin connue, donc pas de repas deviné.
    if (estAnomalie(presence) || estEnCours(presence)) continue;
    if (chevauche(presence, midiDebut, midiFin)) midi = 1;
    if (chevauche(presence, soirDebut, soirFin)) soir = 1;
  }
  return { midi, soir, total: midi + soir };
}
