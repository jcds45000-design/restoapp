import { useState, useRef, useMemo, useEffect, Fragment, lazy, Suspense } from "react";
import { supabase } from './lib/supabase';
import { repartir, CORVEES, pivotSemaine, decalerJours } from './lib/taskDispatch';
import { I } from './lib/icons';
import { findUserIndexByEmail } from './lib/users';
import { alertProductsOf } from './lib/stock';
const SettingsModule = lazy(() => import('./components/SettingsModule'));
const StocksModule = lazy(() => import('./components/StocksModule'));
const EquipeModule = lazy(() => import('./components/EquipeModule'));
const PlanningModule = lazy(() => import('./components/PlanningModule'));
const SemaineView = lazy(() => import('./components/SemaineView'));
const TaskTemplatesModule = lazy(() => import('./components/TaskTemplatesModule'));

const Loading = () => (<div style={{ padding: 40, textAlign: "center", fontSize: 14, opacity: 0.6, fontFamily: "'Noto Sans KR', sans-serif" }}>Chargement…</div>);
import { TODAY, getMonday, WEEK_START, TODAY_LABEL, BANNER_IMAGE, fmt, fmtShort, addDays, getWeekDays, getDayName, isOverdue, calcHours, initialUsersData, initialSchedule, initialPointage, categoryList, priorityList, TASK_TEMPLATES, travailleOuverture, travailleFermeture, estPresent, initialTasks, stockCategories, initialProducts, initialSorties, stockAlerts, recentOrders, weeklyCA, themes, F, StatCard, MiniChart, Badge, StatusBadge, PriorityBadge, CategoryTag, OverdueBadge, CompletedByBadge, DateNav, TaskModal, TaskRow, ChecklistView, KanbanView, HistoryView } from './lib/foundation';

// ═══════════════════════════════════════
// ─── HELPERS ───
// ═══════════════════════════════════════

// ═══════════════════════════════════════
// ─── STOCKS MODULE ───
// ═══════════════════════════════════════
// ═══════════════════════════════════════
// ─── ÉQUIPE MODULE ───
// ═══════════════════════════════════════

// ═══════════════════════════════════════
// ─── PLANNING & RH MODULE ───
// ═══════════════════════════════════════

// ═══════════════════════════════════════
// ─── SETTINGS MODULE ───
// ═══════════════════════════════════════


