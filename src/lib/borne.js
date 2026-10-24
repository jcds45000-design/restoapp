// Logique pure de la borne de pointage (spec §5.1 et §8). Aucun accès Supabase :
// les réponses des fonctions pointer(), etat_pointage() et declarer_depart() sont traduites ici en textes.

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

// ─── Régularisation d'un oubli (tâche 9, spec §5.1) ─────────────

const PARTIES_PARIS = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Paris', hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
});

/** Date et heure murales de Paris à un instant donné, en nombres. */
function partiesParis(ms) {
  const p = Object.fromEntries(PARTIES_PARIS.formatToParts(new Date(ms)).map((x) => [x.type, Number(x.value)]));
  return { an: p.year, mois: p.month, jour: p.day, h: p.hour, m: p.minute };
}

/** Instant UTC d'une heure murale de Paris : l'appareil peut être réglé n'importe comment. */
function parisVersInstant(an, mois, jour, h, m) {
  const naif = Date.UTC(an, mois - 1, jour, h, m);
  const decalage = (ms) => {
    const p = partiesParis(ms);
    return Date.UTC(p.an, p.mois - 1, p.jour, p.h, p.m) - Math.floor(ms / 60000) * 60000;
  };
  // Deux passes : la première estime le décalage, la seconde le corrige près d'un changement d'heure.
  return naif - decalage(naif - decalage(naif));
}

/** « mardi 20 octobre », jour de Paris. */
export function jourParis(iso) {
  return new Date(iso).toLocaleDateString('fr-FR',
    { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris' });
}

/**
 * Heure de départ oubliée, saisie « HHMM » sur le clavier de la borne, en instant ISO.
 * Placée le jour de l'arrivée ; si elle ne la suit pas, c'est un départ après minuit,
 * donc le lendemain. Le serveur refuse ensuite toute durée au-delà de la clôture
 * automatique, ce qui écarte une faute de frappe lue comme « le lendemain ».
 * null si la saisie n'est pas une heure.
 */
export function departDeclare(debutIso, saisie) {
  if (!/^\d{4}$/.test(saisie || '')) return null;
  const h = Number(saisie.slice(0, 2));
  const m = Number(saisie.slice(2));
  if (h > 23 || m > 59) return null;
  const debut = new Date(debutIso).getTime();
  const j = partiesParis(debut);
  let depart = parisVersInstant(j.an, j.mois, j.jour, h, m);
  if (depart <= debut) depart = parisVersInstant(j.an, j.mois, j.jour + 1, h, m);
  return new Date(depart).toISOString();
}

/**
 * Traduit la réponse de declarer_depart(). `etape` dit où renvoyer le salarié quand
 * il peut corriger lui-même : son code, ou l'heure saisie.
 */
export function messageRegularisation(data, oubli) {
  if (data?.action === 'regularise') {
    return { ok: true, texte: `Merci, départ du ${jourParis(oubli.debut)} enregistré à ${heureParis(data.heure)}.` };
  }
  if (data?.action === 'erreur') {
    switch (data.motif) {
      case 'code_invalide':
        return { ok: false, etape: 'code', texte: 'Code incorrect. Réessaie.' };
      case 'heure_invalide':
        // Le futur est déjà filtré sur la borne, et une heure avant l'arrivée y passe au
        // lendemain : en pratique, le serveur ne refuse qu'une journée trop longue.
        return { ok: false, etape: 'heure', texte: 'Heure refusée : la journée serait trop longue. Vérifie l’heure.' };
      case 'presence_non_regularisable':
        // Le gérant l'a corrigé entre-temps : rien à refaire, le salarié peut pointer.
        return { ok: true, texte: 'Cet oubli a déjà été corrigé par le responsable.' };
      case 'trop_de_tentatives':
        return { ok: false, texte: 'Trop d’essais. Patiente quelques minutes.' };
      default:
        break;
    }
  }
  return { ok: false, texte: messageErreurBorne() };
}

// ─── Déclaration d'une tablette comme borne ───────────────────────
// Le jeton est le secret qui autorise une tablette à pointer. La base n'en garde
// qu'une empreinte (bcrypt) : il ne vit qu'ici, dans le stockage local de l'appareil.

/** Clé du stockage local où la tablette garde son jeton de borne. */
export const CLE_JETON = 'kimiko_borne_jeton';

/** Jeton aléatoire de 64 caractères hexadécimaux, bien au-delà des 32 exigés par le SQL. */
export function genererJeton(source = globalThis.crypto) {
  const octets = new Uint8Array(32);
  source.getRandomValues(octets);
  return [...octets].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Longueur minimale imposée par enregistrer_appareil(). */
export function jetonValide(jeton) {
  return typeof jeton === 'string' && jeton.length >= 32;
}

/** Refus de enregistrer_appareil() traduit pour le gérant, jamais le message brut. */
export function messageErreurAppareil(brut = '') {
  const m = String(brut || '');
  if (m.includes('jeton trop court')) return 'Le jeton de la borne est trop court : relance la déclaration.';
  if (m.includes('lieu inconnu ou ferme')) return 'Ce lieu est inconnu ou fermé. Choisis un lieu ouvert.';
  if (m.includes('non autorise')) return 'Seul le gérant peut déclarer une borne.';
  return 'La borne n’a pas pu être déclarée. Réessaie.';
}
