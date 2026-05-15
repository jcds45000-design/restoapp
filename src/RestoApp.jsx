import { useState, useRef, useMemo, useEffect } from "react";
import { supabase } from './lib/supabase';

// ═══════════════════════════════════════
// ─── HELPERS ───
// ═══════════════════════════════════════
const TODAY = new Date().toISOString().slice(0, 10);
const getMonday = (d) => { const dt = new Date(d); const day = dt.getDay(); const diff = dt.getDate() - day + (day === 0 ? -6 : 1); dt.setDate(diff); return dt.toISOString().slice(0, 10); };
const WEEK_START = getMonday(TODAY);
const TODAY_LABEL = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).replace(/^\w/, c => c.toUpperCase());

// ─── IMAGE BANNIÈRE DASHBOARD ───
// 👉 Change cette URL pour modifier l'image du dashboard
const BANNER_IMAGE = "/hero.png";
const fmt = (d) => { const dt=new Date(d+"T00:00:00"); const j=["Dim","Lun","Mar","Mer","Jeu","Ven","Sam"]; const m=["jan","fév","mar","avr","mai","juin","juil","août","sep","oct","nov","déc"]; return `${j[dt.getDay()]} ${dt.getDate()} ${m[dt.getMonth()]}`; };
const fmtShort = (d) => { const dt=new Date(d+"T00:00:00"); return `${dt.getDate()}/${dt.getMonth()+1}`; };
const addDays = (d,n) => { const dt=new Date(d+"T00:00:00"); dt.setDate(dt.getDate()+n); return dt.toISOString().slice(0,10); };
const getWeekDays = (start) => Array.from({length:7},(_,i) => addDays(start,i));
const getDayName = (d) => ["Dim","Lun","Mar","Mer","Jeu","Ven","Sam"][new Date(d+"T00:00:00").getDay()];
const isOverdue = (tk) => tk.status!=="done" && tk.dueDate<TODAY;
const calcHours = (shift) => {
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
const initialUsersData = [
  { id: 0, name: "Jean Claude", role: "gerant", initials: "JC" },
  { id: 1, name: "Yuna", role: "employe", initials: "Yu", poste: "Cuisine", tauxH: 12.50, heuresHebdo: 35, tel: "06 12 34 56 78", email: "yuna@kimiko.fr", dateEntree: "2025-03-15", contrat: "CDI", dateFin: "" },
  { id: 2, name: "Lucas", role: "employe", initials: "Lu", poste: "Caisse", tauxH: 11.80, heuresHebdo: 35, tel: "06 23 45 67 89", email: "lucas@kimiko.fr", dateEntree: "2025-06-01", contrat: "CDI", dateFin: "" },
  { id: 3, name: "Mina", role: "employe", initials: "Mi", poste: "Cuisine", tauxH: 12.50, heuresHebdo: 24, tel: "06 34 56 78 90", email: "mina@kimiko.fr", dateEntree: "2025-09-10", contrat: "CDD", dateFin: "2026-06-10" },
  { id: 4, name: "Théo", role: "employe", initials: "Th", poste: "Salle", tauxH: 11.50, heuresHebdo: 20, tel: "06 45 67 89 01", email: "theo@kimiko.fr", dateEntree: "2025-11-20", contrat: "CDD", dateFin: "2026-05-20" },
  { id: 5, name: "Sofia", role: "employe", initials: "So", poste: "Plonge", tauxH: 11.27, heuresHebdo: 15, tel: "06 56 78 90 12", email: "sofia@kimiko.fr", dateEntree: "2026-01-08", contrat: "CDD", dateFin: "2026-07-08" },
];

// Planning: shifts par employé par date
const initialSchedule = {
  "Yuna":  { "2026-05-04":"repos","2026-05-05":"11h30-14h / 18h-22h","2026-05-06":"11h30-14h / 18h-22h","2026-05-07":"11h30-14h / 18h-22h","2026-05-08":"10h-15h / 18h-22h","2026-05-09":"11h30-22h","2026-05-10":"11h30-22h" },
  "Lucas": { "2026-05-04":"repos","2026-05-05":"11h30-14h / 18h-22h","2026-05-06":"11h30-14h / 18h-22h","2026-05-07":"repos","2026-05-08":"11h-15h / 18h-22h","2026-05-09":"11h30-22h","2026-05-10":"11h30-22h" },
  "Mina":  { "2026-05-04":"repos","2026-05-05":"11h30-14h / 18h-22h","2026-05-06":"repos","2026-05-07":"11h30-14h / 18h-22h","2026-05-08":"11h-15h / 18h-21h","2026-05-09":"11h30-22h","2026-05-10":"repos" },
  "Théo":  { "2026-05-04":"repos","2026-05-05":"11h30-14h","2026-05-06":"11h30-14h / 18h-22h","2026-05-07":"11h30-14h / 18h-22h","2026-05-08":"11h30-15h","2026-05-09":"11h30-22h","2026-05-10":"11h30-22h" },
  "Sofia": { "2026-05-04":"repos","2026-05-05":"18h-22h","2026-05-06":"18h-22h","2026-05-07":"18h-22h","2026-05-08":"repos","2026-05-09":"18h-22h","2026-05-10":"18h-22h" },
};

// Pointage: heures réelles par employé par date (null = pas encore pointé)
const initialPointage = {
  "Yuna":  { "2026-05-05":"11h35-14h05 / 18h-22h10","2026-05-06":"11h30-14h / 18h-22h","2026-05-07":"11h30-14h / 18h-21h50","2026-05-08": null },
  "Lucas": { "2026-05-05":"11h30-14h / 18h-22h15","2026-05-06":"11h40-14h / 18h-22h","2026-05-08": null },
  "Mina":  { "2026-05-05":"11h30-14h / 18h-22h","2026-05-07":"11h30-14h / 18h-22h05","2026-05-08": null },
  "Théo":  { "2026-05-05":"11h30-13h50","2026-05-06":"11h30-14h / 18h-22h","2026-05-07":"11h30-14h10 / 18h-22h","2026-05-08": null },
  "Sofia": { "2026-05-05":"18h05-22h","2026-05-06":"18h-22h","2026-05-07":"18h-21h55" },
};

const categoryList = ["Service","Cuisine","Nettoyage","Stock","Admin","Autre"];
const priorityList = ["haute","moyenne","basse"];

// ─── TEMPLATE TÂCHES JOURNALIÈRES KIMIKO ───
// créneau: "ouverture" = employés qui commencent avant 14h
//          "fermeture" = employés qui finissent après 21h
//          "service"   = tous les présents
const TASK_TEMPLATES = [
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
const travailleOuverture = (shift) => {
  if (!shift || shift === 'repos' || ['maladie','conges','absence'].includes(shift)) return false;
  const m = shift.match(/(\d+)h/);
  return m && parseInt(m[1]) < 14;
};
// Détermine si un employé travaille à la fermeture (finit après 21h)
const travailleFermeture = (shift) => {
  if (!shift || shift === 'repos' || ['maladie','conges','absence'].includes(shift)) return false;
  const parts = shift.split(' / ');
  const last = parts[parts.length - 1];
  const m = last.match(/-(\d+)h/);
  return m && parseInt(m[1]) >= 21;
};
// Détermine si un employé est présent (pas absent/repos)
const estPresent = (shift) => {
  return shift && shift !== 'repos' && !['maladie','conges','absence'].includes(shift);
};

const initialTasks = [
  { id:1, title:"Inventaire chambre froide", assignee:"Mina", category:"Stock", priority:"haute", status:"done", dueDate:"2026-05-07", completedBy:"Mina" },
  { id:2, title:"Nettoyer le sol cuisine", assignee:"Théo", category:"Nettoyage", priority:"moyenne", status:"done", dueDate:"2026-05-07", completedBy:"Théo" },
  { id:3, title:"Appeler fournisseur panko", assignee:"Lucas", category:"Stock", priority:"haute", status:"todo", dueDate:"2026-05-07", completedBy:null },
  { id:4, title:"Nettoyer la hotte d'extraction", assignee:"Théo", category:"Nettoyage", priority:"haute", status:"todo", dueDate:TODAY, completedBy:null },
  { id:5, title:"Réception livraison Metro (10h)", assignee:"Mina", category:"Stock", priority:"haute", status:"doing", dueDate:TODAY, completedBy:null },
  { id:6, title:"Préparer la marinade poulet frit", assignee:"Yuna", category:"Cuisine", priority:"moyenne", status:"doing", dueDate:TODAY, completedBy:null },
  { id:7, title:"Réappro serviettes + gobelets", assignee:"Lucas", category:"Stock", priority:"moyenne", status:"todo", dueDate:TODAY, completedBy:null },
  { id:8, title:"Vérifier DLC sauces frigo", assignee:"Mina", category:"Stock", priority:"haute", status:"todo", dueDate:TODAY, completedBy:null },
  { id:9, title:"Poster story Instagram", assignee:"Lucas", category:"Admin", priority:"basse", status:"todo", dueDate:TODAY, completedBy:null },
  { id:10, title:"Nettoyer friteuses après midi", assignee:"Théo", category:"Nettoyage", priority:"haute", status:"todo", dueDate:TODAY, completedBy:null },
  { id:11, title:"Préparer riz vinaigré (20 portions)", assignee:"Yuna", category:"Cuisine", priority:"moyenne", status:"done", dueDate:TODAY, completedBy:"Yuna" },
  { id:12, title:"Compter la caisse du midi", assignee:"Lucas", category:"Service", priority:"haute", status:"done", dueDate:TODAY, completedBy:"Mina" },
  { id:13, title:"Réception Promocash (9h)", assignee:"Mina", category:"Stock", priority:"haute", status:"todo", dueDate:"2026-05-09", completedBy:null },
  { id:14, title:"Former Sofia sur la plonge", assignee:"Théo", category:"Service", priority:"moyenne", status:"todo", dueDate:"2026-05-09", completedBy:null },
  { id:15, title:"Bento spécial week-end", assignee:"Yuna", category:"Cuisine", priority:"haute", status:"todo", dueDate:"2026-05-09", completedBy:null },
  { id:16, title:"Nettoyage complet frigos", assignee:"Théo", category:"Nettoyage", priority:"haute", status:"todo", dueDate:"2026-05-10", completedBy:null },
  { id:17, title:"Vérifier stocks week-end", assignee:"Mina", category:"Stock", priority:"haute", status:"todo", dueDate:"2026-05-10", completedBy:null },
];

// todayStaff est calculé dynamiquement depuis employees (voir RestoApp)
const stockCategories = ["Viandes & Poissons","Sauces & Condiments","Légumes & Frais","Sec & Féculents","Boissons","Emballages & Consommables"];
const initialProducts = [
  { id:1, name:"Poulet (cuisses désossées)", category:"Viandes & Poissons", qty:3.5, unit:"kg", seuil:5, seuilOrange:8 },
  { id:2, name:"Porc haché", category:"Viandes & Poissons", qty:2, unit:"kg", seuil:3, seuilOrange:5 },
  { id:3, name:"Crevettes décortiquées", category:"Viandes & Poissons", qty:1.5, unit:"kg", seuil:2, seuilOrange:3 },
  { id:4, name:"Huile de friture", category:"Sec & Féculents", qty:2, unit:"L", seuil:5, seuilOrange:8 },
  { id:5, name:"Chapelure panko", category:"Sec & Féculents", qty:0.8, unit:"kg", seuil:2, seuilOrange:3 },
  { id:6, name:"Riz à sushi", category:"Sec & Féculents", qty:4, unit:"kg", seuil:5, seuilOrange:8 },
  { id:7, name:"Farine de blé", category:"Sec & Féculents", qty:3, unit:"kg", seuil:2, seuilOrange:4 },
  { id:8, name:"Sauce gochujang", category:"Sauces & Condiments", qty:1.2, unit:"kg", seuil:2, seuilOrange:3 },
  { id:9, name:"Sauce soja", category:"Sauces & Condiments", qty:2.5, unit:"L", seuil:1.5, seuilOrange:3 },
  { id:10, name:"Vinaigre de riz", category:"Sauces & Condiments", qty:1, unit:"L", seuil:0.5, seuilOrange:1.5 },
  { id:11, name:"Huile de sésame", category:"Sauces & Condiments", qty:0.3, unit:"L", seuil:0.5, seuilOrange:1 },
  { id:12, name:"Oignons verts", category:"Légumes & Frais", qty:15, unit:"bottes", seuil:5, seuilOrange:10 },
  { id:13, name:"Chou chinois", category:"Légumes & Frais", qty:3, unit:"pièces", seuil:4, seuilOrange:6 },
  { id:14, name:"Carottes", category:"Légumes & Frais", qty:2, unit:"kg", seuil:2, seuilOrange:4 },
  { id:15, name:"Coca-Cola 33cl", category:"Boissons", qty:24, unit:"canettes", seuil:12, seuilOrange:24 },
  { id:16, name:"Eau plate 50cl", category:"Boissons", qty:18, unit:"bouteilles", seuil:12, seuilOrange:20 },
  { id:17, name:"Barquettes kraft M", category:"Emballages & Consommables", qty:80, unit:"pièces", seuil:50, seuilOrange:100 },
  { id:18, name:"Baguettes jetables", category:"Emballages & Consommables", qty:200, unit:"paires", seuil:100, seuilOrange:200 },
  { id:19, name:"Serviettes", category:"Emballages & Consommables", qty:150, unit:"pièces", seuil:100, seuilOrange:250 },
  { id:20, name:"Gobelets 40cl", category:"Emballages & Consommables", qty:45, unit:"pièces", seuil:50, seuilOrange:80 },
];
const initialSorties = [
  { id:1, productId:1, qty:1.5, empName:"Yuna", date:TODAY, time:"11h45", status:"pending", note:"Prépa poulet frit midi" },
  { id:2, productId:5, qty:0.5, empName:"Yuna", date:TODAY, time:"11h50", status:"validated", note:"Panure corn dogs" },
  { id:3, productId:8, qty:0.3, empName:"Mina", date:TODAY, time:"12h15", status:"pending", note:"Sauce bibimbap" },
  { id:4, productId:6, qty:2, empName:"Mina", date:"2026-05-07", time:"11h30", status:"validated", note:"Cuisson riz service midi" },
];
const stockAlerts = [
  { item:"Huile de friture", qty:"2 L", seuil:"5 L", urgency:"high" },
  { item:"Chapelure panko", qty:"800 g", seuil:"2 kg", urgency:"high" },
  { item:"Sauce gochujang", qty:"1.2 kg", seuil:"2 kg", urgency:"medium" },
  { item:"Riz à sushi", qty:"4 kg", seuil:"5 kg", urgency:"low" },
];
const recentOrders = [
  { id:"#142", items:"2× Corn Dog, 1× Bibimbap", status:"en cours", time:"il y a 3 min" },
  { id:"#141", items:"1× Poulet Frit L, 2× Wings", status:"prêt", time:"il y a 8 min" },
  { id:"#140", items:"3× Bento Kimiko", status:"servi", time:"il y a 14 min" },
  { id:"#139", items:"1× Corn Dog, 1× Tteokbokki", status:"servi", time:"il y a 22 min" },
];
const weeklyCA = [{day:"Lun",value:1240},{day:"Mar",value:1580},{day:"Mer",value:1320},{day:"Jeu",value:1890},{day:"Ven",value:2340},{day:"Sam",value:2780},{day:"Dim",value:0}];

// ═══════════════════════════════════════
// ─── THEMES ───
// ═══════════════════════════════════════
const themes = {
  kimiko: { name:"Kimiko", primary:"#DC2626", primaryHover:"#B91C1C", primaryLight:"#FEE2E2", accent:"#CA8A04", bg:"#FFFBF5", surface:"#FFFFFF", surfaceAlt:"#FFF8F0", text:"#1A0A00", textMuted:"#6B3A1F", border:"#FEE9D1", success:"#15803D", warning:"#CA8A04", danger:"#DC2626", sidebar:"#1A0A00", sidebarText:"#FFF8F0", sidebarAccent:"#DC2626", cardShadow:"0 4px 20px rgba(202,138,4,0.10), 0 1px 3px rgba(0,0,0,0.05)" },
  ocean: { name:"Océan", primary:"#0077B6", primaryHover:"#005F8A", accent:"#023E58", bg:"#F4F7FA", surface:"#FFFFFF", surfaceAlt:"#F0F4F8", text:"#1A2332", textMuted:"#5A6B7F", border:"#DAE2EB", success:"#2D8A4E", warning:"#D4870E", danger:"#D44040", sidebar:"#023E58", sidebarText:"#E1EBF5", sidebarAccent:"#00B4D8" },
  forest: { name:"Forêt", primary:"#2D6A4F", primaryHover:"#1E4D38", accent:"#1B4332", bg:"#F5F7F5", surface:"#FFFFFF", surfaceAlt:"#F0F5F1", text:"#1A2A1E", textMuted:"#5A6B5F", border:"#D4E2D7", success:"#2D8A4E", warning:"#D4870E", danger:"#D44040", sidebar:"#1B4332", sidebarText:"#D8F0E0", sidebarAccent:"#52B788" },
  neutral: { name:"Neutre Pro", primary:"#4A5568", primaryHover:"#2D3748", accent:"#1A202C", bg:"#F7FAFC", surface:"#FFFFFF", surfaceAlt:"#F0F2F5", text:"#1A202C", textMuted:"#718096", border:"#E2E8F0", success:"#2D8A4E", warning:"#D4870E", danger:"#D44040", sidebar:"#1A202C", sidebarText:"#E2E8F0", sidebarAccent:"#63B3ED" },
};

const F = "'Noto Sans KR', sans-serif";

// ═══════════════════════════════════════
// ─── ICONS ───
// ═══════════════════════════════════════
const I = {
  dashboard: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
  users: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  box: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>,
  orders: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>,
  euro: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 18V6"/></svg>,
  settings: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>,
  tasks: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>,
  clock: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  check: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
  chevron: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>,
  chevronL: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>,
  bell: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>,
  palette: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="13.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="10.5" r="2.5"/><circle cx="8.5" cy="7.5" r="2.5"/><circle cx="6.5" cy="12.5" r="2.5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.7-.1 2.5-.3.4-.1.7-.5.7-.9 0-.3-.1-.5-.3-.7-.2-.2-.3-.5-.3-.8 0-.7.5-1.2 1.2-1.2H17c2.8 0 5-2.2 5-5 0-4.9-4.5-9-10-9z"/></svg>,
  plus: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  list: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>,
  kanban: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="5" height="18" rx="1"/><rect x="10" y="3" width="5" height="12" rx="1"/><rect x="17" y="3" width="5" height="15" rx="1"/></svg>,
  history: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/><path d="M4.93 4.93l2.83 2.83"/></svg>,
  trash: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>,
  x: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  calendar: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  warning: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>,
  swap: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>,
  pin: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="2" width="12" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>,
};

// ═══════════════════════════════════════
// ─── SHARED COMPONENTS ───
// ═══════════════════════════════════════
const StatCard = ({ label, value, sub, icon, color, t, onClick }) => (<div onClick={onClick} style={{ background: t.surface, borderRadius: 14, padding: "20px 22px", border: `1px solid ${t.border}`, display: "flex", alignItems: "flex-start", gap: 14, transition: "box-shadow 0.2s, transform 0.2s", cursor: onClick?"pointer":"default", position:"relative", overflow:"hidden", boxShadow: t.cardShadow||"none" }} onMouseEnter={e => { e.currentTarget.style.boxShadow="0 6px 24px rgba(202,138,4,0.15)"; if(onClick) e.currentTarget.style.transform="translateY(-2px)"; }} onMouseLeave={e => { e.currentTarget.style.boxShadow=t.cardShadow||"none"; e.currentTarget.style.transform="translateY(0)"; }}><div style={{ position:"absolute", top:0, left:0, right:0, height:3, background:"linear-gradient(90deg, #DC2626, #CA8A04)", borderRadius:"14px 14px 0 0" }} /><div style={{ width: 42, height: 42, borderRadius: 10, background: color+"18", display: "flex", alignItems: "center", justifyContent: "center", color, flexShrink: 0 }}>{icon}</div><div><div style={{ fontSize: 13, color: t.textMuted, marginBottom: 4, fontFamily: F }}>{label}</div><div style={{ fontSize: 26, fontWeight: 700, color: t.text, lineHeight: 1.1, fontFamily: F }}>{value}</div>{sub && <div style={{ fontSize: 12, color: t.textMuted, marginTop: 4, fontFamily: F }}>{sub}</div>}</div></div>);
const MiniChart = ({ data, t }) => { const max=Math.max(...data.map(d=>d.value)); return (<div style={{ display:"flex", alignItems:"flex-end", gap:6, height:80 }}>{data.map((d,i)=>(<div key={i} style={{ display:"flex", flexDirection:"column", alignItems:"center", flex:1 }}><div style={{ width:"100%", maxWidth:32, height: max>0?Math.max(4,(d.value/max)*64):4, background: d.value===0?t.border:t.primary, borderRadius:4, opacity: d.value===0?0.3:(0.5+(d.value/max)*0.5) }} /><span style={{ fontSize:11, color:t.textMuted, marginTop:4, fontFamily:F }}>{d.day}</span></div>))}</div>); };
const Badge = ({ label, bg, color }) => (<span style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"3px 10px", borderRadius:20, fontSize:12, fontWeight:600, background:bg, color, fontFamily:F }}><span style={{ width:6, height:6, borderRadius:"50%", background:color }} />{label}</span>);
const StatusBadge = ({ status, t }) => { const m={ present:{bg:t.success+"18",color:t.success,label:"Présent"}, late:{bg:t.warning+"18",color:t.warning,label:"En retard"}, absent:{bg:t.danger+"18",color:t.danger,label:"Absent"}, "en cours":{bg:t.warning+"18",color:t.warning,label:"En cours"}, "prêt":{bg:t.success+"18",color:t.success,label:"Prêt"}, "servi":{bg:t.textMuted+"18",color:t.textMuted,label:"Servi"} }; const c=m[status]||m.present; return <Badge label={c.label} bg={c.bg} color={c.color} />; };
const PriorityBadge = ({ priority, t }) => { const m={ haute:{bg:t.danger+"15",color:t.danger}, moyenne:{bg:t.warning+"15",color:t.warning}, basse:{bg:t.success+"15",color:t.success} }; return <Badge label={priority} bg={(m[priority]||m.basse).bg} color={(m[priority]||m.basse).color} />; };
const CategoryTag = ({ category, t }) => (<span style={{ fontSize:11, fontWeight:600, padding:"2px 8px", borderRadius:6, background:t.primary+"12", color:t.primary, fontFamily:F }}>{category}</span>);
const OverdueBadge = ({ t }) => (<span style={{ display:"inline-flex", alignItems:"center", gap:4, padding:"2px 8px", borderRadius:6, fontSize:11, fontWeight:700, background:t.danger+"18", color:t.danger, fontFamily:F }}>{I.warning} En retard</span>);
const CompletedByBadge = ({ assignee, completedBy, t }) => { if (!completedBy||completedBy===assignee) return null; return <span style={{ display:"inline-flex", alignItems:"center", gap:4, padding:"2px 8px", borderRadius:6, fontSize:11, fontWeight:600, background:"#8B5CF618", color:"#8B5CF6", fontFamily:F }}>{I.swap} Faite par {completedBy}</span>; };

