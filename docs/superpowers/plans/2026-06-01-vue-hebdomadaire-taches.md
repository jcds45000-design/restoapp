# Vue hebdomadaire des tâches - Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter une vue « Semaine » dans le module Tâches : une grille tâches × jours (lundi à samedi), remplie à la main par le gérant, reportable d'une semaine à l'autre, avec un pré-remplissage équitable optionnel.

**Architecture:** Deux petites fonctions pures testées dans `src/lib/taskDispatch.js` (`decalerJours`, `pivotSemaine`), puis un composant `SemaineView` ajouté dans `src/RestoApp.jsx`, branché comme troisième vue à côté de Liste et Kanban. Tout s'appuie sur la table `tasks` existante, aucune migration.

**Tech Stack:** React 19, Vite 8, Supabase JS, vitest.

---

## Notes de cadrage

- Le composant `SemaineView` est défini dans `src/RestoApp.jsx`, au niveau module, comme les autres vues (`ChecklistView`, `KanbanView`). Il accède donc directement aux constantes/ helpers du module : `TASK_TEMPLATES`, `supabase`, `addDays`, `fmt`, `fmtShort`, `WEEK_START`, `estPresent`, `travailleOuverture`, `travailleFermeture`, `calcHours`, `F`.
- Les titres de `TASK_TEMPLATES` sont uniques : la grille est indexée par titre.
- La vue Semaine lit la table `tasks` (forme app : `{ id, title, assignee, category, priority, status, dueDate, completedBy }`).

## Structure des fichiers

- `src/lib/taskDispatch.js` (modifié) : ajout de `decalerJours` et `pivotSemaine` (+ tests).
- `src/lib/taskDispatch.test.js` (modifié) : tests des deux fonctions.
- `src/RestoApp.jsx` (modifié) : import Fragment + fonctions, composant `SemaineView`, bouton de vue « Semaine », branchement de la vue.

---

### Task 1 : Fonctions pures `decalerJours` et `pivotSemaine`

**Files:**
- Modify: `src/lib/taskDispatch.js`
- Test: `src/lib/taskDispatch.test.js`

- [ ] **Step 1 : Écrire les tests qui échouent**

Ajouter à la fin de `src/lib/taskDispatch.test.js` :

```js
import { decalerJours, pivotSemaine } from "./taskDispatch.js";

describe("decalerJours", () => {
  it("décale de +7 jours", () => {
    expect(decalerJours("2026-06-02", 7)).toBe("2026-06-09");
  });
  it("gère le passage de mois", () => {
    expect(decalerJours("2026-06-29", 7)).toBe("2026-07-06");
  });
  it("décale en arrière", () => {
    expect(decalerJours("2026-06-02", -1)).toBe("2026-06-01");
  });
});

describe("pivotSemaine", () => {
  it("range les tâches par titre puis par date, ignore les dates hors semaine", () => {
    const taches = [
      { id: 1, title: "Allumer caisse", assignee: "Thomas", dueDate: "2026-06-02" },
      { id: 2, title: "Allumer caisse", assignee: "Chainez", dueDate: "2026-06-03" },
      { id: 3, title: "Nettoyer mur", assignee: "Ilias", dueDate: "2026-06-02" },
      { id: 4, title: "Allumer caisse", assignee: "Hors", dueDate: "2026-06-30" },
    ];
    const grille = pivotSemaine(taches, ["2026-06-02", "2026-06-03"]);
    expect(grille["Allumer caisse"]["2026-06-02"]).toEqual({ id: 1, assignee: "Thomas" });
    expect(grille["Allumer caisse"]["2026-06-03"]).toEqual({ id: 2, assignee: "Chainez" });
    expect(grille["Nettoyer mur"]["2026-06-02"]).toEqual({ id: 3, assignee: "Ilias" });
    expect(grille["Allumer caisse"]["2026-06-30"]).toBeUndefined();
  });
});
```

- [ ] **Step 2 : Lancer les tests, vérifier l'échec**

Run: `npm test --prefix "C:\Users\LENOVO P15S\Documents\Projets\restoapp"`
Expected: FAIL (`decalerJours` et `pivotSemaine` non exportées).

- [ ] **Step 3 : Implémenter les deux fonctions**

Ajouter à la fin de `src/lib/taskDispatch.js` :

```js
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
```

- [ ] **Step 4 : Lancer les tests, vérifier qu'ils passent**

