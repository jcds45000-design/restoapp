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
const arrondi = (h) => Math.round(h * 100) / 100;

// Absences telles que le Planning les enregistre (table schedule, colonne shift).
// « conge » est l'ancienne valeur du schéma d'origine.
const TYPES_ABSENCE = { conges: 'conges', conge: 'conges', maladie: 'maladie', absence: 'injustifiees' };
// Une journée d'absence justifiée vaut l'horaire hebdomadaire divisé par ce nombre de jours.
// 5 = jours ouvrés. À confirmer avec le comptable (ouvrables : 6).
const JOURS_TRAVAILLES_PAR_SEMAINE = 5;

function lundiDe(jour) {
  const d = dateValide(jour);
  if (!d) return null;
  return iso(new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * JOUR_MS));
}

// Le planning récent ne porte que le nom ; l'identifiant, quand il est là, fait foi.
function absenceDuSalarie(a, salarie) {
  return a?.employee_id ? a.employee_id === salarie.id : a?.employee_name === salarie.name;
}

// Salariés à faire figurer dans le récap : les actifs, plus tout ancien salarié qui a pointé
// ou dont une absence est posée au planning sur la période chargée. Sans ce dernier cas,
// un mois passé perdrait les absences des salariés partis depuis (constaté sur mai 2026).
export function salariesDuRecap(employees = [], presences = [], absences = []) {
  const aPointe = new Set(presences.map((p) => p.employee_id));
  return employees.filter((e) => e.active !== false || aPointe.has(e.id)
    || absences.some((a) => TYPES_ABSENCE[a?.shift] && absenceDuSalarie(a, e)));
}