// ═══════════════════════════════════════
// ─── TASK COMPONENTS (compact) ───
// ═══════════════════════════════════════
const DateNav = ({ viewDate, setViewDate, t, showHistory, setShowHistory, overdueCount }) => { const isToday=viewDate===TODAY; const label=isToday?"Aujourd'hui":viewDate===addDays(TODAY,-1)?"Hier":viewDate===addDays(TODAY,1)?"Demain":fmt(viewDate); const bs={ background:"none", border:`1px solid ${t.border}`, borderRadius:8, padding:"6px 10px", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", color:t.text, fontFamily:F, fontSize:13, fontWeight:500 }; return (<div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}><button onClick={()=>setViewDate(addDays(viewDate,-1))} style={bs}>{I.chevronL}</button><button onClick={()=>setViewDate(TODAY)} style={{ ...bs, background:isToday?t.primary:"transparent", color:isToday?"#fff":t.text, border:isToday?"none":`1px solid ${t.border}`, fontWeight:600, padding:"6px 14px" }}>{I.calendar} <span style={{ marginLeft:6 }}>{label}</span></button><input type="date" value={viewDate==="overdue"?TODAY:viewDate} onChange={e=>setViewDate(e.target.value)} style={{ ...bs, padding:"5px 10px", fontSize:12, width:140 }} /><button onClick={()=>setViewDate(addDays(viewDate,1))} style={bs}>{I.chevron}</button><div style={{ marginLeft:8, height:24, width:1, background:t.border }} /><button onClick={()=>setShowHistory(!showHistory)} style={{ ...bs, gap:6, background:showHistory?t.primary+"12":"transparent", color:showHistory?t.primary:t.textMuted }}>{I.history} <span>Historique</span></button>{overdueCount>0&&<button onClick={()=>setViewDate("overdue")} style={{ ...bs, gap:6, background:t.danger+"10", borderColor:t.danger+"30", color:t.danger, fontWeight:600 }}>{I.warning} <span>{overdueCount} en retard</span></button>}</div>); };
const TaskModal = ({ onClose, onSave, t, defaultDate, employees }) => { const [title,setTitle]=useState(""); const [assignee,setA]=useState(employees[0]?.name || ""); const [category,setC]=useState(categoryList[0]); const [priority,setP]=useState("moyenne"); const [dueDate,setD]=useState(defaultDate||TODAY); const sel={ width:"100%", padding:"10px 12px", borderRadius:8, border:`1px solid ${t.border}`, fontSize:14, fontFamily:F, background:t.surface, color:t.text, outline:"none", cursor:"pointer" }; return (<div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.4)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000 }} onClick={onClose}><div style={{ background:t.surface, borderRadius:16, padding:28, width:460, maxWidth:"92vw", boxShadow:"0 20px 60px rgba(0,0,0,0.15)" }} onClick={e=>e.stopPropagation()}><div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:24 }}><h2 style={{ fontSize:18, fontWeight:700, margin:0, fontFamily:F }}>Nouvelle tâche</h2><button onClick={onClose} style={{ background:"none", border:"none", cursor:"pointer", color:t.textMuted, padding:4 }}>{I.x}</button></div><div style={{ display:"flex", flexDirection:"column", gap:16 }}><div><label style={{ fontSize:13, fontWeight:600, color:t.textMuted, marginBottom:6, display:"block", fontFamily:F }}>Intitulé</label><input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Ex: Nettoyer les friteuses…" autoFocus style={sel} /></div><div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}><div><label style={{ fontSize:13, fontWeight:600, color:t.textMuted, marginBottom:6, display:"block", fontFamily:F }}>Assigné à</label><select value={assignee} onChange={e=>setA(e.target.value)} style={sel}>{employees.map(e=><option key={e.name}>{e.name}</option>)}</select></div><div><label style={{ fontSize:13, fontWeight:600, color:t.textMuted, marginBottom:6, display:"block", fontFamily:F }}>Date prévue</label><input type="date" value={dueDate} onChange={e=>setD(e.target.value)} style={sel} /></div></div><div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}><div><label style={{ fontSize:13, fontWeight:600, color:t.textMuted, marginBottom:6, display:"block", fontFamily:F }}>Catégorie</label><select value={category} onChange={e=>setC(e.target.value)} style={sel}>{categoryList.map(c=><option key={c}>{c}</option>)}</select></div><div><label style={{ fontSize:13, fontWeight:600, color:t.textMuted, marginBottom:8, display:"block", fontFamily:F }}>Priorité</label><div style={{ display:"flex", gap:6 }}>{priorityList.map(p=>(<button key={p} onClick={()=>setP(p)} style={{ flex:1, padding:"8px 0", borderRadius:8, fontSize:12, fontWeight:600, fontFamily:F, cursor:"pointer", textTransform:"capitalize", background:priority===p?(p==="haute"?t.danger:p==="moyenne"?t.warning:t.success):t.surfaceAlt, color:priority===p?"#fff":t.textMuted, border:priority===p?"none":`1px solid ${t.border}` }}>{p}</button>))}</div></div></div></div><div style={{ display:"flex", gap:10, marginTop:24 }}><button onClick={onClose} style={{ flex:1, padding:"10px 0", borderRadius:8, border:`1px solid ${t.border}`, background:t.surface, color:t.textMuted, fontSize:14, fontWeight:600, cursor:"pointer", fontFamily:F }}>Annuler</button><button onClick={()=>{if(title.trim())onSave({title,assignee,category,priority,dueDate});}} style={{ flex:1, padding:"10px 0", borderRadius:8, border:"none", background:title.trim()?t.primary:t.border, color:title.trim()?"#fff":t.textMuted, fontSize:14, fontWeight:600, cursor:title.trim()?"pointer":"default", fontFamily:F }}>Créer</button></div></div></div>); };
const TaskRow = ({ tk, onToggle, onDelete, onEdit, t, isGerant, showAssignee=true }) => { const overdue=isOverdue(tk); return (<div style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 14px", borderRadius:10, background:tk.status==="done"?t.surfaceAlt:overdue?t.danger+"06":t.surface, border:`1px solid ${tk.status==="done"?"transparent":overdue?t.danger+"25":t.border}`, opacity:tk.status==="done"?0.55:1 }}><button onClick={()=>onToggle(tk.id)} style={{ width:22, height:22, borderRadius:6, flexShrink:0, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", background:tk.status==="done"?t.success:"transparent", border:tk.status==="done"?"none":`2px solid ${overdue?t.danger:t.border}`, color:"#fff" }}>{tk.status==="done"&&I.check}</button><div style={{ flex:1, cursor:isGerant?"pointer":"default" }} onClick={()=>{if(isGerant&&onEdit)onEdit(tk);}}><div style={{ fontSize:14, fontWeight:500, textDecoration:tk.status==="done"?"line-through":"none", color:tk.status==="done"?t.textMuted:t.text, fontFamily:F }}>{tk.title}</div><div style={{ display:"flex", gap:8, alignItems:"center", marginTop:4, flexWrap:"wrap" }}>{showAssignee&&<span style={{ fontSize:12, color:t.textMuted, fontFamily:F }}>{tk.assignee}</span>}<CategoryTag category={tk.category} t={t} />{overdue&&<OverdueBadge t={t} />}<CompletedByBadge assignee={tk.assignee} completedBy={tk.completedBy} t={t} /></div></div><PriorityBadge priority={tk.priority} t={t} /></div>); };
const ChecklistView = ({ tasks, onToggle, onDelete, onEdit, t, fA, fC, isGerant, currentUserName }) => { const fl=tasks.filter(tk=>(!fA||tk.assignee===fA)&&(!fC||tk.category===fC)); if(isGerant){ const a=fl.filter(tk=>tk.status!=="done"); const d=fl.filter(tk=>tk.status==="done"); return (<div style={{ display:"flex", flexDirection:"column", gap:6 }}>{a.length===0&&d.length===0&&<div style={{ textAlign:"center", padding:40, color:t.textMuted, fontSize:14, fontFamily:F }}>Aucune tâche.</div>}{a.map(tk=><TaskRow key={tk.id} tk={tk} onToggle={onToggle} onDelete={onDelete} onEdit={onEdit} t={t} isGerant />)}{d.length>0&&<><div style={{ fontSize:13, fontWeight:600, color:t.textMuted, marginTop:12, marginBottom:4, fontFamily:F }}>Terminées ({d.length})</div>{d.map(tk=><TaskRow key={tk.id} tk={tk} onToggle={onToggle} onDelete={onDelete} onEdit={onEdit} t={t} isGerant />)}</>}</div>); } const mine=fl.filter(tk=>tk.assignee===currentUserName); const team=fl.filter(tk=>tk.assignee!==currentUserName); return (<div style={{ display:"flex", flexDirection:"column", gap:6 }}><div style={{ fontSize:15, fontWeight:700, color:t.text, marginBottom:4, fontFamily:F }}>Mes tâches <span style={{ fontSize:12, fontWeight:600, color:t.textMuted, background:t.surfaceAlt, padding:"2px 10px", borderRadius:10 }}>{mine.length}</span></div>{mine.filter(tk=>tk.status!=="done").map(tk=><TaskRow key={tk.id} tk={tk} onToggle={onToggle} onDelete={onDelete} t={t} isGerant={false} showAssignee={false} />)}{mine.filter(tk=>tk.status==="done").length>0&&<>{mine.filter(tk=>tk.status==="done").map(tk=><TaskRow key={tk.id} tk={tk} onToggle={onToggle} onDelete={onDelete} t={t} isGerant={false} showAssignee={false} />)}</>}{team.length>0&&<><div style={{ fontSize:15, fontWeight:700, color:t.text, marginTop:20, marginBottom:4, fontFamily:F, paddingTop:16, borderTop:`1px solid ${t.border}` }}>Tâches de l'équipe <span style={{ fontSize:12, fontWeight:600, color:t.textMuted, background:t.surfaceAlt, padding:"2px 10px", borderRadius:10 }}>{team.length}</span></div>{team.map(tk=><TaskRow key={tk.id} tk={tk} onToggle={onToggle} onDelete={onDelete} t={t} isGerant={false} />)}</>}</div>); };
const KanbanView = ({ tasks, onMove, onDelete, t, fA, fC }) => { const cols=[{key:"todo",label:"À faire",color:t.primary},{key:"doing",label:"En cours",color:t.warning},{key:"done",label:"Terminé",color:t.success}]; const fl=tasks.filter(tk=>(!fA||tk.assignee===fA)&&(!fC||tk.category===fC)); return (<div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:16, minHeight:400 }}>{cols.map(col=>{ const ct=fl.filter(tk=>tk.status===col.key); return (<div key={col.key} style={{ background:t.surfaceAlt, borderRadius:12, padding:14, display:"flex", flexDirection:"column" }}><div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:14, paddingBottom:10, borderBottom:`2px solid ${col.color}` }}><span style={{ width:10, height:10, borderRadius:"50%", background:col.color }} /><span style={{ fontSize:14, fontWeight:700, fontFamily:F }}>{col.label}</span><span style={{ fontSize:12, fontWeight:600, color:t.textMuted, marginLeft:"auto", background:t.surface, padding:"1px 8px", borderRadius:10, fontFamily:F }}>{ct.length}</span></div><div style={{ display:"flex", flexDirection:"column", gap:8, flex:1 }}>{ct.map(tk=>(<div key={tk.id} style={{ background:t.surface, borderRadius:10, padding:"12px 14px", border:`1px solid ${t.border}` }}><div style={{ fontSize:13, fontWeight:600, fontFamily:F, marginBottom:8 }}>{tk.title}</div><div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:10 }}><CategoryTag category={tk.category} t={t} /><PriorityBadge priority={tk.priority} t={t} /><CompletedByBadge assignee={tk.assignee} completedBy={tk.completedBy} t={t} /></div><div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}><div style={{ width:26, height:26, borderRadius:7, background:t.primary+"18", color:t.primary, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700, fontSize:11 }}>{tk.assignee[0]}</div><div style={{ display:"flex", gap:4 }}>{col.key!=="todo"&&<button onClick={()=>onMove(tk.id,col.key==="doing"?"todo":"doing")} style={{ fontSize:11, fontWeight:600, padding:"3px 8px", borderRadius:5, border:`1px solid ${t.border}`, background:t.surface, color:t.textMuted, cursor:"pointer", fontFamily:F }}>← Retour</button>}{col.key!=="done"&&<button onClick={()=>onMove(tk.id,col.key==="todo"?"doing":"done")} style={{ fontSize:11, fontWeight:600, padding:"3px 8px", borderRadius:5, border:"none", background:col.key==="doing"?t.success:t.warning, color:"#fff", cursor:"pointer", fontFamily:F }}>{col.key==="todo"?"Démarrer →":"Terminer ✓"}</button>}</div></div></div>))}{ct.length===0&&<div style={{ textAlign:"center", padding:20, color:t.textMuted, fontSize:13, opacity:0.5 }}>Vide</div>}</div></div>); })}</div>); };
const HistoryView = ({ tasks, t }) => { const pd=tasks.filter(tk=>tk.status==="done"&&tk.dueDate<TODAY); const bd={}; pd.forEach(tk=>{if(!bd[tk.dueDate])bd[tk.dueDate]=[];bd[tk.dueDate].push(tk);}); const ds=Object.keys(bd).sort((a,b)=>b.localeCompare(a)); if(ds.length===0) return <div style={{ textAlign:"center", padding:40, color:t.textMuted, fontSize:14, fontFamily:F }}>Aucune tâche dans l'historique.</div>; return (<div style={{ display:"flex", flexDirection:"column", gap:20 }}>{ds.map(d=>(<div key={d}><div style={{ fontSize:14, fontWeight:700, marginBottom:8, fontFamily:F, display:"flex", alignItems:"center", gap:8 }}>{I.calendar} {fmt(d)} <span style={{ fontSize:12, fontWeight:500, color:t.textMuted }}>— {bd[d].length} tâche{bd[d].length>1?"s":""}</span></div>{bd[d].map(tk=>(<div key={tk.id} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 14px", borderRadius:8, background:t.surfaceAlt, opacity:0.6 }}><div style={{ width:20, height:20, borderRadius:5, background:t.success, display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", flexShrink:0 }}>{I.check}</div><div style={{ flex:1, fontSize:13, textDecoration:"line-through", color:t.textMuted, fontFamily:F }}>{tk.title}</div><span style={{ fontSize:12, color:t.textMuted, fontFamily:F }}>{tk.assignee}</span><CompletedByBadge assignee={tk.assignee} completedBy={tk.completedBy} t={t} /><CategoryTag category={tk.category} t={t} /></div>))}</div>))}</div>); };

// ═══════════════════════════════════════
// ─── STOCKS MODULE ───
// ═══════════════════════════════════════
const StocksModule = ({ t, products, setProducts, sorties, setSorties, isGerant, currentUserName }) => {
  const [stockView, setStockView] = useState("inventory"); // inventory | sorties | shopping
  const [filterCat, setFilterCat] = useState("");
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [showSortieModal, setShowSortieModal] = useState(false);
  const [editProduct, setEditProduct] = useState(null); // product id for inline qty edit
  const [editQty, setEditQty] = useState("");
  const [editingProduct, setEditingProduct] = useState(null); // full product object for edit modal

  // Edit product form state
  const [epName, setEpName] = useState("");
  const [epCat, setEpCat] = useState("");
  const [epUnit, setEpUnit] = useState("");
  const [epSeuil, setEpSeuil] = useState("");
  const [epSeuilOrange, setEpSeuilOrange] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  // New product form state
  const [npName, setNpName] = useState("");
  const [npCat, setNpCat] = useState(stockCategories[0]);
  const [npQty, setNpQty] = useState("");
  const [npUnit, setNpUnit] = useState("kg");
  const [npSeuil, setNpSeuil] = useState("");

  // Sortie form state
  const [spProduct, setSpProduct] = useState("");
  const [spQty, setSpQty] = useState("");
  const [spNote, setSpNote] = useState("");

  const pidRef = useRef(100);
  const sidRef = useRef(100);

  const getUrgency = (p) => {
    if (p.qty <= p.seuil) return "high";
    if (p.qty <= p.seuilOrange) return "medium";
    return "ok";
  };

  const pendingSorties = sorties.filter(s => s.status === "pending");
  const alertProducts = products.filter(p => p.qty <= p.seuil);
  const shoppingList = alertProducts.map(p => ({ ...p, toOrder: Math.ceil((p.seuilOrange - p.qty) * 1.2) }));

  const addProduct = async () => {
    if (!npName.trim() || !npQty) return;
    const tmpId = pidRef.current++;
    const np = { id: tmpId, name: npName, category: npCat, qty: parseFloat(npQty), unit: npUnit, seuil: parseFloat(npSeuil) || 1, seuilOrange: parseFloat(npSeuil) * 2 || 2 };
    setProducts(prev => [...prev, np]);
    setNpName(""); setNpQty(""); setNpSeuil(""); setShowAddProduct(false);
    const { data } = await supabase.from('products').insert({ name: np.name, category: np.category, unit: np.unit, qty: np.qty, seuil: np.seuil, seuil_orange: np.seuilOrange, stock_current: np.qty, stock_min: np.seuil }).select().single();
    if (data) setProducts(prev => prev.map(p => p.id === tmpId ? { ...p, _uuid: data.id } : p));
  };

  const submitSortie = () => {
    if (!spProduct || !spQty) return;
    setSorties(prev => [...prev, { id: sidRef.current++, productId: parseInt(spProduct), qty: parseFloat(spQty), empName: currentUserName, date: TODAY, time: new Date().getHours() + "h" + String(new Date().getMinutes()).padStart(2,"0"), status: "pending", note: spNote }]);
    setSpProduct(""); setSpQty(""); setSpNote(""); setShowSortieModal(false);
  };

  const validateSortie = (sid) => {
    const sortie = sorties.find(s => s.id === sid);
    if (!sortie) return;
    setSorties(prev => prev.map(s => s.id === sid ? { ...s, status: "validated" } : s));
    setProducts(prev => prev.map(p => {
      if (p.id !== sortie.productId) return p;
      const newQty = Math.max(0, Math.round((p.qty - sortie.qty) * 100) / 100);
      if (p._uuid) supabase.from('products').update({ qty: newQty, stock_current: newQty }).eq('id', p._uuid).then(() => {});
      return { ...p, qty: newQty };
    }));
  };

  const rejectSortie = (sid) => {
    setSorties(prev => prev.map(s => s.id === sid ? { ...s, status: "rejected" } : s));
  };

  const updateQty = (pid) => {
    if (editQty === "") return;
    setProducts(prev => prev.map(p => {
      if (p.id !== pid) return p;
      const newQty = parseFloat(editQty);
      if (p._uuid) supabase.from('products').update({ qty: newQty, stock_current: newQty }).eq('id', p._uuid).then(({ error }) => { if (error) alert('Erreur Supabase: ' + error.message); });
      return { ...p, qty: newQty };
    }));
    setEditProduct(null); setEditQty("");
  };

  const openEditProduct = (p) => {
    setEpName(p.name); setEpCat(p.category); setEpUnit(p.unit);
    setEpSeuil(String(p.seuil)); setEpSeuilOrange(String(p.seuilOrange));
    setConfirmDelete(false);
    setEditingProduct(p);
  };

  const saveEditProduct = () => {
    if (!editingProduct || !epName.trim()) return;
    setProducts(prev => prev.map(p => {
      if (p.id !== editingProduct.id) return p;
      const updated = { ...p, name: epName, category: epCat, unit: epUnit, seuil: parseFloat(epSeuil) || 1, seuilOrange: parseFloat(epSeuilOrange) || 2 };
      if (p._uuid) supabase.from('products').update({ name: epName, category: epCat, unit: epUnit, seuil: updated.seuil, seuil_orange: updated.seuilOrange }).eq('id', p._uuid).then(() => {});
      return updated;
    }));
    setEditingProduct(null);
  };

  const deleteProduct = () => {
    if (!editingProduct) return;
    setProducts(prev => prev.filter(p => p.id !== editingProduct.id));
    setEditingProduct(null);
  };

  const sel = { padding: "8px 12px", borderRadius: 8, border: `1px solid ${t.border}`, fontSize: 13, fontFamily: F, background: t.surface, color: t.text, outline: "none", cursor: "pointer" };
  const tabBtn = (key, label, count) => ({ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: F, borderRadius: 8, background: stockView === key ? t.primary : "transparent", color: stockView === key ? "#fff" : t.textMuted, transition: "all 0.15s" });

  // ── Inventory View ──
  const InventoryView = () => {
    const filtered = filterCat ? products.filter(p => p.category === filterCat) : products;
    const grouped = {};
    filtered.forEach(p => { if (!grouped[p.category]) grouped[p.category] = []; grouped[p.category].push(p); });

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {Object.entries(grouped).map(([cat, items]) => (
          <div key={cat}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, fontFamily: F, display: "flex", alignItems: "center", gap: 8 }}>
              {cat} <span style={{ fontSize: 12, fontWeight: 500, color: t.textMuted, background: t.surfaceAlt, padding: "2px 10px", borderRadius: 10 }}>{items.length}</span>
            </div>
            <div style={{ background: t.surface, borderRadius: 12, border: `1px solid ${t.border}`, overflow: "hidden" }}>
              {items.map((p, i) => {
                const urg = getUrgency(p);
                const isEditing = editProduct === p.id;
                return (
                  <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: i < items.length - 1 ? `1px solid ${t.border}` : "none", background: urg === "high" ? t.danger + "06" : "transparent" }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: urg === "high" ? t.danger : urg === "medium" ? t.warning : t.success, flexShrink: 0 }} />
                    <div style={{ flex: 1, cursor: isGerant ? "pointer" : "default" }} onClick={() => { if (isGerant) openEditProduct(p); }}>
                      <div style={{ fontSize: 14, fontWeight: 500, display: "flex", alignItems: "center", gap: 6 }}>{p.name} {isGerant && <span style={{ fontSize: 10, color: t.textMuted, opacity: 0.4 }}>✎</span>}</div>
                      <div style={{ fontSize: 12, color: t.textMuted }}>Seuil : {p.seuil} {p.unit}</div>
                    </div>
                    {isEditing ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <input value={editQty} onChange={e => setEditQty(e.target.value)} type="number" step="0.1" autoFocus style={{ ...sel, width: 70, padding: "6px 8px" }} onKeyDown={e => { if (e.key === "Enter") updateQty(p.id); if (e.key === "Escape") { setEditProduct(null); setEditQty(""); } }} />
                        <span style={{ fontSize: 12, color: t.textMuted }}>{p.unit}</span>
                        <button onClick={() => updateQty(p.id)} style={{ background: t.success, color: "#fff", border: "none", borderRadius: 6, padding: "4px 8px", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>✓</button>
                        <button onClick={() => { setEditProduct(null); setEditQty(""); }} style={{ background: t.border, color: t.textMuted, border: "none", borderRadius: 6, padding: "4px 8px", cursor: "pointer", fontSize: 12 }}>✕</button>
                      </div>
                    ) : (
                      <div onClick={() => { if (isGerant) { setEditProduct(p.id); setEditQty(String(p.qty)); } }} style={{ display: "flex", alignItems: "center", gap: 6, cursor: isGerant ? "pointer" : "default", padding: "4px 10px", borderRadius: 8, background: urg === "high" ? t.danger + "15" : urg === "medium" ? t.warning + "15" : t.surfaceAlt }}>
                        <span style={{ fontSize: 15, fontWeight: 700, color: urg === "high" ? t.danger : urg === "medium" ? t.warning : t.text }}>{p.qty}</span>
                        <span style={{ fontSize: 12, color: t.textMuted }}>{p.unit}</span>
                        {isGerant && <span style={{ fontSize: 10, color: t.textMuted, opacity: 0.5, marginLeft: 4 }}>✎</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  };

  // ── Sorties View ──
  const SortiesView = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {pendingSorties.length > 0 && isGerant && (
        <div style={{ background: t.warning + "08", border: `1px solid ${t.warning}25`, borderRadius: 12, padding: 16, marginBottom: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>{I.warning} <span>{pendingSorties.length} sortie{pendingSorties.length > 1 ? "s" : ""} en attente de validation</span></div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {pendingSorties.map(s => {
              const prod = products.find(p => p.id === s.productId);
              return (
                <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 10, background: t.surface, border: `1px solid ${t.border}` }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{prod ? prod.name : "Produit inconnu"} — <span style={{ color: t.primary }}>-{s.qty} {prod ? prod.unit : ""}</span></div>
                    <div style={{ fontSize: 12, color: t.textMuted }}>{s.empName} · {s.date === TODAY ? "Aujourd'hui" : fmt(s.date)} à {s.time}{s.note ? ` · ${s.note}` : ""}</div>
                  </div>
                  <button onClick={() => validateSortie(s.id)} style={{ padding: "6px 12px", borderRadius: 8, border: "none", background: t.success, color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: F }}>✓ Valider</button>
                  <button onClick={() => rejectSortie(s.id)} style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.surface, color: t.textMuted, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: F }}>✕ Refuser</button>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Historique des sorties</div>
      <div style={{ background: t.surface, borderRadius: 12, border: `1px solid ${t.border}`, overflow: "hidden" }}>
        {sorties.filter(s => s.status !== "pending").slice().reverse().map((s, i, arr) => {
          const prod = products.find(p => p.id === s.productId);
          return (
            <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderBottom: i < arr.length - 1 ? `1px solid ${t.border}` : "none" }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: s.status === "validated" ? t.success : t.danger, flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{prod ? prod.name : "?"} · <span style={{ fontWeight: 700 }}>-{s.qty} {prod ? prod.unit : ""}</span></div>
                <div style={{ fontSize: 12, color: t.textMuted }}>{s.empName} · {s.date === TODAY ? "Aujourd'hui" : fmt(s.date)} à {s.time}</div>
              </div>
              <Badge label={s.status === "validated" ? "Validé" : "Refusé"} bg={s.status === "validated" ? t.success + "18" : t.danger + "18"} color={s.status === "validated" ? t.success : t.danger} />
            </div>
          );
        })}
        {sorties.filter(s => s.status !== "pending").length === 0 && <div style={{ padding: 20, textAlign: "center", color: t.textMuted, fontSize: 13 }}>Aucune sortie enregistrée.</div>}
      </div>
    </div>
  );

  // ── Shopping List ──
  const ShoppingView = () => (
    <div>
      {shoppingList.length === 0 ? (
        <div style={{ textAlign: "center", padding: 40, color: t.textMuted, fontSize: 14 }}>Tous les stocks sont OK — rien à acheter.</div>
      ) : (
        <div style={{ background: t.surface, borderRadius: 12, border: `1px solid ${t.border}`, overflow: "hidden" }}>
          <div style={{ padding: "14px 18px", background: t.surfaceAlt, fontWeight: 700, fontSize: 14, borderBottom: `1px solid ${t.border}` }}>Liste de courses — {shoppingList.length} produit{shoppingList.length > 1 ? "s" : ""}</div>
          {shoppingList.map((p, i) => (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", borderBottom: i < shoppingList.length - 1 ? `1px solid ${t.border}` : "none" }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: t.danger, flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{p.name}</div>
                <div style={{ fontSize: 12, color: t.textMuted }}>{p.category} · Reste {p.qty} {p.unit} (seuil : {p.seuil})</div>
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: t.primary }}>≈ {p.toOrder} {p.unit}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div>
      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
        <div style={{ background: t.surface, borderRadius: 10, padding: "14px 18px", border: `1px solid ${t.border}`, display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: t.primary }} />
          <div><div style={{ fontSize: 12, color: t.textMuted }}>Produits</div><div style={{ fontSize: 22, fontWeight: 700 }}>{products.length}</div></div>
        </div>
        <div style={{ background: t.surface, borderRadius: 10, padding: "14px 18px", border: `1px solid ${alertProducts.length > 0 ? t.danger + "40" : t.border}`, display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: t.danger }} />
          <div><div style={{ fontSize: 12, color: t.textMuted }}>Alertes stock</div><div style={{ fontSize: 22, fontWeight: 700, color: alertProducts.length > 0 ? t.danger : t.text }}>{alertProducts.length}</div></div>
        </div>
        <div style={{ background: t.surface, borderRadius: 10, padding: "14px 18px", border: `1px solid ${pendingSorties.length > 0 ? t.warning + "40" : t.border}`, display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: t.warning }} />
          <div><div style={{ fontSize: 12, color: t.textMuted }}>Sorties en attente</div><div style={{ fontSize: 22, fontWeight: 700, color: pendingSorties.length > 0 ? t.warning : t.text }}>{pendingSorties.length}</div></div>
        </div>
        <div style={{ background: t.surface, borderRadius: 10, padding: "14px 18px", border: `1px solid ${t.border}`, display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: t.success }} />
          <div><div style={{ fontSize: 12, color: t.textMuted }}>Sorties validées (jour)</div><div style={{ fontSize: 22, fontWeight: 700 }}>{sorties.filter(s => s.status === "validated" && s.date === TODAY).length}</div></div>
        </div>
      </div>

      {/* Tabs + actions */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", gap: 6, background: t.surfaceAlt, borderRadius: 10, border: `1px solid ${t.border}`, padding: 4 }}>
          <button onClick={() => setStockView("inventory")} style={tabBtn("inventory")}>{I.box} Inventaire</button>
          <button onClick={() => setStockView("sorties")} style={tabBtn("sorties")}>{I.history} Sorties {pendingSorties.length > 0 && <span style={{ background: t.warning, color: "#fff", fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 8, marginLeft: 4 }}>{pendingSorties.length}</span>}</button>
          <button onClick={() => setStockView("shopping")} style={tabBtn("shopping")}>{I.list} Liste de courses {alertProducts.length > 0 && <span style={{ background: t.danger, color: "#fff", fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 8, marginLeft: 4 }}>{alertProducts.length}</span>}</button>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {stockView === "inventory" && <select value={filterCat} onChange={e => setFilterCat(e.target.value)} style={sel}><option value="">Toutes catégories</option>{stockCategories.map(c => <option key={c}>{c}</option>)}</select>}
          <button onClick={() => setShowSortieModal(true)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.surface, color: t.text, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: F }}>📤 Déclarer une sortie</button>
          {isGerant && <button onClick={() => setShowAddProduct(true)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, border: "none", background: t.primary, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: F }}>{I.plus} Ajouter un produit</button>}
        </div>
      </div>

      {stockView === "inventory" && <InventoryView />}
      {stockView === "sorties" && <SortiesView />}
      {stockView === "shopping" && <ShoppingView />}

      {/* Add product modal */}
      {showAddProduct && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={() => setShowAddProduct(false)}>
          <div style={{ background: t.surface, borderRadius: 16, padding: 28, width: 440, maxWidth: "92vw", boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, fontFamily: F }}>Ajouter un produit</h2>
              <button onClick={() => setShowAddProduct(false)} style={{ background: "none", border: "none", cursor: "pointer", color: t.textMuted, padding: 4 }}>{I.x}</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div><label style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6, display: "block", fontFamily: F }}>Nom du produit</label><input value={npName} onChange={e => setNpName(e.target.value)} placeholder="Ex: Kimchi maison" autoFocus style={{ ...sel, width: "100%" }} /></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div><label style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6, display: "block", fontFamily: F }}>Catégorie</label><select value={npCat} onChange={e => setNpCat(e.target.value)} style={{ ...sel, width: "100%" }}>{stockCategories.map(c => <option key={c}>{c}</option>)}</select></div>
                <div><label style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6, display: "block", fontFamily: F }}>Unité</label><select value={npUnit} onChange={e => setNpUnit(e.target.value)} style={{ ...sel, width: "100%" }}>{["kg","g","L","pièces","canettes","bouteilles","bottes","paires","sachets"].map(u => <option key={u}>{u}</option>)}</select></div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div><label style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6, display: "block", fontFamily: F }}>Quantité actuelle</label><input value={npQty} onChange={e => setNpQty(e.target.value)} type="number" step="0.1" placeholder="0" style={{ ...sel, width: "100%" }} /></div>
                <div><label style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6, display: "block", fontFamily: F }}>Seuil d'alerte</label><input value={npSeuil} onChange={e => setNpSeuil(e.target.value)} type="number" step="0.1" placeholder="0" style={{ ...sel, width: "100%" }} /></div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button onClick={() => setShowAddProduct(false)} style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: `1px solid ${t.border}`, background: t.surface, color: t.textMuted, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: F }}>Annuler</button>
              <button onClick={addProduct} style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "none", background: npName.trim() && npQty ? t.primary : t.border, color: npName.trim() && npQty ? "#fff" : t.textMuted, fontSize: 14, fontWeight: 600, cursor: npName.trim() && npQty ? "pointer" : "default", fontFamily: F }}>Ajouter</button>
            </div>
          </div>
        </div>
      )}

      {/* Sortie modal */}
      {showSortieModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={() => setShowSortieModal(false)}>
          <div style={{ background: t.surface, borderRadius: 16, padding: 28, width: 440, maxWidth: "92vw", boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, fontFamily: F }}>Déclarer une sortie</h2>
              <button onClick={() => setShowSortieModal(false)} style={{ background: "none", border: "none", cursor: "pointer", color: t.textMuted, padding: 4 }}>{I.x}</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div><label style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6, display: "block", fontFamily: F }}>Produit</label><select value={spProduct} onChange={e => setSpProduct(e.target.value)} style={{ ...sel, width: "100%" }}><option value="">Choisir un produit…</option>{products.map(p => <option key={p.id} value={p.id}>{p.name} ({p.qty} {p.unit})</option>)}</select></div>
              <div><label style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6, display: "block", fontFamily: F }}>Quantité prélevée</label><input value={spQty} onChange={e => setSpQty(e.target.value)} type="number" step="0.1" placeholder="0" style={{ ...sel, width: "100%" }} /></div>
              <div><label style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6, display: "block", fontFamily: F }}>Note (optionnel)</label><input value={spNote} onChange={e => setSpNote(e.target.value)} placeholder="Ex: Prépa poulet frit midi" style={{ ...sel, width: "100%" }} /></div>
            </div>
            <div style={{ background: t.surfaceAlt, borderRadius: 10, padding: "10px 14px", marginTop: 16, fontSize: 13, color: t.textMuted, fontFamily: F }}>La sortie sera soumise au gérant pour validation avant de décrémenter le stock.</div>
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button onClick={() => setShowSortieModal(false)} style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: `1px solid ${t.border}`, background: t.surface, color: t.textMuted, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: F }}>Annuler</button>
              <button onClick={submitSortie} style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "none", background: spProduct && spQty ? t.primary : t.border, color: spProduct && spQty ? "#fff" : t.textMuted, fontSize: 14, fontWeight: 600, cursor: spProduct && spQty ? "pointer" : "default", fontFamily: F }}>Déclarer</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit product modal */}
      {editingProduct && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={() => { setEditingProduct(null); setConfirmDelete(false); }}>
          <div style={{ background: t.surface, borderRadius: 16, padding: 28, width: 440, maxWidth: "92vw", boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, fontFamily: F }}>Modifier le produit</h2>
              <button onClick={() => { setEditingProduct(null); setConfirmDelete(false); }} style={{ background: "none", border: "none", cursor: "pointer", color: t.textMuted, padding: 4 }}>{I.x}</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div><label style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6, display: "block", fontFamily: F }}>Nom du produit</label><input value={epName} onChange={e => setEpName(e.target.value)} style={{ ...sel, width: "100%" }} /></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div><label style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6, display: "block", fontFamily: F }}>Catégorie</label><select value={epCat} onChange={e => setEpCat(e.target.value)} style={{ ...sel, width: "100%" }}>{stockCategories.map(c => <option key={c}>{c}</option>)}</select></div>
                <div><label style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6, display: "block", fontFamily: F }}>Unité</label><select value={epUnit} onChange={e => setEpUnit(e.target.value)} style={{ ...sel, width: "100%" }}>{["kg","g","L","pièces","canettes","bouteilles","bottes","paires","sachets"].map(u => <option key={u}>{u}</option>)}</select></div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div><label style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6, display: "block", fontFamily: F }}>Seuil d'alerte (rouge)</label><input value={epSeuil} onChange={e => setEpSeuil(e.target.value)} type="number" step="0.1" style={{ ...sel, width: "100%" }} /></div>
                <div><label style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6, display: "block", fontFamily: F }}>Seuil de vigilance (orange)</label><input value={epSeuilOrange} onChange={e => setEpSeuilOrange(e.target.value)} type="number" step="0.1" style={{ ...sel, width: "100%" }} /></div>
              </div>
              <div style={{ background: t.surfaceAlt, borderRadius: 10, padding: "10px 14px", fontSize: 13, color: t.textMuted }}>Quantité actuelle : <span style={{ fontWeight: 700, color: t.text }}>{editingProduct.qty} {editingProduct.unit}</span> — modifiable directement dans l'inventaire.</div>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              {!confirmDelete ? (
                <button onClick={() => setConfirmDelete(true)} style={{ padding: "10px 14px", borderRadius: 8, border: `1px solid ${t.danger}30`, background: t.danger + "08", color: t.danger, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: F, display: "flex", alignItems: "center", gap: 6 }}>{I.trash} Supprimer</button>
              ) : (
                <button onClick={deleteProduct} style={{ padding: "10px 14px", borderRadius: 8, border: "none", background: t.danger, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: F }}>Confirmer la suppression</button>
              )}
              <div style={{ flex: 1 }} />
              <button onClick={() => { setEditingProduct(null); setConfirmDelete(false); }} style={{ padding: "10px 16px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.surface, color: t.textMuted, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: F }}>Annuler</button>
              <button onClick={saveEditProduct} style={{ padding: "10px 16px", borderRadius: 8, border: "none", background: epName.trim() ? t.primary : t.border, color: epName.trim() ? "#fff" : t.textMuted, fontSize: 14, fontWeight: 600, cursor: epName.trim() ? "pointer" : "default", fontFamily: F }}>Enregistrer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
// ═══════════════════════════════════════
// ─── ÉQUIPE MODULE ───
// ═══════════════════════════════════════
const EquipeModule = ({ t, employees, usersData, setUsersData, isMobile }) => {
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingEmp, setEditingEmp] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Add form
  const [aName, setAName] = useState("");
  const [aPoste, setAPoste] = useState("Cuisine");
  const [aTaux, setATaux] = useState("");
  const [aHeures, setAHeures] = useState("35");
  const [aTel, setATel] = useState("");
  const [aEmail, setAEmail] = useState("");
  const [aDate, setADate] = useState(TODAY);
  const [aContrat, setAContrat] = useState("CDI");
  const [aDateFin, setADateFin] = useState("");

  // Edit form
  const [eName, setEName] = useState("");
  const [ePoste, setEPoste] = useState("");
  const [eTaux, setETaux] = useState("");
  const [eHeures, setEHeures] = useState("");
  const [eTel, setETel] = useState("");
  const [eEmail, setEEmail] = useState("");
  const [eDate, setEDate] = useState("");
  const [eContrat, setEContrat] = useState("CDI");
  const [eDateFin, setEDateFin] = useState("");

  const eidRef = useRef(50);

  const daysRemaining = (dateFin) => {
    if (!dateFin) return null;
    const diff = Math.ceil((new Date(dateFin + "T00:00:00") - new Date(TODAY + "T00:00:00")) / (1000 * 60 * 60 * 24));
    return diff;
  };

  const openEdit = (emp) => {
    setEName(emp.name); setEPoste(emp.poste || ""); setETaux(String(emp.tauxH || ""));
    setEHeures(String(emp.heuresHebdo || "35"));
    setETel(emp.tel || ""); setEEmail(emp.email || ""); setEDate(emp.dateEntree || "");
    setEContrat(emp.contrat || "CDI"); setEDateFin(emp.dateFin || "");
    setConfirmDelete(false);
    setEditingEmp(emp);
  };

  const saveEdit = () => {
    if (!editingEmp || !eName.trim()) return;
    const initials = eName.trim().split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
    const updated = { name: eName, initials, poste: ePoste, tauxH: parseFloat(eTaux) || 0, heuresHebdo: parseFloat(eHeures) || 35, tel: eTel, email: eEmail, dateEntree: eDate, contrat: eContrat, dateFin: eContrat === "CDD" ? eDateFin : "" };
    setUsersData(prev => prev.map(u => u.id === editingEmp.id ? { ...u, ...updated } : u));
    if (editingEmp._uuid) {
      supabase.from('employees').update({ name: eName, role: ePoste, phone: eTel, email: eEmail }).eq('id', editingEmp._uuid).then(({ error }) => { if (error) alert('Erreur Supabase: ' + error.message); });
    }
    setEditingEmp(null);
  };

  const deleteEmp = () => {
    if (!editingEmp) return;
    setUsersData(prev => prev.filter(u => u.id !== editingEmp.id));
    if (editingEmp._uuid) {
      supabase.from('employees').delete().eq('id', editingEmp._uuid).then(({ error }) => { if (error) alert('Erreur Supabase: ' + error.message); });
    }
    setEditingEmp(null);
  };

  const addEmp = async () => {
    if (!aName.trim()) return;
    const initials = aName.trim().split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
    const { data: newEmp, error } = await supabase.from('employees').insert({ name: aName, role: aPoste, phone: aTel, email: aEmail, active: true }).select().single();
    if (error) { alert('Erreur Supabase: ' + error.message); return; }
    setUsersData(prev => [...prev, { id: eidRef.current++, _uuid: newEmp?.id, name: aName, role: "employe", initials, poste: aPoste, tauxH: parseFloat(aTaux) || 11.27, heuresHebdo: parseFloat(aHeures) || 35, tel: aTel, email: aEmail, dateEntree: aDate, contrat: aContrat, dateFin: aContrat === "CDD" ? aDateFin : "" }]);
    setAName(""); setAPoste("Cuisine"); setATaux(""); setAHeures("35"); setATel(""); setAEmail(""); setADate(TODAY); setAContrat("CDI"); setADateFin("");
    setShowAddModal(false);
  };

  const sel = { padding: "10px 12px", borderRadius: 8, border: `1px solid ${t.border}`, fontSize: 14, fontFamily: F, background: t.surface, color: t.text, outline: "none", width: "100%" };

  const ContratBadge = ({ emp }) => {
    if (emp.contrat === "CDI") return <Badge label="CDI" bg={t.success + "18"} color={t.success} />;
    const days = daysRemaining(emp.dateFin);
    if (days === null) return <Badge label="CDD" bg={t.warning + "18"} color={t.warning} />;
    if (days < 0) return <Badge label="CDD expiré" bg={t.danger + "18"} color={t.danger} />;
    if (days <= 15) return <Badge label={`CDD — ${days}j restants`} bg={t.danger + "18"} color={t.danger} />;
    if (days <= 30) return <Badge label={`CDD — ${days}j restants`} bg={t.warning + "18"} color={t.warning} />;
    return <Badge label={`CDD — ${days}j restants`} bg={t.primary + "12"} color={t.primary} />;
  };

  // Alerte CDD proches
  const cddAlerts = employees.filter(emp => emp.contrat === "CDD" && emp.dateFin).map(emp => ({ ...emp, days: daysRemaining(emp.dateFin) })).filter(emp => emp.days !== null && emp.days <= 30).sort((a, b) => a.days - b.days);

  return (
    <div>
      {/* Alerte CDD */}
      {cddAlerts.length > 0 && (
        <div style={{ background: t.warning + "08", border: `1px solid ${t.warning}25`, borderRadius: 12, padding: 16, marginBottom: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>{I.warning} Contrats CDD à surveiller</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {cddAlerts.map(emp => (
              <div key={emp.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 8, background: t.surface, border: `1px solid ${emp.days <= 15 ? t.danger + "30" : t.warning + "30"}` }}>
                <div style={{ width: 30, height: 30, borderRadius: 8, background: (emp.days <= 15 ? t.danger : t.warning) + "18", color: emp.days <= 15 ? t.danger : t.warning, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 12 }}>{emp.initials}</div>
                <div style={{ flex: 1 }}>
                  <span style={{ fontWeight: 600 }}>{emp.name}</span>
                  <span style={{ color: t.textMuted, fontSize: 13 }}> · {emp.poste}</span>
                </div>
                <span style={{ fontSize: 13, fontWeight: 700, color: emp.days <= 15 ? t.danger : t.warning }}>{emp.days < 0 ? "Expiré" : emp.days === 0 ? "Aujourd'hui" : `${emp.days} jour${emp.days > 1 ? "s" : ""}`}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
        <div style={{ fontSize: 14, color: t.textMuted, fontFamily: F }}>{employees.length} employé{employees.length > 1 ? "s" : ""}</div>
        <button onClick={() => setShowAddModal(true)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 18px", borderRadius: 10, border: "none", background: t.primary, color: "#fff", fontWeight: 600, fontSize: 14, cursor: "pointer", fontFamily: F }}>{I.plus} Ajouter un employé</button>
      </div>

      {/* Employee list */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
        {employees.map(emp => (
          <div key={emp.id} onClick={() => openEdit(emp)} style={{ background: t.surface, borderRadius: 14, border: `1px solid ${t.border}`, padding: "18px 20px", cursor: "pointer", transition: "box-shadow 0.2s" }} onMouseEnter={e => e.currentTarget.style.boxShadow = "0 4px 20px rgba(0,0,0,0.06)"} onMouseLeave={e => e.currentTarget.style.boxShadow = "none"}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: t.primary + "18", color: t.primary, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 16, flexShrink: 0 }}>{emp.initials}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 2 }}>{emp.name}</div>
                <div style={{ fontSize: 13, color: t.textMuted }}>{emp.poste} · {emp.heuresHebdo || 0}h/semaine</div>
              </div>
              <ContratBadge emp={emp} />
            </div>
            <div style={{ display: "flex", gap: 16, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${t.border}`, fontSize: 12, color: t.textMuted, flexWrap: "wrap" }}>
              {emp.tel && <span>📞 {emp.tel}</span>}
              {emp.email && <span>✉ {emp.email}</span>}
            </div>
            {emp.dateEntree && <div style={{ fontSize: 11, color: t.textMuted, marginTop: 6, opacity: 0.6 }}>Depuis le {fmt(emp.dateEntree)}{emp.contrat === "CDD" && emp.dateFin ? ` · Fin : ${fmt(emp.dateFin)}` : ""}</div>}
          </div>
        ))}
      </div>

      {employees.length === 0 && <div style={{ textAlign: "center", padding: 40, color: t.textMuted, fontSize: 14 }}>Aucun employé. Cliquez sur "Ajouter un employé" pour commencer.</div>}

      {/* Add modal */}
      {showAddModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={() => setShowAddModal(false)}>
          <div style={{ background: t.surface, borderRadius: 16, padding: 28, width: 480, maxWidth: "92vw", boxShadow: "0 20px 60px rgba(0,0,0,0.15)", maxHeight: "90vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, fontFamily: F }}>Nouvel employé</h2>
              <button onClick={() => setShowAddModal(false)} style={{ background: "none", border: "none", cursor: "pointer", color: t.textMuted, padding: 4 }}>{I.x}</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div><label style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6, display: "block" }}>Nom complet</label><input value={aName} onChange={e => setAName(e.target.value)} placeholder="Ex: Kim Soo-Jin" autoFocus style={sel} /></div>
                <div><label style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6, display: "block" }}>Poste</label><select value={aPoste} onChange={e => setAPoste(e.target.value)} style={sel}>{["Cuisine","Caisse","Salle","Plonge","Polyvalent"].map(p => <option key={p}>{p}</option>)}</select></div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <div><label style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6, display: "block" }}>Taux horaire (€)</label><input value={aTaux} onChange={e => setATaux(e.target.value)} type="number" step="0.01" placeholder="11.27" style={sel} /></div>
                <div><label style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6, display: "block" }}>Heures/semaine</label><input value={aHeures} onChange={e => setAHeures(e.target.value)} type="number" step="1" placeholder="35" style={sel} /></div>
                <div><label style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6, display: "block" }}>Date d'entrée</label><input value={aDate} onChange={e => setADate(e.target.value)} type="date" style={sel} /></div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div><label style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6, display: "block" }}>Type de contrat</label>
                  <div style={{ display: "flex", gap: 6 }}>
                    {["CDI", "CDD"].map(c => (<button key={c} onClick={() => setAContrat(c)} style={{ flex: 1, padding: "9px 0", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: F, background: aContrat === c ? (c === "CDI" ? t.success : t.warning) : t.surfaceAlt, color: aContrat === c ? "#fff" : t.textMuted, border: aContrat === c ? "none" : `1px solid ${t.border}` }}>{c}</button>))}
                  </div>
                </div>
                {aContrat === "CDD" && <div><label style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6, display: "block" }}>Date de fin de contrat</label><input value={aDateFin} onChange={e => setADateFin(e.target.value)} type="date" style={sel} /></div>}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div><label style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6, display: "block" }}>Téléphone</label><input value={aTel} onChange={e => setATel(e.target.value)} placeholder="06 12 34 56 78" style={sel} /></div>
                <div><label style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6, display: "block" }}>Email</label><input value={aEmail} onChange={e => setAEmail(e.target.value)} placeholder="nom@kimiko.fr" style={sel} /></div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button onClick={() => setShowAddModal(false)} style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: `1px solid ${t.border}`, background: t.surface, color: t.textMuted, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: F }}>Annuler</button>
              <button onClick={addEmp} style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "none", background: aName.trim() ? t.primary : t.border, color: aName.trim() ? "#fff" : t.textMuted, fontSize: 14, fontWeight: 600, cursor: aName.trim() ? "pointer" : "default", fontFamily: F }}>Ajouter</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editingEmp && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={() => { setEditingEmp(null); setConfirmDelete(false); }}>
          <div style={{ background: t.surface, borderRadius: 16, padding: 28, width: 480, maxWidth: "92vw", boxShadow: "0 20px 60px rgba(0,0,0,0.15)", maxHeight: "90vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, fontFamily: F }}>Modifier l'employé</h2>
              <button onClick={() => { setEditingEmp(null); setConfirmDelete(false); }} style={{ background: "none", border: "none", cursor: "pointer", color: t.textMuted, padding: 4 }}>{I.x}</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div><label style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6, display: "block" }}>Nom complet</label><input value={eName} onChange={e => setEName(e.target.value)} style={sel} /></div>
                <div><label style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6, display: "block" }}>Poste</label><select value={ePoste} onChange={e => setEPoste(e.target.value)} style={sel}>{["Cuisine","Caisse","Salle","Plonge","Polyvalent"].map(p => <option key={p}>{p}</option>)}</select></div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <div><label style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6, display: "block" }}>Taux horaire (€)</label><input value={eTaux} onChange={e => setETaux(e.target.value)} type="number" step="0.01" style={sel} /></div>
                <div><label style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6, display: "block" }}>Heures/semaine</label><input value={eHeures} onChange={e => setEHeures(e.target.value)} type="number" step="1" style={sel} /></div>
                <div><label style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6, display: "block" }}>Date d'entrée</label><input value={eDate} onChange={e => setEDate(e.target.value)} type="date" style={sel} /></div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div><label style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6, display: "block" }}>Type de contrat</label>
                  <div style={{ display: "flex", gap: 6 }}>
                    {["CDI", "CDD"].map(c => (<button key={c} onClick={() => setEContrat(c)} style={{ flex: 1, padding: "9px 0", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: F, background: eContrat === c ? (c === "CDI" ? t.success : t.warning) : t.surfaceAlt, color: eContrat === c ? "#fff" : t.textMuted, border: eContrat === c ? "none" : `1px solid ${t.border}` }}>{c}</button>))}
                  </div>
                </div>
                {eContrat === "CDD" && <div><label style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6, display: "block" }}>Date de fin de contrat</label><input value={eDateFin} onChange={e => setEDateFin(e.target.value)} type="date" style={sel} /></div>}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div><label style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6, display: "block" }}>Téléphone</label><input value={eTel} onChange={e => setETel(e.target.value)} style={sel} /></div>
                <div><label style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6, display: "block" }}>Email</label><input value={eEmail} onChange={e => setEEmail(e.target.value)} style={sel} /></div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              {!confirmDelete ? (
                <button onClick={() => setConfirmDelete(true)} style={{ padding: "10px 14px", borderRadius: 8, border: `1px solid ${t.danger}30`, background: t.danger + "08", color: t.danger, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: F, display: "flex", alignItems: "center", gap: 6 }}>{I.trash} Supprimer</button>
              ) : (
                <button onClick={deleteEmp} style={{ padding: "10px 14px", borderRadius: 8, border: "none", background: t.danger, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: F }}>Confirmer</button>
              )}
              <div style={{ flex: 1 }} />
              <button onClick={() => { setEditingEmp(null); setConfirmDelete(false); }} style={{ padding: "10px 16px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.surface, color: t.textMuted, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: F }}>Annuler</button>
              <button onClick={saveEdit} style={{ padding: "10px 16px", borderRadius: 8, border: "none", background: eName.trim() ? t.primary : t.border, color: eName.trim() ? "#fff" : t.textMuted, fontSize: 14, fontWeight: 600, cursor: eName.trim() ? "pointer" : "default", fontFamily: F }}>Enregistrer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════
// ─── PLANNING & RH MODULE ───
// ═══════════════════════════════════════
const PlanningModule = ({ t, schedule, setSchedule, pointage, isGerant, currentUserName, employees }) => {
  const [planView, setPlanView] = useState("week"); // week | month | hours
  const [weekStart, setWeekStart] = useState(WEEK_START);
  const [shiftModal, setShiftModal] = useState(null); // { empName, date }
  const [dupConfirm, setDupConfirm] = useState(false);
  const days = getWeekDays(weekStart);

  // Predefined shift templates
  const shiftPresets = [
    { label: "Coupé standard", value: "11h30-14h / 18h-22h", hours: "6.5h", color: null },
    { label: "Continu (ven/sam)", value: "11h30-22h", hours: "10.5h", color: null },
    { label: "Midi uniquement", value: "11h30-14h", hours: "2.5h", color: null },
    { label: "Soir uniquement", value: "18h-22h", hours: "4h", color: null },
    { label: "Repos", value: "repos", hours: "0h", color: null },
    { label: "🤒 Arrêt maladie", value: "maladie", hours: "0h", color: "#EF4444" },
    { label: "🌴 Congés payés", value: "conges", hours: "0h", color: "#3B82F6" },
    { label: "⚠️ Absence injustifiée", value: "absence", hours: "0h", color: "#F97316" },
  ];

  const updateShift = (empName, date, shiftValue) => {
    setSchedule(prev => ({
      ...prev,
      [empName]: { ...(prev[empName] || {}), [date]: shiftValue }
    }));
    supabase.from('schedule').upsert({ employee_name: empName, date, shift: shiftValue, updated_at: new Date().toISOString() }, { onConflict: 'employee_name,date' }).then(() => {});
  };

  const duplicateWeek = () => {
    const nextWeekDays = getWeekDays(addDays(weekStart, 7));
    setSchedule(prev => {
      const updated = { ...prev };
      employees.forEach(emp => {
        const empSched = { ...(updated[emp.name] || {}) };
        days.forEach((d, i) => {
          const sourceShift = empSched[d] || "repos";
          empSched[nextWeekDays[i]] = sourceShift;
        });
        updated[emp.name] = empSched;
      });
      return updated;
    });
    setDupConfirm(true);
    setTimeout(() => setDupConfirm(false), 2500);
  };

  const [shiftMode, setShiftMode] = useState("preset"); // preset | custom
  const [h1Start, setH1Start] = useState("11h30");
  const [h1End, setH1End] = useState("14h");
  const [h2Start, setH2Start] = useState("18h");
  const [h2End, setH2End] = useState("22h");
  const [hasCoupure, setHasCoupure] = useState(true);

  const buildCustomShift = () => {
    if (!hasCoupure) return `${h1Start}-${h1End}`;
    return `${h1Start}-${h1End} / ${h2Start}-${h2End}`;
  };

  const openShiftModal = (empName, date) => {
    const current = (schedule[empName] || {})[date] || "repos";
    const isPreset = shiftPresets.some(p => p.value === current);
    setShiftMode(isPreset ? "preset" : "custom");
    setH1Start("11h30"); setH1End("14h"); setH2Start("18h"); setH2End("22h"); setHasCoupure(true);
    setShiftModal({ empName, date });
  };

  const closeShiftModal = () => setShiftModal(null);

  const shiftModalSel = { padding: "10px 12px", borderRadius: 8, border: `1px solid ${t.border}`, fontSize: 14, fontFamily: F, background: t.surface, color: t.text, outline: "none", width: "100%" };

  // ── Weekly Grid ──
  const WeekView = () => (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontFamily: F, fontSize: 13 }}>
        <thead>
          <tr>
            <th style={{ padding: "12px 16px", textAlign: "left", fontWeight: 700, fontSize: 14, color: t.text, borderBottom: `2px solid ${t.border}`, position: "sticky", left: 0, background: t.bg, zIndex: 1, minWidth: 120 }}>Employé</th>
            {days.map(d => {
              const isToday = d === TODAY;
              const dn = getDayName(d);
              return <th key={d} style={{ padding: "10px 8px", textAlign: "center", fontWeight: isToday ? 700 : 500, color: isToday ? t.primary : t.textMuted, borderBottom: `2px solid ${isToday ? t.primary : t.border}`, background: isToday ? t.primary + "08" : "transparent", minWidth: 110, fontSize: 12 }}>{dn}<br/><span style={{ fontSize: 11, opacity: 0.7 }}>{fmtShort(d)}</span></th>;
            })}
            <th style={{ padding: "10px 8px", textAlign: "center", fontWeight: 700, color: t.text, borderBottom: `2px solid ${t.border}`, minWidth: 70, fontSize: 12 }}>Total h</th>
          </tr>
        </thead>
        <tbody>
          {employees.map(emp => {
            const empSchedule = schedule[emp.name] || {};
            let weekTotal = 0;
            return (
              <tr key={emp.name} style={{ borderBottom: `1px solid ${t.border}` }}>
                <td style={{ padding: "14px 16px", fontWeight: 600, position: "sticky", left: 0, background: t.bg, zIndex: 1, borderBottom: `1px solid ${t.border}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 30, height: 30, borderRadius: 8, background: t.primary + "18", color: t.primary, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 12 }}>{emp.initials}</div>
                    <div><div>{emp.name}</div><div style={{ fontSize: 11, color: t.textMuted }}>{emp.poste}</div></div>
                  </div>
                </td>
                {days.map(d => {
                  const shift = empSchedule[d];
                  const isRest = !shift || shift === "repos";
                  const isAbsence = ["maladie", "conges", "absence"].includes(shift);
                  const absenceColors = { maladie: "#EF4444", conges: "#3B82F6", absence: "#F97316" };
                  const absenceLabels = { maladie: "🤒 Maladie", conges: "🌴 Congés", absence: "⚠️ Absent" };
                  const h = calcHours(shift);
                  weekTotal += h;
                  const isToday = d === TODAY;
                  const ptg = (pointage[emp.name] || {})[d];
                  const realH = ptg ? calcHours(ptg) : null;
                  const absColor = isAbsence ? absenceColors[shift] : null;
                  return (
                    <td key={d}
                      onClick={() => isGerant && openShiftModal(emp.name, d)}
                      style={{ padding: "10px 8px", textAlign: "center", borderBottom: `1px solid ${t.border}`, background: isAbsence ? absColor + "12" : isToday ? t.primary + "06" : "transparent", verticalAlign: "top", cursor: isGerant ? "pointer" : "default", transition: "background 0.15s" }}
                      onMouseEnter={e => { if (isGerant) e.currentTarget.style.background = isAbsence ? absColor + "20" : t.primary + "12"; }}
                      onMouseLeave={e => { e.currentTarget.style.background = isAbsence ? absColor + "12" : isToday ? t.primary + "06" : "transparent"; }}
                    >
                      {isAbsence ? (
                        <span style={{ fontSize: 12, fontWeight: 700, color: absColor }}>{absenceLabels[shift]}</span>
                      ) : isRest ? (
                        <span style={{ fontSize: 12, color: isGerant ? t.primary+"88" : t.textMuted, fontStyle: "italic" }}>{isGerant ? "+ Ajouter" : "Repos"}</span>
                      ) : (
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: t.text, lineHeight: 1.4 }}>
                            {shift.split(" / ").map((s, i) => <div key={i}>{s}</div>)}
                          </div>
                          <div style={{ fontSize: 11, color: t.textMuted, marginTop: 2 }}>{h}h</div>
                          {ptg !== undefined && ptg !== null && (
                            <div style={{ fontSize: 10, color: t.success, fontWeight: 600, marginTop: 3 }}>✓ Pointé: {realH}h</div>
                          )}
                          {ptg === null && d <= TODAY && !isRest && (
                            <div style={{ fontSize: 10, color: t.warning, fontWeight: 600, marginTop: 3 }}>⏳ Non pointé</div>
                          )}
                        </div>
                      )}
                      {isGerant && <div style={{ fontSize: 9, color: t.textMuted, opacity: 0.4, marginTop: 4 }}>✎ modifier</div>}
                    </td>
                  );
                })}
                <td style={{ padding: "10px 8px", textAlign: "center", fontWeight: 700, fontSize: 14, borderBottom: `1px solid ${t.border}`, color: t.primary }}>{weekTotal}h</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  // ── Monthly Overview ──
  const MonthView = () => {
    const monthDays = Array.from({ length: 31 }, (_, i) => {
      const d = `2026-05-${String(i + 1).padStart(2, "0")}`;
      try { new Date(d + "T00:00:00").toISOString(); return d; } catch { return null; }
    }).filter(Boolean);

    return (
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "separate", borderSpacing: 0, fontFamily: F, fontSize: 11 }}>
          <thead>
            <tr>
              <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 700, position: "sticky", left: 0, background: t.bg, zIndex: 1, minWidth: 100, borderBottom: `2px solid ${t.border}` }}>Employé</th>
              {monthDays.map(d => {
                const dn = getDayName(d);
                const day = new Date(d + "T00:00:00").getDate();
                const isToday = d === TODAY;
                const isSun = dn === "Dim";
                return <th key={d} style={{ padding: "6px 3px", textAlign: "center", fontWeight: isToday ? 700 : 400, color: isToday ? t.primary : isSun ? t.textMuted : t.text, borderBottom: `2px solid ${isToday ? t.primary : t.border}`, background: isToday ? t.primary + "08" : isSun ? t.surfaceAlt : "transparent", minWidth: 30 }}><div style={{ fontSize: 9, opacity: 0.6 }}>{dn.charAt(0)}</div>{day}</th>;
              })}
            </tr>
          </thead>
          <tbody>
            {employees.map(emp => {
              const empSchedule = schedule[emp.name] || {};
              return (
                <tr key={emp.name}>
                  <td style={{ padding: "8px 12px", fontWeight: 600, fontSize: 12, position: "sticky", left: 0, background: t.bg, zIndex: 1, borderBottom: `1px solid ${t.border}` }}>{emp.name}</td>
                  {monthDays.map(d => {
                    const shift = empSchedule[d];
                    const isRest = !shift || shift === "repos";
                    const h = calcHours(shift);
                    const isToday = d === TODAY;
                    const isSun = getDayName(d) === "Dim";
                    return (
                      <td key={d} style={{ padding: "4px 2px", textAlign: "center", borderBottom: `1px solid ${t.border}`, background: isToday ? t.primary + "08" : isSun ? t.surfaceAlt : "transparent" }}>
                        {isRest ? (
                          <div style={{ width: 22, height: 22, borderRadius: 6, background: t.border + "60", margin: "0 auto" }} />
                        ) : (
                          <div style={{ width: 22, height: 22, borderRadius: 6, background: h > 8 ? t.primary : t.primary + "55", margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 9, fontWeight: 700 }}>{h}</div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  // ── Hours Summary (with cost for gérant) ──
  const HoursView = () => {
    return (
      <div style={{ background: t.surface, borderRadius: 14, border: `1px solid ${t.border}`, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: F, fontSize: 13 }}>
          <thead>
            <tr style={{ background: t.surfaceAlt }}>
              <th style={{ padding: "14px 18px", textAlign: "left", fontWeight: 700 }}>Employé</th>
              <th style={{ padding: "14px 12px", textAlign: "left", fontWeight: 700 }}>Poste</th>
              <th style={{ padding: "14px 12px", textAlign: "center", fontWeight: 700 }}>Heures planifiées</th>
              <th style={{ padding: "14px 12px", textAlign: "center", fontWeight: 700 }}>Heures pointées</th>
              <th style={{ padding: "14px 12px", textAlign: "center", fontWeight: 700 }}>Écart</th>
              {isGerant && <th style={{ padding: "14px 12px", textAlign: "center", fontWeight: 700 }}>Taux horaire</th>}
              {isGerant && <th style={{ padding: "14px 12px", textAlign: "center", fontWeight: 700 }}>Coût estimé</th>}
            </tr>
          </thead>
          <tbody>
            {employees.map(emp => {
              const empSchedule = schedule[emp.name] || {};
              const empPointage = pointage[emp.name] || {};
              let planH = 0, realH = 0;
              days.forEach(d => {
                planH += calcHours(empSchedule[d]);
                if (empPointage[d]) realH += calcHours(empPointage[d]);
              });
              const ecart = Math.round((realH - planH) * 10) / 10;
              const cost = Math.round(planH * emp.tauxH * 100) / 100;
              // Show employee's own row highlighted if not gérant
              const isSelf = emp.name === currentUserName;
              return (
                <tr key={emp.name} style={{ borderBottom: `1px solid ${t.border}`, background: isSelf && !isGerant ? t.primary + "08" : "transparent" }}>
                  <td style={{ padding: "14px 18px", fontWeight: 600 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 30, height: 30, borderRadius: 8, background: t.primary + "18", color: t.primary, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 12 }}>{emp.initials}</div>
                      {emp.name}
                    </div>
                  </td>
                  <td style={{ padding: "14px 12px", color: t.textMuted }}>{emp.poste}</td>
                  <td style={{ padding: "14px 12px", textAlign: "center", fontWeight: 600 }}>{planH}h</td>
                  <td style={{ padding: "14px 12px", textAlign: "center", fontWeight: 600 }}>{realH > 0 ? `${realH}h` : "—"}</td>
                  <td style={{ padding: "14px 12px", textAlign: "center", fontWeight: 700, color: ecart > 0 ? t.danger : ecart < 0 ? t.success : t.textMuted }}>
                    {realH > 0 ? `${ecart > 0 ? "+" : ""}${ecart}h` : "—"}
                  </td>
                  {isGerant && <td style={{ padding: "14px 12px", textAlign: "center", color: t.textMuted }}>{emp.tauxH.toFixed(2)} €/h</td>}
                  {isGerant && <td style={{ padding: "14px 12px", textAlign: "center", fontWeight: 700, color: t.primary }}>{cost.toFixed(0)} €</td>}
                </tr>
              );
            })}
          </tbody>
          {isGerant && (
            <tfoot>
              <tr style={{ background: t.surfaceAlt }}>
                <td colSpan={4} style={{ padding: "14px 18px", fontWeight: 700, fontSize: 14 }}>Total masse salariale (semaine)</td>
                <td style={{ padding: "14px 12px" }}></td>
                <td style={{ padding: "14px 12px" }}></td>
                <td style={{ padding: "14px 12px", textAlign: "center", fontWeight: 700, fontSize: 16, color: t.primary }}>
                  {employees.reduce((sum, emp) => {
                    const empSchedule = schedule[emp.name] || {};
                    let h = 0; days.forEach(d => h += calcHours(empSchedule[d]));
                    return sum + h * emp.tauxH;
                  }, 0).toFixed(0)} €
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    );
  };

  // ── Pointage Panel ──
  const PointagePanel = () => (
    <div style={{ background: t.surface, borderRadius: 14, border: `1px solid ${t.border}`, padding: 22, marginTop: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        {I.pin}
        <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, fontFamily: F }}>Pointage du jour — {fmt(TODAY)}</h3>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {employees.map(emp => {
          const shift = (schedule[emp.name] || {})[TODAY];
          const isRest = !shift || shift === "repos";
          const ptg = (pointage[emp.name] || {})[TODAY];
          if (isRest) return (
            <div key={emp.name} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 10, background: t.surfaceAlt, opacity: 0.5 }}>
              <div style={{ width: 30, height: 30, borderRadius: 8, background: t.border, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 12, color: t.textMuted }}>{emp.initials}</div>
              <div style={{ flex: 1 }}><span style={{ fontWeight: 600 }}>{emp.name}</span> <span style={{ color: t.textMuted }}>— Repos</span></div>
            </div>
          );
          return (
            <div key={emp.name} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 10, background: ptg === null ? t.warning + "08" : ptg ? t.success + "08" : t.surfaceAlt, border: `1px solid ${ptg === null ? t.warning + "25" : ptg ? t.success + "20" : "transparent"}` }}>
              <div style={{ width: 30, height: 30, borderRadius: 8, background: t.primary + "18", color: t.primary, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 12 }}>{emp.initials}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{emp.name}</div>
                <div style={{ fontSize: 12, color: t.textMuted }}>Planifié : {shift}</div>
              </div>
              {ptg === null && <Badge label="Non pointé" bg={t.warning + "18"} color={t.warning} />}
              {ptg && <Badge label={`Pointé : ${ptg}`} bg={t.success + "18"} color={t.success} />}
              {!ptg && ptg !== null && <span style={{ fontSize: 12, color: t.textMuted }}>—</span>}
            </div>
          );
        })}
      </div>
    </div>
  );

  const tabBtn = (key, label) => ({
    display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: F, borderRadius: 8,
    background: planView === key ? t.primary : "transparent",
    color: planView === key ? "#fff" : t.textMuted,
    transition: "all 0.15s",
  });

  return (
    <div>
      {/* Tab bar */}
      <div style={{ display: "flex", gap: 6, marginBottom: 20, background: t.surfaceAlt, borderRadius: 10, border: `1px solid ${t.border}`, padding: 4, width: "fit-content" }}>
        <button onClick={() => setPlanView("week")} style={tabBtn("week", "Semaine")}>{I.calendar} Semaine</button>
        <button onClick={() => setPlanView("month")} style={tabBtn("month", "Mois")}>{I.calendar} Mois</button>
        <button onClick={() => setPlanView("hours")} style={tabBtn("hours", "Heures")}>{I.clock} Compteur d'heures</button>
      </div>

      {/* Week navigation */}
      {planView === "week" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          <button onClick={() => setWeekStart(addDays(weekStart, -7))} style={{ background: "none", border: `1px solid ${t.border}`, borderRadius: 8, padding: "6px 10px", cursor: "pointer", color: t.text, fontFamily: F }}>{I.chevronL}</button>
          <span style={{ fontSize: 14, fontWeight: 600, fontFamily: F }}>Semaine du {fmt(weekStart)}</span>
          <button onClick={() => setWeekStart(addDays(weekStart, 7))} style={{ background: "none", border: `1px solid ${t.border}`, borderRadius: 8, padding: "6px 10px", cursor: "pointer", color: t.text, fontFamily: F }}>{I.chevron}</button>
          <button onClick={() => setWeekStart(WEEK_START)} style={{ marginLeft: 8, padding: "6px 14px", borderRadius: 8, border: "none", background: t.primary, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: F }}>Cette semaine</button>
          {isGerant && <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={duplicateWeek} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.surface, color: t.text, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: F }}>📋 Dupliquer → semaine suivante</button>
            {dupConfirm && <span style={{ fontSize: 12, fontWeight: 600, color: t.success, fontFamily: F }}>✓ Semaine dupliquée !</span>}
          </div>}
        </div>
      )}

      {planView === "week" && isGerant && <div style={{ fontSize: 12, color: t.textMuted, fontFamily: F, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}><span style={{ color: t.primary }}>💡</span> Cliquez sur une cellule pour assigner ou modifier un horaire</div>}
      {planView === "week" && <WeekView />}
      {planView === "month" && <MonthView />}
      {planView === "hours" && <HoursView />}

      {/* Pointage panel (always visible below) */}
      {(isGerant || planView === "week") && <PointagePanel />}

      {/* Shift edit modal */}
      {shiftModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={closeShiftModal}>
          <div style={{ background: t.surface, borderRadius: 16, padding: 28, width: 440, maxWidth: "92vw", maxHeight: "85vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, fontFamily: F }}>Modifier le shift</h2>
                <p style={{ fontSize: 13, color: t.textMuted, margin: "4px 0 0", fontFamily: F }}>{shiftModal.empName} — {fmt(shiftModal.date)}</p>
              </div>
              <button onClick={closeShiftModal} style={{ background: "none", border: "none", cursor: "pointer", color: t.textMuted, padding: 4 }}>{I.x}</button>
            </div>
            <div style={{ display: "flex", background: t.surfaceAlt, borderRadius: 8, border: `1px solid ${t.border}`, padding: 3, marginBottom: 20 }}>
              <button onClick={() => setShiftMode("preset")} style={{ flex: 1, padding: "8px 0", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: F, background: shiftMode === "preset" ? t.primary : "transparent", color: shiftMode === "preset" ? "#fff" : t.textMuted }}>Shifts types</button>
              <button onClick={() => setShiftMode("custom")} style={{ flex: 1, padding: "8px 0", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: F, background: shiftMode === "custom" ? t.primary : "transparent", color: shiftMode === "custom" ? "#fff" : t.textMuted }}>Personnalisé</button>
            </div>
            {shiftMode === "preset" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {shiftPresets.map(p => {
                  const isActive = ((schedule[shiftModal.empName] || {})[shiftModal.date] || "repos") === p.value;
                  return (
                    <button key={p.value} onClick={() => { updateShift(shiftModal.empName, shiftModal.date, p.value); closeShiftModal(); }}
                      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderRadius: 10, border: isActive ? `2px solid ${t.primary}` : `1px solid ${t.border}`, background: isActive ? t.primary + "08" : t.surface, cursor: "pointer", textAlign: "left", fontFamily: F }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: t.text }}>{p.label}</div>
                        <div style={{ fontSize: 12, color: t.textMuted, marginTop: 2 }}>{p.value === "repos" ? "Jour de repos" : p.value}</div>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: p.value === "repos" ? t.textMuted : t.primary }}>{p.hours}</div>
                    </button>
                  );
                })}
              </div>
            )}
            {shiftMode === "custom" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                  <label style={{ fontSize: 13, fontWeight: 600, fontFamily: F, color: t.text }}>Shift coupé</label>
                  <button onClick={() => setHasCoupure(!hasCoupure)} style={{ width: 40, height: 22, borderRadius: 11, border: "none", cursor: "pointer", background: hasCoupure ? t.primary : t.border, position: "relative", transition: "background 0.2s" }}>
                    <span style={{ position: "absolute", top: 2, left: hasCoupure ? 20 : 2, width: 18, height: 18, borderRadius: "50%", background: "#fff", transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
                  </button>
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6, display: "block", fontFamily: F }}>{hasCoupure ? "Première plage" : "Horaires"}</label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 8, alignItems: "center" }}>
                    <input value={h1Start} onChange={e => setH1Start(e.target.value)} placeholder="11h30" style={shiftModalSel} />
                    <span style={{ color: t.textMuted, fontWeight: 600 }}>→</span>
                    <input value={h1End} onChange={e => setH1End(e.target.value)} placeholder="14h" style={shiftModalSel} />
                  </div>
                </div>
                {hasCoupure && (
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6, display: "block", fontFamily: F }}>Deuxième plage</label>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 8, alignItems: "center" }}>
                      <input value={h2Start} onChange={e => setH2Start(e.target.value)} placeholder="18h" style={shiftModalSel} />
                      <span style={{ color: t.textMuted, fontWeight: 600 }}>→</span>
                      <input value={h2End} onChange={e => setH2End(e.target.value)} placeholder="22h" style={shiftModalSel} />
                    </div>
                  </div>
                )}
                <div style={{ background: t.surfaceAlt, borderRadius: 10, padding: "12px 16px", fontSize: 13, fontFamily: F }}>
                  <span style={{ color: t.textMuted }}>Résultat : </span>
                  <span style={{ fontWeight: 700, color: t.primary }}>{buildCustomShift()}</span>
                  <span style={{ color: t.textMuted, marginLeft: 8 }}>({calcHours(buildCustomShift())}h)</span>
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button onClick={closeShiftModal} style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: `1px solid ${t.border}`, background: t.surface, color: t.textMuted, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: F }}>Annuler</button>
                  <button onClick={() => { updateShift(shiftModal.empName, shiftModal.date, buildCustomShift()); closeShiftModal(); }} style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "none", background: t.primary, color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: F }}>Appliquer</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════
// ─── MAIN APP ───
// ═══════════════════════════════════════
export default function RestoApp() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const [currentUserIdx, setCurrentUserIdx] = useState(0);
  const [usersData, setUsersData] = useState(initialUsersData);
  const currentUser = usersData[currentUserIdx] || usersData[0];
  const isGerant = currentUser.role === "gerant";
  const employees = useMemo(() => usersData.filter(u => u.role === "employe"), [usersData]);

  const [section, setSection] = useState("dashboard");
  const [themeKey, setThemeKey] = useState("kimiko");
  const [showThemePicker, setShowThemePicker] = useState(false);
  const [tasks, setTasks] = useState(initialTasks);
  const [schedule, setSchedule] = useState({});
  const [products, setProducts] = useState(initialProducts);
  const [sorties, setSorties] = useState(initialSorties);
  const [showModal, setShowModal] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [templateDate, setTemplateDate] = useState(TODAY);
  const [templateAssignments, setTemplateAssignments] = useState([]);

  // Calcule la distribution des tâches selon les horaires du jour
  const computeTemplateAssignments = (date) => {
    const allUsers = usersData.filter(u => u.name !== "Jean Claude");
    const empShifts = allUsers.map(u => ({ name: u.name, shift: (schedule[u.name] || {})[date] || null }));
    const presents = empShifts.filter(e => estPresent(e.shift));
    if (!presents.length) return [];
    const ouverture = presents.filter(e => travailleOuverture(e.shift));
    const fermeture = presents.filter(e => travailleFermeture(e.shift));
    const assignments = [];
    const pools = { ouverture, fermeture, service: presents };
    let idxO = 0, idxF = 0, idxS = 0;
    TASK_TEMPLATES.forEach(task => {
      let pool = pools[task.creneau];
      if (!pool.length) pool = presents;
      let idx = task.creneau === 'ouverture' ? idxO : task.creneau === 'fermeture' ? idxF : idxS;
      const emp = pool[idx % pool.length];
      if (task.creneau === 'ouverture') idxO++;
      else if (task.creneau === 'fermeture') idxF++;
      else idxS++;
      assignments.push({ ...task, assignee: emp.name });
    });
    return assignments;
  };

  const openTemplateModal = () => {
    setTemplateAssignments(computeTemplateAssignments(TODAY));
    setTemplateDate(TODAY);
    setShowTemplateModal(true);
  };

  const shuffleTemplateAssignments = () => {
    const allUsers = usersData.filter(u => u.name !== "Jean Claude");
    const empShifts = allUsers.map(u => ({ name: u.name, shift: (schedule[u.name] || {})[templateDate] || null }));
    const presents = empShifts.filter(e => estPresent(e.shift));
    if (!presents.length) return;
    // Mélanger aléatoirement les assignations en respectant les créneaux
    const shuffled = presents.sort(() => Math.random() - 0.5);
    const ouverture = presents.filter(e => travailleOuverture(e.shift)).sort(() => Math.random() - 0.5);
    const fermeture = presents.filter(e => travailleFermeture(e.shift)).sort(() => Math.random() - 0.5);
    let idxO = 0, idxF = 0, idxS = 0;
    setTemplateAssignments(templateAssignments.map(task => {
      let pool = task.creneau === 'ouverture' ? ouverture : task.creneau === 'fermeture' ? fermeture : shuffled;
      if (!pool.length) pool = shuffled;
      let idx = task.creneau === 'ouverture' ? idxO : task.creneau === 'fermeture' ? idxF : idxS;
      const emp = pool[idx % pool.length];
      if (task.creneau === 'ouverture') idxO++; else if (task.creneau === 'fermeture') idxF++; else idxS++;
      return { ...task, assignee: emp.name };
    }));
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
  const [fA, setFA] = useState("");
  const [fC, setFC] = useState("");
  const t = themes[themeKey];
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
      // Produits
      const { data: pData } = await supabase.from('products').select('*').order('name');
      if (pData?.length) {
        setProducts(pData.map((p, i) => ({
          id: i + 1, _uuid: p.id,
          name: p.name, category: p.category, unit: p.unit,
          qty: parseFloat(p.qty) || 0,
          seuil: parseFloat(p.seuil) || 0,
          seuilOrange: parseFloat(p.seuil_orange) || 0,
        })));
      }
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
        setUsersData(prev => {
          const gerant = prev.find(u => u.role === 'gerant') || prev[0];
          return [gerant, ...eData.map((e, i) => ({
            id: i + 1, _uuid: e.id,
            name: e.name, role: e.role === 'gerant' ? 'gerant' : 'employe',
            initials: e.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase(),
            poste: e.role, tauxH: 12, heuresHebdo: 35,
            tel: e.phone || '', email: e.email || '',
            dateEntree: e.created_at?.slice(0, 10) || '', contrat: 'CDI', dateFin: '',
          }))];
        });
      }
    };
    loadData();
  }, []);

  const todayStaff = useMemo(() => employees.map(emp => {
    const sched = schedule[emp.name]?.[TODAY];
    return {
      name: emp.name,
      role: emp.poste || emp.role,
      shift: sched && sched !== 'repos' ? sched : '—',
      status: !sched || sched === 'repos' ? 'absent' : 'present'
    };
  }), [employees, schedule]);
  const effectiveSection = (!isGerant && section === "dashboard") ? "tasks" : section;
  const effectiveDate = isGerant ? viewDate : TODAY;
  const overdueTasks = useMemo(() => tasks.filter(isOverdue), [tasks]);
  const todayTasks = useMemo(() => tasks.filter(tk => tk.dueDate === TODAY), [tasks]);
  const viewTasks = useMemo(() => { if (effectiveDate === "overdue") return overdueTasks; return tasks.filter(tk => tk.dueDate === effectiveDate); }, [tasks, effectiveDate, overdueTasks]);

  const _pmap = { haute: 'high', moyenne: 'medium', basse: 'low' };
  const addTask = async (d) => {
    const tmpId = nid.current++;
    setTasks(p => [...p, { id: tmpId, ...d, status: "todo", completedBy: null }]);
    setShowModal(false);
    const { data } = await supabase.from('tasks').insert({
      title: d.title, assignee_name: d.assignee, category: d.category,
      priority: _pmap[d.priority] || 'medium', status: 'todo', due_date: d.dueDate,
    }).select().single();
    if (data) setTasks(p => p.map(tk => tk.id === tmpId ? { ...tk, id: data.id } : tk));
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

  const empBadge = isGerant ? todayTasks.filter(tk => tk.status !== "done").length + overdueTasks.length : todayTasks.filter(tk => tk.assignee === currentUser.name && tk.status !== "done").length;
  const stockAlertCount = products.filter(p => p.qty <= p.seuil).length;
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
    ? [{ id:"dashboard", label:"Accueil", icon:I.dashboard }, { id:"tasks", label:"Tâches", icon:I.tasks, badge:empBadge }, { id:"planning", label:"Planning", icon:I.users }, { id:"stocks", label:"Stocks", icon:I.box, badge:stockAlertCount+pendingSortiesCount }, { id:"more", label:"Plus", icon:I.settings }]
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
          <div style={{ padding: "12px 14px", borderBottom: `1px solid ${t.sidebarText}15` }}>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1, color: t.sidebarText + "66", marginBottom: 6, fontFamily: F }}>Connecté en tant que</div>
            <select value={currentUserIdx} onChange={e => { setCurrentUserIdx(+e.target.value); setSection(usersData[+e.target.value].role === "gerant" ? "dashboard" : "tasks"); setViewDate(TODAY); setShowHistory(false); }}
              style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: `1px solid ${t.sidebarText}33`, background: t.sidebarText + "11", color: t.sidebarText, fontSize: 13, fontWeight: 600, fontFamily: F, cursor: "pointer", outline: "none" }}>
              {usersData.map((u, i) => <option key={i} value={i} style={{ color: "#000" }}>{u.name} ({u.role === "gerant" ? "Gérant" : "Employé"})</option>)}
            </select>
          </div>
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
            {showThemePicker && (<div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap", padding: "0 4px" }}>{Object.entries(themes).map(([k, th]) => (<button key={k} onClick={() => { setThemeKey(k); setShowThemePicker(false); }} title={th.name} style={{ width: 28, height: 28, borderRadius: 8, border: themeKey === k ? `2px solid ${t.sidebarAccent}` : "2px solid transparent", background: `linear-gradient(135deg, ${th.sidebar} 50%, ${th.primary} 50%)`, cursor: "pointer" }} />))}</div>)}
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
            {isMobile && (
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
              {isGerant && !showHistory && <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                <button onClick={openTemplateModal} style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 16px", borderRadius:10, border:`1.5px solid ${t.accent||'#CA8A04'}`, background:"transparent", color:t.accent||'#CA8A04', fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:F }}>📋 Template du jour</button>
                <button onClick={() => setShowModal(true)} style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 20px", borderRadius:10, border:"none", background:t.primary, color:"#fff", fontWeight:600, fontSize:14, cursor:"pointer", fontFamily:F }} onMouseEnter={e => e.currentTarget.style.background = t.primaryHover} onMouseLeave={e => e.currentTarget.style.background = t.primary}>{I.plus} Nouvelle tâche</button>
              </div>}
            </div>
            {showHistory && isGerant ? <HistoryView tasks={tasks} t={t} /> : (<>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
                {isGerant && <div style={{ display: "flex", background: t.surfaceAlt, borderRadius: 8, border: `1px solid ${t.border}`, overflow: "hidden" }}>{[{ key: "checklist", icon: I.list, label: "Liste" }, { key: "kanban", icon: I.kanban, label: "Kanban" }].map(v => (<button key={v.key} onClick={() => setTaskView(v.key)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: F, background: taskView === v.key ? t.primary : "transparent", color: taskView === v.key ? "#fff" : t.textMuted }}>{v.icon}{v.label}</button>))}</div>}
                {isGerant && <select value={fA} onChange={e => setFA(e.target.value)} style={ss}><option value="">Tous</option>{employees.map(e => <option key={e.name}>{e.name}</option>)}</select>}
                <select value={fC} onChange={e => setFC(e.target.value)} style={ss}><option value="">Toutes catégories</option>{categoryList.map(c => <option key={c}>{c}</option>)}</select>
              </div>
              {isGerant && <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: isMobile ? 8 : 12, marginBottom: isMobile ? 12 : 20 }}>{[{label:"À faire",val:viewTasks.filter(tk=>tk.status==="todo").length,color:t.primary},{label:"En cours",val:viewTasks.filter(tk=>tk.status==="doing").length,color:t.warning},{label:"Terminées",val:viewTasks.filter(tk=>tk.status==="done").length,color:t.success},{label:"Total",val:viewTasks.length,color:t.textMuted}].map((s,i)=>(<div key={i} style={{ background:t.surface, borderRadius:10, padding:"14px 18px", border:`1px solid ${t.border}`, display:"flex", alignItems:"center", gap:12 }}><span style={{ width:10, height:10, borderRadius:"50%", background:s.color }} /><div><div style={{ fontSize:12, color:t.textMuted }}>{s.label}</div><div style={{ fontSize:22, fontWeight:700 }}>{s.val}</div></div></div>))}</div>}
              {(isGerant && taskView === "kanban") ? <KanbanView tasks={viewTasks} onMove={moveTask} onDelete={delTask} t={t} fA={fA} fC={fC} /> : <ChecklistView tasks={viewTasks} onToggle={toggleTask} onDelete={delTask} onEdit={openEditTask} t={t} fA={fA} fC={fC} isGerant={isGerant} currentUserName={currentUser.name} />}
            </>)}
          </div>
        )}

        {/* ÉQUIPE */}
        {effectiveSection === "equipe" && isGerant && (
          <EquipeModule t={t} employees={employees} usersData={usersData} setUsersData={setUsersData} isMobile={isMobile} />
        )}

        {/* PLANNING */}
        {effectiveSection === "planning" && (
          <PlanningModule t={t} schedule={schedule} setSchedule={setSchedule} pointage={initialPointage} isGerant={isGerant} currentUserName={currentUser.name} employees={employees} />
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
              <StatCard label="Équipe présente" value="4/5" sub="1 absence (Sofia)" icon={I.users} color={t.warning} t={t} />
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
          <StocksModule t={t} products={products} setProducts={setProducts} sorties={sorties} setSorties={setSorties} isGerant={isGerant} currentUserName={currentUser.name} />
        )}

        {/* Placeholder */}
        {!["dashboard", "tasks", "planning", "stocks", "equipe"].includes(effectiveSection) && (
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
            {[{ id: "equipe", label: "Équipe", icon: I.users }, { id: "orders", label: "Commandes", icon: I.orders }, { id: "finances", label: "Finances", icon: I.euro }, { id: "settings", label: "Paramètres", icon: I.settings }].map(item => (
              <button key={item.id} onClick={() => { setSection(item.id); setShowMobileMenu(false); }} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 10, border: "none", cursor: "pointer", background: effectiveSection === item.id ? t.primary + "12" : "transparent", color: effectiveSection === item.id ? t.primary : t.text, fontSize: 14, fontWeight: 500, fontFamily: F, textAlign: "left", width: "100%" }}>
                {item.icon}{item.label}
              </button>
            ))}
            <div style={{ borderTop: `1px solid ${t.border}`, marginTop: 4, paddingTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
              {Object.entries(themes).map(([k, th]) => (<button key={k} onClick={() => { setThemeKey(k); setShowMobileMenu(false); }} style={{ width: 32, height: 32, borderRadius: 8, border: themeKey === k ? `2px solid ${t.primary}` : `2px solid ${t.border}`, background: `linear-gradient(135deg, ${th.sidebar} 50%, ${th.primary} 50%)`, cursor: "pointer" }} />))}
            </div>
          </div>
        </div>
      )}

      {showModal && <TaskModal onClose={() => setShowModal(false)} onSave={addTask} t={t} defaultDate={viewDate !== "overdue" ? viewDate : TODAY} employees={employees} />}

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
              <input type="date" value={templateDate} onChange={e => { setTemplateDate(e.target.value); setTemplateAssignments(computeTemplateAssignments(e.target.value)); }}
                style={{ width:"100%", padding:"10px 14px", borderRadius:10, border:`1.5px solid ${t.border}`, fontFamily:F, fontSize:14, color:t.text, background:t.surface, outline:"none" }} />
            </div>
            {/* Warning si personne au planning */}
            {templateAssignments.length === 0 && (
              <div style={{ margin:"0 24px 16px", padding:"12px 16px", borderRadius:10, background:"#FEF3C7", border:"1px solid #FDE68A", fontSize:13, color:"#854D0E", fontFamily:F }}>
                ⚠️ Aucun employé n'a de shift planifié ce jour-là. Vérifie le planning d'abord.
              </div>
            )}
            {/* Task list */}
            {["ouverture","service","fermeture"].map(creneau => {
              const tasks = templateAssignments.filter(a => a.creneau === creneau);
              if (!tasks.length) return null;
              const labels = { ouverture:"🌅 Ouverture", service:"🍽️ Service", fermeture:"🌙 Fermeture" };
              const colors = { ouverture:"#F97316", service:t.primary, fermeture:"#6366F1" };
              return (
                <div key={creneau} style={{ padding:"0 24px", marginBottom:8 }}>
                  <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", color:colors[creneau], marginBottom:8, fontFamily:F }}>{labels[creneau]} · {tasks.length} tâches</div>
                  {tasks.map((task, i) => (
                    <div key={i} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", borderRadius:10, border:`1px solid ${t.border}`, background:t.surface, marginBottom:6, borderLeft:`3px solid ${colors[creneau]}` }}>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:13, fontWeight:600, color:t.text, fontFamily:F }}>{task.title}</div>
                        <div style={{ fontSize:11, color:t.textMuted, fontFamily:F, marginTop:2 }}>{task.category} · {task.priority}</div>
                      </div>
                      <div style={{ fontSize:12, fontWeight:700, color:t.text, fontFamily:F, flexShrink:0 }}>{task.assignee}</div>
                    </div>
                  ))}
                </div>
              );
            })}
            {/* Actions */}
            <div style={{ padding:"16px 24px 0", display:"flex", flexDirection:"column", gap:10 }}>
              <button onClick={shuffleTemplateAssignments} style={{ padding:"10px", borderRadius:10, border:`1.5px solid ${t.primary}`, background:"transparent", color:t.primary, fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:F }}>🔀 Répartir aléatoirement</button>
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
                <div><label style={{ fontSize: 13, fontWeight: 600, color: t.textMuted, marginBottom: 6, display: "block", fontFamily: F }}>Catégorie</label><select value={etCategory} onChange={e => setEtCategory(e.target.value)} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: `1px solid ${t.border}`, fontSize: 14, fontFamily: F, background: t.surface, color: t.text, outline: "none", cursor: "pointer" }}>{categoryList.map(c => <option key={c}>{c}</option>)}</select></div>
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
