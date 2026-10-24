// src/lib/correction.js
// Logique pure des corrections de présences par le gérant. Aucun accès Supabase, aucun JSX.
// Les contrôles reprennent ceux de corriger_presence / ajouter_presence (migrations 10c, 10d) :
// la base reste juge, l'écran prévient seulement avant d'être refusé.

const FUSEAU = 'Europe/Paris';

export const MOTIFS = [
  'Oubli au départ',
  'Oubli à l’arrivée',
  'Erreur de pointage',
  'Coupure non pointée',
  'Autre',
];

// « 21:55 », « 21h55 », « 21h », « 2155 », « 955 » → « 21:55 » / « 09:55 ». null si illisible.
export function lireHeure(texte) {
  const s = String(texte ?? '').trim().toLowerCase().replace(/\s+/g, '');
  let m = s.match(/^(\d{1,2})[:h](\d{2})?$/);
  if (!m) {
    const n = s.match(/^(\d{1,2})(\d{2})$/);
    m = n ? [s, n[1], n[2]] : null;
  }
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

// Décalage de Paris (en minutes) à un instant donné : +60 l'hiver, +120 l'été.
function decalageParis(ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: FUSEAU, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const commeUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((commeUTC - Math.floor(ms / 1000) * 1000) / 60000);
}

// Heure murale de Paris → instant ISO. Juste aux changements d'heure, sans dépendre
// du fuseau de l'appareil qui affiche l'écran.
export function versInstant(jour, heure) {
  const j = String(jour ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const h = lireHeure(heure);
  if (!j || !h) return null;
  const [hh, mm] = h.split(':').map(Number);
  const mur = Date.UTC(+j[1], +j[2] - 1, +j[3], hh, mm);
  let ms = mur - decalageParis(mur) * 60000;
  ms = mur - decalageParis(ms) * 60000;
  return new Date(ms).toISOString();
}

// Instant ISO → { jour: 'AAAA-MM-JJ', heure: 'HH:MM' } à l'heure de Paris.
export function versChamps(iso) {
  if (!iso) return { jour: '', heure: '' };
  const d = new Date(iso);
  const jour = new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSEAU, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
  const heure = new Intl.DateTimeFormat('fr-FR', {
    timeZone: FUSEAU, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(d);
  return { jour, heure };
}

function lendemain(jour) {
  const d = new Date(`${jour}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// Le départ ne se saisit qu'en heure : s'il est plus tôt que l'arrivée, c'est le
// lendemain (service qui finit après minuit). Rend { debut, fin, finLendemain }.
export function instantsSaisis({ jour, heureDebut, heureFin }) {
  const debut = versInstant(jour, heureDebut);
  if (!debut) return { debut: null, fin: null, finLendemain: false };
  if (!String(heureFin ?? '').trim()) return { debut, fin: null, finLendemain: false };
  const memeJour = versInstant(jour, heureFin);
  if (!memeJour) return { debut, fin: undefined, finLendemain: false };
  if (memeJour > debut) return { debut, fin: memeJour, finLendemain: false };
  return { debut, fin: versInstant(lendemain(jour), heureFin), finLendemain: true };
}

// La borne enregistre les secondes, le formulaire n'affiche que les minutes. Une heure
// laissée telle quelle doit repartir avec son instant EXACT d'origine : sinon la base voit
// une arrivée « modifiée » de quelques secondes et la marque corrigée à tort.
const aLaMinute = (iso) => Math.floor(new Date(iso).getTime() / 60000);
export function garderOrigine(presence, { debut, fin }) {
  if (!presence) return { debut, fin };
  return {
    debut: debut && aLaMinute(debut) === aLaMinute(presence.debut) ? presence.debut : debut,
    fin: fin && presence.fin && aLaMinute(fin) === aLaMinute(presence.fin) ? presence.fin : fin,
  };
}

// « Oubli au départ : parti à 22 h, vu par Thomas ». « Autre » exige une précision.
export function composerMotif(type, precision) {
  const t = String(type ?? '').trim();
  const p = String(precision ?? '').trim();
  if (!t) return '';
  if (t === 'Autre') return p;
  return p ? `${t} : ${p}` : t;
}

// Même règle que la base : une présence sans fin occupe tout l'après si elle est ouverte,
// seulement l'instant de son arrivée si c'est une anomalie.
function finOccupee(p) {
  if (p.fin) return new Date(p.fin).getTime();
  return p.statut === 'ouverte' ? Infinity : new Date(p.debut).getTime() + 1;
}

export function chevauche({ debut, fin, resteOuverte }, autres = []) {
  const d = new Date(debut).getTime();
  const f = fin ? new Date(fin).getTime() : (resteOuverte ? Infinity : d + 1);
  return autres.some((p) => new Date(p.debut).getTime() < f && finOccupee(p) > d);
}

const minutes = (ms) => ms / 60000;

// Rend le premier problème en français, ou null si la saisie peut partir en base.
// mode 'corriger' : `presence` est la ligne d'origine. mode 'ajouter' : pas d'origine.
export function verifierSaisie({
  mode, presence, debut, fin, motif, autres = [], maintenant = Date.now(), heuresMax = 14,
}) {
  if (!debut) return 'Heure d’arrivée illisible : écrire par exemple 11:30.';
  if (fin === undefined) return 'Heure de départ illisible : écrire par exemple 22:00.';
  const d = new Date(debut).getTime();
  const f = fin ? new Date(fin).getTime() : null;
  if (d > maintenant) return 'L’arrivée est dans le futur.';
  if (f !== null && f > maintenant) return 'Le départ est dans le futur.';
  const enCours = mode === 'corriger' && presence?.statut === 'ouverte' && !presence?.fin;
  if (f === null) {
    if (mode === 'corriger' && !enCours) return 'Indiquer l’heure de départ : sans elle, la présence reste à 0 h.';
    if (mode === 'ajouter' && minutes(maintenant - d) > heuresMax * 60) {
      return 'Indiquer l’heure de départ : la personne ne peut plus être en poste depuis tout ce temps.';
    }
  }
  if (f !== null && minutes(f - d) > heuresMax * 60) {
    return `Plus de ${heuresMax} h d’affilée : vérifier le jour et les heures.`;
  }
  if (mode === 'corriger' && presence
    && new Date(presence.debut).getTime() === d
    && (presence.fin ? new Date(presence.fin).getTime() : null) === f) {
    return 'Rien n’a changé : modifier l’arrivée ou le départ.';
  }
  if (!String(motif ?? '').trim()) return 'Le motif est obligatoire : il reste dans l’historique pour le comptable.';
  const resteOuverte = mode === 'ajouter' ? f === null : enCours && f === null;
  const voisines = autres.filter((p) => p.id !== presence?.id);
  if (chevauche({ debut, fin, resteOuverte }, voisines)) {
    return 'Ces heures recouvrent une autre présence de la même personne : corriger plutôt celle-là.';
  }
  return null;
}

// Messages de la base (migrations 10, 10c, 10d) traduits pour l'écran.
const ERREURS = [
  ['non autorise', 'Seul un compte admin peut corriger un pointage.'],
  ['motif obligatoire', 'Le motif est obligatoire.'],
  ['chevauche', 'Ces heures recouvrent une autre présence de la même personne.'],
  ['aucune modification', 'Rien n’a changé.'],
  ['trop longue', 'Présence trop longue : vérifier le jour.'],
  ['debut dans le futur', 'L’arrivée est dans le futur.'],
  ['fin dans le futur', 'Le départ est dans le futur.'],
  ['fin anterieure', 'Le départ est avant l’arrivée.'],
  ['presence inconnue', 'Cette présence n’existe plus : recharger la page.'],
];
export function messageErreur(message) {
  const m = String(message ?? '');
  const trouve = ERREURS.find(([cle]) => m.includes(cle));
  return trouve ? trouve[1] : `Enregistrement refusé : ${m}`;
}

// Une entrée du journal d'audit → ce qui a bougé, lisible : ['arrivée 11:00 → 11:30', ...].
export function changementsLisibles(entree) {
  const avant = entree?.before || null;
  const apres = entree?.after || {};
  const h = (iso) => (iso ? versChamps(iso).heure : '—');
  const j = (iso) => (iso ? versChamps(iso).jour : '');
  const lignes = [];
  if (!avant) {
    lignes.push(`présence ajoutée : ${h(apres.debut)} → ${h(apres.fin)}`);
    return lignes;
  }
  // to_jsonb peut écrire le même instant de deux façons : on compare des instants.
  const ms = (iso) => (iso ? new Date(iso).getTime() : null);
  if (ms(avant.debut) !== ms(apres.debut)) {
    const autreJour = j(avant.debut) !== j(apres.debut);
    lignes.push(`arrivée ${h(avant.debut)} → ${h(apres.debut)}${autreJour ? ` (jour changé : ${j(avant.debut)} → ${j(apres.debut)})` : ''}`);
  }
  if (ms(avant.fin) !== ms(apres.fin)) {
    lignes.push(`départ ${h(avant.fin)} → ${h(apres.fin)}`);
  }
  return lignes;
}
