// Tâches pénibles : poids 2. Le reste : poids 1.
// Titres alignés exactement sur TASK_TEMPLATES de RestoApp.jsx.
export const CORVEES = new Set([
  "Nettoyer les toilettes toutes les 1h",
  "Vaisselle pot de sauce, verre, fourchette, cuillère — toutes les 1h",
  "Faire vaisselle toutes les 30 min",
  "Nettoyer pot de sauce et remplir",
  "Changer les poubelles",
  "Lavage de sol / surface / étagères — toutes les 30 min",
  "Nettoyage sol, pieds de table, tables",
  "Nettoyer escalier",
  "Nettoyer frigo intérieur et extérieur",
  "Nettoyer mur",
  "Couper le poulet et mariner (15min max pour 10kg)",
]);

export const poidsTache = (titre) => (CORVEES.has(titre) ? 2 : 1);

// Générateur pseudo-aléatoire déterministe (mulberry32) pour départager les égalités.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Pool des personnes éligibles à une tâche : créneau respecté, gérants hors corvées.
function eligibles(tache, presents) {
  let pool = presents.filter((p) => {
    if (tache.creneau === "ouverture") return p.ouverture;
    if (tache.creneau === "fermeture") return p.fermeture;
    return true; // service
  });
  if (poidsTache(tache.title) === 2) pool = pool.filter((p) => !p.isGerant);
  if (pool.length === 0) pool = presents; // dernier recours
  return pool;
}

// Compare deux candidats : ratio le plus bas, puis tâche faite le moins récemment, puis aléa.
function meilleur(a, b) {
  const EPS = 1e-9;
  if (a.ratio < b.ratio - EPS) return true;
  if (a.ratio > b.ratio + EPS) return false;
  if (a.dernier !== b.dernier) return a.dernier < b.dernier; // "" = jamais fait, prioritaire
  return a.alea < b.alea;
}

// presents: [{ name, isGerant, ouverture, fermeture }]
// historique: [{ assignee, title, due_date }] (7 jours précédents)
// heures7j: { [name]: heures de présence sur 7 jours, aujourd'hui inclus, > 0 }
// seed: graine du départage aléatoire
export function repartir({ taches, presents, historique = [], heures7j = {}, seed = 1 }) {
  const rng = mulberry32(seed);

  const charge = {};
  presents.forEach((p) => { charge[p.name] = 0; });
  historique.forEach((h) => {
    if (charge[h.assignee] != null) charge[h.assignee] += poidsTache(h.title);
  });

  const dernierJour = {};
  historique.forEach((h) => {
    if (!dernierJour[h.title]) dernierJour[h.title] = {};
    const cur = dernierJour[h.title][h.assignee];
    if (!cur || (h.due_date && h.due_date > cur)) dernierJour[h.title][h.assignee] = h.due_date || "";
  });

  // Corvées d'abord, puis ordre d'origine.
  const ordre = taches
    .map((tache, i) => ({ tache, i }))
    .sort((x, y) => poidsTache(y.tache.title) - poidsTache(x.tache.title) || x.i - y.i);

  const choisi = {};
  for (const { tache } of ordre) {
    const poids = poidsTache(tache.title);
    const pool = eligibles(tache, presents);
    let best = null;
    for (const p of pool) {
      const cand = {
        name: p.name,
        ratio: (charge[p.name] + poids) / (heures7j[p.name] || 1),
        dernier: (dernierJour[tache.title] && dernierJour[tache.title][p.name]) || "",
        alea: rng(),
      };
      if (best === null || meilleur(cand, best)) best = cand;
    }
    if (best) {
      charge[best.name] += poids;
      choisi[tache.title] = best.name;
    }
  }

  // Résultat dans l'ordre d'origine des tâches.
  return taches.map((tache) => ({ ...tache, assignee: choisi[tache.title] || null }));
}

// Décale une date "YYYY-MM-DD" de n jours et renvoie une date "YYYY-MM-DD".
export function decalerJours(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Pivote une liste de tâches (forme app) en grille[titre][date] = { id, assignee },
// en ne gardant que les tâches dont dueDate est dans `dates`.
export function pivotSemaine(taches, dates) {
  const jours = new Set(dates);
  const grille = {};
  for (const tk of taches) {
    if (!jours.has(tk.dueDate)) continue;
    if (!grille[tk.title]) grille[tk.title] = {};
    grille[tk.title][tk.dueDate] = { id: tk.id, assignee: tk.assignee };
  }
  return grille;
}
