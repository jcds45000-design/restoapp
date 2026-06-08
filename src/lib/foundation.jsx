// Socle partagé : helpers, constantes, thèmes et composants d'affichage (extraits de RestoApp.jsx)
import { useState, useRef, useMemo, useEffect, Fragment } from 'react';
import { I } from './icons';

export const TODAY = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })();
export const getMonday = (d) => { const dt = new Date(d+"T00:00:00"); const day = dt.getDay(); const diff = dt.getDate() - day + (day === 0 ? -6 : 1); dt.setDate(diff); return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`; };
export const WEEK_START = getMonday(TODAY);
export const TODAY_LABEL = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).replace(/^\w/, c => c.toUpperCase());

// ─── IMAGE BANNIÈRE DASHBOARD ───
// 👉 Change cette URL pour modifier l'image du dashboard
export const BANNER_IMAGE = "/hero.png";
export const fmt = (d) => { const dt=new Date(d+"T00:00:00"); const j=["Dim","Lun","Mar","Mer","Jeu","Ven","Sam"]; const m=["jan","fév","mar","avr","mai","juin","juil","août","sep","oct","nov","déc"]; return `${j[dt.getDay()]} ${dt.getDate()} ${m[dt.getMonth()]}`; };
export const fmtShort = (d) => { const dt=new Date(d+"T00:00:00"); return `${dt.getDate()}/${dt.getMonth()+1}`; };
export const addDays = (d,n) => { const dt=new Date(d+"T00:00:00"); dt.setDate(dt.getDate()+n); return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`; };
export const getWeekDays = (start) => Array.from({length:7},(_,i) => addDays(start,i));
export const getDayName = (d) => ["Dim","Lun","Mar","Mer","Jeu","Ven","Sam"][new Date(d+"T00:00:00").getDay()];
export const isOverdue = (tk) => tk.status!=="done" && tk.dueDate<TODAY;
export const calcHours = (shift) => {
  if (!shift || shift === "repos") return 0;
  const parts = shift.split(" / ");
  let total = 0;
  parts.forEach(p => {
    const m = p.match(/(\d+)h?(\d*)\s*[-–]\s*(\d+)h?(\d*)/);
    if (m) {
      const s = parseInt(m[1]) + (m[2] ? parseInt(m[2])/60 : 0);
      const e = parseInt(m[3]) + (m[4] ? parseInt(m[4])/60 : 0);
      total += e - s;
    }
  });
  return Math.round(total * 10) / 10;
};

// ═══════════════════════════════════════
// ─── USERS & DATA ───
// ═══════════════════════════════════════
export const initialUsersData = [
  { id: 0, name: "Jean Claude", role: "gerant", initials: "JC" },
  // Les employés réels sont chargés depuis Supabase au démarrage
];

// Planning: shifts par employé par date — chargé depuis Supabase au démarrage
export const initialSchedule = {};

// Pointage: heures réelles par employé par date — chargé depuis Supabase au démarrage
export const initialPointage = {};

export const categoryList = ["Service","Cuisine","Nettoyage","Stock","Admin","Autre"];
export const priorityList = ["haute","moyenne","basse"];

