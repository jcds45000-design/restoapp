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

import { titresHorsCatalogue } from "./taskDispatch.js";

describe('titresHorsCatalogue', () => {
  it('retourne les titres de la semaine absents du catalogue, dédoublonnés', () => {
    const tasks = [
      { title: 'Libre A', dueDate: '2026-07-06' },
      { title: 'Libre A', dueDate: '2026-07-07' },
      { title: 'Au catalogue', dueDate: '2026-07-06' },
      { title: 'Libre B', dueDate: '2026-07-20' }, // hors semaine
    ];
    const jours = ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10', '2026-07-11'];
    expect(titresHorsCatalogue(tasks, jours, ['Au catalogue'])).toEqual(['Libre A']);
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
