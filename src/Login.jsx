import { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';

const F = "'Noto Sans KR', sans-serif";

const themes = {
  kimiko:  { name:"Kimiko",     primary:"#DC2626", primaryHover:"#B91C1C", bg:"#FFFBF5", surface:"#FFFFFF", text:"#1A0A00", textMuted:"#6B3A1F", border:"#FEE9D1", sidebar:"#1A0A00", accent:"#CA8A04" },
  ocean:   { name:"Océan",      primary:"#0077B6", primaryHover:"#005F8A", bg:"#F4F7FA", surface:"#FFFFFF", text:"#1A2332", textMuted:"#5A6B7F", border:"#DAE2EB", sidebar:"#023E58", accent:"#00B4D8" },
  forest:  { name:"Forêt",      primary:"#2D6A4F", primaryHover:"#1E4D38", bg:"#F5F7F5", surface:"#FFFFFF", text:"#1A2A1E", textMuted:"#5A6B5F", border:"#D4E2D7", sidebar:"#1B4332", accent:"#52B788" },
  neutral: { name:"Neutre Pro", primary:"#4A5568", primaryHover:"#2D3748", bg:"#F7FAFC", surface:"#FFFFFF", text:"#1A202C", textMuted:"#718096", border:"#E2E8F0", sidebar:"#1A202C", accent:"#63B3ED" },
};

export default function Login({ onLogin }) {
  const [themeKey, setThemeKey] = useState(() => localStorage.getItem('restoapp-theme') || 'kimiko');
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const t = themes[themeKey];

  useEffect(() => {
    localStorage.setItem('restoapp-theme', themeKey);
  }, [themeKey]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { data, error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) {
      setError('Email ou mot de passe incorrect.');
    } else {
      onLogin(data.user, themeKey);
    }
    setLoading(false);
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    setError('');
    if (!name.trim()) { setError('Le prénom est requis.'); return; }
    setLoading(true);
    const { data, error: err } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: name.trim(), role: 'employe' } },
    });
    if (err) {
      setError(err.message === 'User already registered' ? 'Cet email est déjà utilisé.' : err.message);
    } else if (data.user && !data.session) {
      setError('');
      setMode('confirm');
    } else if (data.user) {
      onLogin(data.user, themeKey);
    }
    setLoading(false);
  };

  const inp = {
    width: '100%',
    padding: '12px 16px',
    borderRadius: 10,
    border: `1.5px solid ${t.border}`,
    fontSize: 15,
    fontFamily: F,
    background: t.bg,
    color: t.text,
    outline: 'none',
    boxSizing: 'border-box',
    transition: 'border-color 0.2s',
  };

  const bgGradient = {
    kimiko:  'linear-gradient(135deg, #1A0A00 0%, #3D1505 40%, #DC262622 100%)',
    ocean:   'linear-gradient(135deg, #023E58 0%, #0077B6 60%, #00B4D822 100%)',
    forest:  'linear-gradient(135deg, #1B4332 0%, #2D6A4F 60%, #52B78822 100%)',
    neutral: 'linear-gradient(135deg, #1A202C 0%, #4A5568 60%, #63B3ED22 100%)',
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: bgGradient[themeKey],
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: F,
      padding: '24px 16px',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Cercles décoratifs */}
      <div style={{ position:'absolute', top:-120, right:-120, width:400, height:400, borderRadius:'50%', background:`${t.primary}18`, pointerEvents:'none' }} />
      <div style={{ position:'absolute', bottom:-80, left:-80, width:300, height:300, borderRadius:'50%', background:`${t.accent}15`, pointerEvents:'none' }} />

      <div style={{
        width: '100%',
        maxWidth: 420,
        background: 'rgba(255,255,255,0.08)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid rgba(255,255,255,0.15)',
        borderRadius: 24,
        padding: '40px 36px',
        boxShadow: '0 24px 64px rgba(0,0,0,0.35)',
        position: 'relative',
        zIndex: 1,
      }}>

        {/* Logo */}
        <div style={{ textAlign:'center', marginBottom: 32 }}>
          <div style={{
            width: 64, height: 64,
            borderRadius: 18,
            background: t.primary,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 16px',
            boxShadow: `0 8px 24px ${t.primary}55`,
          }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/>
            </svg>
          </div>
          <h1 style={{ color:'#fff', fontSize: 28, fontWeight: 700, margin: 0, letterSpacing: -0.5 }}>Kimiko</h1>
          <p style={{ color:'rgba(255,255,255,0.45)', fontSize: 12, margin: '4px 0 0', fontWeight: 500, letterSpacing: 1, textTransform: 'uppercase' }}>Street food coréenne · Orléans</p>
          <p style={{ color:'rgba(255,255,255,0.55)', fontSize: 14, margin: '10px 0 0', fontWeight: 400 }}>
            {mode === 'login' ? 'Connectez-vous à votre espace' : mode === 'signup' ? 'Créer votre compte employé' : ''}
          </p>
        </div>

        {/* Confirmation email */}
        {mode === 'confirm' && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ display:'block', margin:'0 auto' }}>
                <rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
              </svg>
            </div>
            <p style={{ color:'rgba(255,255,255,0.9)', fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Vérifiez vos emails</p>
            <p style={{ color:'rgba(255,255,255,0.55)', fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
              Un lien de confirmation a été envoyé à<br/><strong style={{ color:'rgba(255,255,255,0.8)' }}>{email}</strong>
            </p>
            <button onClick={() => setMode('login')} style={{ background:'rgba(255,255,255,0.12)', border:'1px solid rgba(255,255,255,0.2)', color:'#fff', borderRadius:10, padding:'10px 24px', fontSize:14, fontWeight:600, cursor:'pointer', fontFamily:F }}>
              Retour à la connexion
            </button>
          </div>
        )}

        {/* Formulaire login / signup */}
        {mode !== 'confirm' && (
          <form onSubmit={mode === 'login' ? handleLogin : handleSignup}>
            <div style={{ display:'flex', flexDirection:'column', gap: 14 }}>

              {mode === 'signup' && (
                <div>
                  <label style={{ display:'block', fontSize:13, fontWeight:600, color:'rgba(255,255,255,0.7)', marginBottom:6 }}>Prénom et nom</label>
                  <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Thomas Da Silva"
                    style={inp}
                    required
                    autoFocus={mode === 'signup'}
                  />
                </div>
              )}

              <div>
                <label style={{ display:'block', fontSize:13, fontWeight:600, color:'rgba(255,255,255,0.7)', marginBottom:6 }}>Adresse email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="prenom@kimiko.fr"
                  style={inp}
                  required
                  autoFocus={mode === 'login'}
                  autoComplete="email"
                />
              </div>

              <div>
                <label style={{ display:'block', fontSize:13, fontWeight:600, color:'rgba(255,255,255,0.7)', marginBottom:6 }}>Mot de passe</label>
                <div style={{ position:'relative' }}>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder={mode === 'signup' ? 'Minimum 6 caractères' : '••••••••'}
                    style={{ ...inp, paddingRight: 44 }}
                    required
                    minLength={6}
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    style={{ position:'absolute', right:12, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color: t.textMuted, padding:4, display:'flex', alignItems:'center' }}
                    aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                  >
                    {showPassword ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    )}
                  </button>
                </div>
              </div>

              {error && (
                <div style={{ background:'rgba(220,38,38,0.15)', border:'1px solid rgba(220,38,38,0.3)', borderRadius:8, padding:'10px 14px', fontSize:13, color:'#FCA5A5', fontWeight:500 }}>
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                style={{
                  width:'100%',
                  padding: '13px 0',
                  borderRadius: 12,
                  border: 'none',
                  background: loading ? `${t.primary}80` : t.primary,
                  color: '#fff',
                  fontSize: 15,
                  fontWeight: 700,
                  cursor: loading ? 'not-allowed' : 'pointer',
                  fontFamily: F,
                  marginTop: 4,
                  boxShadow: `0 4px 16px ${t.primary}44`,
                  transition: 'all 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                }}
              >
                {loading ? (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation:'spin 1s linear infinite' }}>
                      <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                    </svg>
                    {mode === 'login' ? 'Connexion...' : 'Création...'}
                  </>
                ) : mode === 'login' ? 'Se connecter' : 'Créer mon compte'}
              </button>
            </div>
          </form>
        )}

        {/* Toggle login / signup */}
        {mode !== 'confirm' && (
          <p style={{ textAlign:'center', marginTop:20, fontSize:14, color:'rgba(255,255,255,0.5)', margin:'20px 0 0' }}>
            {mode === 'login' ? (
              <>Pas encore de compte ?{' '}
                <button onClick={() => { setMode('signup'); setError(''); }} style={{ background:'none', border:'none', color:'rgba(255,255,255,0.85)', fontWeight:700, cursor:'pointer', fontSize:14, fontFamily:F, textDecoration:'underline', padding:0 }}>
                  Créer un compte
                </button>
              </>
            ) : (
              <>Déjà un compte ?{' '}
                <button onClick={() => { setMode('login'); setError(''); }} style={{ background:'none', border:'none', color:'rgba(255,255,255,0.85)', fontWeight:700, cursor:'pointer', fontSize:14, fontFamily:F, textDecoration:'underline', padding:0 }}>
                  Se connecter
                </button>
              </>
            )}
          </p>
        )}

        {/* Sélecteur de thème */}
        <div style={{ display:'flex', justifyContent:'center', gap:10, marginTop:28 }}>
          {Object.entries(themes).map(([k, th]) => (
            <button
              key={k}
              onClick={() => setThemeKey(k)}
              title={th.name}
              aria-label={`Thème ${th.name}`}
              style={{
                width: 22, height: 22,
                borderRadius: '50%',
                border: themeKey === k ? '2px solid #fff' : '2px solid rgba(255,255,255,0.2)',
                background: `linear-gradient(135deg, ${th.sidebar} 50%, ${th.primary} 50%)`,
                cursor: 'pointer',
                padding: 0,
                transition: 'border-color 0.15s, transform 0.15s',
                transform: themeKey === k ? 'scale(1.25)' : 'scale(1)',
              }}
            />
          ))}
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        input:focus { border-color: ${t.primary} !important; box-shadow: 0 0 0 3px ${t.primary}22; }
      `}</style>
    </div>
  );
}