// ─── TEMPLATE TÂCHES JOURNALIÈRES KIMIKO ───
// créneau: "ouverture" = employés qui commencent avant 14h
//          "fermeture" = employés qui finissent après 21h
//          "service"   = tous les présents
export const TASK_TEMPLATES = [
  // 🌅 OUVERTURE
  { title:"Allumer caisse", category:"Admin", priority:"haute", creneau:"ouverture" },
  { title:"Allumer lumière / clim / chauffage", category:"Admin", priority:"haute", creneau:"ouverture" },
  { title:"Allumer machine à glaçon", category:"Admin", priority:"haute", creneau:"ouverture" },
  { title:"Allumer friteuse", category:"Cuisine", priority:"haute", creneau:"ouverture" },
  { title:"Vérifier rouleau TPE chaque matin", category:"Admin", priority:"haute", creneau:"ouverture" },
  { title:"Poser les bippeurs sur imprimante", category:"Admin", priority:"moyenne", creneau:"ouverture" },
  { title:"Nettoyer écran borne et écran caisse", category:"Nettoyage", priority:"moyenne", creneau:"ouverture" },
  { title:"Sortir les sauces", category:"Cuisine", priority:"haute", creneau:"ouverture" },
  { title:"Faire des étiquettes boîte corndog", category:"Admin", priority:"moyenne", creneau:"ouverture" },
  { title:"Vérifier stock gyoza / œufs / roquette / choux / tomates / poulet à bento / oignons frits / ciboulette / sésame", category:"Stock", priority:"haute", creneau:"ouverture" },
  { title:"Couper le poulet et mariner (15min max pour 10kg)", category:"Cuisine", priority:"haute", creneau:"ouverture" },
  { title:"Faire poulet à bento farine œuf chapelure", category:"Cuisine", priority:"haute", creneau:"ouverture" },
  { title:"Vérifier quantité riz", category:"Stock", priority:"haute", creneau:"ouverture" },
  // 🍽️ SERVICE
  { title:"Dresser plateau / sac emporter (sauce, boisson, serviette, flyer)", category:"Service", priority:"haute", creneau:"service" },
  { title:"Mettre les plats dans chaque commande", category:"Service", priority:"haute", creneau:"service" },
  { title:"Faire les boissons", category:"Service", priority:"haute", creneau:"service" },
  { title:"Appeler les clients avec bippeur", category:"Service", priority:"haute", creneau:"service" },
  { title:"Annoncer les nouvelles commandes", category:"Service", priority:"haute", creneau:"service" },
  { title:"Vaisselle pot de sauce, verre, fourchette, cuillère — toutes les 1h", category:"Nettoyage", priority:"moyenne", creneau:"service" },
  { title:"Nettoyer les toilettes toutes les 1h", category:"Nettoyage", priority:"moyenne", creneau:"service" },
  { title:"Nettoyage des tables salle", category:"Nettoyage", priority:"moyenne", creneau:"service" },
  { title:"Nettoyer plateaux", category:"Nettoyage", priority:"basse", creneau:"service" },
  { title:"Lavage de sol / surface / étagères — toutes les 30 min", category:"Nettoyage", priority:"moyenne", creneau:"service" },
  { title:"Faire vaisselle toutes les 30 min", category:"Nettoyage", priority:"moyenne", creneau:"service" },
  { title:"Vérifier stock sacs / serviettes / soda / fourchettes / agrafes / lait / bonbons / sirops / purées / matcha / pistache", category:"Stock", priority:"haute", creneau:"service" },
  { title:"Remplir frigo boisson", category:"Stock", priority:"moyenne", creneau:"service" },
  { title:"Changer les poubelles", category:"Nettoyage", priority:"moyenne", creneau:"service" },
  { title:"Remplir sauces", category:"Cuisine", priority:"haute", creneau:"service" },
  { title:"Vérifier quantité patates douces / frites / pommes rissolées", category:"Stock", priority:"haute", creneau:"service" },
  { title:"Lancer boneless wings", category:"Cuisine", priority:"haute", creneau:"service" },
  { title:"Vérifier quantité boneless et wings", category:"Stock", priority:"haute", creneau:"service" },
  { title:"Lancer les corndogs", category:"Cuisine", priority:"haute", creneau:"service" },
  { title:"Vérifier quantité corndog — bien fermer sac congélation", category:"Stock", priority:"haute", creneau:"service" },
  { title:"Vérifier pâte corndog", category:"Cuisine", priority:"haute", creneau:"service" },
  { title:"Refaire cuire des œufs", category:"Cuisine", priority:"haute", creneau:"service" },
  { title:"Refaire crème fraîche", category:"Cuisine", priority:"moyenne", creneau:"service" },
  { title:"Faire des frites / patates douces régulièrement", category:"Cuisine", priority:"haute", creneau:"service" },
  { title:"S'occuper des DLC", category:"Stock", priority:"haute", creneau:"service" },
  { title:"Faire le riz", category:"Cuisine", priority:"haute", creneau:"service" },
  { title:"Vérifier les emballages (stock cuisine + cave)", category:"Stock", priority:"moyenne", creneau:"service" },
  { title:"Nettoyer écran KDS", category:"Nettoyage", priority:"basse", creneau:"service" },
  // 🌙 FERMETURE
  { title:"Fermer caisse, vérifier espèces et mettre dans enveloppe", category:"Admin", priority:"haute", creneau:"fermeture" },
  { title:"Éteindre caisse (mardi et jeudi)", category:"Admin", priority:"haute", creneau:"fermeture" },
  { title:"Éteindre machine à glaçon", category:"Admin", priority:"haute", creneau:"fermeture" },
  { title:"Éteindre friteuse", category:"Cuisine", priority:"haute", creneau:"fermeture" },
  { title:"Ranger les sauces", category:"Cuisine", priority:"haute", creneau:"fermeture" },
  { title:"Ranger ciboulette / choux / œufs / tomates / gyoza / poulet à bento / sauces", category:"Cuisine", priority:"haute", creneau:"fermeture" },
  { title:"Nettoyage sol, pieds de table, tables", category:"Nettoyage", priority:"haute", creneau:"fermeture" },
  { title:"Nettoyer mur", category:"Nettoyage", priority:"moyenne", creneau:"fermeture" },
  { title:"Nettoyer escalier", category:"Nettoyage", priority:"moyenne", creneau:"fermeture" },
  { title:"Nettoyer frigo intérieur et extérieur", category:"Nettoyage", priority:"haute", creneau:"fermeture" },
  { title:"Nettoyer pot de sauce et remplir", category:"Nettoyage", priority:"moyenne", creneau:"fermeture" },
  { title:"Remonter 3 farines 1 sucre chaque soir", category:"Stock", priority:"haute", creneau:"fermeture" },
];

