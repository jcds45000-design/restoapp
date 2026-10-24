// Sélecteur de mois en français : flèches mois précédent / suivant, et un calendrier des
// 12 mois qui s'ouvre au clic sur le libellé. Remplace <input type="month">, dont
// l'affichage dépend de la langue du navigateur et qui se manipule mal au doigt.
import { useState, useEffect, useRef } from 'react';
import { F } from '../lib/foundation';
import { decalerMois, libelleMois, MOIS_COURTS } from '../lib/mois';

export default function SelecteurMois({ t, valeur, onChange, max }) {
  const [ouvert, setOuvert] = useState(false);
  const [annee, setAnnee] = useState(Number(valeur.slice(0, 4)));
  const racine = useRef(null);

  // Fermeture au clic en dehors ou sur Échap.
  useEffect(() => {
    if (!ouvert) return undefined;
    const dehors = (e) => { if (racine.current && !racine.current.contains(e.target)) setOuvert(false); };
    const echap = (e) => { if (e.key === 'Escape') setOuvert(false); };
    document.addEventListener('mousedown', dehors);
    document.addEventListener('keydown', echap);
    return () => {
      document.removeEventListener('mousedown', dehors);
      document.removeEventListener('keydown', echap);
    };
  }, [ouvert]);

  const choisir = (m) => { setOuvert(false); if (m !== valeur) onChange(m); };
  const apresMax = (m) => Boolean(max) && m > max;
  const suivant = decalerMois(valeur, 1);

  const fleche = (actif) => ({
    width: 40, height: 40, borderRadius: 8, border: `1px solid ${t.border}`, background: t.surface,
    color: actif ? t.text : t.textMuted, fontSize: 18, cursor: actif ? 'pointer' : 'default',
    opacity: actif ? 1 : 0.4, fontFamily: F, display: 'flex', alignItems: 'center', justifyContent: 'center',
  });

  return (
    <div ref={racine} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6 }}>
      <button type="button" aria-label="Mois précédent" onClick={() => choisir(decalerMois(valeur, -1))} style={fleche(true)}>‹</button>
      <button type="button" aria-haspopup="dialog" aria-expanded={ouvert}
        onClick={() => { setAnnee(Number(valeur.slice(0, 4))); setOuvert((o) => !o); }}
        style={{ height: 40, minWidth: 150, padding: '0 14px', borderRadius: 8, border: `1px solid ${ouvert ? t.primary : t.border}`,
          background: t.surface, color: t.text, fontSize: 14, fontWeight: 600, fontFamily: F, cursor: 'pointer' }}>
        {libelleMois(valeur)} <span style={{ color: t.textMuted, fontSize: 11 }}>▾</span>
      </button>
      <button type="button" aria-label="Mois suivant" disabled={apresMax(suivant)}
        onClick={() => choisir(suivant)} style={fleche(!apresMax(suivant))}>›</button>

      {ouvert && (
        <div role="dialog" aria-label="Choisir un mois"
          style={{ position: 'absolute', top: 46, left: 0, zIndex: 20, width: 264, padding: 12, borderRadius: 12,
            background: t.surface, border: `1px solid ${t.border}`, boxShadow: '0 8px 24px rgba(0,0,0,0.15)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <button type="button" aria-label="Année précédente" onClick={() => setAnnee((a) => a - 1)} style={fleche(true)}>‹</button>
            <span style={{ fontSize: 15, fontWeight: 700, fontFamily: F, color: t.text }}>{annee}</span>
            <button type="button" aria-label="Année suivante" disabled={apresMax(`${annee + 1}-01`)}
              onClick={() => setAnnee((a) => a + 1)} style={fleche(!apresMax(`${annee + 1}-01`))}>›</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
            {MOIS_COURTS.map((court, i) => {
              const m = `${annee}-${String(i + 1).padStart(2, '0')}`;
              const choisi = m === valeur;
              const interdit = apresMax(m);
              return (
                <button key={m} type="button" disabled={interdit} onClick={() => choisir(m)} aria-pressed={choisi}
                  style={{ height: 40, borderRadius: 8, fontSize: 14, fontFamily: F, fontWeight: choisi ? 700 : 500,
                    border: `1px solid ${choisi ? t.primary : t.border}`,
                    background: choisi ? t.primary : 'transparent', color: choisi ? '#fff' : interdit ? t.textMuted : t.text,
                    opacity: interdit ? 0.4 : 1, cursor: interdit ? 'default' : 'pointer' }}>
                  {court}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