Run: `npm test --prefix "C:\Users\LENOVO P15S\Documents\Projets\restoapp"`
Expected: PASS (tous les tests, anciens + nouveaux).

- [ ] **Step 5 : Commit** (ne PAS committer si Jean-Claude veut rester en local ; sinon :)

```bash
git add src/lib/taskDispatch.js src/lib/taskDispatch.test.js
git commit -m "feat(taches): helpers decalerJours et pivotSemaine"
```

---

### Task 2 : Composant SemaineView et branchement dans le module Tâches

**Files:**
- Modify: `src/RestoApp.jsx:1` (import React : ajouter `Fragment`)
- Modify: `src/RestoApp.jsx:3` (import depuis `./lib/taskDispatch`)
- Modify: `src/RestoApp.jsx` (ajouter le composant `SemaineView` au niveau module, juste avant le composant principal `RestoApp`)
- Modify: `src/RestoApp.jsx:1806` (bouton de vue « Semaine »)
- Modify: `src/RestoApp.jsx:1807-1810` (masquer filtres + stats en vue Semaine)
- Modify: `src/RestoApp.jsx:1811` (brancher `SemaineView`)

- [ ] **Step 1 : Ajouter `Fragment` à l'import React**

Ligne 1, remplacer :
```js
import { useState, useRef, useMemo, useEffect } from "react";
```
par :
```js
import { useState, useRef, useMemo, useEffect, Fragment } from "react";
```

- [ ] **Step 2 : Compléter l'import depuis taskDispatch**

Ligne 3, remplacer :
```js
import { repartir } from './lib/taskDispatch';
```
par :
```js
import { repartir, CORVEES, pivotSemaine, decalerJours } from './lib/taskDispatch';
```

- [ ] **Step 3 : Ajouter le composant `SemaineView` au niveau module**

Insérer ce composant complet dans `src/RestoApp.jsx`, au niveau module, juste avant la déclaration du composant principal `RestoApp` (chercher `function RestoApp` ou `const RestoApp =`) :