// Récap d'un salarié pour un mois (format 'AAAA-MM'), prêt pour le comptable.
// ATTENTION : le mois ne filtre PAS sur le jour calendaire, mais sur le MOIS DE
// RATTACHEMENT DE LA SEMAINE. Sans ça, la semaine du 28 septembre au 4 octobre serait
// tronquée à deux jours dans le récap de septembre, et ses heures supplémentaires
// calculées sur une semaine incomplète, donc sous-estimées (spec §6.2).
export function recapMensuel({
  salarie, presences = [], mois, creneaux, regleSemaine = 'mois_fin', absences = [],
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
  let repasHorsPointe = 0;
  const jours = [];
  for (const [jour, presencesDuJour] of [...parJour.entries()].sort()) {
    const repas = repasDuJour(presencesDuJour, creneaux);
    repasMidi += repas.midi;
    repasSoir += repas.soir;
    repasHorsPointe += repas.horsPointe;
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

  // Absences posées au planning, sur les seules semaines sous contrat du mois.
  // Un jour saisi deux fois ne compte qu'une fois.
  const lundisContrat = new Set(semainesContrat);
  const typeParJour = new Map();
  for (const a of absences) {
    const type = TYPES_ABSENCE[a?.shift];
    if (!type || !absenceDuSalarie(a, salarie) || !lundisContrat.has(lundiDe(a.date))) continue;
    typeParJour.set(a.date, type);
  }
  const compteAbsences = { conges: 0, maladie: 0, injustifiees: 0 };
  const joursJustifiesParSemaine = new Map();
  for (const [jour, type] of typeParJour) {
    compteAbsences[type] += 1;
    if (type === 'injustifiees') continue;
    const lundi = lundiDe(jour);
    joursJustifiesParSemaine.set(lundi, (joursJustifiesParSemaine.get(lundi) || 0) + 1);
  }
  // Congés et maladie sont retirés du contrat, jamais plus que le contrat de la semaine.
  // L'absence injustifiée n'est pas retirée : c'est un vrai manque d'heures.
  const hebdo = Number(salarie.heures_hebdo);
  const heuresAbsencesJustifiees = arrondi([...joursJustifiesParSemaine.values()].reduce(
    (t, n) => t + Math.min(hebdo, (n * hebdo) / JOURS_TRAVAILLES_PAR_SEMAINE), 0,
  ));

  return {
    salarie,
    mois,
    jours,
    semaines,
    heuresTotales,
    heuresPointees: enHeures(qualite.minutesPointees),
    heuresDeclarees: enHeures(qualite.minutesDeclarees),
    qualite,
    repas: {
      midi: repasMidi, soir: repasSoir, horsPointe: repasHorsPointe,
      total: repasMidi + repasSoir + repasHorsPointe,
    },
    anomalies: duMois.filter(estAnomalie),
    // Écart au CONTRAT, pas au planning : le planning n'est pas tenu à l'avance,
    // le comptable ne doit pas voir d'écarts imaginaires (spec §6, décision).
    heuresContractuellesMois,
    // Salariés mensualisés : horaire hebdo × 52 / 12, c'est la base PAYÉE. Elle est affichée
    // mais ne sert pas à l'écart : comparée à des semaines entières (4 ou 5 par mois), elle
    // produirait chaque mois un faux écart (décision JC du 24/10/2026, option A).
    baseMensualisee: arrondi((hebdo * 52) / 12),
    absences: compteAbsences,
    heuresAbsencesJustifiees,
    ecartContratHeures: arrondi(heuresTotales - (heuresContractuellesMois - heuresAbsencesJustifiees)),
  };
}

// Les heures sup se somment SEMAINE PAR SEMAINE. Les recalculer sur le total mensuel
// donnerait un résultat faux et favorable à l'employeur.
// Le contrat est validé en amont par recapMensuel : pas de repli à 0 ici, une valeur
// manquante doit rester visible (NaN) plutôt que d'être masquée.
// Chaque colonne est arrondie séparément à 0,01 h : « Heures totales » peut différer de 0,01 h de « dont pointées » + « dont déclarées ». Les minutes exactes restent en base (spec §6.6).
export function lignesExport(recaps = []) {
  return recaps.map((r) => ({
    salarie: r.salarie.name,
    mois: r.mois,
    heuresContrat: Number(r.salarie.heures_hebdo),
    heuresTotales: r.heuresTotales,
    heuresPointees: r.heuresPointees,
    heuresDeclarees: r.heuresDeclarees,
    heuresSupplementaires: Math.round(
      r.semaines.reduce((t, s) => t + s.supplementaires, 0) * 100,
    ) / 100,
    heuresComplementaires: Math.round(
      r.semaines.reduce((t, s) => t + s.complementaires, 0) * 100,
    ) / 100,
    repasMidi: r.repas.midi,
    repasSoir: r.repas.soir,
    repasHorsPointe: r.repas.horsPointe ?? 0,
    repasTotal: r.repas.total,
    joursConges: r.absences?.conges ?? 0,
    joursMaladie: r.absences?.maladie ?? 0,
    joursAbsenceInjustifiee: r.absences?.injustifiees ?? 0,
    anomalies: r.qualite.anomalies,
    fiabilitePct: r.qualite.tauxFiabilite,
  }));
}

const COLONNES = [
  ['salarie', 'Salarié'],
  ['heuresTotales', 'Heures totales'],
  ['heuresContrat', 'Heures contrat/semaine'],
  ['heuresSupplementaires', 'Heures supplémentaires'],
  ['heuresComplementaires', 'Heures complémentaires'],
  ['repasMidi', 'Repas midi'],
  ['repasSoir', 'Repas soir'],
  ['repasHorsPointe', 'Repas hors pointe (5 h)'],
  ['repasTotal', 'Repas total'],
  ['joursConges', 'Congés (jours)'],
  ['joursMaladie', 'Maladie (jours)'],
  ['joursAbsenceInjustifiee', 'Absences injustifiées (jours)'],
  ['heuresPointees', 'dont pointées'],
  ['heuresDeclarees', 'dont déclarées après coup'],
  ['anomalies', 'Anomalies non résolues'],
  ['fiabilitePct', 'Fiabilité %'],
];

// Point-virgule et virgule décimale : c'est ce qu'attend Excel en configuration française.
// Un CSV à la virgule s'ouvrirait en une seule colonne chez le comptable.
export function versCSV(lignes = []) {
  // Texte : d'abord neutraliser un début de formule (Excel l'évaluerait à l'ouverture),
  // puis entourer de guillemets si la cellule contient un séparateur, un guillemet ou un saut de ligne.
  const format = (valeur) => {
    if (typeof valeur === 'number') return String(valeur).replace('.', ',');
    let texte = String(valeur ?? '');
    if (/^[=+\-@\t\r]/.test(texte)) texte = `'${texte}`;
    return /[;"\r\n]/.test(texte) ? `"${texte.replace(/"/g, '""')}"` : texte;
  };
  const entete = COLONNES.map(([, libelle]) => libelle).join(';');
  const corps = lignes.map((l) => COLONNES.map(([cle]) => format(l[cle])).join(';'));
  return [entete, ...corps].join('\n');
}

// Fenêtre de lecture des présences pour un mois de récap. Le récap rattache une semaine
// entière au mois qui la porte : il faut donc charger un peu avant et un peu après le
// mois civil, sinon la semaine à cheval arriverait tronquée et ses heures
// supplémentaires seraient sous-estimées. Sept jours suffisent des deux côtés.
export function fenetreChargement(mois) {
  if (typeof mois !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(mois)) return null;
  const [an, m] = mois.split('-').map(Number);
  const premier = Date.UTC(an, m - 1, 1);
  const dernier = Date.UTC(an, m, 0);
  return {
    debut: iso(new Date(premier - 7 * JOUR_MS)),
    fin: iso(new Date(dernier + 7 * JOUR_MS)),
  };
}
