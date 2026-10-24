// src/lib/mois.js
// Mois au format 'AAAA-MM'. Libellés écrits en dur en français : le champ natif
// <input type="month"> suit la langue du navigateur et s'affichait en anglais chez le gérant.

export const MOIS_LONGS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export const MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin',
  'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

function lire(mois) {
  const m = /^(\d{4})-(\d{2})$/.exec(typeof mois === 'string' ? mois : '');
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw new Error('mois invalide : ' + mois);
  return { annee: Number(m[1]), index: Number(m[2]) - 1 };
}

export function decalerMois(mois, n) {
  const { annee, index } = lire(mois);
  const total = annee * 12 + index + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

export function libelleMois(mois) {
  const { annee, index } = lire(mois);
  return `${MOIS_LONGS[index]} ${annee}`;
}
