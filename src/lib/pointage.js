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

// Accepte "HH:MM" et "HH:MM:SS" (format time de Postgres). Tout le reste est refusé :
// un créneau illisible ne doit pas produire 0 repas en silence.
function enMinutes(hhmm) {
  if (typeof hhmm !== 'string' || !/^\d{1,2}:\d{2}(:\d{2})?$/.test(hhmm)) {
    throw new Error('creneau repas invalide : ' + hhmm);
  }
  const [h, m] = hhmm.split(':').map(Number);
  if (h > 23 || m > 59) throw new Error('creneau repas invalide : ' + hhmm);
  return h * 60 + m;
}

// Seuils de la convention collective restauration rapide (brochure 3245, art. repas §d),
// retenus par Jean-Claude le 23/10/2026.
const MINUTES_DANS_LA_POINTE = 60; // §d.1 : couvrir au moins 1 h d'une heure de pointe
const MINUTES_DANS_LA_JOURNEE = 5 * 60; // §d.2 : à défaut, 5 h de travail effectif, consécutives ou non

// Minutes passées dans le créneau. La fin se déduit de la durée réelle et non de l'heure
// affichée : un service qui finit après minuit reste ainsi d'un seul tenant.
function minutesDansCreneau(presence, debutCreneau, finCreneau) {
  const debut = minutesLocales(presence.debut);
  const fin = debut + dureeMinutes(presence);
  return Math.max(0, Math.min(fin, finCreneau) - Math.max(debut, debutCreneau));
}

// Droit au repas selon la convention : un repas par heure de pointe dans laquelle le salarié
// a travaillé au moins 1 h, présences du jour cumulées (la coupure produit deux présences et
// deux repas, la journée continue une présence et deux repas). S'il ne couvre aucune pointe,
// 5 h de travail dans la journée ouvrent un repas « hors pointe ». Un passage de quelques
// minutes ne donne donc rien (cas réel du 23/10/2026 : 3 minutes avaient produit un repas).
// Repas du jour de DÉBUT uniquement : une présence continue qui atteindrait le midi du lendemain n'est pas gérée (cas irréaliste, la clôture d'office à 14 h la passe en anomalie).
export function repasDuJour(presencesDuJour = [], creneaux) {
  if (!creneaux) throw new Error('creneaux repas manquants');
  const midiDebut = enMinutes(creneaux.midiDebut);
  const midiFin = enMinutes(creneaux.midiFin);
  const soirDebut = enMinutes(creneaux.soirDebut);
  const soirFin = enMinutes(creneaux.soirFin);

  let minutesMidi = 0;
  let minutesSoir = 0;
  let minutesJournee = 0;
  for (const presence of presencesDuJour) {
    // Anomalie ou présence en cours : pas de fin connue, donc pas de repas deviné.
    if (estAnomalie(presence) || estEnCours(presence)) continue;
    minutesMidi += minutesDansCreneau(presence, midiDebut, midiFin);
    minutesSoir += minutesDansCreneau(presence, soirDebut, soirFin);
    minutesJournee += dureeMinutes(presence);
  }
  const midi = minutesMidi >= MINUTES_DANS_LA_POINTE ? 1 : 0;
  const soir = minutesSoir >= MINUTES_DANS_LA_POINTE ? 1 : 0;
  const horsPointe = midi + soir === 0 && minutesJournee >= MINUTES_DANS_LA_JOURNEE ? 1 : 0;
  return { midi, soir, horsPointe, total: midi + soir + horsPointe };
}