// ═══════════════════════════════════════
// ─── MAIN APP ───
// ═══════════════════════════════════════
export default function RestoApp({ authUser, initialTheme, onLogout }) {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const [currentUserIdx, setCurrentUserIdx] = useState(0);
  const [usersData, setUsersData] = useState(initialUsersData);
  const [realIsGerant, setRealIsGerant] = useState(() => {
    const i = findUserIndexByEmail(initialUsersData, authUser?.email);
    return i >= 0 && initialUsersData[i].role === "gerant";
  });
  const currentUser = usersData[currentUserIdx] || usersData[0];
  // Droits basés sur le compte RÉELLEMENT connecté (realIsGerant), pas sur l'utilisateur
  // affiché. Un gérant qui « voit en tant que » un employé voit bien la vue employé.
  const isGerant = realIsGerant && currentUser.role === "gerant";
  const employees = useMemo(() => usersData.filter(u => u.name !== "Jean Claude"), [usersData]);

  const [section, setSection] = useState("dashboard");
  const [themeKey, setThemeKey] = useState(initialTheme || "kimiko");
  const [showThemePicker, setShowThemePicker] = useState(false);
  const [tasks, setTasks] = useState(initialTasks);
  const [schedule, setSchedule] = useState({});
  const [products, setProducts] = useState(initialProducts);
  const [sorties, setSorties] = useState(initialSorties);
  const [suppliers, setSuppliers] = useState([]);
  const [productSuppliers, setProductSuppliers] = useState([]);
  const [categories, setCategories] = useState([]);
  const catNames = categories.length ? categories.map(c => c.name) : categoryList;
  const [templates, setTemplates] = useState([]);
  const [showTemplatesEditor, setShowTemplatesEditor] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [templateDate, setTemplateDate] = useState(TODAY);
  const [templateAssignments, setTemplateAssignments] = useState([]);
  const [editingTemplateIdx, setEditingTemplateIdx] = useState(null);

  // Calcule la distribution des tâches selon les horaires du jour
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
    let historique;
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
    setTemplateAssignments(repartir({ taches: templates.length ? templates : TASK_TEMPLATES, presents, historique, heures7j, seed }));
  };

  const openTemplateModal = async () => {
    const d = viewDate || TODAY;
    setTemplateDate(d);
    setEditingTemplateIdx(null);
    seedRef.current = 1;
    setShowTemplateModal(true);
    await genererTemplate(d, seedRef.current);
  };

  const loadTemplate = async () => {
    const pmap = { haute: 'high', moyenne: 'medium', basse: 'low' };
    const inserts = templateAssignments.map(t => ({
      title: t.title, assignee_name: t.assignee, category: t.category,
      priority: pmap[t.priority] || 'medium', status: 'todo',
      due_date: templateDate, completed_by_name: null,
    }));
    const { data } = await supabase.from('tasks').insert(inserts).select();
    if (data) {
      setTasks(prev => [...prev, ...data.map(t => ({
        id: t.id, title: t.title, assignee: t.assignee_name, category: t.category,
        priority: t.priority === 'high' ? 'haute' : t.priority === 'low' ? 'basse' : 'moyenne',
        status: 'todo', dueDate: t.due_date, completedBy: null,
      }))]);
    }
    setShowTemplateModal(false);
  };
  const [taskView, setTaskView] = useState("checklist");
  const [viewDate, setViewDate] = useState(TODAY);
  const [showHistory, setShowHistory] = useState(false);
  const [gerantMyTasks, setGerantMyTasks] = useState(false); // toggle gérant : toutes vs mes tâches
  const [fA, setFA] = useState("");
  const [fC, setFC] = useState("");
  const t = themes[themeKey];
  const tmpl = templates.length ? templates : TASK_TEMPLATES;
  const nid = useRef(20);

  // ─── CHARGEMENT SUPABASE AU DÉMARRAGE ───
  useEffect(() => {
    const pmap = { high: 'haute', medium: 'moyenne', low: 'basse' };
    const loadData = async () => {
      // Tâches
      const { data: tData } = await supabase.from('tasks').select('*').order('created_at');
      if (tData?.length) {
        setTasks(tData.map(t => ({
          id: t.id,
          title: t.title || '',
          assignee: t.assignee_name || '',
          category: t.category || 'Autre',
          priority: pmap[t.priority] || 'moyenne',
          status: t.status || 'todo',
          dueDate: t.due_date || TODAY,
          completedBy: t.completed_by_name || null,
        })));
      }
      // Produits (seuil null = « à définir », ne pas le convertir en 0)
      const { data: pData } = await supabase.from('products').select('*').order('name');
      if (pData?.length) {
        setProducts(pData.map((p, i) => ({
          id: i + 1, _uuid: p.id,
          name: p.name, category: p.category, unit: p.unit,
          qty: parseFloat(p.qty) || 0,
          seuil: p.seuil == null ? null : parseFloat(p.seuil),
          seuilOrange: p.seuil_orange == null ? null : parseFloat(p.seuil_orange),
          priceUnit: p.price_unit == null ? null : parseFloat(p.price_unit),
        })));
      }
      // Fournisseurs + liaisons produit-fournisseur
      const { data: supData } = await supabase.from('suppliers').select('*').order('name');
      if (supData) setSuppliers(supData);
      const { data: psData } = await supabase.from('product_suppliers').select('*');
      if (psData) setProductSuppliers(psData);
      // Sorties (persistées dans stock_movements, type 'out')
      const { data: mvData } = await supabase.from('stock_movements')
        .select('*').eq('type', 'out').order('created_at');
      if (mvData?.length) {
        setSorties(mvData.map(m => ({
          id: m.id, productUuid: m.product_id, qty: Math.abs(parseFloat(m.quantity) || 0),
          empName: m.employee_name || '', date: (m.created_at || '').slice(0, 10),
          time: m.created_at
            ? new Date(m.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).replace(':', 'h')
            : '',
          status: m.status || 'validated', note: m.reason || '',
        })));
      }
      // Catégories de tâches
      const { data: cData } = await supabase.from('task_categories').select('*').order('sort_order');
      if (cData?.length) setCategories(cData);
      // Tâches habituelles (catalogue) — seed initial depuis la liste codée si table vide.
      let { data: tplData } = await supabase.from('task_templates').select('*').order('sort_order');
      if (tplData && tplData.length === 0 && TASK_TEMPLATES.length) {
        const seed = TASK_TEMPLATES.map((tp, i) => ({ title: tp.title, category: tp.category, priority: tp.priority, creneau: tp.creneau, sort_order: i }));
        const { data: ins } = await supabase.from('task_templates').insert(seed).select();
        tplData = ins || [];
      }
      if (tplData?.length) setTemplates(tplData);
      // Planning
      const { data: sData } = await supabase.from('schedule').select('*');
      if (sData?.length) {
        const sched = {};
        sData.forEach(s => {
          if (!sched[s.employee_name]) sched[s.employee_name] = {};
          sched[s.employee_name][s.date] = s.shift;
        });
        setSchedule(sched);
      }
      // Employés
      const { data: eData } = await supabase.from('employees').select('*').order('name');
      if (eData?.length) {
        // Gérants non-salariés (pas dans la table employees) — ex: Jean-Claude
        const gerantsExternes = initialUsersData.filter(u => u.role === 'gerant' && !eData.find(e => e.name === u.name));
        const merged = [
          ...gerantsExternes,
          ...eData.map((e, i) => ({
            id: i + 1, _uuid: e.id,
            name: e.name,
            role: e.role === 'gerant' ? 'gerant' : 'employe',
            initials: e.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase(),
            poste: e.poste || 'Équipe',
            tauxH: parseFloat(e.taux_h) || 11.27,
            heuresHebdo: parseFloat(e.heures_hebdo) || 35,
            tel: e.phone || '',
            email: e.email || '',
            dateEntree: e.date_entree || e.created_at?.slice(0, 10) || '',
            contrat: e.contrat || 'CDI',
            dateFin: e.date_fin || '',
          })),
        ];
        setUsersData(merged);
        // Positionne l'utilisateur courant sur le compte réellement connecté (par email).
        // Sinon (ex. gérant externe sans email), garde le défaut (index 0 = Jean Claude).
        const idx = findUserIndexByEmail(merged, authUser?.email);
        if (idx >= 0) setCurrentUserIdx(idx);
        // Droits réels = rôle du compte connecté (et non l'utilisateur affiché).
        setRealIsGerant(idx >= 0 && merged[idx].role === 'gerant');
      }
    };
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ABSENCE_SHIFTS = ['repos', 'maladie', 'conges', 'absence'];
  const todayStaff = useMemo(() => employees.map(emp => {
    const sched = schedule[emp.name]?.[TODAY];
    const isAbsent = !sched || ABSENCE_SHIFTS.includes(sched);
    const shiftLabels = { maladie: '🤒 Maladie', conges: '🌴 Congés', absence: '⚠️ Absent' };
    return {
      name: emp.name,
      role: emp.poste || emp.role,
      shift: isAbsent ? (shiftLabels[sched] || '—') : sched,
      status: isAbsent ? 'absent' : 'present'
    };
  }), [employees, schedule]);
  const effectiveSection = (!isGerant && section === "dashboard") ? "tasks" : section;
  const effectiveDate = isGerant ? viewDate : TODAY;
  const overdueTasks = useMemo(() => tasks.filter(isOverdue), [tasks]);
  const todayTasks = useMemo(() => tasks.filter(tk => tk.dueDate === TODAY), [tasks]);
  const viewTasks = useMemo(() => {
    if (effectiveDate === "overdue") return overdueTasks.filter(tk => !isGerant || !gerantMyTasks || tk.assignee === currentUser.name);
    const base = tasks.filter(tk => tk.dueDate === effectiveDate);
    if (isGerant && gerantMyTasks) return base.filter(tk => tk.assignee === currentUser.name);
    return base;
  }, [tasks, effectiveDate, overdueTasks, isGerant, gerantMyTasks, currentUser.name]);

  const _pmap = { haute: 'high', moyenne: 'medium', basse: 'low' };
  const addTask = async (d) => {
    const { addToTemplates, tmplCreneau, ...td } = d;
    const tmpId = nid.current++;
    setTasks(p => [...p, { id: tmpId, ...td, status: "todo", completedBy: null }]);
    setShowModal(false);
    const { data } = await supabase.from('tasks').insert({
      title: td.title, assignee_name: td.assignee, category: td.category,
      priority: _pmap[td.priority] || 'medium', status: 'todo', due_date: td.dueDate,
    }).select().single();
    if (data) setTasks(p => p.map(tk => tk.id === tmpId ? { ...tk, id: data.id } : tk));
    if (addToTemplates && tmplCreneau) {
      await addTemplate({ title: td.title, category: td.category, priority: td.priority, creneau: tmplCreneau });
    }
  };
  const toggleTask = (id) => setTasks(p => p.map(tk => {
    if (tk.id !== id) return tk;
    const ns = tk.status === "done" ? "todo" : "done";
    const cb = ns === "done" ? (currentUser.name === "Jean Claude" ? tk.assignee : currentUser.name) : null;
    supabase.from('tasks').update({ status: ns, completed_by_name: cb, updated_at: new Date().toISOString() }).eq('id', id).then(() => {});
    return { ...tk, status: ns, completedBy: cb };
  }));
  const moveTask = (id, s) => setTasks(p => p.map(tk => {
    if (tk.id !== id) return tk;
    const cb = s === "done" ? (currentUser.name === "Jean Claude" ? tk.assignee : currentUser.name) : null;
    supabase.from('tasks').update({ status: s, completed_by_name: cb, updated_at: new Date().toISOString() }).eq('id', id).then(() => {});
    return { ...tk, status: s, completedBy: cb };
  }));
  const delTask = (id) => {
    setTasks(p => p.filter(tk => tk.id !== id)); setEditingTask(null);
    supabase.from('tasks').delete().eq('id', id).then(() => {});
  };
  const delTasks = (ids) => {
    if (!ids.length) return;
    setTasks(p => p.filter(tk => !ids.includes(tk.id)));
    supabase.from('tasks').delete().in('id', ids).then(() => {});
  };
  const [editingTask, setEditingTask] = useState(null);
  const [etTitle, setEtTitle] = useState("");
  const [etAssignee, setEtAssignee] = useState("");
  const [etCategory, setEtCategory] = useState("");
  const [etPriority, setEtPriority] = useState("");
  const [etDueDate, setEtDueDate] = useState("");
  const [etConfirmDel, setEtConfirmDel] = useState(false);
  const openEditTask = (tk) => { setEtTitle(tk.title); setEtAssignee(tk.assignee); setEtCategory(tk.category); setEtPriority(tk.priority); setEtDueDate(tk.dueDate); setEtConfirmDel(false); setEditingTask(tk); };
  const saveEditTask = () => {
    if (!editingTask || !etTitle.trim()) return;
    setTasks(p => p.map(tk => tk.id === editingTask.id ? { ...tk, title: etTitle, assignee: etAssignee, category: etCategory, priority: etPriority, dueDate: etDueDate } : tk));
    setEditingTask(null);
    supabase.from('tasks').update({ title: etTitle, assignee_name: etAssignee, category: etCategory, priority: _pmap[etPriority] || 'medium', due_date: etDueDate, updated_at: new Date().toISOString() }).eq('id', editingTask.id).then(() => {});
  };

  // ─── CATÉGORIES DE TÂCHES (CRUD, gérant) ───
  const addCategory = async (name) => {
    const clean = (name || '').trim();
    if (!clean) return { error: 'Nom vide.' };
    if (categories.some(c => c.name.toLowerCase() === clean.toLowerCase())) return { error: 'Cette catégorie existe déjà.' };
    const sort_order = categories.reduce((m, c) => Math.max(m, c.sort_order ?? 0), 0) + 1;
    const { data, error } = await supabase.from('task_categories').insert({ name: clean, sort_order }).select().single();
    if (error) return { error: error.message };
    setCategories(prev => [...prev, data]);
    return { success: true };
  };
  const renameCategory = async (id, oldName, newName) => {
    const clean = (newName || '').trim();
    if (!clean) return { error: 'Nom vide.' };
    if (oldName === 'Autre') return { error: '« Autre » ne peut pas être renommée.' };
    if (clean === oldName) return { success: true };
    if (categories.some(c => c.id !== id && c.name.toLowerCase() === clean.toLowerCase())) return { error: 'Ce nom est déjà pris.' };
    const { error } = await supabase.from('task_categories').update({ name: clean }).eq('id', id);
    if (error) return { error: error.message };
    setCategories(prev => prev.map(c => c.id === id ? { ...c, name: clean } : c));
    await supabase.from('tasks').update({ category: clean }).eq('category', oldName);
    setTasks(prev => prev.map(tk => tk.category === oldName ? { ...tk, category: clean } : tk));
    return { success: true };
  };
  const deleteCategory = async (id, name) => {
    if (name === 'Autre') return { error: '« Autre » ne peut pas être supprimée.' };
    await supabase.from('tasks').update({ category: 'Autre' }).eq('category', name);
    setTasks(prev => prev.map(tk => tk.category === name ? { ...tk, category: 'Autre' } : tk));
    const { error } = await supabase.from('task_categories').delete().eq('id', id);
    if (error) return { error: error.message };
    setCategories(prev => prev.filter(c => c.id !== id));
    return { success: true };
  };

  // ─── TÂCHES HABITUELLES (catalogue, CRUD gérant) ───
  const addTemplate = async ({ title, category, priority, creneau }) => {
    const clean = (title || '').trim();
    if (!clean) return { error: 'Titre vide.' };
    if (templates.some(tp => tp.title.toLowerCase() === clean.toLowerCase() && tp.creneau === creneau)) return { error: 'Cette tâche existe déjà à ce moment.' };
    const sort_order = templates.reduce((m, tp) => Math.max(m, tp.sort_order ?? 0), 0) + 1;
    const { data, error } = await supabase.from('task_templates').insert({ title: clean, category, priority, creneau, sort_order }).select().single();
    if (error) return { error: error.message };
    setTemplates(prev => [...prev, data]);
    return { success: true };
  };
  const updateTemplate = async (id, { title, category, priority, creneau }) => {
    const clean = (title || '').trim();
    if (!clean) return { error: 'Titre vide.' };
    const { error } = await supabase.from('task_templates').update({ title: clean, category, priority, creneau }).eq('id', id);
    if (error) return { error: error.message };
    setTemplates(prev => prev.map(tp => tp.id === id ? { ...tp, title: clean, category, priority, creneau } : tp));
    return { success: true };
  };
  const deleteTemplate = async (id) => {
    const { error } = await supabase.from('task_templates').delete().eq('id', id);
    if (error) return { error: error.message };
    setTemplates(prev => prev.filter(tp => tp.id !== id));
    return { success: true };
  };

  const empBadge = isGerant ? todayTasks.filter(tk => tk.status !== "done").length + overdueTasks.length : todayTasks.filter(tk => tk.assignee === currentUser.name && tk.status !== "done").length;
  const stockAlertCount = alertProductsOf(products).length;
  const pendingSortiesCount = sorties.filter(s => s.status === "pending").length;

  const navItems = isGerant ? [
    { id: "dashboard", label: "Tableau de bord", icon: I.dashboard },
    { id: "tasks", label: "Tâches", icon: I.tasks, badge: empBadge },
    { id: "equipe", label: "Équipe", icon: I.users },
    { id: "planning", label: "Planning & RH", icon: I.calendar },
    { id: "stocks", label: "Stocks", icon: I.box, badge: stockAlertCount + pendingSortiesCount },
    { id: "orders", label: "Commandes", icon: I.orders },
    { id: "finances", label: "Finances", icon: I.euro },
    { id: "settings", label: "Paramètres", icon: I.settings },
  ] : [
    { id: "tasks", label: "Mes tâches", icon: I.tasks, badge: empBadge },
    { id: "planning", label: "Mon planning", icon: I.users },
    { id: "stocks", label: "Stocks", icon: I.box },
    { id: "settings", label: "Paramètres", icon: I.settings },
  ];

  const ss = { padding: "7px 12px", borderRadius: 8, border: `1px solid ${t.border}`, fontSize: 13, fontFamily: F, background: t.surface, color: t.text, outline: "none", cursor: "pointer" };

  const [showMobileMenu, setShowMobileMenu] = useState(false);

  // Mobile bottom bar items (max 5)
  const mobileNavItems = isGerant
    ? [{ id:"dashboard", label:"Accueil", icon:I.dashboard }, { id:"equipe", label:"Équipe", icon:I.users }, { id:"planning", label:"Planning", icon:I.calendar }, { id:"tasks", label:"Tâches", icon:I.tasks, badge:empBadge }, { id:"more", label:"Plus", icon:I.settings }]
    : [{ id:"tasks", label:"Tâches", icon:I.tasks, badge:empBadge }, { id:"planning", label:"Planning", icon:I.users }, { id:"stocks", label:"Stocks", icon:I.box }, { id:"settings", label:"Réglages", icon:I.settings }];

  return (
    <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", height: "100vh", fontFamily: F, background: t.bg, color: t.text, overflow: "hidden" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />

      {/* ── Desktop Sidebar ── */}
      {!isMobile && (
        <nav style={{ width: 230, background: t.sidebar, color: t.sidebarText, display: "flex", flexDirection: "column", padding: "20px 0", flexShrink: 0 }}>
          <div style={{ padding: "0 20px 24px", borderBottom: `1px solid ${t.sidebarText}22` }}>
            <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: -0.5 }}><span style={{ color: t.sidebarAccent }}>●</span> Kimiko</div>
            <div style={{ fontSize: 12, opacity: 0.5, marginTop: 2 }}>Street food coréenne</div>
          </div>
          {realIsGerant && (
          <div style={{ padding: "12px 14px", borderBottom: `1px solid ${t.sidebarText}15` }}>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1, color: t.sidebarText + "66", marginBottom: 6, fontFamily: F }}>Connecté en tant que</div>
            <select value={currentUserIdx} onChange={e => { setCurrentUserIdx(+e.target.value); setSection(usersData[+e.target.value].role === "gerant" ? "dashboard" : "tasks"); setViewDate(TODAY); setShowHistory(false); setGerantMyTasks(false); }}
              style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: `1px solid ${t.sidebarText}33`, background: t.sidebarText + "11", color: t.sidebarText, fontSize: 13, fontWeight: 600, fontFamily: F, cursor: "pointer", outline: "none" }}>
              {usersData.map((u, i) => <option key={i} value={i} style={{ color: "#000" }}>{u.name} ({u.role === "gerant" ? "Gérant" : "Employé"})</option>)}
            </select>
          </div>
          )}
          <div style={{ flex: 1, padding: "16px 10px", display: "flex", flexDirection: "column", gap: 2 }}>
            {navItems.map(item => (
              <button key={item.id} onClick={() => { setSection(item.id); if (item.id === "tasks") { setShowHistory(false); setViewDate(TODAY); } }} style={{
                display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 8, border: "none", cursor: "pointer",
                background: effectiveSection === item.id ? t.sidebarAccent + "22" : "transparent", color: effectiveSection === item.id ? t.sidebarAccent : t.sidebarText,
                fontSize: 14, fontWeight: effectiveSection === item.id ? 600 : 400, fontFamily: F, textAlign: "left", width: "100%",
              }} onMouseEnter={e => { if (effectiveSection !== item.id) e.currentTarget.style.background = t.sidebarText + "0D"; }} onMouseLeave={e => { if (effectiveSection !== item.id) e.currentTarget.style.background = "transparent"; }}>
                {item.icon}{item.label}
                {item.badge != null && item.badge > 0 && <span style={{ marginLeft: "auto", background: t.danger, color: "#fff", fontSize: 11, fontWeight: 700, padding: "1px 7px", borderRadius: 10 }}>{item.badge}</span>}
              </button>
            ))}
          </div>
          <div style={{ padding: "12px 14px", borderTop: `1px solid ${t.sidebarText}22` }}>
            <button onClick={() => setShowThemePicker(!showThemePicker)} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "8px 10px", borderRadius: 8, border: "none", cursor: "pointer", background: showThemePicker ? t.sidebarAccent + "22" : "transparent", color: t.sidebarText, fontSize: 13, fontFamily: F, textAlign: "left" }}>
              {I.palette} Thème : {t.name}
            </button>
            {showThemePicker && (<div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap", padding: "0 4px" }}>{Object.entries(themes).map(([k, th]) => (<button key={k} onClick={() => { setThemeKey(k); localStorage.setItem('restoapp-theme', k); setShowThemePicker(false); }} title={th.name} style={{ width: 28, height: 28, borderRadius: 8, border: themeKey === k ? `2px solid ${t.sidebarAccent}` : "2px solid transparent", background: `linear-gradient(135deg, ${th.sidebar} 50%, ${th.primary} 50%)`, cursor: "pointer" }} />))}</div>)}
            {onLogout && (
              <button onClick={onLogout} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "10px 10px", borderRadius: 8, border: `1px solid rgba(220,38,38,0.25)`, cursor: "pointer", background: "rgba(220,38,38,0.08)", color: "#FCA5A5", fontSize: 13, fontFamily: F, textAlign: "left", marginTop: 6 }}
                onMouseEnter={e => { e.currentTarget.style.background = "rgba(220,38,38,0.18)"; e.currentTarget.style.color = "#fff"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "rgba(220,38,38,0.08)"; e.currentTarget.style.color = "#FCA5A5"; }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                Déconnexion
              </button>
            )}
          </div>
        </nav>
      )}

      {/* ── Main Content ── */}
      <main style={{ flex: 1, overflow: "auto", padding: isMobile ? "16px 14px 90px" : "28px 32px" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: isMobile ? 16 : 28 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ fontSize: isMobile ? 18 : 24, fontWeight: 700, margin: 0, letterSpacing: -0.5 }}>
              {effectiveSection === "planning" ? "Planning & RH" : effectiveSection === "equipe" ? "Mon équipe" : effectiveSection === "stocks" ? "Stocks" : effectiveSection === "tasks" ? (isGerant ? (showHistory ? "Historique" : viewDate === "overdue" ? "En retard" : "Tâches") : `Bonjour, ${currentUser.name} 👋`) : (isMobile ? "Kimiko" : `Bonjour, ${currentUser.name} 👋`)}
            </h1>
            {!isMobile && <p style={{ fontSize: 14, color: t.textMuted, margin: "4px 0 0" }}>{TODAY_LABEL} — Bon service ! 🔥 {!isGerant && <span style={{ marginLeft: 8, fontWeight: 600, color: t.primary }}>Vue employé</span>}</p>}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
            {isMobile && realIsGerant && (
              <select value={currentUserIdx} onChange={e => { setCurrentUserIdx(+e.target.value); setSection(usersData[+e.target.value].role === "gerant" ? "dashboard" : "tasks"); }} style={{ padding: "7px 10px", borderRadius: 10, border: `1.5px solid ${t.primary}40`, fontSize: 13, fontFamily: F, fontWeight: 600, background: t.surface, color: t.text, outline: "none", maxWidth: 150, minWidth: 110, boxShadow: "0 1px 4px rgba(0,0,0,0.08)", cursor: "pointer" }}>
                {usersData.map((u, i) => <option key={i} value={i} style={{ color: "#000" }}>{u.name} {u.role === "gerant" ? "👑" : ""}</option>)}
              </select>
            )}
            <button style={{ position: "relative", width: 36, height: 36, borderRadius: 10, border: `1px solid ${t.border}`, background: t.surface, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: t.text }}>{I.bell}{empBadge > 0 && <span style={{ position: "absolute", top: 4, right: 4, width: 8, height: 8, borderRadius: "50%", background: t.danger }} />}</button>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: t.primary, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14 }}>{currentUser.initials}</div>
          </div>
        </div>

        {/* TASKS */}
        {effectiveSection === "tasks" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
              {isGerant ? <DateNav viewDate={viewDate} setViewDate={(d) => { setViewDate(d); setShowHistory(false); }} t={t} showHistory={showHistory} setShowHistory={setShowHistory} overdueCount={overdueTasks.length} /> : <div style={{ fontSize: 15, fontWeight: 600, fontFamily: F }}>Tâches du jour — {fmt(TODAY)}</div>}
              {isGerant && !showHistory && <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
                {/* Toggle Toutes / Mes tâches */}
                <div style={{ display:"flex", background:t.surfaceAlt, borderRadius:8, border:`1px solid ${t.border}`, overflow:"hidden" }}>
                  <button onClick={() => setGerantMyTasks(false)} style={{ padding:"8px 14px", border:"none", cursor:"pointer", fontSize:13, fontWeight:600, fontFamily:F, background:!gerantMyTasks ? t.primary : "transparent", color:!gerantMyTasks ? "#fff" : t.textMuted, transition:"all 0.15s" }}>Toutes</button>
                  <button onClick={() => setGerantMyTasks(true)} style={{ padding:"8px 14px", border:"none", cursor:"pointer", fontSize:13, fontWeight:600, fontFamily:F, background:gerantMyTasks ? t.primary : "transparent", color:gerantMyTasks ? "#fff" : t.textMuted, transition:"all 0.15s" }}>Mes tâches</button>
                </div>
                <button onClick={openTemplateModal} style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 16px", borderRadius:10, border:`1.5px solid ${t.accent||'#CA8A04'}`, background:"transparent", color:t.accent||'#CA8A04', fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:F }}>📋 Template du jour</button>
                <button onClick={() => setShowTemplatesEditor(true)} style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 16px", borderRadius:10, border:`1.5px solid ${t.border}`, background:"transparent", color:t.textMuted, fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:F }}>🛠️ Habituelles</button>
                <button onClick={() => setShowModal(true)} style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 20px", borderRadius:10, border:"none", background:t.primary, color:"#fff", fontWeight:600, fontSize:14, cursor:"pointer", fontFamily:F }} onMouseEnter={e => e.currentTarget.style.background = t.primaryHover} onMouseLeave={e => e.currentTarget.style.background = t.primary}>{I.plus} Nouvelle tâche</button>
              </div>}
            </div>
            {showHistory && isGerant ? <HistoryView tasks={tasks} t={t} /> : (<>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
                {isGerant && <div style={{ display: "flex", background: t.surfaceAlt, borderRadius: 8, border: `1px solid ${t.border}`, overflow: "hidden" }}>{[{ key: "checklist", icon: I.list, label: "Liste" }, { key: "kanban", icon: I.kanban, label: "Kanban" }, { key: "semaine", icon: "🗓️", label: "Semaine" }].map(v => (<button key={v.key} onClick={() => setTaskView(v.key)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: F, background: taskView === v.key ? t.primary : "transparent", color: taskView === v.key ? "#fff" : t.textMuted }}>{v.icon}{v.label}</button>))}</div>}
                {isGerant && taskView !== "semaine" && <select value={fA} onChange={e => setFA(e.target.value)} style={ss}><option value="">Tous</option>{employees.map(e => <option key={e.name}>{e.name}</option>)}</select>}
                {taskView !== "semaine" && (<select value={fC} onChange={e => setFC(e.target.value)} style={ss}><option value="">Toutes catégories</option>{catNames.map(c => <option key={c}>{c}</option>)}</select>)}
              </div>
              {isGerant && taskView !== "semaine" && <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: isMobile ? 8 : 12, marginBottom: isMobile ? 12 : 20 }}>{[{label:"À faire",val:viewTasks.filter(tk=>tk.status==="todo").length,color:t.primary},{label:"En cours",val:viewTasks.filter(tk=>tk.status==="doing").length,color:t.warning},{label:"Terminées",val:viewTasks.filter(tk=>tk.status==="done").length,color:t.success},{label:"Total",val:viewTasks.length,color:t.textMuted}].map((s,i)=>(<div key={i} style={{ background:t.surface, borderRadius:10, padding:"14px 18px", border:`1px solid ${t.border}`, display:"flex", alignItems:"center", gap:12 }}><span style={{ width:10, height:10, borderRadius:"50%", background:s.color }} /><div><div style={{ fontSize:12, color:t.textMuted }}>{s.label}</div><div style={{ fontSize:22, fontWeight:700 }}>{s.val}</div></div></div>))}</div>}
              {(isGerant && taskView === "semaine") ? <Suspense fallback={<Loading />}><SemaineView tasks={tasks} setTasks={setTasks} employees={employees} schedule={schedule} t={t} templates={tmpl} /></Suspense>
                : (isGerant && taskView === "kanban") ? <KanbanView tasks={viewTasks} onMove={moveTask} onDelete={delTask} t={t} fA={fA} fC={fC} />
                : <ChecklistView key={`cl-${effectiveDate}-${fA}-${fC}`} tasks={viewTasks} onToggle={toggleTask} onDelete={delTask} onEdit={openEditTask} onBulkDelete={delTasks} t={t} fA={fA} fC={fC} isGerant={isGerant} currentUserName={currentUser.name} />}
            </>)}
          </div>
        )}

        {/* ÉQUIPE */}
        {effectiveSection === "equipe" && isGerant && (
          <Suspense fallback={<Loading />}><EquipeModule t={t} employees={employees} usersData={usersData} setUsersData={setUsersData} isMobile={isMobile} /></Suspense>
        )}

        {/* PLANNING */}
        {effectiveSection === "planning" && (
          <Suspense fallback={<Loading />}><PlanningModule t={t} schedule={schedule} setSchedule={setSchedule} pointage={initialPointage} isGerant={isGerant} currentUserName={currentUser.name} employees={employees} /></Suspense>
        )}

        {/* DASHBOARD */}
        {effectiveSection === "dashboard" && isGerant && (
          <>
            {/* Bannière Kimiko */}
            <div style={{ background: `linear-gradient(135deg, ${t.sidebar} 0%, ${t.sidebar}DD 60%, ${t.primary}99 100%)`, borderRadius: isMobile ? 14 : 18, padding: isMobile ? "20px 18px" : "28px 32px", marginBottom: isMobile ? 16 : 24, display: "flex", alignItems: "center", gap: isMobile ? 16 : 28, overflow: "hidden", position: "relative" }}>
              <div style={{ flex: 1, zIndex: 1 }}>
                <div style={{ fontSize: isMobile ? 24 : 32, fontWeight: 700, color: "#fff", letterSpacing: -0.5, lineHeight: 1.1, fontFamily: F }}>Kimiko</div>
                <div style={{ fontSize: isMobile ? 13 : 15, color: "#ffffff99", marginTop: 4, fontFamily: F }}>Street food coréenne · Orléans</div>
                <div style={{ fontSize: isMobile ? 13 : 15, color: "#fff", marginTop: isMobile ? 10 : 14, fontWeight: 500, fontFamily: F }}>Bonjour, {currentUser.name} 👋</div>
                <div style={{ fontSize: isMobile ? 11 : 13, color: "#ffffff77", marginTop: 2, fontFamily: F }}>{TODAY_LABEL} — Bon service ! 🔥</div>
              </div>
              <img src={BANNER_IMAGE} alt="Kimiko corn dog" style={{ width: isMobile ? 70 : 100, height: isMobile ? 70 : 100, borderRadius: 14, objectFit: "cover", flexShrink: 0, boxShadow: "0 4px 16px rgba(0,0,0,0.3)" }} />
              <div style={{ position: "absolute", top: -20, right: -20, width: 120, height: 120, borderRadius: "50%", background: t.primary + "15" }} />
              <div style={{ position: "absolute", bottom: -30, left: "40%", width: 80, height: 80, borderRadius: "50%", background: "#ffffff08" }} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr", gap: isMobile ? 10 : 16, marginBottom: isMobile ? 16 : 28 }}>
              {(() => {
                const presents = todayStaff.filter(s => s.status === 'present');
                const absents = todayStaff.filter(s => s.status === 'absent');
                const total = todayStaff.length;
                const absentNames = absents.map(s => s.name).join(', ');
                const subTxt = absents.length === 0 ? 'Toute l\'équipe est présente' : `${absents.length} absence${absents.length > 1 ? 's' : ''} (${absentNames})`;
                return <StatCard label="Équipe présente" value={`${presents.length}/${total}`} sub={subTxt} icon={I.users} color={absents.length > 0 ? t.warning : t.success} t={t} onClick={() => setSection("planning")} />;
              })()}
              <StatCard label="Tâches du jour" value={`${todayTasks.filter(tk => tk.status === "done").length}/${todayTasks.length}`} sub={overdueTasks.length > 0 ? `${todayTasks.filter(tk => tk.status !== "done").length} restantes · ${overdueTasks.length} en retard` : `${todayTasks.filter(tk => tk.status !== "done").length} restantes`} icon={I.tasks} color={overdueTasks.length > 0 ? t.danger : t.primary} t={t} onClick={() => setSection("tasks")} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? 12 : 20 }}>
              <div style={{ background: t.surface, borderRadius: 14, border: `1px solid ${t.border}`, padding: 22 }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}><h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Équipe du jour</h2><button onClick={() => setSection("planning")} style={{ fontSize: 13, color: t.primary, background: "none", border: "none", cursor: "pointer", fontWeight: 600, fontFamily: F, display: "flex", alignItems: "center", gap: 4 }}>Voir planning {I.chevron}</button></div><div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{todayStaff.map((s, i) => (<div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 10, background: t.surfaceAlt }}><div style={{ width: 34, height: 34, borderRadius: 8, background: t.primary + "18", color: t.primary, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13, flexShrink: 0 }}>{s.name[0]}</div><div style={{ flex: 1 }}><div style={{ fontSize: 14, fontWeight: 600 }}>{s.name}</div><div style={{ fontSize: 12, color: t.textMuted }}>{s.role} · {s.shift}</div></div><StatusBadge status={s.status} t={t} /></div>))}</div></div>
              <div style={{ background: t.surface, borderRadius: 14, border: `1px solid ${t.border}`, padding: 22 }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}><h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Alertes stock</h2><button onClick={() => setSection("stocks")} style={{ fontSize: 13, color: t.primary, background: "none", border: "none", cursor: "pointer", fontWeight: 600, fontFamily: F, display: "flex", alignItems: "center", gap: 4 }}>Voir stocks {I.chevron}</button></div><div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{stockAlerts.map((s, i) => (<div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 10, background: s.urgency === "high" ? t.danger + "0A" : t.surfaceAlt, border: s.urgency === "high" ? `1px solid ${t.danger}22` : "1px solid transparent" }}><div style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: s.urgency === "high" ? t.danger : s.urgency === "medium" ? t.warning : t.success }} /><div style={{ flex: 1 }}><div style={{ fontSize: 14, fontWeight: 600 }}>{s.item}</div><div style={{ fontSize: 12, color: t.textMuted }}>Reste {s.qty} — seuil : {s.seuil}</div></div></div>))}</div></div>
            </div>
            <div style={{ marginTop: 20, background: t.surface, borderRadius: 14, border: `1px solid ${t.border}`, padding: "18px 22px", display: "flex", alignItems: "center", gap: 16 }}><div style={{ width: 40, height: 40, borderRadius: 10, background: t.success + "18", color: t.success, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{I.check}</div><div style={{ flex: 1 }}><div style={{ fontWeight: 700, fontSize: 14 }}>Conformité HACCP</div><div style={{ fontSize: 13, color: t.textMuted }}>3/5 relevés de température · Checklist nettoyage : 60%</div></div><button style={{ padding: "8px 18px", borderRadius: 8, border: "none", background: t.primary, color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: F }} onMouseEnter={e => e.currentTarget.style.background = t.primaryHover} onMouseLeave={e => e.currentTarget.style.background = t.primary}>Compléter les relevés</button></div>
          </>
        )}

        {/* STOCKS */}
        {effectiveSection === "stocks" && (
          <Suspense fallback={<Loading />}><StocksModule t={t} products={products} setProducts={setProducts}
  sorties={sorties} setSorties={setSorties} suppliers={suppliers} setSuppliers={setSuppliers}
  productSuppliers={productSuppliers} setProductSuppliers={setProductSuppliers}
  isGerant={isGerant} currentUserName={currentUser.name} /></Suspense>
        )}

        {/* PARAMÈTRES */}
        {effectiveSection === "settings" && isGerant && (
          <Suspense fallback={<Loading />}><SettingsModule t={t} F={F} authUser={authUser} categories={categories} onAddCategory={addCategory} onRenameCategory={renameCategory} onDeleteCategory={deleteCategory} /></Suspense>
        )}

        {/* Placeholder */}
        {!["dashboard", "tasks", "planning", "stocks", "equipe", "settings"].includes(effectiveSection) && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "60vh", color: t.textMuted }}>
            <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>🚧</div>
            <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>Module « {navItems.find(n => n.id === effectiveSection)?.label || effectiveSection} »</div>
            <div style={{ fontSize: 14 }}>En cours de développement</div>
          </div>
        )}
      </main>

      {/* ── Mobile Bottom Bar ── */}
      {isMobile && (
        <nav style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: t.surface, borderTop: `1px solid ${t.border}`, display: "flex", justifyContent: "space-around", alignItems: "center", padding: "6px 0 env(safe-area-inset-bottom, 8px)", zIndex: 900 }}>
          {mobileNavItems.map(item => {
            const isActive = item.id === "more" ? showMobileMenu : effectiveSection === item.id;
            return (
              <button key={item.id} onClick={() => {
                if (item.id === "more") { setShowMobileMenu(!showMobileMenu); }
                else { setSection(item.id); setShowMobileMenu(false); if (item.id === "tasks") { setShowHistory(false); setViewDate(TODAY); } }
              }} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: "6px 12px", border: "none", cursor: "pointer", background: "transparent", color: isActive ? t.primary : t.textMuted, fontFamily: F, minWidth: 50, position: "relative" }}>
                {item.icon}
                <span style={{ fontSize: 10, fontWeight: isActive ? 700 : 500 }}>{item.label}</span>
                {item.badge != null && item.badge > 0 && <span style={{ position: "absolute", top: 2, right: 6, width: 16, height: 16, borderRadius: "50%", background: t.danger, color: "#fff", fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{item.badge}</span>}
              </button>
            );
          })}
        </nav>
      )}

      {/* ── Mobile "More" Menu ── */}
      {isMobile && showMobileMenu && (
        <div style={{ position: "fixed", bottom: 60, left: 0, right: 0, background: t.surface, borderTop: `1px solid ${t.border}`, padding: "12px 16px", zIndex: 899, boxShadow: "0 -4px 20px rgba(0,0,0,0.1)" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {[{ id: "stocks", label: "Stocks", icon: I.box, badge: stockAlertCount+pendingSortiesCount }, { id: "orders", label: "Commandes", icon: I.orders }, { id: "finances", label: "Finances", icon: I.euro }, { id: "settings", label: "Paramètres", icon: I.settings }].map(item => (
              <button key={item.id} onClick={() => { setSection(item.id); setShowMobileMenu(false); }} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 10, border: "none", cursor: "pointer", background: effectiveSection === item.id ? t.primary + "12" : "transparent", color: effectiveSection === item.id ? t.primary : t.text, fontSize: 14, fontWeight: 500, fontFamily: F, textAlign: "left", width: "100%" }}>
                {item.icon}{item.label}
              </button>
            ))}
            <div style={{ borderTop: `1px solid ${t.border}`, marginTop: 4, paddingTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
              {Object.entries(themes).map(([k, th]) => (<button key={k} onClick={() => { setThemeKey(k); localStorage.setItem('restoapp-theme', k); setShowMobileMenu(false); }} style={{ width: 32, height: 32, borderRadius: 8, border: themeKey === k ? `2px solid ${t.primary}` : `2px solid ${t.border}`, background: `linear-gradient(135deg, ${th.sidebar} 50%, ${th.primary} 50%)`, cursor: "pointer" }} />))}
            </div>
            {onLogout && (
              <button onClick={onLogout} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "12px 14px", borderRadius: 10, border: `1px solid ${t.danger}22`, cursor: "pointer", background: t.danger + "08", color: t.danger, fontSize: 14, fontWeight: 600, fontFamily: F, textAlign: "left", marginTop: 4 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                Déconnexion
              </button>
            )}
          </div>
        </div>
      )}

      {showModal && <TaskModal onClose={() => setShowModal(false)} onSave={addTask} t={t} defaultDate={viewDate !== "overdue" ? viewDate : TODAY} employees={employees} categories={catNames} templates={tmpl} />}

      {showTemplatesEditor && <Suspense fallback={<Loading />}><TaskTemplatesModule t={t} F={F} templates={templates} categories={catNames} onAdd={addTemplate} onUpdate={updateTemplate} onDelete={deleteTemplate} onClose={() => setShowTemplatesEditor(false)} /></Suspense>}

      {/* ── MODAL TEMPLATE DU JOUR ── */}
      {showTemplateModal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(26,10,0,0.55)", display:"flex", alignItems:"flex-end", justifyContent:"center", zIndex:1000 }} onClick={() => setShowTemplateModal(false)}>
          <div style={{ background:t.surface, borderRadius:"24px 24px 0 0", width:"100%", maxWidth:560, maxHeight:"88vh", overflowY:"auto", paddingBottom:32, boxShadow:"0 -8px 40px rgba(0,0,0,0.2)" }} onClick={e => e.stopPropagation()}>
            {/* Handle */}
            <div style={{ width:36, height:4, background:t.border, borderRadius:2, margin:"12px auto 0" }} />
            {/* Top gradient bar */}
            <div style={{ height:3, background:"linear-gradient(90deg,#DC2626,#CA8A04)", borderRadius:"0 0 3px 3px", margin:"0 24px" }} />
            {/* Header */}
            <div style={{ padding:"20px 24px 0", display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
              <div>
                <div style={{ fontSize:20, fontWeight:700, color:t.text, fontFamily:F, letterSpacing:-0.01 }}>Template journalier Kimiko</div>
                <div style={{ fontSize:13, color:t.textMuted, fontFamily:F, marginTop:4 }}>
                  {templateAssignments.length} tâches · {[...new Set(templateAssignments.map(a=>a.assignee))].length} employés présents
                </div>
              </div>
              <button onClick={() => setShowTemplateModal(false)} style={{ background:"none", border:`1px solid ${t.border}`, borderRadius:"50%", width:32, height:32, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", color:t.textMuted, fontSize:16 }}>✕</button>
            </div>
            {/* Stats */}
            <div style={{ display:"flex", gap:10, padding:"16px 24px" }}>
              {[
                { label:"Ouverture 🌅", val: templateAssignments.filter(a=>a.creneau==='ouverture').length, color:"#F97316" },
                { label:"Service 🍽️",   val: templateAssignments.filter(a=>a.creneau==='service').length,   color:t.primary },
                { label:"Fermeture 🌙", val: templateAssignments.filter(a=>a.creneau==='fermeture').length, color:"#6366F1" },
              ].map(s => (
                <div key={s.label} style={{ flex:1, background:t.bg, border:`1px solid ${t.border}`, borderRadius:12, padding:"10px 12px", textAlign:"center" }}>
                  <div style={{ fontSize:20, fontWeight:700, color:s.color, fontFamily:F }}>{s.val}</div>
                  <div style={{ fontSize:10, color:t.textMuted, fontFamily:F, marginTop:2 }}>{s.label}</div>
                </div>
              ))}
            </div>
            {/* Date */}
            <div style={{ padding:"0 24px 16px" }}>
              <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", color:t.textMuted, marginBottom:8, fontFamily:F }}>Date d'assignation</div>
              <input type="date" value={templateDate} onChange={async e => { setTemplateDate(e.target.value); setEditingTemplateIdx(null); await genererTemplate(e.target.value, seedRef.current); }}
                style={{ width:"100%", padding:"10px 14px", borderRadius:10, border:`1.5px solid ${t.border}`, fontFamily:F, fontSize:14, color:t.text, background:t.surface, outline:"none" }} />
            </div>
            {/* Info planning */}
            {templateAssignments.length > 0 && templateAssignments[0].noPlanning && (
              <div style={{ margin:"0 24px 16px", padding:"12px 16px", borderRadius:10, background:"#FEF3C7", border:"1px solid #FDE68A", fontSize:13, color:"#854D0E", fontFamily:F }}>
                ℹ️ Aucun planning trouvé pour ce jour — toutes les tâches sont réparties entre tous les employés. Tu peux <strong>Répartir aléatoirement</strong> ou remplir le planning d'abord.
              </div>
            )}
            {/* Task list */}
            {["ouverture","service","fermeture"].map(creneau => {
              const creneauIdxs = templateAssignments.reduce((acc, a, i) => { if (a.creneau === creneau) acc.push(i); return acc; }, []);
              if (!creneauIdxs.length) return null;
              const labels = { ouverture:"🌅 Ouverture", service:"🍽️ Service", fermeture:"🌙 Fermeture" };
              const colors = { ouverture:"#F97316", service:t.primary, fermeture:"#6366F1" };
              const empOptions = usersData.filter(u => u.name !== "Jean Claude");
              return (
                <div key={creneau} style={{ padding:"0 24px", marginBottom:8 }}>
                  <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", color:colors[creneau], marginBottom:8, fontFamily:F }}>{labels[creneau]} · {creneauIdxs.length} tâches</div>
                  {creneauIdxs.map(globalIdx => {
                    const task = templateAssignments[globalIdx];
                    const isEditing = editingTemplateIdx === globalIdx;
                    return (
                      <div key={globalIdx} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", borderRadius:10, border:`1px solid ${isEditing ? colors[creneau] : t.border}`, background:isEditing ? t.bg : t.surface, marginBottom:6, borderLeft:`3px solid ${colors[creneau]}`, transition:"all 0.15s" }}>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:13, fontWeight:600, color:t.text, fontFamily:F, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{task.title}</div>
                          <div style={{ fontSize:11, color:t.textMuted, fontFamily:F, marginTop:2 }}>{task.category} · {task.priority}</div>
                        </div>
                        {isEditing ? (
                          <select autoFocus value={task.assignee}
                            onChange={e => { setTemplateAssignments(prev => prev.map((a, i) => i === globalIdx ? {...a, assignee: e.target.value} : a)); setEditingTemplateIdx(null); }}
                            onBlur={() => setEditingTemplateIdx(null)}
                            style={{ fontSize:13, fontWeight:700, padding:"4px 8px", borderRadius:8, border:`1.5px solid ${colors[creneau]}`, fontFamily:F, color:t.text, background:t.surface, outline:"none", cursor:"pointer" }}>
                            {empOptions.map(u => <option key={u.name} value={u.name}>{u.name}</option>)}
                          </select>
                        ) : (
                          <button onClick={() => setEditingTemplateIdx(globalIdx)}
                            title="Changer l'assigné"
                            style={{ fontSize:12, fontWeight:700, color:t.text, fontFamily:F, flexShrink:0, background:"none", border:`1px dashed ${t.border}`, borderRadius:8, padding:"4px 10px", cursor:"pointer", display:"flex", alignItems:"center", gap:4 }}>
                            {task.assignee} <span style={{ fontSize:10, color:t.textMuted }}>✏️</span>
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
            {/* Actions */}
            <div style={{ padding:"16px 24px 0", display:"flex", flexDirection:"column", gap:10 }}>
              <button onClick={async () => { seedRef.current = seedRef.current + 1; await genererTemplate(templateDate, seedRef.current); }} style={{ padding:"10px", borderRadius:10, border:`1.5px solid ${t.primary}`, background:"transparent", color:t.primary, fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:F }}>🔀 Régénérer</button>
              <button onClick={loadTemplate} disabled={!templateAssignments.length} style={{ padding:"14px", borderRadius:10, border:"none", background:templateAssignments.length ? t.primary : t.border, color:templateAssignments.length ? "#fff" : t.textMuted, fontSize:15, fontWeight:700, cursor:templateAssignments.length ? "pointer" : "default", fontFamily:F, boxShadow:templateAssignments.length ? "0 4px 14px rgba(220,38,38,0.35)" : "none" }}>
                📋 Charger {templateAssignments.length} tâches
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit task modal */}
      {editingTask && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={() => { setEditingTask(null); setEtConfirmDel(false); }}>
          <div style={{ background: t.surface, borderRadius: 16, padding: 28, width: 460, maxWidth: "92vw", boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, fontFamily: F }}>Modifier la tâche</h2>
              <button onClick={() => { setEditingTask(null); setEtConfirmDel(false); }} style={{ background: "none", border: "none", cursor: "pointer", color: t.textMuted, padding: 4 }}>{I.x}</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div><label style={{ fontSize: 13, fontWeight: 600, color: t.textMuted, marginBottom: 6, display: "block", fontFamily: F }}>Intitulé</label><input value={etTitle} onChange={e => setEtTitle(e.target.value)} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: `1px solid ${t.border}`, fontSize: 14, fontFamily: F, background: t.surface, color: t.text, outline: "none" }} /></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div><label style={{ fontSize: 13, fontWeight: 600, color: t.textMuted, marginBottom: 6, display: "block", fontFamily: F }}>Assigné à</label><select value={etAssignee} onChange={e => setEtAssignee(e.target.value)} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: `1px solid ${t.border}`, fontSize: 14, fontFamily: F, background: t.surface, color: t.text, outline: "none", cursor: "pointer" }}>{employees.map(e => <option key={e.name}>{e.name}</option>)}</select></div>
                <div><label style={{ fontSize: 13, fontWeight: 600, color: t.textMuted, marginBottom: 6, display: "block", fontFamily: F }}>Date prévue</label><input type="date" value={etDueDate} onChange={e => setEtDueDate(e.target.value)} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: `1px solid ${t.border}`, fontSize: 14, fontFamily: F, background: t.surface, color: t.text, outline: "none", cursor: "pointer" }} /></div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div><label style={{ fontSize: 13, fontWeight: 600, color: t.textMuted, marginBottom: 6, display: "block", fontFamily: F }}>Catégorie</label><select value={etCategory} onChange={e => setEtCategory(e.target.value)} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: `1px solid ${t.border}`, fontSize: 14, fontFamily: F, background: t.surface, color: t.text, outline: "none", cursor: "pointer" }}>{catNames.map(c => <option key={c}>{c}</option>)}</select></div>
                <div><label style={{ fontSize: 13, fontWeight: 600, color: t.textMuted, marginBottom: 8, display: "block", fontFamily: F }}>Priorité</label><div style={{ display: "flex", gap: 6 }}>{priorityList.map(p => (<button key={p} onClick={() => setEtPriority(p)} style={{ flex: 1, padding: "8px 0", borderRadius: 8, fontSize: 12, fontWeight: 600, fontFamily: F, cursor: "pointer", textTransform: "capitalize", background: etPriority === p ? (p === "haute" ? t.danger : p === "moyenne" ? t.warning : t.success) : t.surfaceAlt, color: etPriority === p ? "#fff" : t.textMuted, border: etPriority === p ? "none" : `1px solid ${t.border}` }}>{p}</button>))}</div></div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
              {!etConfirmDel ? (
                <button onClick={() => setEtConfirmDel(true)} style={{ padding: "10px 14px", borderRadius: 8, border: `1px solid ${t.danger}30`, background: t.danger + "08", color: t.danger, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: F, display: "flex", alignItems: "center", gap: 6 }}>{I.trash} Supprimer</button>
              ) : (
                <button onClick={() => delTask(editingTask.id)} style={{ padding: "10px 14px", borderRadius: 8, border: "none", background: t.danger, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: F }}>Confirmer</button>
              )}
              <div style={{ flex: 1 }} />
              <button onClick={() => { setEditingTask(null); setEtConfirmDel(false); }} style={{ padding: "10px 16px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.surface, color: t.textMuted, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: F }}>Annuler</button>
              <button onClick={saveEditTask} style={{ padding: "10px 16px", borderRadius: 8, border: "none", background: etTitle.trim() ? t.primary : t.border, color: etTitle.trim() ? "#fff" : t.textMuted, fontSize: 14, fontWeight: 600, cursor: etTitle.trim() ? "pointer" : "default", fontFamily: F }}>Enregistrer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
