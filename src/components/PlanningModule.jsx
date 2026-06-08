import { useState, useRef, useMemo, useEffect, Fragment } from 'react';
import { supabase } from '../lib/supabase';
import { repartir, CORVEES, pivotSemaine, decalerJours } from '../lib/taskDispatch';
import { I } from '../lib/icons';
import { TODAY, getMonday, WEEK_START, TODAY_LABEL, BANNER_IMAGE, fmt, fmtShort, addDays, getWeekDays, getDayName, isOverdue, calcHours, initialUsersData, initialSchedule, initialPointage, categoryList, priorityList, TASK_TEMPLATES, travailleOuverture, travailleFermeture, estPresent, initialTasks, stockCategories, initialProducts, initialSorties, stockAlerts, recentOrders, weeklyCA, themes, F, StatCard, MiniChart, Badge, StatusBadge, PriorityBadge, CategoryTag, OverdueBadge, CompletedByBadge, DateNav, TaskModal, TaskRow, ChecklistView, KanbanView, HistoryView } from '../lib/foundation';

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

export default PlanningModule;
