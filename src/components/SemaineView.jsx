import { useState, useRef, useMemo, useEffect, Fragment } from 'react';
import { supabase } from '../lib/supabase';
import { repartir, CORVEES, pivotSemaine, decalerJours } from '../lib/taskDispatch';
import { I } from '../lib/icons';
import { TODAY, getMonday, WEEK_START, TODAY_LABEL, BANNER_IMAGE, fmt, fmtShort, addDays, getWeekDays, getDayName, isOverdue, calcHours, initialUsersData, initialSchedule, initialPointage, categoryList, priorityList, TASK_TEMPLATES, travailleOuverture, travailleFermeture, estPresent, initialTasks, stockCategories, initialProducts, initialSorties, stockAlerts, recentOrders, weeklyCA, themes, F, StatCard, MiniChart, Badge, StatusBadge, PriorityBadge, CategoryTag, OverdueBadge, CompletedByBadge, DateNav, TaskModal, TaskRow, ChecklistView, KanbanView, HistoryView } from '../lib/foundation';

const SemaineView = ({ tasks, setTasks, employees, schedule, t }) => {
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
    const c = grille[titre] && grille[titre][date];
    setEditCell(null);
    if (c && c.id) {
      if (!nom) {
        setTasks(prev => prev.filter(tk => tk.id !== c.id));
        await supabase.from('tasks').delete().eq('id', c.id);
        return;
      }
      setTasks(prev => prev.map(tk => tk.id === c.id ? { ...tk, assignee: nom } : tk));
      await supabase.from('tasks').update({ assignee_name: nom }).eq('id', c.id);
    } else if (nom) {
      const { data } = await supabase.from('tasks').insert({
        title: titre, assignee_name: nom, category: tmpl ? tmpl.category : 'Autre',
        priority: tmpl ? (PRIO_TO_DB[tmpl.priority] || 'medium') : 'medium',
        status: 'todo', due_date: date, completed_by_name: null,
      }).select().single();
      if (data) setTasks(prev => [...prev, toAppTask(data)]);
    }
  };

  const retirerJour = async (titre, date) => {
    const c = grille[titre] && grille[titre][date];
    if (!c || !c.id) return;
    setTasks(prev => prev.filter(tk => tk.id !== c.id));
    await supabase.from('tasks').delete().eq('id', c.id);
  };

  const retirerSemaine = async (titre) => {
    const ids = jours.map(d => grille[titre] && grille[titre][d]).filter(Boolean).map(c => c.id);
    if (!ids.length) return;
    if (!confirm(`Retirer « ${titre} » pour toute la semaine du ${fmt(jours[0])} au ${fmt(jours[5])} ?`)) return;
    setTasks(prev => prev.filter(tk => !ids.includes(tk.id)));
    await supabase.from('tasks').delete().in('id', ids);
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
        <button onClick={() => setWeekStart(addDays(weekStart, -7))} style={{ padding: "8px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.surface, color: t.text, cursor: "pointer", fontFamily: F }}>&larr;</button>
        <div style={{ fontSize: 14, fontWeight: 700, fontFamily: F, minWidth: 170, textAlign: "center" }}>{fmt(jours[0])} &mdash; {fmt(jours[5])}</div>
        <button onClick={() => setWeekStart(addDays(weekStart, 7))} style={{ padding: "8px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.surface, color: t.text, cursor: "pointer", fontFamily: F }}>&rarr;</button>
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
                      <td style={{ ...cell, textAlign: "left", fontWeight: 500 }}>{corvee && <span style={{ color: t.warning || '#F97316', marginRight: 4 }}>●</span>}{tk.title}{jours.some(d => grille[tk.title] && grille[tk.title][d]) && <button onClick={() => retirerSemaine(tk.title)} title="Retirer cette tâche toute la semaine" style={{ marginLeft: 6, border: "none", background: "transparent", color: t.textMuted, cursor: "pointer", fontSize: 12 }}>✕</button>}</td>
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
                            {c ? (
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                                {c.assignee}
                                <button onClick={(e) => { e.stopPropagation(); retirerJour(tk.title, d); }} title="Retirer pour ce jour" style={{ border: "none", background: "transparent", color: t.textMuted, cursor: "pointer", fontSize: 11, padding: 0, lineHeight: 1 }}>✕</button>
                              </span>
                            ) : '—'}
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

export default SemaineView;