```jsx
const SemaineView = ({ tasks, setTasks, employees, schedule, t, isMobile }) => {
  const [weekStart, setWeekStart] = useState(WEEK_START); // lundi de la semaine affichée
  const [editCell, setEditCell] = useState(null); // { title, date }
  const [busy, setBusy] = useState(false);

  const jours = useMemo(() => [0, 1, 2, 3, 4, 5].map(i => addDays(weekStart, i)), [weekStart]); // lundi..samedi
  const grille = useMemo(() => pivotSemaine(tasks, jours), [tasks, jours]);

  const PRIO_TO_DB = { haute: 'high', moyenne: 'medium', basse: 'low' };
  const PRIO_FROM_DB = { high: 'haute', medium: 'moyenne', low: 'basse' };
  const JOURS_NOMS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
  const EXCLUS = ['Sarah'];
  const groupes = [
    { titre: 'Ouverture', cle: 'ouverture' },
    { titre: 'Service', cle: 'service' },
    { titre: 'Fermeture', cle: 'fermeture' },
  ];

  const toAppTask = (d) => ({
    id: d.id, title: d.title, assignee: d.assignee_name, category: d.category,
    priority: PRIO_FROM_DB[d.priority] || 'moyenne', status: 'todo', dueDate: d.due_date, completedBy: null,
  });

  const presentsJour = (date) => employees
    .filter(u => estPresent((schedule[u.name] || {})[date]))
    .map(u => u.name);

  const assignerCellule = async (titre, date, nom) => {
    const tmpl = TASK_TEMPLATES.find(x => x.title === titre);
    const cell = grille[titre] && grille[titre][date];
    setEditCell(null);
    if (cell && cell.id) {
      if (!nom) {
        setTasks(prev => prev.filter(tk => tk.id !== cell.id));
        await supabase.from('tasks').delete().eq('id', cell.id);
        return;
      }
      setTasks(prev => prev.map(tk => tk.id === cell.id ? { ...tk, assignee: nom } : tk));
      await supabase.from('tasks').update({ assignee_name: nom }).eq('id', cell.id);
    } else if (nom) {
      const { data } = await supabase.from('tasks').insert({
        title: titre, assignee_name: nom, category: tmpl ? tmpl.category : 'Autre',
        priority: tmpl ? (PRIO_TO_DB[tmpl.priority] || 'medium') : 'medium',
        status: 'todo', due_date: date, completed_by_name: null,
      }).select().single();
      if (data) setTasks(prev => [...prev, toAppTask(data)]);
    }
  };

  const copierSemaineSuivante = async () => {
    const cibleDates = jours.map(d => decalerJours(d, 7));
    const aCopier = tasks.filter(tk => jours.includes(tk.dueDate));
    if (!aCopier.length) { alert('Cette semaine est vide, rien à copier.'); return; }
    const cibleExistante = tasks.some(tk => cibleDates.includes(tk.dueDate));
    if (cibleExistante && !confirm('La semaine suivante contient déjà des tâches. Les remplacer par une copie de cette semaine ?')) return;
    setBusy(true);
    if (cibleExistante) {
      await supabase.from('tasks').delete().in('due_date', cibleDates);
      setTasks(prev => prev.filter(tk => !cibleDates.includes(tk.dueDate)));
    }
    const inserts = aCopier.map(tk => ({
      title: tk.title, assignee_name: tk.assignee, category: tk.category,
      priority: PRIO_TO_DB[tk.priority] || 'medium', status: 'todo',
      due_date: decalerJours(tk.dueDate, 7), completed_by_name: null,
    }));
    const { data } = await supabase.from('tasks').insert(inserts).select();
    if (data) setTasks(prev => [...prev, ...data.map(toAppTask)]);
    setBusy(false);
    setWeekStart(addDays(weekStart, 7));
  };

  const preremplirEquitable = async () => {
    if (tasks.some(tk => jours.includes(tk.dueDate)) && !confirm('Remplacer les tâches de cette semaine par une répartition équitable ?')) return;
    setBusy(true);
    await supabase.from('tasks').delete().in('due_date', jours);
    let restantes = tasks.filter(tk => !jours.includes(tk.dueDate));
    const nouvelles = [];
    for (const date of jours) {
      const presents = employees
        .map(u => ({ u, shift: (schedule[u.name] || {})[date] || null }))
        .filter(({ shift }) => estPresent(shift))
        .filter(({ u }) => !EXCLUS.includes(u.name))
        .map(({ u, shift }) => ({ name: u.name, isGerant: u.role === 'gerant', ouverture: travailleOuverture(shift), fermeture: travailleFermeture(shift) }));
      if (!presents.length) continue; // jour fermé -> reste vide
      const heures7j = {};
      presents.forEach(p => {
        let h = 0;
        for (let i = 0; i <= 6; i++) h += calcHours((schedule[p.name] || {})[addDays(date, -i)] || '');
        heures7j[p.name] = h > 0 ? h : 1;
      });
      const { data: hist } = await supabase.from('tasks').select('assignee_name,title,due_date').gte('due_date', addDays(date, -7)).lt('due_date', date);
      const historique = [
        ...(hist || []).map(r => ({ assignee: r.assignee_name, title: r.title, due_date: r.due_date })),
        ...nouvelles.filter(n => n.due_date >= addDays(date, -7) && n.due_date < date).map(n => ({ assignee: n.assignee_name, title: n.title, due_date: n.due_date })),
      ];
      const affectations = repartir({ taches: TASK_TEMPLATES, presents, historique, heures7j, seed: 1 });
      affectations.forEach(a => {
        if (!a.assignee) return;
        nouvelles.push({ title: a.title, assignee_name: a.assignee, category: a.category, priority: PRIO_TO_DB[a.priority] || 'medium', status: 'todo', due_date: date, completed_by_name: null });
      });
    }
    if (nouvelles.length) {
      const { data } = await supabase.from('tasks').insert(nouvelles).select();
      if (data) restantes = [...restantes, ...data.map(toAppTask)];
    }
    setTasks(restantes);
    setBusy(false);
  };

  const cell = { padding: "6px 8px", borderBottom: `1px solid ${t.border}`, borderRight: `1px solid ${t.border}`, fontSize: 12, fontFamily: F, textAlign: "center", minWidth: 78 };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <button onClick={() => setWeekStart(addDays(weekStart, -7))} style={{ padding: "8px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.surface, color: t.text, cursor: "pointer", fontFamily: F }}>←</button>
        <div style={{ fontSize: 14, fontWeight: 700, fontFamily: F, minWidth: 170, textAlign: "center" }}>{fmt(jours[0])} — {fmt(jours[5])}</div>
        <button onClick={() => setWeekStart(addDays(weekStart, 7))} style={{ padding: "8px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.surface, color: t.text, cursor: "pointer", fontFamily: F }}>→</button>
        <div style={{ flex: 1 }} />
        <button disabled={busy} onClick={preremplirEquitable} style={{ padding: "9px 14px", borderRadius: 8, border: `1.5px solid ${t.primary}`, background: "transparent", color: t.primary, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: F, opacity: busy ? 0.5 : 1 }}>⚖️ Pré-remplir équitablement</button>
        <button disabled={busy} onClick={copierSemaineSuivante} style={{ padding: "9px 14px", borderRadius: 8, border: "none", background: t.primary, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: F, opacity: busy ? 0.5 : 1 }}>📋 Copier vers la semaine suivante</button>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", background: t.surface }}>
          <thead>
            <tr>
              <th style={{ ...cell, textAlign: "left", fontWeight: 700, minWidth: 220, background: t.surfaceAlt }}>Tâche</th>
              {jours.map((d, i) => (
                <th key={d} style={{ ...cell, fontWeight: 700, background: t.surfaceAlt }}>{JOURS_NOMS[i]}<div style={{ fontSize: 10, color: t.textMuted, fontWeight: 400 }}>{fmtShort(d)}</div></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groupes.map(g => (
              <Fragment key={g.cle}>
                <tr><td colSpan={7} style={{ padding: "8px 10px", fontWeight: 700, fontSize: 12, fontFamily: F, background: t.surfaceAlt, color: t.primary }}>{g.titre}</td></tr>
                {TASK_TEMPLATES.filter(tk => tk.creneau === g.cle).map(tk => {
                  const corvee = CORVEES.has(tk.title);
                  return (
                    <tr key={tk.title}>
                      <td style={{ ...cell, textAlign: "left", fontWeight: 500 }}>{corvee && <span style={{ color: t.warning || '#F97316', marginRight: 4 }}>●</span>}{tk.title}</td>
                      {jours.map(d => {
                        const c = grille[tk.title] && grille[tk.title][d];
                        const enEdition = editCell && editCell.title === tk.title && editCell.date === d;
                        if (enEdition) {
                          const presents = presentsJour(d);
                          const noms = [...presents, ...employees.map(e => e.name).filter(n => !presents.includes(n))];
                          return (
                            <td key={d} style={cell}>
                              <select autoFocus value={c ? c.assignee : ''} onChange={e => assignerCellule(tk.title, d, e.target.value)} onBlur={() => setEditCell(null)} style={{ width: "100%", fontSize: 12, fontFamily: F, padding: 2 }}>
                                <option value="">— personne —</option>
                                {noms.map(n => <option key={n} value={n}>{n}</option>)}
                              </select>
                            </td>
                          );
                        }
                        return (
                          <td key={d} onClick={() => setEditCell({ title: tk.title, date: d })} style={{ ...cell, cursor: "pointer", background: c && corvee ? '#F9731612' : 'transparent', color: c ? t.text : t.textMuted }}>
                            {c ? c.assignee : '—'}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
```

