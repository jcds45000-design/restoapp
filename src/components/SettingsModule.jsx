import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { I } from '../lib/icons';

const SettingsModule = ({ t, F, authUser }) => {
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
