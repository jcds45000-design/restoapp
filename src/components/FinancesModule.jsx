import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { F } from '../lib/foundation.jsx';
import {
  SEUILS_DEFAUT, computeCoffreTheorique, computeReconciliation, mondayOf,
} from '../lib/finances.js';

const eur = (n) => `${(Number(n) || 0).toFixed(2)} €`;
const fmtSemaine = (lundi) => {
  const d = new Date(`${lundi}T12:00:00Z`);
  return `Sem. du ${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}`;
};
const addDaysISO = (dateISO, n) => {
  const d = new Date(`${dateISO}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const STATUTS = {
  en_cours:       { label: 'En cours',        color: '#6B7280' },
  a_deposer:      { label: 'À déposer',       color: '#CA8A04' },
  attente_banque: { label: 'Attente banque',  color: '#2563EB' },
  reconciliee:    { label: 'Réconciliée',     color: '#16A34A' },
  ecart:          { label: 'ÉCART',           color: '#DC2626' },
};

export default function FinancesModule({ t }) {
  const [semaines, setSemaines] = useState([]);   // triées récentes en premier
  const [lignes, setLignes] = useState([]);
  const [seuils, setSeuils] = useState(SEUILS_DEFAUT);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const aujourdHui = new Date().toISOString().slice(0, 10);

  const recharger = async () => {
    const [se, li, st] = await Promise.all([
      supabase.from('finance_semaines').select('*').order('semaine_debut', { ascending: false }),
      supabase.from('finance_banque_lignes').select('*'),
      supabase.from('finance_settings').select('*').eq('id', 1).maybeSingle(),
    ]);
    const err = se.error || li.error || st.error;
    if (err) { setErreur(err.message); setChargement(false); return; }
    setSemaines(se.data || []);
    setLignes(li.data || []);
    if (st.data) setSeuils(st.data);
    setChargement(false);
  };
  // Chargement initial au montage : recharger() ne fait ses setState qu'APRÈS
  // le await (donc pas de rendu en cascade). set-state-in-effect a un faux
  // positif ici car il ne trace pas l'asynchronie.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { recharger(); }, []);

  const [showSaisie, setShowSaisie] = useState(false);
  const [formSaisie, setFormSaisie] = useState(null);

  const ouvrirSaisie = () => {
    // Par défaut : la semaine écoulée (rituel du lundi).
    setFormSaisie({
      semaine_debut: mondayOf(addDaysISO(aujourdHui, -7)),
      caisse_cb: '', caisse_especes: '', caisse_uber: '', caisse_deliveroo: '', caisse_autres: '',
      caisse_source: 'manuelle',
    });
    setShowSaisie(true);
  };

  const enregistrerSaisie = async () => {
    const f = formSaisie;
    // Virgule décimale acceptée ; champ vide = null (jamais coercé en 0).
    const num = (v) => (v === '' || v == null ? null : Number(String(v).replace(',', '.')));
    if (num(f.caisse_cb) === null || num(f.caisse_especes) === null) return; // les 2 champs du rapprochement sont requis
    const { error } = await supabase.from('finance_semaines').upsert({
      semaine_debut: mondayOf(f.semaine_debut),
      caisse_cb: num(f.caisse_cb), caisse_especes: num(f.caisse_especes),
      caisse_uber: num(f.caisse_uber), caisse_deliveroo: num(f.caisse_deliveroo),
      caisse_autres: num(f.caisse_autres),
      caisse_source: f.caisse_source, caisse_saisi_le: new Date().toISOString(),
    }, { onConflict: 'semaine_debut' });
    if (error) { setErreur(error.message); return; }
    setShowSaisie(false);
    await recharger();
  };

  const depots = useMemo(
    () => lignes.filter((l) => l.categorie === 'depot_especes').map((l) => ({ montant: l.montant })),
    [lignes]
  );
  const coffre = useMemo(
    () => computeCoffreTheorique([...semaines].reverse(), depots, aujourdHui, seuils),
    [semaines, depots, aujourdHui, seuils]
  );
  const recos = useMemo(() => {
    const map = {};
    for (const s of semaines) {
      map[s.semaine_debut] = computeReconciliation(s, !!coffre.couvertes[s.semaine_debut], seuils, aujourdHui);
    }
    return map;
  }, [semaines, coffre, seuils, aujourdHui]);
  const nbAlertes = Object.values(recos).reduce((n, r) => n + r.alertes.length, 0) + coffre.alertes.length;

  const couleurCoffre = coffre.solde > Number(seuils.plafond_coffre) ? t.danger
    : coffre.solde > Number(seuils.plafond_coffre) * 0.7 ? t.warning : t.success;

  if (chargement) return <div style={{ padding: 40, textAlign: 'center', opacity: 0.6, fontFamily: F }}>Chargement…</div>;
  if (erreur) return <div style={{ padding: 40, color: t.danger, fontFamily: F }}>Erreur : {erreur}</div>;

  const th = { textAlign: 'right', padding: '10px 12px', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: t.textMuted, borderBottom: `1px solid ${t.border}` };
  const td = { textAlign: 'right', padding: '10px 12px', borderBottom: `1px solid ${t.border}` };

  return (
    <div style={{ fontFamily: F }}>
      {/* ── Barre d'actions ── */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        <button onClick={ouvrirSaisie} style={{ padding: '10px 18px', borderRadius: 10, border: 'none', background: t.primary, color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: F }}>
          Saisir les totaux caisse
        </button>
      </div>

      {/* ── Bandeau cockpit ── */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', background: t.surface, border: `1px solid ${t.border}`, borderLeft: `5px solid ${couleurCoffre}`, borderRadius: 14, padding: '18px 22px', marginBottom: 20 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, color: t.textMuted }}>Coffre théorique</div>
          <div style={{ fontSize: 26, fontWeight: 700, color: couleurCoffre }}>{eur(coffre.solde)} non déposés</div>
          {coffre.semaineOrigine && (
            <div style={{ fontSize: 13, color: t.textMuted, marginTop: 2 }}>
              depuis la {fmtSemaine(coffre.semaineOrigine).toLowerCase()} ({coffre.ancienneteSemaines} sem.)
            </div>
          )}
        </div>
        {nbAlertes > 0 && (
          <div style={{ background: t.danger + '15', color: t.danger, borderRadius: 10, padding: '8px 14px', fontWeight: 700, fontSize: 13 }}>
            {nbAlertes} alerte{nbAlertes > 1 ? 's' : ''}
          </div>
        )}
      </div>

      {/* ── Tableau des semaines ── */}
      {semaines.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: t.textMuted }}>
          Aucune semaine pour l'instant. Commence par « Saisir les totaux caisse ».
        </div>
      ) : (
        <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 900 }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: 'left' }}>Semaine</th>
                <th style={{ ...th, textAlign: 'left' }}>Statut</th>
                <th style={th}>Caisse CB</th>
                <th style={th}>Espèces</th>
                <th style={th}>Uber</th>
                <th style={th}>Deliveroo</th>
                <th style={th}>Banque CB</th>
                <th style={th}>Dépôts</th>
                <th style={th}>Écart CB</th>
              </tr>
            </thead>
            <tbody>
              {semaines.map((s) => {
                const r = recos[s.semaine_debut];
                const st = STATUTS[r.statut];
                return (
                  <tr key={s.id}>
                    <td style={{ ...td, textAlign: 'left', fontWeight: 600 }}>{fmtSemaine(s.semaine_debut)}</td>
                    <td style={{ ...td, textAlign: 'left' }}>
                      <span style={{ background: st.color + '18', color: st.color, borderRadius: 8, padding: '3px 10px', fontWeight: 700, fontSize: 12 }}>{st.label}</span>
                    </td>
                    <td style={td}>{s.caisse_cb == null ? '—' : eur(s.caisse_cb)}</td>
                    <td style={td}>{s.caisse_especes == null ? '—' : eur(s.caisse_especes)}</td>
                    <td style={td}>{s.caisse_uber == null ? '—' : eur(s.caisse_uber)}</td>
                    <td style={td}>{s.caisse_deliveroo == null ? '—' : eur(s.caisse_deliveroo)}</td>
                    <td style={td}>{s.banque_cb == null ? '—' : eur(s.banque_cb)}</td>
                    <td style={td}>{s.banque_depot_especes == null ? '—' : eur(s.banque_depot_especes)}</td>
                    <td style={{ ...td, fontWeight: 700, color: r.ecartCb === null ? t.textMuted : Math.abs(r.ecartCb) <= Number(seuils.tolerance_cb) ? t.success : t.danger }}>
                      {r.ecartCb === null ? '—' : eur(r.ecartCb)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showSaisie && formSaisie && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: t.surface, borderRadius: 14, padding: 24, width: 380, maxWidth: '92vw' }}>
            <h2 style={{ margin: '0 0 4px', fontSize: 17 }}>Totaux caisse de la semaine</h2>
            <p style={{ margin: '0 0 14px', fontSize: 12, color: t.textMuted }}>Depuis le rapport de la caisse (Z hebdo). CB et espèces sont requis.</p>
            <label style={{ fontSize: 12, color: t.textMuted }}>Lundi de la semaine</label>
            <input type="date" value={formSaisie.semaine_debut} onChange={(e) => setFormSaisie({ ...formSaisie, semaine_debut: e.target.value })}
              style={{ width: '100%', padding: 8, margin: '4px 0 10px', borderRadius: 8, border: `1px solid ${t.border}`, fontFamily: F, boxSizing: 'border-box' }} />
            {[['caisse_cb', 'CB'], ['caisse_especes', 'Espèces'], ['caisse_uber', 'Uber Eats'], ['caisse_deliveroo', 'Deliveroo'], ['caisse_autres', 'Autres']].map(([champ, label]) => (
              <div key={champ} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <label style={{ flex: 1, fontSize: 13 }}>{label}</label>
                <input inputMode="decimal" placeholder="0,00" value={formSaisie[champ]}
                  onChange={(e) => setFormSaisie({ ...formSaisie, [champ]: e.target.value })}
                  style={{ width: 120, padding: 8, borderRadius: 8, border: `1px solid ${t.border}`, textAlign: 'right', fontFamily: F }} />
              </div>
            ))}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0 16px' }}>
              <label style={{ flex: 1, fontSize: 13 }}>Source</label>
              <select value={formSaisie.caisse_source} onChange={(e) => setFormSaisie({ ...formSaisie, caisse_source: e.target.value })}
                style={{ width: 136, padding: 8, borderRadius: 8, border: `1px solid ${t.border}`, fontFamily: F }}>
                <option value="manuelle">Manuelle</option>
                <option value="caisse_web">Back-office caisse</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowSaisie(false)} style={{ padding: '9px 16px', borderRadius: 8, border: `1px solid ${t.border}`, background: 'transparent', color: t.text, cursor: 'pointer', fontFamily: F }}>Annuler</button>
              <button onClick={enregistrerSaisie} style={{ padding: '9px 16px', borderRadius: 8, border: 'none', background: t.primary, color: '#fff', fontWeight: 600, cursor: 'pointer', fontFamily: F }}>Enregistrer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