// Détermine si un employé travaille à l'ouverture (commence avant 14h)
export const travailleOuverture = (shift) => {
  if (!shift || shift === 'repos' || ['maladie','conges','absence'].includes(shift)) return false;
  const m = shift.match(/(\d+)h/);
  return m && parseInt(m[1]) < 14;
};
// Détermine si un employé travaille à la fermeture (finit après 21h)
export const travailleFermeture = (shift) => {
  if (!shift || shift === 'repos' || ['maladie','conges','absence'].includes(shift)) return false;
  const parts = shift.split(' / ');
  const last = parts[parts.length - 1];
  const m = last.match(/-(\d+)h/);
  return m && parseInt(m[1]) >= 21;
};
// Détermine si un employé est présent (pas absent/repos)
export const estPresent = (shift) => {
  return shift && shift !== 'repos' && !['maladie','conges','absence'].includes(shift);
};

// Tâches — chargées depuis Supabase au démarrage
export const initialTasks = [];

// todayStaff est calculé dynamiquement depuis employees (voir RestoApp)
export const stockCategories = ["Viandes & Poissons","Sauces & Condiments","Légumes & Frais","Sec & Féculents","Boissons","Emballages & Consommables"];
// Produits — chargés depuis Supabase au démarrage
export const initialProducts = [];
// Sorties de stock — chargées depuis Supabase au démarrage
export const initialSorties = [];
// Alertes stock — calculées dynamiquement depuis les produits
export const stockAlerts = [];
// Commandes récentes — chargées depuis Supabase au démarrage
export const recentOrders = [];
// CA hebdomadaire — chargé depuis Supabase au démarrage
export const weeklyCA = [{day:"Lun",value:0},{day:"Mar",value:0},{day:"Mer",value:0},{day:"Jeu",value:0},{day:"Ven",value:0},{day:"Sam",value:0},{day:"Dim",value:0}];

// ═══════════════════════════════════════
// ─── THEMES ───
// ═══════════════════════════════════════
export const themes = {
  kimiko: { name:"Kimiko", primary:"#DC2626", primaryHover:"#B91C1C", primaryLight:"#FEE2E2", accent:"#CA8A04", bg:"#FFFBF5", surface:"#FFFFFF", surfaceAlt:"#FFF8F0", text:"#1A0A00", textMuted:"#6B3A1F", border:"#FEE9D1", success:"#15803D", warning:"#CA8A04", danger:"#DC2626", sidebar:"#1A0A00", sidebarText:"#FFF8F0", sidebarAccent:"#DC2626", cardShadow:"0 4px 20px rgba(202,138,4,0.10), 0 1px 3px rgba(0,0,0,0.05)" },
  ocean: { name:"Océan", primary:"#0077B6", primaryHover:"#005F8A", accent:"#023E58", bg:"#F4F7FA", surface:"#FFFFFF", surfaceAlt:"#F0F4F8", text:"#1A2332", textMuted:"#5A6B7F", border:"#DAE2EB", success:"#2D8A4E", warning:"#D4870E", danger:"#D44040", sidebar:"#023E58", sidebarText:"#E1EBF5", sidebarAccent:"#00B4D8" },
  forest: { name:"Forêt", primary:"#2D6A4F", primaryHover:"#1E4D38", accent:"#1B4332", bg:"#F5F7F5", surface:"#FFFFFF", surfaceAlt:"#F0F5F1", text:"#1A2A1E", textMuted:"#5A6B5F", border:"#D4E2D7", success:"#2D8A4E", warning:"#D4870E", danger:"#D44040", sidebar:"#1B4332", sidebarText:"#D8F0E0", sidebarAccent:"#52B788" },
  neutral: { name:"Neutre Pro", primary:"#4A5568", primaryHover:"#2D3748", accent:"#1A202C", bg:"#F7FAFC", surface:"#FFFFFF", surfaceAlt:"#F0F2F5", text:"#1A202C", textMuted:"#718096", border:"#E2E8F0", success:"#2D8A4E", warning:"#D4870E", danger:"#D44040", sidebar:"#1A202C", sidebarText:"#E2E8F0", sidebarAccent:"#63B3ED" },
};

export const F = "'Noto Sans KR', sans-serif";

// ═══════════════════════════════════════
// ─── ICONS ───
// ═══════════════════════════════════════

