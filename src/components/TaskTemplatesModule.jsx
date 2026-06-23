import { useState } from 'react';
import { priorityList } from '../lib/foundation';

const CRENEAUX = [
  { key: 'ouverture', label: '🌅 Ouverture' },
  { key: 'service', label: '🍽️ Service' },
  { key: 'fermeture', label: '🌙 Fermeture' },
];

// Éditeur du catalogue des tâches habituelles (gérant). Ajoute / modifie / supprime
// des templates groupés par moment. La liste alimente le menu « Piocher » et le
// « Template du jour ».
export default function TaskTemplatesModule({ t, F, templates, categories, onAdd, onUpdate, onDelete, onClose }) {
  const [editId, setEditId] = useState(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState(categories[0] || 'Autre');
  const [priority, setPriority] = useState('moyenne');
  const [creneau, setCreneau] = useState('service');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [delId, setDelId] = useState(null);

  const inp = { width: '100%', padding: '10px 12px', borderRadius: 8, border: `1px solid ${t.border}`, fontSize: 14, fontFamily: F, background: t.surface, color: t.text, outline: 'none', boxSizing: 'border-box' };
  const btn = { padding: '9px 14px', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: F };

  const reset = () => { setEditId(null); setTitle(''); setCategory(categories[0] || 'Autre'); setPriority('moyenne'); setCreneau('service'); };
  const startEdit = (tp) => { setEditId(tp.id); setTitle(tp.title); setCategory(tp.category); setPriority(tp.priority); setCreneau(tp.creneau); setMsg(null); };

  const submit = async () => {
    if (!title.trim()) { setMsg({ ok: false, m: 'Le titre est requis.' }); return; }
    setBusy(true); setMsg(null);
    const payload = { title: title.trim(), category, priority, creneau };
    const r = editId ? await onUpdate(editId, payload) : await onAdd(payload);
    if (r?.error) setMsg({ ok: false, m: r.error });
    else { setMsg({ ok: true, m: editId ? 'Tâche modifiée.' : 'Tâche ajoutée.' }); reset(); }
    setBusy(false);
  };
  const remove = async (tp) => {
    setBusy(true); setMsg(null);
    const r = await onDelete(tp.id);
    if (r?.error) setMsg({ ok: false, m: r.error });
    else { setDelId(null); if (editId === tp.id) reset(); }
    setBusy(false);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }} onClick={onClose}>
      <div style={{ background: t.surface, borderRadius: 16, padding: 24, width: 580, maxWidth: '95vw', maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, fontFamily: F }}>Tâches habituelles</h2>
          <button onClick={onClose} style={{ background: 'none', border: `1px solid ${t.border}`, borderRadius: '50%', width: 32, height: 32, cursor: 'pointer', color: t.textMuted }}>✕</button>
        </div>

        <div style={{ background: t.surfaceAlt, borderRadius: 12, padding: 14, marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: t.text, fontFamily: F }}>{editId ? 'Modifier la tâche' : 'Ajouter une tâche habituelle'}</div>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Intitulé de la tâche" style={inp} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <select value={category} onChange={e => setCategory(e.target.value)} style={inp}>{categories.map(c => <option key={c} value={c}>{c}</option>)}</select>
            <select value={creneau} onChange={e => setCreneau(e.target.value)} style={inp}>{CRENEAUX.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</select>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>{priorityList.map(p => (<button key={p} onClick={() => setPriority(p)} style={{ ...btn, flex: 1, textTransform: 'capitalize', background: priority === p ? (p === 'haute' ? t.danger : p === 'moyenne' ? t.warning : t.success) : t.surface, color: priority === p ? '#fff' : t.textMuted, border: priority === p ? 'none' : `1px solid ${t.border}` }}>{p}</button>))}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={submit} disabled={busy} style={{ ...btn, flex: 1, background: t.primary, color: '#fff' }}>{editId ? 'Enregistrer' : 'Ajouter'}</button>
            {editId && <button onClick={reset} style={{ ...btn, background: t.surface, color: t.textMuted, border: `1px solid ${t.border}` }}>Annuler</button>}
          </div>
          {msg && <div style={{ fontSize: 13, fontWeight: 500, color: msg.ok ? t.success : t.danger, fontFamily: F }}>{msg.ok ? '✓ ' : '✗ '}{msg.m}</div>}
        </div>

        {CRENEAUX.map(cr => {
          const list = templates.filter(tp => tp.creneau === cr.key);
          if (!list.length) return null;
          return (
            <div key={cr.key} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: t.textMuted, marginBottom: 6, fontFamily: F }}>{cr.label} · {list.length}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {list.map(tp => (
                  <div key={tp.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, background: editId === tp.id ? t.primary + '10' : t.surfaceAlt, border: `1px solid ${editId === tp.id ? t.primary + '55' : t.border}` }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: t.text, fontFamily: F }}>{tp.title}</div>
                      <div style={{ fontSize: 11, color: t.textMuted, fontFamily: F }}>{tp.category} · {tp.priority}</div>
                    </div>
                    {delId === tp.id ? (
                      <>
                        <button onClick={() => remove(tp)} disabled={busy} style={{ ...btn, background: t.danger, color: '#fff' }}>Confirmer</button>
                        <button onClick={() => setDelId(null)} style={{ ...btn, background: t.surface, color: t.textMuted, border: `1px solid ${t.border}` }}>Non</button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => startEdit(tp)} style={{ ...btn, background: t.surface, color: t.text, border: `1px solid ${t.border}` }}>Modifier</button>
                        <button onClick={() => { setDelId(tp.id); setMsg(null); }} style={{ ...btn, background: t.danger + '0F', color: t.danger, border: `1px solid ${t.danger}30` }}>Suppr.</button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        {templates.length === 0 && <p style={{ fontSize: 13, color: t.textMuted, fontFamily: F }}>Aucune tâche habituelle chargée (applique le SQL de création de la table, puis recharge).</p>}
      </div>
    </div>
  );
}