- [ ] **Step 4 : Ajouter le bouton de vue « Semaine »**

Ligne 1806, dans le tableau des vues, ajouter l'entrée `semaine`. Remplacer :
```jsx
{[{ key: "checklist", icon: I.list, label: "Liste" }, { key: "kanban", icon: I.kanban, label: "Kanban" }].map(v => (
```
par :
```jsx
{[{ key: "checklist", icon: I.list, label: "Liste" }, { key: "kanban", icon: I.kanban, label: "Kanban" }, { key: "semaine", icon: "🗓️", label: "Semaine" }].map(v => (
```

- [ ] **Step 5 : Masquer filtres et statistiques en vue Semaine**

Ligne 1807, le filtre par salarié : remplacer
```jsx
                {isGerant && <select value={fA} onChange={e => setFA(e.target.value)} style={ss}>
```
par
```jsx
                {isGerant && taskView !== "semaine" && <select value={fA} onChange={e => setFA(e.target.value)} style={ss}>
```

Ligne 1808, le filtre par catégorie : remplacer
```jsx
                <select value={fC} onChange={e => setFC(e.target.value)} style={ss}>
```
par
```jsx
                {taskView !== "semaine" && <select value={fC} onChange={e => setFC(e.target.value)} style={ss}>
```
et fermer correctement ce bloc conditionnel (ajouter `}` après le `</select>` correspondant).

