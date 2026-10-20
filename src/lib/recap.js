// src/lib/recap.js
// Agrégation pure des présences pour le récap mensuel (spec §6).
// Aucun accès Supabase. Les entrées sont des présences déjà chargées.
import {
  dureeMinutes, qualiteHeures, repasDuJour, estAnomalie,
} from './pointage.js';

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

function grouperPar(liste, cle) {
  const groupes = new Map();
  for (const element of liste) {
    const k = cle(element);
    if (!groupes.has(k)) groupes.set(k, []);
    groupes.get(k).push(element);
  }
  return groupes;
}

const JOUR_MS = 24 * 3600 * 1000;
const iso = (d) => d.toISOString().slice(0, 10);

// Clés ISO de TOUTES les semaines civiles rattachées à ce mois, qu'il y ait eu des
// présences ou non. On parcourt les lundis, du lundi qui précède le 1er jusqu'au dernier
// jour du mois, et on garde ceux que `moisDeRattachement` rattache au mois : strictement
// la même règle que le filtre des présences.
export function semainesDuMois(mois, regleSemaine = 'mois_fin') {
  return lundisDuMois(mois, regleSemaine).map((lundi) => cleSemaine(lundi));
}

function lundisDuMois(mois, regleSemaine) {
  if (typeof mois !== 'string' || !/^\d{4}-\d{2}$/.test(mois) || !dateValide(`${mois}-01`)) {
    throw new Error('semainesDuMois : mois invalide : ' + mois);
  }
  const premier = dateValide(`${mois}-01`);
  const dernier = new Date(Date.UTC(premier.getUTCFullYear(), premier.getUTCMonth() + 1, 0, 12));
  const lundi = new Date(premier.getTime() - ((premier.getUTCDay() + 6) % 7) * JOUR_MS);
  const lundis = [];
  for (let d = lundi; d <= dernier; d = new Date(d.getTime() + 7 * JOUR_MS)) {
    if (moisDeRattachement(iso(d), regleSemaine) === mois) lundis.push(iso(d));
  }
  return lundis;
}

// Valide le contrat avec les mêmes règles que heuresSupplementaires (0 accepté).
function contratValide(v) {
  return v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0;
}

const enHeures = (minutes) => Math.round((minutes / 60) * 100) / 100;

// Récap d'un salarié pour un mois (format 'AAAA-MM'), prêt pour le comptable.
// ATTENTION : le mois ne filtre PAS sur le jour calendaire, mais sur le MOIS DE
// RATTACHEMENT DE LA SEMAINE. Sans ça, la semaine du 28 septembre au 4 octobre serait
// tronquée à deux jours dans le récap de septembre, et ses heures supplémentaires
// calculées sur une semaine incomplète, donc sous-estimées (spec §6.2).
export function recapMensuel({
  salarie, presences = [], mois, creneaux, regleSemaine = 'mois_fin',
}) {
  if (!contratValide(salarie?.heures_hebdo)) {
    throw new Error('contrat manquant ou invalide pour '
      + (salarie?.name || salarie?.id) + ' : ' + salarie?.heures_hebdo);
  }
  const duMois = presences
    .filter((p) => p.employee_id === salarie.id
      && moisDeRattachement(p.jour, regleSemaine) === mois)
    .sort((a, b) => String(a.debut).localeCompare(String(b.debut)));

  const qualite = qualiteHeures(duMois);

  const parJour = grouperPar(duMois, (p) => p.jour);
  let repasMidi = 0;
  let repasSoir = 0;
  const jours = [];
  for (const [jour, presencesDuJour] of [...parJour.entries()].sort()) {
    const repas = repasDuJour(presencesDuJour, creneaux);
    repasMidi += repas.midi;
    repasSoir += repas.soir;
    jours.push({
      jour,
      presences: presencesDuJour,
      minutes: presencesDuJour.reduce((t, p) => t + (estAnomalie(p) ? 0 : dureeMinutes(p)), 0),
      repas,
    });
  }

  const parSemaine = grouperPar(jours, (j) => cleSemaine(j.jour));
  const semaines = [...parSemaine.entries()].sort().map(([cle, joursSemaine]) => {
    const heures = enHeures(joursSemaine.reduce((t, j) => t + j.minutes, 0));
    return { cle, heures, ...heuresSupplementaires(heures, salarie.heures_hebdo) };
  });

  const heuresTotales = enHeures(qualite.minutesTotales);

  // Contrat du mois = semaines CIVILES du mois, pas seulement celles où le salarié a pointé,
  // sinon une absence réduirait le contrat et masquerait l'écart.
  // Semaine partielle (entrée ou sortie en cours de semaine) comptée entière : à confirmer avec le comptable.
  const semainesContrat = lundisDuMois(mois, regleSemaine).filter((lundi) => {
    const dimanche = iso(new Date(dateValide(lundi).getTime() + 6 * JOUR_MS));
    if (salarie.date_entree && dimanche < salarie.date_entree) return false;
    if (salarie.date_fin && lundi > salarie.date_fin) return false;
    return true;
  });
  const heuresContractuellesMois = enHeures(
    Number(salarie.heures_hebdo) * semainesContrat.length * 60,
  );

  return {
    salarie,
    mois,
    jours,
    semaines,
    heuresTotales,
    heuresPointees: enHeures(qualite.minutesPointees),
    heuresDeclarees: enHeures(qualite.minutesDeclarees),
    qualite,
    repas: { midi: repasMidi, soir: repasSoir, total: repasMidi + repasSoir },
    anomalies: duMois.filter(estAnomalie),
    // Écart au CONTRAT, pas au planning : le planning n'est pas tenu à l'avance,
    // le comptable ne doit pas voir d'écarts imaginaires (spec §6, décision).
    heuresContractuellesMois,
    // Lot 1 : l'écart inclut les absences justifiées (congés, arrêts), que le lot 1 ne connaît pas (spec §2).
    ecartContratHeures: Math.round((heuresTotales - heuresContractuellesMois) * 100) / 100,
  };
}