// ═══════════════════════════════════════
// ─── SHARED COMPONENTS ───
// ═══════════════════════════════════════
export const StatCard = ({ label, value, sub, icon, color, t, onClick }) => (<div onClick={onClick} style={{ background: t.surface, borderRadius: 14, padding: "20px 22px", border: `1px solid ${t.border}`, display: "flex", alignItems: "flex-start", gap: 14, transition: "box-shadow 0.2s, transform 0.2s", cursor: onClick?"pointer":"default", position:"relative", overflow:"hidden", boxShadow: t.cardShadow||"none" }} onMouseEnter={e => { e.currentTarget.style.boxShadow="0 6px 24px rgba(202,138,4,0.15)"; if(onClick) e.currentTarget.style.transform="translateY(-2px)"; }} onMouseLeave={e => { e.currentTarget.style.boxShadow=t.cardShadow||"none"; e.currentTarget.style.transform="translateY(0)"; }}><div style={{ position:"absolute", top:0, left:0, right:0, height:3, background:"linear-gradient(90deg, #DC2626, #CA8A04)", borderRadius:"14px 14px 0 0" }} /><div style={{ width: 42, height: 42, borderRadius: 10, background: color+"18", display: "flex", alignItems: "center", justifyContent: "center", color, flexShrink: 0 }}>{icon}</div><div><div style={{ fontSize: 13, color: t.textMuted, marginBottom: 4, fontFamily: F }}>{label}</div><div style={{ fontSize: 26, fontWeight: 700, color: t.text, lineHeight: 1.1, fontFamily: F }}>{value}</div>{sub && <div style={{ fontSize: 12, color: t.textMuted, marginTop: 4, fontFamily: F }}>{sub}</div>}</div></div>);
export const MiniChart = ({ data, t }) => { const max=Math.max(...data.map(d=>d.value)); return (<div style={{ display:"flex", alignItems:"flex-end", gap:6, height:80 }}>{data.map((d,i)=>(<div key={i} style={{ display:"flex", flexDirection:"column", alignItems:"center", flex:1 }}><div style={{ width:"100%", maxWidth:32, height: max>0?Math.max(4,(d.value/max)*64):4, background: d.value===0?t.border:t.primary, borderRadius:4, opacity: d.value===0?0.3:(0.5+(d.value/max)*0.5) }} /><span style={{ fontSize:11, color:t.textMuted, marginTop:4, fontFamily:F }}>{d.day}</span></div>))}</div>); };
export const Badge = ({ label, bg, color }) => (<span style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"3px 10px", borderRadius:20, fontSize:12, fontWeight:600, background:bg, color, fontFamily:F }}><span style={{ width:6, height:6, borderRadius:"50%", background:color }} />{label}</span>);
export const StatusBadge = ({ status, t }) => { const m={ present:{bg:t.success+"18",color:t.success,label:"Présent"}, late:{bg:t.warning+"18",color:t.warning,label:"En retard"}, absent:{bg:t.danger+"18",color:t.danger,label:"Absent"}, "en cours":{bg:t.warning+"18",color:t.warning,label:"En cours"}, "prêt":{bg:t.success+"18",color:t.success,label:"Prêt"}, "servi":{bg:t.textMuted+"18",color:t.textMuted,label:"Servi"} }; const c=m[status]||m.present; return <Badge label={c.label} bg={c.bg} color={c.color} />; };
export const PriorityBadge = ({ priority, t }) => { const m={ haute:{bg:t.danger+"15",color:t.danger}, moyenne:{bg:t.warning+"15",color:t.warning}, basse:{bg:t.success+"15",color:t.success} }; return <Badge label={priority} bg={(m[priority]||m.basse).bg} color={(m[priority]||m.basse).color} />; };
export const CategoryTag = ({ category, t }) => (<span style={{ fontSize:11, fontWeight:600, padding:"2px 8px", borderRadius:6, background:t.primary+"12", color:t.primary, fontFamily:F }}>{category}</span>);
export const OverdueBadge = ({ t }) => (<span style={{ display:"inline-flex", alignItems:"center", gap:4, padding:"2px 8px", borderRadius:6, fontSize:11, fontWeight:700, background:t.danger+"18", color:t.danger, fontFamily:F }}>{I.warning} En retard</span>);
export const CompletedByBadge = ({ assignee, completedBy, t }) => { if (!completedBy||completedBy===assignee) return null; return <span style={{ display:"inline-flex", alignItems:"center", gap:4, padding:"2px 8px", borderRadius:6, fontSize:11, fontWeight:600, background:"#8B5CF618", color:"#8B5CF6", fontFamily:F }}>{I.swap} Faite par {completedBy}</span>; };