Ligne 1810, la barre de statistiques : remplacer le début
```jsx
              {isGerant && <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)",
```
par
```jsx
              {isGerant && taskView !== "semaine" && <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)",
```

- [ ] **Step 6 : Brancher `SemaineView` dans le switch d'affichage**

Ligne 1811, remplacer :
```jsx
              {(isGerant && taskView === "kanban") ? <KanbanView tasks={viewTasks} onMove={moveTask} onDelete={delTask} t={t} fA={fA} fC={fC} /> : <ChecklistView tasks={viewTasks} onToggle={toggleTask} onDelete={delTask} onEdit={openEditTask} t={t} fA={fA} fC={fC} isGerant={isGerant} currentUserName={currentUser.name} />}
```
par :
```jsx
              {(isGerant && taskView === "semaine") ? <SemaineView tasks={tasks} setTasks={setTasks} employees={employees} schedule={schedule} t={t} isMobile={isMobile} />
                : (isGerant && taskView === "kanban") ? <KanbanView tasks={viewTasks} onMove={moveTask} onDelete={delTask} t={t} fA={fA} fC={fC} />
                : <ChecklistView tasks={viewTasks} onToggle={toggleTask} onDelete={delTask} onEdit={openEditTask} t={t} fA={fA} fC={fC} isGerant={isGerant} currentUserName={currentUser.name} />}
```

- [ ] **Step 7 : Lint et build**

Run: `npm run lint --prefix "C:\Users\LENOVO P15S\Documents\Projets\restoapp"`
Expected: aucune NOUVELLE erreur (avertissements préexistants tolérés). Vérifier qu'il n'y a pas de variable non définie (`SemaineView`, `pivotSemaine`, `decalerJours`, `CORVEES`, `Fragment` bien importés).

Run: `npm run build --prefix "C:\Users\LENOVO P15S\Documents\Projets\restoapp"`
Expected: build réussi.

- [ ] **Step 8 : Vérification manuelle dans l'application**

Run: `npm run dev --prefix "C:\Users\LENOVO P15S\Documents\Projets\restoapp" -- --port 5178`

Se connecter en gérant, aller dans Tâches, cliquer l'onglet **Semaine** :
- La grille s'affiche : lignes = tâches groupées Ouverture / Service / Fermeture, colonnes Lun à Sam.
- Naviguer avec ← → change la semaine. La colonne **Lun** est vide (resto fermé).
- Cliquer une cellule ouvre un menu déroulant (présents du jour en premier, puis tout le monde) ; choisir une personne enregistre l'affectation ; choisir « personne » la retire.
- **Copier vers la semaine suivante** : recopie la semaine affichée sur la suivante (confirmation si elle a déjà des tâches), puis affiche la semaine suivante.
- **Pré-remplir équitablement** : remplit mardi à samedi avec une répartition équitable, lundi reste vide, aucune corvée sur Thomas ni Chainez.
- Les corvées sont signalées par un point orange.
- Vérifier que les vues Liste et Kanban fonctionnent toujours, et que les tâches saisies en vue Semaine apparaissent bien dans la vue Liste du jour correspondant.

- [ ] **Step 9 : Commit** (seulement si Jean-Claude le demande)

```bash
git add src/RestoApp.jsx
git commit -m "feat(taches): vue Semaine (grille, edition, copie de semaine, pre-remplissage)"
```

---

## Auto-revue

- **Couverture du spec :** grille lundi-samedi (Task 2, jours = 6 colonnes) ; lundi vide (aucune génération si pas de présents) ; remplissage manuel par cellule (assignerCellule) ; bouton Copier (copierSemaineSuivante) ; bouton Pré-remplir optionnel (preremplirEquitable) ; édition de n'importe quelle personne (menu listant tous les actifs) ; corvées repérées ; table `tasks` sans migration ; coexistence avec Liste/Kanban. Pivot et décalage testés (Task 1).
- **Placeholders :** aucun, tout le code est fourni.
- **Cohérence des noms :** `pivotSemaine`, `decalerJours`, `SemaineView`, `assignerCellule`, `copierSemaineSuivante`, `preremplirEquitable`, `toAppTask`, `jours`, `grille` utilisés de façon cohérente. `repartir` réutilise la signature `{ taches, presents, historique, heures7j, seed }` déjà en place.
