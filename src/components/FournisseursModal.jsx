import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { I } from '../lib/icons';
import { F } from '../lib/foundation';

// Modal de gestion des fournisseurs (gérant uniquement).
// Props : { t, suppliers, setSuppliers, productSuppliers, onClose }
const FournisseursModal = ({ t, suppliers, setSuppliers, productSuppliers, onClose }) => {
  const [newName, setNewName] = useState('');
  // renameId : id du fournisseur en cours de renommage
  const [renameId, setRenameId] = useState(null);
  const [renameName, setRenameName] = useState('');
  // confirmDeleteId : premier clic sur Supprimer/Désactiver
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const sel = {
    padding: '8px 12px', borderRadius: 8, border: `1px solid ${t.border}`,
    fontSize: 13, fontFamily: F, background: t.surface, color: t.text, outline: 'none',
  };

  // Ajouter un fournisseur
  const addSupplier = async () => {
    const name = newName.trim();
    if (!name) return;
    const { data, error } = await supabase.from('suppliers').insert({ name }).select().single();
    if (error) { alert('Erreur : ' + error.message); return; }
    setSuppliers(prev => [...prev, data]);
    setNewName('');
  };

  // Démarrer le renommage
  const startRename = (s) => {
    setRenameId(s.id);
    setRenameName(s.name);
    setConfirmDeleteId(null);
  };

  // Valider le renommage
  const saveRename = async (s) => {
    const name = renameName.trim();
    if (!name) { setRenameId(null); return; }
    const { error } = await supabase.from('suppliers').update({ name }).eq('id', s.id);
    if (error) { alert('Erreur : ' + error.message); return; }
    setSuppliers(prev => prev.map(x => x.id === s.id ? { ...x, name } : x));
    setRenameId(null);
  };

  // Supprimer ou désactiver (si des produits sont liés)
  const removeSupplier = async (s) => {
    const linked = productSuppliers.some(l => l.supplier_id === s.id);
    if (linked) {
      const { error } = await supabase.from('suppliers').update({ active: false }).eq('id', s.id);
      if (error) { alert('Erreur : ' + error.message); return; }
      setSuppliers(prev => prev.map(x => x.id === s.id ? { ...x, active: false } : x));
    } else {
      const { error } = await supabase.from('suppliers').delete().eq('id', s.id);
      if (error) { alert('Erreur : ' + error.message); return; }
      setSuppliers(prev => prev.filter(x => x.id !== s.id));
    }
    setConfirmDeleteId(null);
  };

  // Réactiver un fournisseur inactif
  const reactivateSupplier = async (s) => {
    const { error } = await supabase.from('suppliers').update({ active: true }).eq('id', s.id);
    if (error) { alert('Erreur : ' + error.message); return; }
    setSuppliers(prev => prev.map(x => x.id === s.id ? { ...x, active: true } : x));
  };

  const sorted = [...suppliers].sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
      onClick={onClose}
    >
      <div
        style={{ background: t.surface, borderRadius: 16, padding: 28, width: 500, maxWidth: '92vw', boxShadow: '0 20px 60px rgba(0,0,0,0.15)', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
        onClick={e => e.stopPropagation()}
      >
        {/* En-tête */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, fontFamily: F }}>Fournisseurs</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.textMuted, padding: 4 }}>{I.x}</button>
        </div>

        {/* Liste scrollable */}
        <div style={{ maxHeight: '70vh', overflowY: 'auto', marginBottom: 16 }}>
          {sorted.length === 0 && (
            <div style={{ textAlign: 'center', padding: 24, color: t.textMuted, fontSize: 13, fontFamily: F }}>
              Aucun fournisseur enregistré.
            </div>
          )}
          {sorted.map((s, i) => {
            const linkedCount = productSuppliers.filter(l => l.supplier_id === s.id).length;
            const isInactif = s.active === false;
            const isRenaming = renameId === s.id;
            const isConfirming = confirmDeleteId === s.id;

            return (
              <div
                key={s.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '12px 4px',
                  borderBottom: i < sorted.length - 1 ? `1px solid ${t.border}` : 'none',
                  opacity: isInactif ? 0.6 : 1,
                }}
              >
                {/* Nom ou champ de renommage */}
                {isRenaming ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                    <input
                      value={renameName}
                      onChange={e => setRenameName(e.target.value)}
                      autoFocus
                      style={{ ...sel, flex: 1, padding: '6px 10px' }}
                      onKeyDown={e => { if (e.key === 'Enter') saveRename(s); if (e.key === 'Escape') setRenameId(null); }}
                    />
                    <button onClick={() => saveRename(s)} style={{ background: t.success, color: '#fff', border: 'none', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>✓</button>
                    <button onClick={() => setRenameId(null)} style={{ background: t.border, color: t.textMuted, border: 'none', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12 }}>✕</button>
                  </div>
                ) : (
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <span style={{ fontSize: 14, fontWeight: 500, fontFamily: F, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                    {isInactif && (
                      <span style={{ fontSize: 11, fontWeight: 600, background: t.border, color: t.textMuted, padding: '2px 8px', borderRadius: 20, whiteSpace: 'nowrap', fontFamily: F }}>inactif</span>
                    )}
                    <span style={{ fontSize: 12, color: t.textMuted, whiteSpace: 'nowrap', fontFamily: F }}>{linkedCount} produit{linkedCount !== 1 ? 's' : ''}</span>
                  </div>
                )}

                {/* Actions */}
                {!isRenaming && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    {/* Renommer */}
                    <button
                      onClick={() => startRename(s)}
                      title="Renommer"
                      style={{ background: 'none', border: `1px solid ${t.border}`, borderRadius: 6, padding: '4px 8px', cursor: 'pointer', color: t.textMuted, fontSize: 13 }}
                    >
                      ✎
                    </button>

                    {/* Réactiver / Désactiver / Supprimer */}
                    {isInactif ? (
                      <button
                        onClick={() => reactivateSupplier(s)}
                        style={{ background: t.success + '18', color: t.success, border: `1px solid ${t.success}30`, borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: F }}
                      >
                        Réactiver
                      </button>
                    ) : isConfirming ? (
                      <button
                        onClick={() => removeSupplier(s)}
                        style={{ background: t.danger, color: '#fff', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: F }}
                      >
                        Confirmer ?
                      </button>
                    ) : (
                      <button
                        onClick={() => { setConfirmDeleteId(s.id); setRenameId(null); }}
                        style={{ background: t.danger + '08', color: t.danger, border: `1px solid ${t.danger}30`, borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: F }}
                      >
                        {linkedCount > 0 ? 'Désactiver' : 'Supprimer'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Formulaire ajout */}
        <div style={{ display: 'flex', gap: 8, borderTop: `1px solid ${t.border}`, paddingTop: 16 }}>
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Nom du fournisseur"
            style={{ ...sel, flex: 1 }}
            onKeyDown={e => { if (e.key === 'Enter') addSupplier(); }}
          />
          <button
            onClick={addSupplier}
            style={{
              padding: '8px 16px', borderRadius: 8, border: 'none',
              background: newName.trim() ? t.primary : t.border,
              color: newName.trim() ? '#fff' : t.textMuted,
              fontSize: 13, fontWeight: 600, cursor: newName.trim() ? 'pointer' : 'default', fontFamily: F,
            }}
          >
            Ajouter
          </button>
        </div>
      </div>
    </div>
  );
};

export default FournisseursModal;
