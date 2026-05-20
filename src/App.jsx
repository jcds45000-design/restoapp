import { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';
import Login from './Login';
import RestoApp from './RestoApp';

export default function App() {
  const [user, setUser] = useState(null);
  const [themeKey, setThemeKey] = useState(() => localStorage.getItem('restoapp-theme') || 'kimiko');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleLogin = (authUser, selectedTheme) => {
    setUser(authUser);
    setThemeKey(selectedTheme);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  if (loading) {
    return (
      <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#1A0A00' }}>
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2.5" strokeLinecap="round" style={{ animation:'spin 1s linear infinite' }}>
          <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
        </svg>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!user) {
    return <Login onLogin={handleLogin} />;
  }

  return <RestoApp authUser={user} initialTheme={themeKey} onLogout={handleLogout} />;
}
