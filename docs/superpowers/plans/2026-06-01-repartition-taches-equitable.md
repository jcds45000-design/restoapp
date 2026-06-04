# Répartition équitable des tâches avec mémoire - Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer la répartition aléatoire du "template du jour" par une répartition qui tourne les corvées, équilibre la charge, et tient compte des heures de présence, avec mémoire sur 7 jours.

**Architecture:** Le cœur de calcul devient une fonction pure `repartir` dans `src/lib/taskDispatch.js`, testée avec vitest. `RestoApp.jsx` récupère les présents, l'historique et les heures, puis appelle `repartir`.

**Tech Stack:** React 19, Vite 8, Supabase JS, vitest (ajouté).

---

## Notes de cadrage

- `repartir` suppose que les titres de `TASK_TEMPLATES` sont uniques (c'est le cas aujourd'hui). Le résultat est indexé par titre.
- La liste des corvées contient deux entrées "vaisselle" distinctes présentes dans `TASK_TEMPLATES` ("toutes les 1h" et "toutes les 30 min"), les deux comptent comme corvées. C'est la traduction exacte du point "vaisselle" du spec.
- Aucune migration Supabase. Le poids se déduit du titre.

## Structure des fichiers

- `src/lib/taskDispatch.js` (nouveau) : `CORVEES`, `poidsTache`, `repartir`. Logique pure, aucune dépendance React/Supabase.
- `src/lib/taskDispatch.test.js` (nouveau) : tests vitest de la logique pure.
- `src/RestoApp.jsx` (modifié) : branchement de `repartir`, génération asynchrone, bouton "Régénérer".
- `package.json` (modifié) : dépendance vitest + script `test`.

---

### Task 1 : Mettre en place vitest et le module avec poidsTache

**Files:**
- Modify: `package.json`
- Create: `src/lib/taskDispatch.js`
- Test: `src/lib/taskDispatch.test.js`

- [ ] **Step 1 : Installer vitest et ajouter le script de test**

Run: `npm install -D vitest`

Puis dans `package.json`, ajouter la ligne `"test": "vitest run"` dans `scripts` (juste après `"lint": "eslint ."`), de sorte que la section devienne :

```json
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "lint": "eslint .",
    "test": "vitest run",
    "preview": "vite preview"
  },
```

- [ ] **Step 2 : Écrire le test qui échoue pour poidsTache**

Create `src/lib/taskDispatch.test.js` :

```js
import { describe, it, expect } from "vitest";
import { poidsTache } from "./taskDispatch.js";

describe("poidsTache", () => {
  it("une corvée pèse 2", () => {
    expect(poidsTache("Nettoyer escalier")).toBe(2);
  });
  it("une tâche normale pèse 1", () => {
    expect(poidsTache("Faire les boissons")).toBe(1);
  });
});
```

- [ ] **Step 3 : Lancer le test pour vérifier qu'il échoue**

Run: `npm test`
Expected: FAIL, `poidsTache` n'est pas exportée (module introuvable ou export manquant).

- [ ] **Step 4 : Implémenter CORVEES et poidsTache**

Create `src/lib/taskDispatch.js` :

```js
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
```

- [ ] **Step 5 : Lancer le test pour vérifier qu'il passe**

Run: `npm test`
Expected: PASS (2 tests).

- [ ] **Step 6 : Commit**

```bash
git add package.json package-lock.json src/lib/taskDispatch.js src/lib/taskDispatch.test.js
git commit -m "feat(taches): module taskDispatch avec poids des corvees + vitest"
```

---

### Task 2 : Implémenter la fonction de répartition `repartir`

**Files:**
- Modify: `src/lib/taskDispatch.js`
- Test: `src/lib/taskDispatch.test.js`

- [ ] **Step 1 : Écrire les tests qui échouent pour repartir**

Ajouter dans `src/lib/taskDispatch.test.js` (après le bloc existant) :

