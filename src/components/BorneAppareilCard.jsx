import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { CLE_JETON, genererJeton, messageErreurAppareil } from '../lib/borne';
import { LIEU_RESTAURANT } from '../lib/horaires';

// Carte « Borne de pointage » de Paramètres, gérant seul (tâche 10).
// Déclarer la borne depuis la tablette écrit le jeton dans SON stockage local : le
// secret ne quitte jamais l'appareil, la base n'en garde qu'une empreinte bcrypt
// (enregistrer_appareil, migrations 10 et 10c). D'où la consigne : faire la
// manipulation sur la tablette qui servira de borne, pas sur l'ordinateur du gérant.

const lireJetonLocal = () => {
  try { return localStorage.getItem(CLE_JETON) || ''; } catch { return ''; }
};

const BorneAppareilCard = ({ t, F }) => {
  const [appareils, setAppareils] = useState([]);
  const [lieux, setLieux] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreurChargement, setErreurChargement] = useState('');
  const [libelle, setLibelle] = useState('');
  const [lieuId, setLieuId] = useState(LIEU_RESTAURANT);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [dejaBorne, setDejaBorne] = useState(() => Boolean(lireJetonLocal()));
  const [confirmOubli, setConfirmOubli] = useState(false);

  const lireTables = () => Promise.all([
    supabase.from('pointage_appareils').select('id,libelle,actif,lieu_id,created_at').order('created_at'),
    supabase.from('pointage_lieux').select('id,nom,actif').order('created_at'),
  ]);

  const appliquer = useCallback(([ra, rl]) => {
    setErreurChargement(ra.error || rl.error ? 'Les bornes déclarées n’ont pas pu être lues.' : '');
    setAppareils(ra.data || []);
    setLieux(rl.data || []);
    setChargement(false);
  }, []);

  // Le chargement part de l'état initial : rien n'est posé pendant l'effet lui-même.
  useEffect(() => {
    let annule = false;
    lireTables().then((r) => { if (!annule) appliquer(r); });
    return () => { annule = true; };
  }, [appliquer]);

  const rafraichir = () => lireTables().then(appliquer);

  const declarer = async () => {
    if (busy || !libelle.trim()) return;
    setBusy(true);
    setMsg(null);
    const jeton = genererJeton();
    const { error } = await supabase.rpc('enregistrer_appareil', {
      p_libelle: libelle.trim(), p_jeton: jeton, p_lieu: lieuId,
    });
    if (error) { setBusy(false); setMsg({ ok: false, texte: messageErreurAppareil(error.message) }); return; }
    try {
      localStorage.setItem(CLE_JETON, jeton);
    } catch {
      setBusy(false);
      setMsg({ ok: false, texte: 'La borne est déclarée mais le jeton n’a pas pu être gardé sur cet appareil. Vérifie que le navigateur autorise le stockage local, puis recommence.' });
      return;
    }
    setBusy(false);
    setDejaBorne(true);
    setLibelle('');
    setMsg({ ok: true, texte: 'Cette tablette est maintenant la borne. Ouvre l’adresse /borne et laisse-la ouverte.' });
    rafraichir();
  };

  const oublier = () => {
    try { localStorage.removeItem(CLE_JETON); } catch { /* stockage indisponible : rien à retirer */ }
    setDejaBorne(false);
    setConfirmOubli(false);
    setMsg({ ok: true, texte: 'Cet appareil ne pointe plus. La borne reste déclarée en base : ferme-la dans la liste si elle ne sert plus.' });
  };

  const nomLieu = (id) => lieux.find((l) => l.id === id)?.nom || 'Lieu inconnu';
  const inp = { padding: '10px 12px', borderRadius: 8, border: `1px solid ${t.border}`, fontSize: 14, fontFamily: F, background: t.surface, color: t.text, outline: 'none', width: '100%' };

  return (
    <div style={{ background: t.surface, borderRadius: 16, border: `1px solid ${t.border}`, padding: 28, marginBottom: 20 }}>
      <h2 style={{ fontSize: 17, fontWeight: 700, margin: '0 0 6px', fontFamily: F }}>Borne de pointage</h2>
      <p style={{ fontSize: 14, color: t.textMuted, margin: '0 0 16px', fontFamily: F, lineHeight: 1.5 }}>
        Une borne est une tablette autorisée à enregistrer les pointages. <strong style={{ color: t.text }}>Fais cette déclaration depuis la tablette elle-même</strong> : la clé qui l’autorise est gardée sur l’appareil qui déclare, et nulle part ailleurs.
      </p>

      <div style={{ padding: '12px 14px', borderRadius: 10, marginBottom: 16, fontSize: 13, fontFamily: F, lineHeight: 1.5,
        background: dejaBorne ? t.success + '12' : t.warning + '12',
        border: `1px solid ${(dejaBorne ? t.success : t.warning)}33`, color: t.text }}>
        {dejaBorne
          ? 'Cet appareil est déclaré comme borne : il peut enregistrer des pointages sur l’adresse /borne.'
          : 'Cet appareil n’est pas une borne : sur l’adresse /borne, il affichera « Cet appareil n’est pas la borne de pointage ».'}
      </div>

      {chargement ? (
        <div style={{ fontSize: 13, color: t.textMuted, fontFamily: F }}>Lecture des bornes déclarées…</div>
      ) : (
        <>
          {erreurChargement && <div style={{ fontSize: 13, color: t.danger, fontFamily: F, marginBottom: 12 }}>{erreurChargement}</div>}
          <div style={{ fontSize: 13, fontWeight: 600, fontFamily: F, marginBottom: 8 }}>
            {appareils.length === 0 ? 'Aucune borne déclarée pour l’instant' : `${appareils.length} borne${appareils.length > 1 ? 's' : ''} déclarée${appareils.length > 1 ? 's' : ''}`}
          </div>
          {appareils.length > 0 && (
            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {appareils.map((a) => (
                <li key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 12px', borderRadius: 8, border: `1px solid ${t.border}`, fontSize: 13, fontFamily: F }}>
                  <span style={{ fontWeight: 600 }}>{a.libelle}</span>
                  <span style={{ color: t.textMuted }}>{nomLieu(a.lieu_id)}</span>
                  <span style={{ marginLeft: 'auto', fontWeight: 600, color: a.actif ? t.success : t.textMuted }}>{a.actif ? 'active' : 'fermée'}</span>
                </li>
              ))}
            </ul>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6, display: 'block', fontFamily: F }}>Nom de cette tablette</label>
              <input value={libelle} onChange={(e) => { setLibelle(e.target.value); setMsg(null); }} placeholder="Tablette du comptoir" style={inp} />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6, display: 'block', fontFamily: F }}>Lieu</label>
              <select value={lieuId} onChange={(e) => setLieuId(e.target.value)} style={inp}>
                {lieux.filter((l) => l.actif).map((l) => <option key={l.id} value={l.id}>{l.nom}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <button onClick={declarer} disabled={busy || !libelle.trim()}
              style={{ padding: '10px 16px', borderRadius: 8, border: 'none', fontSize: 14, fontWeight: 600, fontFamily: F,
                background: !busy && libelle.trim() ? t.primary : t.border, color: !busy && libelle.trim() ? '#fff' : t.textMuted,
                cursor: !busy && libelle.trim() ? 'pointer' : 'default' }}>
              {busy ? 'Déclaration…' : dejaBorne ? 'Redéclarer cette tablette' : 'Déclarer cette tablette comme borne'}
            </button>
            {dejaBorne && (confirmOubli ? (
              <button onClick={oublier} style={{ padding: '10px 14px', borderRadius: 8, border: 'none', background: t.danger, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: F }}>Confirmer : cet appareil ne pointe plus</button>
            ) : (
              <button onClick={() => setConfirmOubli(true)} style={{ padding: '10px 14px', borderRadius: 8, border: `1px solid ${t.border}`, background: t.surface, color: t.text, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: F }}>Cet appareil n’est plus la borne</button>
            ))}
          </div>

          {msg && (
            <div style={{ marginTop: 12, fontSize: 13, fontWeight: 600, fontFamily: F, lineHeight: 1.5, color: msg.ok ? t.success : t.danger }}>
              {msg.texte}
              {msg.ok && dejaBorne && (
                <> <a href="/borne" style={{ color: t.primary, fontWeight: 700 }}>Ouvrir la borne</a></>
              )}
            </div>
          )}

          <p style={{ fontSize: 12, color: t.textMuted, margin: '14px 0 0', fontFamily: F, lineHeight: 1.5 }}>
            La clé n’est jamais affichée ni relue, même par toi : une tablette perdue se neutralise en fermant son lieu, et une nouvelle déclaration remplace la clé de cet appareil.
          </p>
        </>
      )}
    </div>
  );
};

export default BorneAppareilCard;
