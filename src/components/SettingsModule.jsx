import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { I } from '../lib/icons';

const SettingsModule = ({ t, F, authUser, categories = [], onAddCategory, onRenameCategory, onDeleteCategory }) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [role, setRole] = useState('employe');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null); // { success, message }
  // Changement de mon propre mot de passe
  const [npNew, setNpNew] = useState('');
  const [npConfirm, setNpConfirm] = useState('');
  const [npShow, setNpShow] = useState(false);
  const [npLoading, setNpLoading] = useState(false);
  const [npResult, setNpResult] = useState(null); // { success, message }

  const changePassword = async () => {
    if (npNew.length < 6) { setNpResult({ success: false, message: 'Le mot de passe doit faire au moins 6 caractères.' }); return; }
    if (npNew !== npConfirm) { setNpResult({ success: false, message: 'Les deux mots de passe ne correspondent pas.' }); return; }
    setNpLoading(true); setNpResult(null);
    const { error } = await supabase.auth.updateUser({ password: npNew });
    if (error) setNpResult({ success: false, message: error.message || 'Erreur lors de la mise à jour.' });
    else { setNpResult({ success: true, message: 'Mot de passe mis à jour.' }); setNpNew(''); setNpConfirm(''); }
    setNpLoading(false);
  };

  // ─── Catégories de tâches ───
  const [newCat, setNewCat] = useState('');
  const [catBusy, setCatBusy] = useState(false);
  const [catMsg, setCatMsg] = useState(null);
  const [editCatId, setEditCatId] = useState(null);
  const [editCatName, setEditCatName] = useState('');
  const [delCatId, setDelCatId] = useState(null);
  const handleAddCat = async () => {
    setCatBusy(true); setCatMsg(null);
    const r = await onAddCategory(newCat);
    if (r?.error) setCatMsg({ success: false, message: r.error });
    else { setNewCat(''); setCatMsg({ success: true, message: 'Catégorie ajoutée.' }); }
    setCatBusy(false);
  };
  const handleRenameCat = async (cat) => {
    setCatBusy(true); setCatMsg(null);
    const r = await onRenameCategory(cat.id, cat.name, editCatName);
    if (r?.error) setCatMsg({ success: false, message: r.error });
    else { setEditCatId(null); setCatMsg({ success: true, message: 'Catégorie renommée, tâches mises à jour.' }); }
    setCatBusy(false);
  };
  const handleDeleteCat = async (cat) => {
    setCatBusy(true); setCatMsg(null);
    const r = await onDeleteCategory(cat.id, cat.name);
    if (r?.error) setCatMsg({ success: false, message: r.error });
    else { setDelCatId(null); setCatMsg({ success: true, message: 'Catégorie supprimée, tâches déplacées dans « Autre ».' }); }
    setCatBusy(false);
  };

  const createAccount = async () => {
    if (!name.trim() || !email.trim() || !password.trim()) {
      setResult({ success: false, message: 'Tous les champs sont requis.' });
      return;
    }
    if (password.length < 6) {
      setResult({ success: false, message: 'Le mot de passe doit faire au moins 6 caractères.' });
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-user`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ email: email.trim(), password, full_name: name.trim(), role }),
        }
      );
      const data = await res.json();
      if (!data.success) {
        setResult({ success: false, message: data.error || 'Erreur lors de la création.' });
        setLoading(false);
        return;
      }

      // Créer automatiquement la fiche employé dans Équipe
      await supabase.from('employees').upsert({
        name: name.trim(),
        email: email.trim(),
        role: role,
        poste: role === 'gerant' ? 'Gérant' : 'Polyvalent',
        taux_h: 11.27,
        heures_hebdo: 35,
        contrat: 'CDI',
        active: true,
      }, { onConflict: 'email' });

      setResult({ success: true, message: `Compte et fiche employé créés pour ${name.trim()}.` });
      setName(''); setEmail(''); setPassword(''); setRole('employe');
    } catch (e) {
      setResult({ success: false, message: 'Erreur réseau : ' + e.message });
    }
    setLoading(false);
  };

  const inp = { width: '100%', padding: '10px 14px', borderRadius: 10, border: `1.5px solid ${t.border}`, fontSize: 14, fontFamily: F, background: t.bg, color: t.text, outline: 'none', boxSizing: 'border-box' };
  const btnSm = { padding: '8px 12px', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: F };

  return (
    <div style={{ maxWidth: 560 }}>
      <div style={{ background: t.surface, borderRadius: 16, border: `1px solid ${t.border}`, padding: 28, marginBottom: 20 }}>
        <h2 style={{ fontSize: 17, fontWeight: 700, margin: '0 0 6px', fontFamily: F }}>Mon mot de passe</h2>
        <p style={{ fontSize: 14, color: t.textMuted, margin: '0 0 20px', fontFamily: F }}>Compte connecté : <strong style={{ color: t.text }}>{authUser?.email || '—'}</strong></p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6, fontFamily: F }}>Nouveau mot de passe</label>
            <div style={{ position: 'relative' }}>
              <input type={npShow ? 'text' : 'password'} value={npNew} onChange={e => setNpNew(e.target.value)} placeholder="Minimum 6 caractères" style={{ ...inp, paddingRight: 40 }} />
              <button type="button" onClick={() => setNpShow(!npShow)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: t.textMuted, display: 'flex', alignItems: 'center', padding: 4 }} aria-label={npShow ? 'Masquer' : 'Afficher'}>
                {npShow ? I.eyeOff : I.eyeOn}
              </button>
            </div>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6, fontFamily: F }}>Confirmer le nouveau mot de passe</label>
            <input type={npShow ? 'text' : 'password'} value={npConfirm} onChange={e => setNpConfirm(e.target.value)} placeholder="Retapez le mot de passe" style={inp} />
          </div>
          {npResult && (
            <div style={{ padding: '10px 14px', borderRadius: 8, fontSize: 13, fontWeight: 500, fontFamily: F, background: npResult.success ? t.success + '12' : t.danger + '12', color: npResult.success ? t.success : t.danger, border: `1px solid ${npResult.success ? t.success : t.danger}22` }}>
              {npResult.success ? '✓ ' : '✗ '}{npResult.message}
            </div>
          )}
          <button onClick={changePassword} disabled={npLoading} style={{ padding: '12px 0', borderRadius: 10, border: 'none', background: npLoading ? t.primary + '80' : t.primary, color: '#fff', fontSize: 14, fontWeight: 700, cursor: npLoading ? 'not-allowed' : 'pointer', fontFamily: F, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            {npLoading ? 'Mise à jour...' : 'Mettre à jour'}
          </button>
        </div>
      </div>
      <div style={{ background: t.surface, borderRadius: 16, border: `1px solid ${t.border}`, padding: 28, marginBottom: 20 }}>
        <h2 style={{ fontSize: 17, fontWeight: 700, margin: '0 0 6px', fontFamily: F }}>Catégories de tâches</h2>
        <p style={{ fontSize: 14, color: t.textMuted, margin: '0 0 20px', fontFamily: F }}>Ajoute, renomme ou supprime les catégories. Supprimer une catégorie déplace ses tâches dans « Autre ».</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {categories.map(cat => (
            <div key={cat.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 10, background: t.surfaceAlt, border: `1px solid ${t.border}` }}>
              {editCatId === cat.id ? (
                <>
                  <input value={editCatName} onChange={e => setEditCatName(e.target.value)} autoFocus onKeyDown={e => { if (e.key === 'Enter') handleRenameCat(cat); }} style={{ ...inp, flex: 1 }} />
                  <button onClick={() => handleRenameCat(cat)} disabled={catBusy} style={{ ...btnSm, background: t.primary, color: '#fff' }}>OK</button>
                  <button onClick={() => setEditCatId(null)} style={{ ...btnSm, background: t.surface, color: t.textMuted, border: `1px solid ${t.border}` }}>Annuler</button>
                </>
              ) : delCatId === cat.id ? (
                <>
                  <span style={{ flex: 1, fontSize: 13, color: t.text, fontFamily: F }}>Supprimer « {cat.name} » ? Ses tâches passent dans « Autre ».</span>
                  <button onClick={() => handleDeleteCat(cat)} disabled={catBusy} style={{ ...btnSm, background: t.danger, color: '#fff' }}>Confirmer</button>
                  <button onClick={() => setDelCatId(null)} style={{ ...btnSm, background: t.surface, color: t.textMuted, border: `1px solid ${t.border}` }}>Annuler</button>
                </>
              ) : (
                <>
                  <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: t.text, fontFamily: F }}>{cat.name}</span>
                  {cat.name === 'Autre' ? (
                    <span style={{ fontSize: 12, color: t.textMuted, fontFamily: F }}>protégée</span>
                  ) : (
                    <>
                      <button onClick={() => { setEditCatId(cat.id); setEditCatName(cat.name); setCatMsg(null); }} style={{ ...btnSm, background: t.surface, color: t.text, border: `1px solid ${t.border}` }}>Renommer</button>
                      <button onClick={() => { setDelCatId(cat.id); setCatMsg(null); }} style={{ ...btnSm, background: t.danger + '0F', color: t.danger, border: `1px solid ${t.danger}30` }}>Supprimer</button>
                    </>
                  )}
                </>
              )}
            </div>
          ))}
          {categories.length === 0 && <p style={{ fontSize: 13, color: t.textMuted, fontFamily: F, margin: 0 }}>Aucune catégorie chargée (applique d'abord le SQL de création de la table dans Supabase).</p>}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <input value={newCat} onChange={e => setNewCat(e.target.value)} placeholder="Nouvelle catégorie (ex : Livraison)" onKeyDown={e => { if (e.key === 'Enter') handleAddCat(); }} style={{ ...inp, flex: 1 }} />
          <button onClick={handleAddCat} disabled={catBusy || !newCat.trim()} style={{ ...btnSm, padding: '10px 16px', background: (catBusy || !newCat.trim()) ? t.border : t.primary, color: (catBusy || !newCat.trim()) ? t.textMuted : '#fff' }}>Ajouter</button>
        </div>
        {catMsg && (
          <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 8, fontSize: 13, fontWeight: 500, fontFamily: F, background: catMsg.success ? t.success + '12' : t.danger + '12', color: catMsg.success ? t.success : t.danger, border: `1px solid ${(catMsg.success ? t.success : t.danger)}22` }}>
            {catMsg.success ? '✓ ' : '✗ '}{catMsg.message}
          </div>
        )}
      </div>

      <div style={{ background: t.surface, borderRadius: 16, border: `1px solid ${t.border}`, padding: 28, marginBottom: 20 }}>
        <h2 style={{ fontSize: 17, fontWeight: 700, margin: '0 0 6px', fontFamily: F }}>Gestion des comptes</h2>
        <p style={{ fontSize: 14, color: t.textMuted, margin: '0 0 24px', fontFamily: F }}>Créer un compte pour un nouvel employé ou gérant.</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6, fontFamily: F }}>Prénom et nom</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Ex : Yuna Kim" style={inp} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6, fontFamily: F }}>Adresse email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="yuna@kimiko.fr" style={inp} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6, fontFamily: F }}>Mot de passe temporaire</label>
            <div style={{ position: 'relative' }}>
              <input type={showPwd ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="Minimum 6 caractères" style={{ ...inp, paddingRight: 40 }} />
              <button type="button" onClick={() => setShowPwd(!showPwd)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: t.textMuted, display: 'flex', alignItems: 'center', padding: 4 }} aria-label={showPwd ? 'Masquer' : 'Afficher'}>
                {showPwd ? I.eyeOff : I.eyeOn}
              </button>
            </div>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 8, fontFamily: F }}>Rôle</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {[{ val: 'employe', label: 'Employé' }, { val: 'gerant', label: 'Gérant salarié' }].map(r => (
                <button key={r.val} onClick={() => setRole(r.val)} style={{ flex: 1, padding: '10px 0', borderRadius: 10, border: role === r.val ? 'none' : `1px solid ${t.border}`, background: role === r.val ? t.primary : t.surfaceAlt, color: role === r.val ? '#fff' : t.textMuted, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: F }}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {result && (
            <div style={{ padding: '10px 14px', borderRadius: 8, fontSize: 13, fontWeight: 500, fontFamily: F, background: result.success ? t.success + '12' : t.danger + '12', color: result.success ? t.success : t.danger, border: `1px solid ${result.success ? t.success : t.danger}22` }}>
              {result.success ? '✓ ' : '✗ '}{result.message}
            </div>
          )}

          <button onClick={createAccount} disabled={loading} style={{ padding: '12px 0', borderRadius: 10, border: 'none', background: loading ? t.primary + '80' : t.primary, color: '#fff', fontSize: 14, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', fontFamily: F, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            {loading ? 'Création en cours...' : 'Créer le compte'}
          </button>
        </div>
      </div>

      <div style={{ background: t.surface, borderRadius: 16, border: `1px solid ${t.border}`, padding: 20 }}>
        <p style={{ fontSize: 13, color: t.textMuted, margin: 0, fontFamily: F, lineHeight: 1.6 }}>
          <strong style={{ color: t.text }}>Note :</strong> Le compte est actif immédiatement, sans email de confirmation. Communiquez le mot de passe temporaire à la personne et invitez-la à le changer.
        </p>
      </div>
    </div>
  );
};

export default SettingsModule;