```js
import { repartir } from "./taskDispatch.js";

const P = (name, opts = {}) => ({ name, isGerant: false, ouverture: true, fermeture: true, ...opts });

const chargeParPersonne = (res) => {
  const c = {};
  res.forEach((r) => { c[r.assignee] = (c[r.assignee] || 0) + poidsTache(r.title); });
  return c;
};

describe("repartir", () => {
  it("équilibre la charge à heures égales", () => {
    const taches = Array.from({ length: 4 }, (_, i) => ({ title: `Tache normale ${i}`, creneau: "service" }));
    const res = repartir({ taches, presents: [P("A"), P("B")], heures7j: { A: 5, B: 5 }, seed: 1 });
    const c = chargeParPersonne(res);
    expect(Math.abs((c.A || 0) - (c.B || 0))).toBeLessThanOrEqual(1);
  });

  it("donne plus de tâches à qui est présent plus longtemps", () => {
    const taches = Array.from({ length: 6 }, (_, i) => ({ title: `Tache normale ${i}`, creneau: "service" }));
    const res = repartir({ taches, presents: [P("A"), P("B")], heures7j: { A: 10, B: 2 }, seed: 1 });
    const c = chargeParPersonne(res);
    expect(c.A).toBeGreaterThan(c.B || 0);
  });

  it("respecte le créneau ouverture", () => {
    const taches = [{ title: "Allumer caisse", creneau: "ouverture" }];
    const presents = [P("Midi", { fermeture: false }), P("Soir", { ouverture: false })];
    const res = repartir({ taches, presents, heures7j: { Midi: 3, Soir: 4 }, seed: 1 });
    expect(res[0].assignee).toBe("Midi");
  });

  it("n'attribue jamais une corvée à un gérant", () => {
    const taches = [{ title: "Nettoyer escalier", creneau: "fermeture" }];
    const presents = [P("Gerant", { isGerant: true }), P("Salarie")];
    const res = repartir({ taches, presents, heures7j: { Gerant: 5, Salarie: 5 }, seed: 1 });
    expect(res[0].assignee).toBe("Salarie");
  });

  it("fait tourner une corvée d'un jour à l'autre", () => {
    const taches = [{ title: "Nettoyer escalier", creneau: "fermeture" }];
    const historique = [{ assignee: "A", title: "Nettoyer escalier", due_date: "2026-05-31" }];
    const res = repartir({ taches, presents: [P("A"), P("B")], historique, heures7j: { A: 5, B: 5 }, seed: 1 });
    expect(res[0].assignee).toBe("B");
  });

  it("attribue tout à la seule personne présente", () => {
    const taches = [{ title: "Faire les boissons", creneau: "service" }, { title: "Nettoyer mur", creneau: "fermeture" }];
    const res = repartir({ taches, presents: [P("Seul")], heures7j: { Seul: 5 }, seed: 1 });
    expect(res.every((r) => r.assignee === "Seul")).toBe(true);
  });

  it("conserve l'ordre des tâches dans le résultat", () => {
    const taches = [{ title: "Faire les boissons", creneau: "service" }, { title: "Nettoyer mur", creneau: "service" }];
    const res = repartir({ taches, presents: [P("A")], heures7j: { A: 5 }, seed: 1 });
    expect(res.map((r) => r.title)).toEqual(["Faire les boissons", "Nettoyer mur"]);
  });
});
```

- [ ] **Step 2 : Lancer les tests pour vérifier qu'ils échouent**

Run: `npm test`
Expected: FAIL, `repartir` n'est pas exportée.

- [ ] **Step 3 : Implémenter repartir**

Ajouter dans `src/lib/taskDispatch.js` :

```js
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
```

- [ ] **Step 4 : Lancer les tests pour vérifier qu'ils passent**

Run: `npm test`
Expected: PASS (tous les tests, y compris ceux de Task 1).

- [ ] **Step 5 : Commit**

```bash
git add src/lib/taskDispatch.js src/lib/taskDispatch.test.js
git commit -m "feat(taches): repartition equitable avec memoire 7 jours"
```

---

### Task 3 : Brancher `repartir` dans RestoApp.jsx

**Files:**
- Modify: `src/RestoApp.jsx:2` (import)
- Modify: `src/RestoApp.jsx:1478-1500` (remplacer `computeTemplateAssignments` par `genererTemplate`)
- Modify: `src/RestoApp.jsx:1503-1509` (`openTemplateModal`)
- Modify: `src/RestoApp.jsx:1511-1529` (supprimer `shuffleTemplateAssignments`)
- Modify: `src/RestoApp.jsx:1958` (onChange du sélecteur de date)
- Modify: `src/RestoApp.jsx:2008` (bouton "Régénérer")

- [ ] **Step 1 : Ajouter l'import du module**

Après la ligne 2 (`import { supabase } from './lib/supabase';`), ajouter :

```js
import { repartir } from './lib/taskDispatch';
```

- [ ] **Step 2 : Remplacer `computeTemplateAssignments` par `genererTemplate`**

Remplacer le bloc actuel (lignes 1478-1500, la fonction `computeTemplateAssignments`) par :

