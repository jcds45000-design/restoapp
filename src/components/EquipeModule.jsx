import { useState, useRef, useMemo, useEffect, Fragment } from 'react';
import { supabase } from '../lib/supabase';
import { repartir, CORVEES, pivotSemaine, decalerJours } from '../lib/taskDispatch';
import { I } from '../lib/icons';
import { TODAY, getMonday, WEEK_START, TODAY_LABEL, BANNER_IMAGE, fmt, fmtShort, addDays, getWeekDays, getDayName, isOverdue, calcHours, initialUsersData, initialSchedule, initialPointage, categoryList, priorityList, TASK_TEMPLATES, travailleOuverture, travailleFermeture, estPresent, initialTasks, stockCategories, initialProducts, initialSorties, stockAlerts, recentOrders, weeklyCA, themes, F, StatCard, MiniChart, Badge, StatusBadge, PriorityBadge, CategoryTag, OverdueBadge, CompletedByBadge, DateNav, TaskModal, TaskRow, ChecklistView, KanbanView, HistoryView } from '../lib/foundation';

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
  const [aCreateAccount, setACreateAccount] = useState(false);
  const [aPassword, setAPassword] = useState("");
  const [aShowPwd, setAShowPwd] = useState(false);
  const [aAccountMsg, setAAccountMsg] = useState(null);

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
  const [eCreateAccount, setECreateAccount] = useState(false);
  const [ePassword, setEPassword] = useState("");
  const [eShowPwd, setEShowPwd] = useState(false);
  const [eAccountMsg, setEAccountMsg] = useState(null);

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

  const saveEdit = async () => {
    if (!editingEmp || !eName.trim()) return;
    if (eCreateAccount && (!eEmail.trim() || ePassword.length < 6)) {
      setEAccountMsg({ ok: false, msg: eEmail.trim() ? 'Mot de passe : 6 caractères minimum.' : 'Email requis pour créer un compte.' });
      return;
    }
    const initials = eName.trim().split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
    const updated = { name: eName, initials, poste: ePoste, tauxH: parseFloat(eTaux) || 0, heuresHebdo: parseFloat(eHeures) || 35, tel: eTel, email: eEmail, dateEntree: eDate, contrat: eContrat, dateFin: eContrat === "CDD" ? eDateFin : "" };
    setUsersData(prev => prev.map(u => u.id === editingEmp.id ? { ...u, ...updated } : u));
    if (editingEmp._uuid) {
      supabase.from('employees').update({
        name: eName, poste: ePoste, phone: eTel, email: eEmail,
        taux_h: parseFloat(eTaux) || 0, heures_hebdo: parseFloat(eHeures) || 35,
        contrat: eContrat, date_fin: eContrat === "CDD" && eDateFin ? eDateFin : null, date_entree: eDate || null,
      }).eq('id', editingEmp._uuid).then(({ error }) => { if (error) console.error('Supabase update error:', error.message); });
    }
    // Créer le compte Auth si demandé
    if (eCreateAccount && eEmail.trim() && ePassword) {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}`, 'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY },
        body: JSON.stringify({ email: eEmail.trim(), password: ePassword, full_name: eName.trim(), role: 'employe' }),
      });
      const data = await res.json();
      if (!data.success) {
        setEAccountMsg({ ok: false, msg: `Fiche sauvegardée mais compte échoué : ${data.error}` });
        return;
      }
    }
    setEditingEmp(null); setECreateAccount(false); setEPassword(""); setEAccountMsg(null);
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
    if (aCreateAccount && (!aEmail.trim() || aPassword.length < 6)) {
      setAAccountMsg({ ok: false, msg: aEmail.trim() ? 'Mot de passe : 6 caractères minimum.' : 'Email requis pour créer un compte.' });
      return;
    }
    setAAccountMsg(null);
    const initials = aName.trim().split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
    const { data: newEmp, error } = await supabase.from('employees').insert({
      name: aName,
      role: 'employe',
      poste: aPoste,
      phone: aTel,
      email: aEmail,
      taux_h: parseFloat(aTaux) || 11.27,
      heures_hebdo: parseFloat(aHeures) || 35,
      contrat: aContrat,
      date_fin: aContrat === "CDD" && aDateFin ? aDateFin : null,
      date_entree: aDate || null,
      active: true,
    }).select().single();
    if (error) { alert('Erreur Supabase: ' + error.message); return; }

    // Créer le compte de connexion si demandé
    if (aCreateAccount && aEmail.trim() && aPassword) {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}`, 'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY },
        body: JSON.stringify({ email: aEmail.trim(), password: aPassword, full_name: aName.trim(), role: 'employe' }),
      });
      const data = await res.json();
      if (!data.success) {
        setAAccountMsg({ ok: false, msg: `Fiche créée mais compte échoué : ${data.error}` });
      }
    }

    setUsersData(prev => [...prev, { id: eidRef.current++, _uuid: newEmp?.id, name: aName, role: "employe", initials, poste: aPoste, tauxH: parseFloat(aTaux) || 11.27, heuresHebdo: parseFloat(aHeures) || 35, tel: aTel, email: aEmail, dateEntree: aDate, contrat: aContrat, dateFin: aContrat === "CDD" ? aDateFin : "" }]);
    setAName(""); setAPoste("Cuisine"); setATaux(""); setAHeures("35"); setATel(""); setAEmail(""); setADate(TODAY); setAContrat("CDI"); setADateFin(""); setACreateAccount(false); setAPassword(""); setAAccountMsg(null);
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
              {/* Option compte de connexion */}
              <div style={{ borderTop: `1px solid ${t.border}`, paddingTop: 14 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                  <input type="checkbox" checked={aCreateAccount} onChange={e => { setACreateAccount(e.target.checked); setAAccountMsg(null); }} style={{ width: 16, height: 16, cursor: "pointer", accentColor: t.primary }} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: t.text, fontFamily: F }}>Créer un compte de connexion</span>
                </label>
                {aCreateAccount && (
                  <div style={{ marginTop: 12 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6, display: "block" }}>Mot de passe temporaire</label>
                    <div style={{ position: 'relative' }}>
                      <input value={aPassword} onChange={e => setAPassword(e.target.value)} type={aShowPwd ? 'text' : 'password'} placeholder="Minimum 6 caractères" style={{ ...sel, borderColor: t.primary + "60", paddingRight: 40 }} />
                      <button type="button" onClick={() => setAShowPwd(!aShowPwd)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: t.textMuted, display: 'flex', alignItems: 'center', padding: 4 }} aria-label={aShowPwd ? 'Masquer' : 'Afficher'}>
                        {aShowPwd ? I.eyeOff : I.eyeOn}
                      </button>
                    </div>
                    <div style={{ fontSize: 12, color: t.textMuted, marginTop: 4, fontFamily: F }}>L'email saisi ci-dessus sera utilisé comme identifiant.</div>
                  </div>
                )}
                {aAccountMsg && <div style={{ marginTop: 8, fontSize: 12, fontWeight: 500, color: aAccountMsg.ok ? t.success : t.danger, fontFamily: F }}>{aAccountMsg.msg}</div>}
              </div>

            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button onClick={() => { setShowAddModal(false); setACreateAccount(false); setAPassword(""); setAAccountMsg(null); }} style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: `1px solid ${t.border}`, background: t.surface, color: t.textMuted, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: F }}>Annuler</button>
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
            {/* Option compte de connexion */}
            <div style={{ borderTop: `1px solid ${t.border}`, paddingTop: 14, marginTop: 4 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                <input type="checkbox" checked={eCreateAccount} onChange={e => { setECreateAccount(e.target.checked); setEAccountMsg(null); }} style={{ width: 16, height: 16, cursor: "pointer", accentColor: t.primary }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: t.text, fontFamily: F }}>Créer / recréer un compte de connexion</span>
              </label>
              {eCreateAccount && (
                <div style={{ marginTop: 12 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6, display: "block" }}>Mot de passe temporaire</label>
                  <div style={{ position: 'relative' }}>
                    <input value={ePassword} onChange={e => setEPassword(e.target.value)} type={eShowPwd ? 'text' : 'password'} placeholder="Minimum 6 caractères" style={{ ...sel, borderColor: t.primary + "60", paddingRight: 40 }} />
                    <button type="button" onClick={() => setEShowPwd(!eShowPwd)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: t.textMuted, display: 'flex', alignItems: 'center', padding: 4 }} aria-label={eShowPwd ? 'Masquer' : 'Afficher'}>
                      {eShowPwd ? I.eyeOff : I.eyeOn}
                    </button>
                  </div>
                  <div style={{ fontSize: 12, color: t.textMuted, marginTop: 4, fontFamily: F }}>L'email de la fiche sera utilisé comme identifiant.</div>
                </div>
              )}
              {eAccountMsg && <div style={{ marginTop: 8, fontSize: 12, fontWeight: 500, color: eAccountMsg.ok ? t.success : t.danger, fontFamily: F }}>{eAccountMsg.msg}</div>}
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              {!confirmDelete ? (
                <button onClick={() => setConfirmDelete(true)} style={{ padding: "10px 14px", borderRadius: 8, border: `1px solid ${t.danger}30`, background: t.danger + "08", color: t.danger, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: F, display: "flex", alignItems: "center", gap: 6 }}>{I.trash} Supprimer</button>
              ) : (
                <button onClick={deleteEmp} style={{ padding: "10px 14px", borderRadius: 8, border: "none", background: t.danger, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: F }}>Confirmer</button>
              )}
              <div style={{ flex: 1 }} />
              <button onClick={() => { setEditingEmp(null); setConfirmDelete(false); setECreateAccount(false); setEPassword(""); setEAccountMsg(null); }} style={{ padding: "10px 16px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.surface, color: t.textMuted, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: F }}>Annuler</button>
              <button onClick={saveEdit} style={{ padding: "10px 16px", borderRadius: 8, border: "none", background: eName.trim() ? t.primary : t.border, color: eName.trim() ? "#fff" : t.textMuted, fontSize: 14, fontWeight: 600, cursor: eName.trim() ? "pointer" : "default", fontFamily: F }}>Enregistrer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EquipeModule;
