import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { countedTodayIds } from '../lib/stock';
import { F } from '../lib/foundation';

// Mode inventaire guidé : sommaire des catégories -> comptage produit par produit.
// Chaque saisie est enregistrée immédiatement via le RPC enregistrer_comptage
// (seul canal d'écriture ouvert aux employés). « Passer » ne touche pas la quantité.
const InventaireMode = ({ t, products, setProducts, stockCategories, onClose }) => {
  const [counted, setCounted] = useState(new Set()); // _uuid des produits comptés aujourd'hui
  const [cat, setCat] = useState(null);              // null = sommaire
  const [idx, setIdx] = useState(0);
  const [val, setVal] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Reprise : produits déjà comptés aujourd'hui (traces stock_movements)
  useEffect(() => {
    const load = async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { data } = await supabase.from('stock_movements')
        .select('product_id, type').eq('type', 'adjustment').gte('created_at', today);
      if (data) setCounted(countedTodayIds(data));
    };
    load();
  }, []);

  const catProducts = cat ? products.filter(p => p.category === cat) : [];
  const current = catProducts[idx];

  const openCat = (c) => {
    const list = products.filter(p => p.category === c);
    const first = list.findIndex(p => !counted.has(p._uuid));
    setCat(c); setIdx(first === -1 ? 0 : first); setVal(''); setError('');
  };

  const advance = () => {
    if (idx + 1 < catProducts.length) { setIdx(idx + 1); setVal(''); setError(''); }
    else { setCat(null); }             // catégorie finie -> retour sommaire
  };

  const save = async () => {
    if (val === '' || saving) return;
    const q = parseFloat(String(val).replace(',', '.'));
    if (isNaN(q) || q < 0) { setError('Quantité invalide'); return; }
    setSaving(true); setError('');
    const { error: e } = await supabase.rpc('enregistrer_comptage',
      { p_product_id: current._uuid, p_qty: q });
    setSaving(false);
    if (e) { setError('Échec, réessaie : ' + e.message); return; }
    setProducts(prev => prev.map(p => p._uuid === current._uuid ? { ...p, qty: q } : p));
    setCounted(prev => new Set(prev).add(current._uuid));
    advance();
  };

  // ── Rendu ──
  const overlay = { position: 'fixed', inset: 0, background: t.bg || '#fff', zIndex: 1200,
    overflowY: 'auto', padding: 20, fontFamily: F };
  const done = products.filter(p => counted.has(p._uuid)).length;

  if (!cat) return (
    <div style={overlay}>
      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Inventaire</h2>
          <span style={{ fontSize: 12, background: t.surfaceAlt, borderRadius: 10, padding: '3px 10px' }}>
            {done} / {products.length} comptés</span>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 16, color: t.text }}>✕</button>
        </div>
        {stockCategories.map(c => {
          const list = products.filter(p => p.category === c);
          if (!list.length) return null;
          const n = list.filter(p => counted.has(p._uuid)).length;
          const full = n === list.length;
          return (
            <button key={c} onClick={() => openCat(c)} style={{ display: 'flex', width: '100%',
              justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', marginBottom: 8,
              borderRadius: 12, border: `1px solid ${t.border}`, background: t.surface, cursor: 'pointer',
              fontFamily: F, fontSize: 14, fontWeight: 600, color: t.text }}>
              <span>{full ? '✅' : '📦'} {c}</span>
              <span style={{ color: full ? t.success : t.textMuted, fontWeight: 500 }}>{n} / {list.length}</span>
            </button>
          );
        })}
        <button onClick={onClose} style={{ width: '100%', marginTop: 12, padding: '12px 0', borderRadius: 10,
          border: `1px solid ${t.border}`, background: t.surface, color: t.textMuted, cursor: 'pointer',
          fontFamily: F, fontWeight: 600 }}>Terminer pour aujourd'hui</button>
      </div>
    </div>
  );

  // Guard: catégorie vide ou idx hors bornes (edge case)
  if (!current) return null;

  return (
    <div style={overlay}>
      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <button onClick={() => setCat(null)} style={{ border: 'none', background: 'none', cursor: 'pointer',
            color: t.primary, fontFamily: F, fontWeight: 600 }}>← Catégories</button>
          <span style={{ fontSize: 12, color: t.textMuted }}>{cat} · {idx + 1} / {catProducts.length}</span>
        </div>
        <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 16, padding: 24 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: t.text }}>{current.name}
            {counted.has(current._uuid) && <span style={{ fontSize: 12, color: t.success, marginLeft: 8 }}>déjà compté ✓</span>}
          </div>
          <div style={{ fontSize: 13, color: t.textMuted, marginBottom: 16 }}>
            La dernière fois : {current.qty} {current.unit}</div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <input value={val} onChange={e => setVal(e.target.value)} type="number" step="0.1" min="0"
              autoFocus inputMode="decimal" placeholder="0"
              onKeyDown={e => { if (e.key === 'Enter') save(); }}
              style={{ flex: 1, fontSize: 24, textAlign: 'center', padding: '12px 8px', borderRadius: 10,
                border: `1px solid ${t.border}`, fontFamily: F, background: t.surface, color: t.text }} />
            <span style={{ fontSize: 15, color: t.textMuted }}>{current.unit}</span>
          </div>
          {error && <div style={{ color: t.danger, fontSize: 13, marginTop: 10 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <button onClick={save} disabled={saving || val === ''} style={{ flex: 2, padding: '14px 0',
              borderRadius: 10, border: 'none', background: val === '' ? t.border : t.primary,
              color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: F }}>
              {saving ? '…' : '✓ Suivant'}</button>
            <button onClick={advance} style={{ flex: 1, padding: '14px 0', borderRadius: 10,
              border: `1px solid ${t.border}`, background: t.surface, color: t.textMuted,
              fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: F }}>Passer</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InventaireMode;