// ═══════════════════════════════════════
// ─── TASK COMPONENTS (compact) ───
// ═══════════════════════════════════════
export const DateNav = ({ viewDate, setViewDate, t, showHistory, setShowHistory, overdueCount }) => { const isToday=viewDate===TODAY; const label=isToday?"Aujourd'hui":viewDate===addDays(TODAY,-1)?"Hier":viewDate===addDays(TODAY,1)?"Demain":fmt(viewDate); const bs={ background:"none", border:`1px solid ${t.border}`, borderRadius:8, padding:"6px 10px", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", color:t.text, fontFamily:F, fontSize:13, fontWeight:500 }; return (<div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}><button onClick={()=>setViewDate(addDays(viewDate,-1))} style={bs}>{I.chevronL}</button><button onClick={()=>setViewDate(TODAY)} style={{ ...bs, background:isToday?t.primary:"transparent", color:isToday?"#fff":t.text, border:isToday?"none":`1px solid ${t.border}`, fontWeight:600, padding:"6px 14px" }}>{I.calendar} <span style={{ marginLeft:6 }}>{label}</span></button><div style={{ position:"relative", display:"inline-flex" }}><div style={{ ...bs, padding:"5px 10px", fontSize:12, width:"auto", userSelect:"none", pointerEvents:"none", display:"flex", alignItems:"center", justifyContent:"flex-start", gap:6 }}><span>{(()=>{ const d=new Date((viewDate==="overdue"?TODAY:viewDate)+"T00:00:00"); return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`; })()}</span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div><input type="date" value={viewDate==="overdue"?TODAY:viewDate} onChange={e=>setViewDate(e.target.value)} style={{ position:"absolute", inset:0, opacity:0.01, width:"100%", height:"100%", cursor:"pointer" }} /></div><button onClick={()=>setViewDate(addDays(viewDate,1))} style={bs}>{I.chevron}</button><div style={{ marginLeft:8, height:24, width:1, background:t.border }} /><button onClick={()=>setShowHistory(!showHistory)} style={{ ...bs, gap:6, background:showHistory?t.primary+"12":"transparent", color:showHistory?t.primary:t.textMuted }}>{I.history} <span>Historique</span></button>{overdueCount>0&&<button onClick={()=>setViewDate("overdue")} style={{ ...bs, gap:6, background:t.danger+"10", borderColor:t.danger+"30", color:t.danger, fontWeight:600 }}>{I.warning} <span>{overdueCount} en retard</span></button>}</div>); };
export const TaskModal = ({ onClose, onSave, t, defaultDate, employees }) => { const [title,setTitle]=useState(""); const [assignee,setA]=useState(employees[0]?.name || ""); const [category,setC]=useState(categoryList[0]); const [priority,setP]=useState("moyenne"); const [dueDate,setD]=useState(defaultDate||TODAY); const sel={ width:"100%", padding:"10px 12px", borderRadius:8, border:`1px solid ${t.border}`, fontSize:14, fontFamily:F, background:t.surface, color:t.text, outline:"none", cursor:"pointer" }; return (<div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.4)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000 }} onClick={onClose}><div style={{ background:t.surface, borderRadius:16, padding:28, width:460, maxWidth:"92vw", boxShadow:"0 20px 60px rgba(0,0,0,0.15)" }} onClick={e=>e.stopPropagation()}><div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:24 }}><h2 style={{ fontSize:18, fontWeight:700, margin:0, fontFamily:F }}>Nouvelle tâche</h2><button onClick={onClose} style={{ background:"none", border:"none", cursor:"pointer", color:t.textMuted, padding:4 }}>{I.x}</button></div><div style={{ display:"flex", flexDirection:"column", gap:16 }}><div><label style={{ fontSize:13, fontWeight:600, color:t.textMuted, marginBottom:6, display:"block", fontFamily:F }}>Piocher dans la liste habituelle (optionnel)</label><select value="" onChange={e=>{ const v=e.target.value; if(v==="")return; const tmpl=TASK_TEMPLATES[+v]; if(tmpl){ setTitle(tmpl.title); setC(tmpl.category); setP(tmpl.priority); } }} style={sel}><option value="">— Choisir une tâche habituelle —</option>{[{key:"ouverture",label:"Ouverture"},{key:"service",label:"Service"},{key:"fermeture",label:"Fermeture"}].map(c=>(<optgroup key={c.key} label={c.label}>{TASK_TEMPLATES.map((tmpl,i)=>({tmpl,i})).filter(x=>x.tmpl.creneau===c.key).map(x=>(<option key={x.i} value={x.i}>{x.tmpl.title}</option>))}</optgroup>))}</select></div><div><label style={{ fontSize:13, fontWeight:600, color:t.textMuted, marginBottom:6, display:"block", fontFamily:F }}>Intitulé</label><input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Ex: Nettoyer les friteuses…" autoFocus style={sel} /></div><div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}><div><label style={{ fontSize:13, fontWeight:600, color:t.textMuted, marginBottom:6, display:"block", fontFamily:F }}>Assigné à</label><select value={assignee} onChange={e=>setA(e.target.value)} style={sel}>{employees.map(e=><option key={e.name}>{e.name}</option>)}</select></div><div><label style={{ fontSize:13, fontWeight:600, color:t.textMuted, marginBottom:6, display:"block", fontFamily:F }}>Date prévue</label><input type="date" value={dueDate} onChange={e=>setD(e.target.value)} style={sel} /></div></div><div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}><div><label style={{ fontSize:13, fontWeight:600, color:t.textMuted, marginBottom:6, display:"block", fontFamily:F }}>Catégorie</label><select value={category} onChange={e=>setC(e.target.value)} style={sel}>{categoryList.map(c=><option key={c}>{c}</option>)}</select></div><div><label style={{ fontSize:13, fontWeight:600, color:t.textMuted, marginBottom:8, display:"block", fontFamily:F }}>Priorité</label><div style={{ display:"flex", gap:6 }}>{priorityList.map(p=>(<button key={p} onClick={()=>setP(p)} style={{ flex:1, padding:"8px 0", borderRadius:8, fontSize:12, fontWeight:600, fontFamily:F, cursor:"pointer", textTransform:"capitalize", background:priority===p?(p==="haute"?t.danger:p==="moyenne"?t.warning:t.success):t.surfaceAlt, color:priority===p?"#fff":t.textMuted, border:priority===p?"none":`1px solid ${t.border}` }}>{p}</button>))}</div></div></div></div><div style={{ display:"flex", gap:10, marginTop:24 }}><button onClick={onClose} style={{ flex:1, padding:"10px 0", borderRadius:8, border:`1px solid ${t.border}`, background:t.surface, color:t.textMuted, fontSize:14, fontWeight:600, cursor:"pointer", fontFamily:F }}>Annuler</button><button onClick={()=>{if(title.trim())onSave({title,assignee,category,priority,dueDate});}} style={{ flex:1, padding:"10px 0", borderRadius:8, border:"none", background:title.trim()?t.primary:t.border, color:title.trim()?"#fff":t.textMuted, fontSize:14, fontWeight:600, cursor:title.trim()?"pointer":"default", fontFamily:F }}>Créer</button></div></div></div>); };
export const TaskRow = ({ tk, onToggle, onDelete, onEdit, t, isGerant, showAssignee=true, selectable=false, selected=false, onSelectToggle }) => { const overdue=isOverdue(tk); return (<div style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 14px", borderRadius:10, background:selected?t.primary+"0C":tk.status==="done"?t.surfaceAlt:overdue?t.danger+"06":t.surface, border:`1px solid ${selected?t.primary+"55":tk.status==="done"?"transparent":overdue?t.danger+"25":t.border}`, opacity:tk.status==="done"&&!selectable?0.55:1 }}>{selectable&&<button onClick={()=>onSelectToggle(tk.id)} style={{ width:20, height:20, borderRadius:5, flexShrink:0, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", background:selected?t.primary:"transparent", border:selected?"none":`2px solid ${t.border}`, color:"#fff" }}>{selected&&I.check}</button>}<button onClick={()=>onToggle(tk.id)} style={{ width:22, height:22, borderRadius:6, flexShrink:0, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", background:tk.status==="done"?t.success:"transparent", border:tk.status==="done"?"none":`2px solid ${overdue?t.danger:t.border}`, color:"#fff" }}>{tk.status==="done"&&I.check}</button><div style={{ flex:1, cursor:isGerant?"pointer":"default" }} onClick={()=>{if(isGerant&&onEdit)onEdit(tk);}}><div style={{ fontSize:14, fontWeight:500, textDecoration:tk.status==="done"?"line-through":"none", color:tk.status==="done"?t.textMuted:t.text, fontFamily:F }}>{tk.title}</div><div style={{ display:"flex", gap:8, alignItems:"center", marginTop:4, flexWrap:"wrap" }}>{showAssignee&&<span style={{ fontSize:12, color:t.textMuted, fontFamily:F }}>{tk.assignee}</span>}<CategoryTag category={tk.category} t={t} />{overdue&&<OverdueBadge t={t} />}<CompletedByBadge assignee={tk.assignee} completedBy={tk.completedBy} t={t} /></div></div><PriorityBadge priority={tk.priority} t={t} /></div>); };
export const ChecklistView = ({ tasks, onToggle, onDelete, onEdit, onBulkDelete, t, fA, fC, isGerant, currentUserName }) => { const fl=tasks.filter(tk=>(!fA||tk.assignee===fA)&&(!fC||tk.category===fC)); const [selectMode,setSelectMode]=useState(false); const [selectedIds,setSelectedIds]=useState(()=>new Set()); const [confirmDel,setConfirmDel]=useState(false); if(isGerant){ const a=fl.filter(tk=>tk.status!=="done"); const d=fl.filter(tk=>tk.status==="done"); const allIds=fl.map(tk=>tk.id); const allSelected=allIds.length>0&&allIds.every(id=>selectedIds.has(id)); const sel=(id)=>setSelectedIds(prev=>{const ns=new Set(prev);ns.has(id)?ns.delete(id):ns.add(id);return ns;}); const selectAll=()=>setSelectedIds(allSelected?new Set():new Set(allIds)); const exitSelect=()=>{setSelectMode(false);setSelectedIds(new Set());setConfirmDel(false);}; const doDelete=()=>{onBulkDelete([...selectedIds]);exitSelect();}; const nSel=selectedIds.size; const rp=(tk)=>selectMode?{selectable:true,selected:selectedIds.has(tk.id),onSelectToggle:sel}:{}; const miniBtn={fontSize:13,fontWeight:600,fontFamily:F,padding:"6px 12px",borderRadius:8,cursor:"pointer",display:"inline-flex",alignItems:"center",gap:6}; return (<div style={{ display:"flex", flexDirection:"column", gap:6 }}><div style={{ display:"flex", justifyContent:"flex-end", marginBottom:2 }}>{!selectMode?(fl.length>0&&<button onClick={()=>setSelectMode(true)} style={{ ...miniBtn, border:`1px solid ${t.border}`, background:t.surface, color:t.textMuted }}>{I.check} Sélectionner</button>):<button onClick={exitSelect} style={{ ...miniBtn, border:`1px solid ${t.border}`, background:t.surface, color:t.textMuted }}>{I.x} Annuler</button>}</div>{selectMode&&<div style={{ display:"flex", alignItems:"center", gap:12, flexWrap:"wrap", padding:"10px 14px", borderRadius:10, background:t.surfaceAlt, border:`1px solid ${t.border}` }}><button onClick={selectAll} disabled={allIds.length===0} style={{ ...miniBtn, border:`1px solid ${t.border}`, background:t.surface, color:t.text }}>{allSelected?"Tout désélectionner":"Tout sélectionner"}</button><span style={{ fontSize:13, color:t.textMuted, fontFamily:F }}>{nSel} sélectionnée{nSel>1?"s":""}</span><div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>{!confirmDel?<button onClick={()=>setConfirmDel(true)} disabled={nSel===0} style={{ ...miniBtn, border:"none", background:nSel===0?t.border:t.danger, color:nSel===0?t.textMuted:"#fff", cursor:nSel===0?"default":"pointer" }}>{I.trash} Supprimer ({nSel})</button>:<><span style={{ fontSize:13, fontWeight:600, color:t.danger, fontFamily:F }}>Supprimer {nSel} tâche{nSel>1?"s":""} ? Action définitive.</span><button onClick={()=>setConfirmDel(false)} style={{ ...miniBtn, border:`1px solid ${t.border}`, background:t.surface, color:t.textMuted }}>Annuler</button><button onClick={doDelete} style={{ ...miniBtn, border:"none", background:t.danger, color:"#fff" }}>Confirmer</button></>}</div></div>}{a.length===0&&d.length===0&&<div style={{ textAlign:"center", padding:40, color:t.textMuted, fontSize:14, fontFamily:F }}>Aucune tâche.</div>}{a.map(tk=><TaskRow key={tk.id} tk={tk} onToggle={onToggle} onDelete={onDelete} onEdit={onEdit} t={t} isGerant {...rp(tk)} />)}{d.length>0&&<><div style={{ fontSize:13, fontWeight:600, color:t.textMuted, marginTop:12, marginBottom:4, fontFamily:F }}>Terminées ({d.length})</div>{d.map(tk=><TaskRow key={tk.id} tk={tk} onToggle={onToggle} onDelete={onDelete} onEdit={onEdit} t={t} isGerant {...rp(tk)} />)}</>}</div>); } const mine=fl.filter(tk=>tk.assignee===currentUserName); const team=fl.filter(tk=>tk.assignee!==currentUserName); return (<div style={{ display:"flex", flexDirection:"column", gap:6 }}><div style={{ fontSize:15, fontWeight:700, color:t.text, marginBottom:4, fontFamily:F }}>Mes tâches <span style={{ fontSize:12, fontWeight:600, color:t.textMuted, background:t.surfaceAlt, padding:"2px 10px", borderRadius:10 }}>{mine.length}</span></div>{mine.filter(tk=>tk.status!=="done").map(tk=><TaskRow key={tk.id} tk={tk} onToggle={onToggle} onDelete={onDelete} t={t} isGerant={false} showAssignee={false} />)}{mine.filter(tk=>tk.status==="done").length>0&&<>{mine.filter(tk=>tk.status==="done").map(tk=><TaskRow key={tk.id} tk={tk} onToggle={onToggle} onDelete={onDelete} t={t} isGerant={false} showAssignee={false} />)}</>}{team.length>0&&<><div style={{ fontSize:15, fontWeight:700, color:t.text, marginTop:20, marginBottom:4, fontFamily:F, paddingTop:16, borderTop:`1px solid ${t.border}` }}>Tâches de l'équipe <span style={{ fontSize:12, fontWeight:600, color:t.textMuted, background:t.surfaceAlt, padding:"2px 10px", borderRadius:10 }}>{team.length}</span></div>{team.map(tk=><TaskRow key={tk.id} tk={tk} onToggle={onToggle} onDelete={onDelete} t={t} isGerant={false} />)}</>}</div>); };
export const KanbanView = ({ tasks, onMove, onDelete, t, fA, fC }) => { const cols=[{key:"todo",label:"À faire",color:t.primary},{key:"doing",label:"En cours",color:t.warning},{key:"done",label:"Terminé",color:t.success}]; const fl=tasks.filter(tk=>(!fA||tk.assignee===fA)&&(!fC||tk.category===fC)); return (<div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:16, minHeight:400 }}>{cols.map(col=>{ const ct=fl.filter(tk=>tk.status===col.key); return (<div key={col.key} style={{ background:t.surfaceAlt, borderRadius:12, padding:14, display:"flex", flexDirection:"column" }}><div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:14, paddingBottom:10, borderBottom:`2px solid ${col.color}` }}><span style={{ width:10, height:10, borderRadius:"50%", background:col.color }} /><span style={{ fontSize:14, fontWeight:700, fontFamily:F }}>{col.label}</span><span style={{ fontSize:12, fontWeight:600, color:t.textMuted, marginLeft:"auto", background:t.surface, padding:"1px 8px", borderRadius:10, fontFamily:F }}>{ct.length}</span></div><div style={{ display:"flex", flexDirection:"column", gap:8, flex:1 }}>{ct.map(tk=>(<div key={tk.id} style={{ background:t.surface, borderRadius:10, padding:"12px 14px", border:`1px solid ${t.border}` }}><div style={{ fontSize:13, fontWeight:600, fontFamily:F, marginBottom:8 }}>{tk.title}</div><div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:10 }}><CategoryTag category={tk.category} t={t} /><PriorityBadge priority={tk.priority} t={t} /><CompletedByBadge assignee={tk.assignee} completedBy={tk.completedBy} t={t} /></div><div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}><div style={{ width:26, height:26, borderRadius:7, background:t.primary+"18", color:t.primary, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700, fontSize:11 }}>{tk.assignee[0]}</div><div style={{ display:"flex", gap:4 }}>{col.key!=="todo"&&<button onClick={()=>onMove(tk.id,col.key==="doing"?"todo":"doing")} style={{ fontSize:11, fontWeight:600, padding:"3px 8px", borderRadius:5, border:`1px solid ${t.border}`, background:t.surface, color:t.textMuted, cursor:"pointer", fontFamily:F }}>← Retour</button>}{col.key!=="done"&&<button onClick={()=>onMove(tk.id,col.key==="todo"?"doing":"done")} style={{ fontSize:11, fontWeight:600, padding:"3px 8px", borderRadius:5, border:"none", background:col.key==="doing"?t.success:t.warning, color:"#fff", cursor:"pointer", fontFamily:F }}>{col.key==="todo"?"Démarrer →":"Terminer ✓"}</button>}</div></div></div>))}{ct.length===0&&<div style={{ textAlign:"center", padding:20, color:t.textMuted, fontSize:13, opacity:0.5 }}>Vide</div>}</div></div>); })}</div>); };
export const HistoryView = ({ tasks, t }) => { const pd=tasks.filter(tk=>tk.status==="done"&&tk.dueDate<TODAY); const bd={}; pd.forEach(tk=>{if(!bd[tk.dueDate])bd[tk.dueDate]=[];bd[tk.dueDate].push(tk);}); const ds=Object.keys(bd).sort((a,b)=>b.localeCompare(a)); if(ds.length===0) return <div style={{ textAlign:"center", padding:40, color:t.textMuted, fontSize:14, fontFamily:F }}>Aucune tâche dans l'historique.</div>; return (<div style={{ display:"flex", flexDirection:"column", gap:20 }}>{ds.map(d=>(<div key={d}><div style={{ fontSize:14, fontWeight:700, marginBottom:8, fontFamily:F, display:"flex", alignItems:"center", gap:8 }}>{I.calendar} {fmt(d)} <span style={{ fontSize:12, fontWeight:500, color:t.textMuted }}>— {bd[d].length} tâche{bd[d].length>1?"s":""}</span></div>{bd[d].map(tk=>(<div key={tk.id} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 14px", borderRadius:8, background:t.surfaceAlt, opacity:0.6 }}><div style={{ width:20, height:20, borderRadius:5, background:t.success, display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", flexShrink:0 }}>{I.check}</div><div style={{ flex:1, fontSize:13, textDecoration:"line-through", color:t.textMuted, fontFamily:F }}>{tk.title}</div><span style={{ fontSize:12, color:t.textMuted, fontFamily:F }}>{tk.assignee}</span><CompletedByBadge assignee={tk.assignee} completedBy={tk.completedBy} t={t} /><CategoryTag category={tk.category} t={t} /></div>))}</div>))}</div>); };
