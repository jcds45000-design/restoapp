// Règles de retard et d'expiration des tâches (Phase 0, spec §9).
// Une tâche PONCTUELLE passée non faite  => « en retard » (elle reste visible et comptée).
// Une tâche RÉCURRENTE passée non faite  => « expirée » : elle n'a plus de sens (la
// prochaine occurrence la remplace) et ne doit PLUS gonfler le badge. L'archivage réel
// (statut non_faite en base) est fait par la RPC archiver_taches_expirees() une fois la
// migration 7 appliquée ; en attendant, le classement côté app donne le même affichage.

// Nature d'une tâche : colonne kind si présente (migration 7), sinon correspondance
// titre ↔ catalogue des tâches habituelles (le lien historique).
export function estRecurrente(task, templates) {
  if (task.kind) return task.kind === 'recurrente';
  return templates.some((tt) => tt.title === task.title);
}

const CLOTUREE = (tk) => tk.status === 'done' || tk.status === 'non_faite';

// Sépare les tâches passées non faites : en retard (ponctuelles) vs expirées (récurrentes).
export function classerTaches(tasks, templates, today) {
  const enRetard = [];
  const expirees = [];
  for (const tk of tasks) {
    if (CLOTUREE(tk)) continue;
    if (!tk.dueDate || tk.dueDate >= today) continue;
    (estRecurrente(tk, templates) ? expirees : enRetard).push(tk);
  }
  return { enRetard, expirees };
}

// Badge de navigation : tâches du jour non faites + ponctuelles en retard.
// (Avant : TOUTES les tâches passées comptaient => centaines de « retards ».)
export function badgeTaches({ tasks, templates, today, pourNom = null }) {
  const filtre = (liste) => (pourNom ? liste.filter((tk) => tk.assignee === pourNom) : liste);
  const duJour = tasks.filter((tk) => tk.dueDate === today && !CLOTUREE(tk));
  const { enRetard } = classerTaches(tasks, templates, today);
  return filtre(duJour).length + filtre(enRetard).length;
}

// Borne de chargement : on ne recharge plus TOUT l'historique à chaque ouverture.
export function dateFenetre(today, jours = 60) {
  const d = new Date(today + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - jours);
  return d.toISOString().slice(0, 10);
}

// Anti-doublon du « Charger le template du jour » : ne proposer que les titres
// pas encore présents ce jour-là (double clic = 0 doublon).
export function titresManquants(catalogue, tasksDuJour) {
  const dejaLa = new Set(tasksDuJour.map((tk) => tk.title));
  return catalogue.filter((tt) => !dejaLa.has(tt.title));
}