```js
  const seedRef = useRef(1);
  const EXCLUS_REPARTITION = ['Sarah'];

  const genererTemplate = async (date, seed) => {
    // Présents du jour (employees exclut déjà Jean-Claude), Sarah retirée
    let presents = employees
      .map(u => ({ u, shift: (schedule[u.name] || {})[date] || null }))
      .filter(({ shift }) => estPresent(shift))
      .filter(({ u }) => !EXCLUS_REPARTITION.includes(u.name))
      .map(({ u, shift }) => ({
        name: u.name,
        isGerant: u.role === 'gerant',
        ouverture: travailleOuverture(shift),
        fermeture: travailleFermeture(shift),
      }));
    // Pas de planning ce jour : on prend tous les actifs, présents toute la journée
    if (!presents.length) {
      presents = employees
        .filter(u => !EXCLUS_REPARTITION.includes(u.name))
        .map(u => ({ name: u.name, isGerant: u.role === 'gerant', ouverture: true, fermeture: true }));
    }
    // Heures de présence sur 7 jours glissants (aujourd'hui inclus)
    const heures7j = {};
    presents.forEach(p => {
      let h = 0;
      for (let i = 0; i <= 6; i++) h += calcHours((schedule[p.name] || {})[addDays(date, -i)] || '');
      heures7j[p.name] = h > 0 ? h : 1;
    });
    // Historique des 7 jours précédents
    let historique = [];
    try {
      const { data } = await supabase
        .from('tasks')
        .select('assignee_name,title,due_date')
        .gte('due_date', addDays(date, -7))
        .lt('due_date', date);
      historique = (data || []).map(r => ({ assignee: r.assignee_name, title: r.title, due_date: r.due_date }));
    } catch {
      historique = [];
    }
    setTemplateAssignments(repartir({ taches: TASK_TEMPLATES, presents, historique, heures7j, seed }));
  };
```

- [ ] **Step 3 : Mettre à jour `openTemplateModal` en asynchrone**

Remplacer `openTemplateModal` (lignes 1503-1509) par :

```js
  const openTemplateModal = async () => {
    const d = viewDate || TODAY;
    setTemplateDate(d);
    setEditingTemplateIdx(null);
    seedRef.current = 1;
    setShowTemplateModal(true);
    await genererTemplate(d, seedRef.current);
  };
```

- [ ] **Step 4 : Supprimer `shuffleTemplateAssignments`**

Supprimer entièrement la fonction `shuffleTemplateAssignments` (lignes 1511-1529). Elle est remplacée par "Régénérer" (Step 6).

- [ ] **Step 5 : Mettre à jour le onChange du sélecteur de date**

Remplacer la ligne 1958 (`<input type="date" ...>`) par :

```jsx
              <input type="date" value={templateDate} onChange={async e => { setTemplateDate(e.target.value); setEditingTemplateIdx(null); await genererTemplate(e.target.value, seedRef.current); }}
```

(garder le reste des attributs de cet `<input>` tels quels après le `onChange`)

- [ ] **Step 6 : Transformer le bouton "Répartir aléatoirement" en "Régénérer"**

Remplacer la ligne 2008 par :

```jsx
              <button onClick={async () => { seedRef.current = seedRef.current + 1; await genererTemplate(templateDate, seedRef.current); }} style={{ padding:"10px", borderRadius:10, border:`1.5px solid ${t.primary}`, background:"transparent", color:t.primary, fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:F }}>🔀 Régénérer</button>
```

- [ ] **Step 7 : Vérifier que le lint et le build passent**

Run: `npm run lint`
Expected: aucune erreur (avertissements existants tolérés).

Run: `npm run build`
Expected: build réussi, aucune référence cassée à `computeTemplateAssignments` ou `shuffleTemplateAssignments`.

- [ ] **Step 8 : Vérification manuelle dans l'application**

Run: `npm run dev`

Dans l'appli, se connecter en gérant, aller dans Tâches, ouvrir "Template du jour" :
- Vérifier que les tâches sont réparties entre les présents du jour.
- Vérifier qu'aucune corvée (toilettes, escalier, plonge, poubelles, sols, frigo, mur, couper le poulet) n'est attribuée à Thomas ou Chainez.
- Cliquer "Régénérer" : la répartition change, reste équilibrée.
- Réassigner une ligne manuellement : la valeur choisie est conservée.
- Cliquer "Charger" : les tâches du jour apparaissent dans la liste.

- [ ] **Step 9 : Commit**

```bash
git add src/RestoApp.jsx
git commit -m "feat(taches): brancher la repartition equitable dans le template du jour"
```

---

## Auto-revue

- Couverture du spec : pondération corvées (Task 1), mémoire 7 jours + ratio charge/heures + corvées d'abord + départage rotation/aléa (Task 2), gérants hors corvées (Task 2 + test), créneaux (Task 2 + test), flux de données sans migration + modification manuelle conservée + bouton régénérer + cas limites (Task 3). Tests vitest (Tasks 1-2). Tout est couvert.
- Pas de placeholder : tout le code est fourni.
- Cohérence des noms : `repartir`, `poidsTache`, `CORVEES`, `genererTemplate`, `seedRef`, `heures7j` utilisés de façon identique partout.
