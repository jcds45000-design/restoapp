import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import {
  JOURS, LIEU_RESTAURANT, aujourdhuiParis, dateCourte, semaineVide, semaineDeVersion, versionsDuLieu,
  estFerme, copierLundi, erreursSemaine, semainePourRpc, messageErreurHoraires,
} from '../lib/horaires';

// Carte « Horaires du pointage » de Paramètres, gérant seul (tâche 9 bis, lot B).
// Lecture directe des tables (policy de lecture), écriture par enregistrer_horaires()
// et enregistrer_lieu() uniquement. Une modification ne réécrit jamais le passé.

const LIGNES = [
  { cle: 'midi', label: 'Midi', deb: 'midi_debut', fin: 'midi_fin', entre: 'à' },
  { cle: 'soir', label: 'Soir', deb: 'soir_debut', fin: 'soir_fin', entre: 'à' },
  { cle: 'coupure', label: 'Coupure', deb: 'coupure_max', fin: 'retour_soir', entre: 'retour' },
];

const STATUTS = { a_venir: 'à venir', en_vigueur: 'en vigueur', passee: 'remplacée' };

const HorairesPointageCard = ({ t, F }) => {
  const [lieux, setLieux] = useState([]);
  const [lignes, setLignes] = useState([]);
  const [lieuId, setLieuId] = useState(LIEU_RESTAURANT);
  const [chargement, setChargement] = useState(true);
  const [erreurChargement, setErreurChargement] = useState('');
  const [semaine, setSemaine] = useState(semaineVide);
  // Heures d'un jour juste avant « Aucun service », pour pouvoir le rouvrir d'un clic.
  const [avantFermeture, setAvantFermeture] = useState({});
  const [dateEffet, setDateEffet] = useState(aujourdhuiParis);
  const [tente, setTente] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [nouveauLieu, setNouveauLieu] = useState('');
  const [renommage, setRenommage] = useState(null);
  const [confirmFermer, setConfirmFermer] = useState(false);
  const [largeur, setLargeur] = useState(() => window.innerWidth);

  useEffect(() => {
    const surRedim = () => setLargeur(window.innerWidth);
    window.addEventListener('resize', surRedim);
    return () => window.removeEventListener('resize', surRedim);
  }, []);
  const etroit = largeur < 480;

  const aujourdhui = aujourdhuiParis();
  const lieu = lieux.find(l => l.id === lieuId);
  const versions = versionsDuLieu(lignes, lieuId, aujourdhui);
  const erreurs = erreursSemaine(semaine);
  const remplace = versions.find(v => v.date_effet === dateEffet);

  // Formulaire de départ : la version en vigueur, applicable à partir d'aujourd'hui ;
  // sans version en vigueur (lieu neuf), la prochaine version prévue à sa date.
  const remplirDepuis = useCallback((toutes, id) => {
    const vs = versionsDuLieu(toutes, id, aujourdhuiParis());
    const enVigueur = vs.find(v => v.statut === 'en_vigueur');
    const prochaine = vs.filter(v => v.statut === 'a_venir').pop();
    const base = enVigueur || prochaine;
    setSemaine(base ? semaineDeVersion(toutes, id, base.date_effet) : semaineVide());
    setAvantFermeture({});
    setDateEffet(enVigueur || !prochaine ? aujourdhuiParis() : prochaine.date_effet);
    setTente(false);
  }, []);

  useEffect(() => {
    let annule = false;
    Promise.all([
      supabase.from('pointage_lieux').select('id,nom,actif,created_at').order('created_at'),
      supabase.from('pointage_horaires').select('*'),
    ]).then(([rl, rh]) => {
      if (annule) return;
      setChargement(false);
      if (rl.error || rh.error) {
        setErreurChargement('Horaires indisponibles : la migration 10c est-elle appliquée ?');
        return;
      }
      setLieux(rl.data);
      setLignes(rh.data);
      remplirDepuis(rh.data, LIEU_RESTAURANT);
    });
    return () => { annule = true; };
  }, [remplirDepuis]);

  const choisirLieu = (id) => {
    setLieuId(id);
    setMsg(null); setRenommage(null); setConfirmFermer(false);
    remplirDepuis(lignes, id);
  };

  const changer = (i, champ, valeur) => {
    setSemaine(s => s.map((j, k) => (k === i ? { ...j, [champ]: valeur } : j)));
    setMsg(null);
  };
  const fermer = (i) => {
    setAvantFermeture(a => ({ ...a, [i]: semaine[i] }));
    vider(i, ['midi_debut', 'midi_fin', 'soir_debut', 'soir_fin', 'coupure_max', 'retour_soir']);
  };
  const rouvrir = (i) => {
    setSemaine(s => s.map((j, k) => (k === i ? avantFermeture[i] : j)));
    setAvantFermeture(a => { const reste = { ...a }; delete reste[i]; return reste; });
    setMsg(null);
  };
  const vider = (i, champs) => {
    setSemaine(s => s.map((j, k) => (k === i ? { ...j, ...Object.fromEntries(champs.map(c => [c, ''])) } : j)));
    setMsg(null);
  };

  const enregistrer = async () => {
    setTente(true);
    if (erreurs.length || !dateEffet || dateEffet < aujourdhui) return;
    setBusy(true); setMsg(null);
    const { error } = await supabase.rpc('enregistrer_horaires', {
      p_lieu: lieuId, p_date_effet: dateEffet, p_semaine: semainePourRpc(semaine),
    });
    setBusy(false);
    if (error) { setMsg({ ok: false, texte: messageErreurHoraires(error.message) }); return; }
    const { data } = await supabase.from('pointage_horaires').select('*');
    if (data) setLignes(data);
    setTente(false);
    setMsg({ ok: true, texte: `Horaires enregistrés, applicables à partir du ${dateCourte(dateEffet)}.` });
  };

  const reprendre = (v) => {
    setSemaine(semaineDeVersion(lignes, lieuId, v.date_effet));
    setAvantFermeture({});
    setDateEffet(v.statut === 'a_venir' ? v.date_effet : aujourdhui);
    setTente(false); setMsg(null);
  };

  const appelLieu = async (params, succes) => {
    setBusy(true); setMsg(null);
    const { data, error } = await supabase.rpc('enregistrer_lieu', params);
    setBusy(false);
    if (error) { setMsg({ ok: false, texte: messageErreurHoraires(error.message) }); return; }
    const { data: ls } = await supabase.from('pointage_lieux').select('id,nom,actif,created_at').order('created_at');
    if (ls) setLieux(ls);
    succes(data);
  };

  const ajouterLieu = () => {
    const nom = nouveauLieu.trim();
    if (!nom) return;
    appelLieu({ p_lieu: null, p_nom: nom, p_actif: true }, (id) => {
      setNouveauLieu('');
      setLieuId(id);
      setRenommage(null); setConfirmFermer(false);
      remplirDepuis(lignes, id);
      setMsg({ ok: true, texte: `Lieu « ${nom} » ajouté. Saisis ses horaires puis enregistre.` });
    });
  };

  const renommer = () => {
    const nom = (renommage || '').trim();
    if (!nom || !lieu) return;
    appelLieu({ p_lieu: lieu.id, p_nom: nom, p_actif: lieu.actif }, () => {
      setRenommage(null);
      setMsg({ ok: true, texte: `Lieu renommé en « ${nom} ».` });
    });
  };

  const basculerActif = () => {
    if (!lieu) return;
    const actif = !lieu.actif;
    appelLieu({ p_lieu: lieu.id, p_nom: lieu.nom, p_actif: actif }, () => {
      setConfirmFermer(false);
      setMsg({ ok: true, texte: actif ? `« ${lieu.nom} » est rouvert : ses tablettes peuvent pointer.` : `« ${lieu.nom} » est fermé : ses tablettes ne peuvent plus pointer.` });
    });
  };

  const carte = { background: t.surface, borderRadius: 16, border: `1px solid ${t.border}`, padding: etroit ? 14 : 28, marginBottom: 20 };
  const btnSm = { padding: '8px 12px', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: F };
  const champ = { padding: '8px 6px', borderRadius: 8, border: `1.5px solid ${t.border}`, fontSize: 14, fontFamily: F, background: t.bg, color: t.text, outline: 'none', boxSizing: 'border-box', minWidth: 0 };
  const texteAide = { fontSize: 13, color: t.textMuted, margin: '0 0 14px', fontFamily: F, lineHeight: 1.5 };
  const bandeau = (ok) => ({ padding: '10px 14px', borderRadius: 8, fontSize: 13, fontWeight: 500, fontFamily: F, background: (ok ? t.success : t.danger) + '12', color: ok ? t.success : t.danger, border: `1px solid ${(ok ? t.success : t.danger)}22` });

  if (chargement) {
    return <div style={carte}><p style={{ ...texteAide, margin: 0 }}>Chargement des horaires…</p></div>;
  }
  if (erreurChargement) {
    return <div style={carte}><h2 style={{ fontSize: 17, fontWeight: 700, margin: '0 0 6px', fontFamily: F }}>Horaires du pointage</h2><p style={{ ...texteAide, margin: 0, color: t.danger }}>{erreurChargement}</p></div>;
  }

  const datePassee = !dateEffet || dateEffet < aujourdhui;
  const bloque = busy || (tente && (erreurs.length > 0 || datePassee));

  return (
    <div style={carte}>
      <h2 style={{ fontSize: 17, fontWeight: 700, margin: '0 0 6px', fontFamily: F }}>Horaires du pointage</h2>
      <p style={texteAide}>
        <strong style={{ color: t.text }}>Midi et soir</strong> : heures de service du lieu. Elles ne servent pas aux repas, qui se comptent sur les heures de pointe du pointage (voir l’écran Pointage).{' '}
        <strong style={{ color: t.text }}>Coupure</strong> : heure limite de départ après le midi, puis heure de retour pour le soir. Vers l’heure de retour, la borne demande à un salarié encore en poste s’il part ou s’il revient. Sans coupure, pas de question (journée continue).
      </p>

      {/* Lieux */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
        {lieux.map(l => (
          <button key={l.id} onClick={() => choisirLieu(l.id)} style={{ ...btnSm, background: l.id === lieuId ? t.primary : t.surfaceAlt, color: l.id === lieuId ? '#fff' : (l.actif ? t.text : t.textMuted), border: l.id === lieuId ? 'none' : `1px solid ${t.border}` }}>
            {l.nom}{!l.actif && ' (fermé)'}
          </button>
        ))}
      </div>

      {lieu && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          {renommage !== null ? (
            <>
              <input value={renommage} onChange={e => setRenommage(e.target.value)} autoFocus onKeyDown={e => { if (e.key === 'Enter') renommer(); }} style={{ ...champ, flex: 1, padding: '8px 12px' }} />
              <button onClick={renommer} disabled={busy} style={{ ...btnSm, background: t.primary, color: '#fff' }}>OK</button>
              <button onClick={() => setRenommage(null)} style={{ ...btnSm, background: t.surface, color: t.textMuted, border: `1px solid ${t.border}` }}>Annuler</button>
            </>
          ) : confirmFermer ? (
            <>
              <span style={{ flex: '1 1 200px', fontSize: 13, color: t.text, fontFamily: F }}>Fermer « {lieu.nom} » ? Ses tablettes ne pourront plus pointer. Son historique reste.</span>
              <button onClick={basculerActif} disabled={busy} style={{ ...btnSm, background: t.danger, color: '#fff' }}>Confirmer</button>
              <button onClick={() => setConfirmFermer(false)} style={{ ...btnSm, background: t.surface, color: t.textMuted, border: `1px solid ${t.border}` }}>Annuler</button>
            </>
          ) : (
            <>
              <span style={{ flex: 1, fontSize: 13, color: lieu.actif ? t.textMuted : t.warning, fontFamily: F }}>{lieu.actif ? 'Lieu ouvert' : 'Lieu fermé : aucun pointage possible'}</span>
              <button onClick={() => { setRenommage(lieu.nom); setMsg(null); }} style={{ ...btnSm, background: t.surface, color: t.text, border: `1px solid ${t.border}` }}>Renommer</button>
              {lieu.id !== LIEU_RESTAURANT && (lieu.actif ? (
                <button onClick={() => { setConfirmFermer(true); setMsg(null); }} style={{ ...btnSm, background: t.danger + '0F', color: t.danger, border: `1px solid ${t.danger}30` }}>Fermer ce lieu</button>
              ) : (
                <button onClick={basculerActif} disabled={busy} style={{ ...btnSm, background: t.success + '12', color: t.success, border: `1px solid ${t.success}30` }}>Rouvrir</button>
              ))}
            </>
          )}
        </div>
      )}

      {/* Semaine */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <label htmlFor="horaires-date-effet" style={{ fontSize: 13, fontWeight: 600, color: t.text, fontFamily: F }}>Applicable à partir du</label>
        <input id="horaires-date-effet" type="date" value={dateEffet} min={aujourdhui} onChange={e => { setDateEffet(e.target.value); setMsg(null); }} style={{ ...champ, padding: '8px 10px' }} />
      </div>
      <p style={{ fontSize: 12, color: datePassee ? t.danger : t.textMuted, margin: '0 0 12px', fontFamily: F }}>
        {datePassee ? 'Choisis aujourd’hui ou une date à venir : le passé ne se réécrit pas.'
          : remplace ? `Remplace les horaires déjà prévus à partir du ${dateCourte(dateEffet)}.`
            : 'Les jours précédents gardent leurs horaires.'}
      </p>
      <button onClick={() => { setSemaine(copierLundi); setMsg(null); }} style={{ ...btnSm, background: t.surface, color: t.text, border: `1px solid ${t.border}`, marginBottom: 12 }}>Copier lundi sur toute la semaine</button>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {semaine.map((j, i) => (
          <div key={j.jour_semaine} style={{ padding: etroit ? '10px 8px' : '10px 12px', borderRadius: 10, background: t.surfaceAlt, border: `1px solid ${t.border}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: t.text, fontFamily: F }}>{JOURS[i]}</span>
              {estFerme(j) && avantFermeture[i] ? (
                <>
                  <span style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, fontFamily: F }}>Pas de service</span>
                  <button onClick={() => rouvrir(i)} style={{ ...btnSm, padding: '4px 10px', fontSize: 12, background: t.surface, color: t.text, border: `1px solid ${t.border}` }}>Rouvrir</button>
                </>
              ) : estFerme(j) ? (
                <span style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, fontFamily: F, textAlign: 'right' }}>Pas de service · saisis des heures pour l’ouvrir</span>
              ) : (
                <button onClick={() => fermer(i)} style={{ ...btnSm, padding: '4px 10px', fontSize: 12, background: t.surface, color: t.textMuted, border: `1px solid ${t.border}` }}>Aucun service</button>
              )}
            </div>
            {LIGNES.map(r => (
              <div key={r.cle} style={{ display: 'flex', alignItems: 'center', gap: etroit ? 4 : 6, marginTop: 4 }}>
                <span style={{ width: etroit ? 56 : 70, flexShrink: 0, fontSize: 13, color: t.textMuted, fontFamily: F }}>{r.label}</span>
                <input type="time" aria-label={`${JOURS[i]}, ${r.label}, ${r.cle === 'coupure' ? 'départ au plus tard' : 'début'}`} value={j[r.deb]} onChange={e => changer(i, r.deb, e.target.value)} style={{ ...champ, flex: 1 }} />
                <span style={{ width: 38, flexShrink: 0, textAlign: 'center', fontSize: 12, color: t.textMuted, fontFamily: F }}>{r.entre}</span>
                <input type="time" aria-label={`${JOURS[i]}, ${r.label}, ${r.cle === 'coupure' ? 'retour' : 'fin'}`} value={j[r.fin]} onChange={e => changer(i, r.fin, e.target.value)} style={{ ...champ, flex: 1 }} />
                <button onClick={() => vider(i, [r.deb, r.fin])} disabled={!j[r.deb] && !j[r.fin]} aria-label={`${JOURS[i]} : pas de ${r.label.toLowerCase()}`} title={`Pas de ${r.label.toLowerCase()}`} style={{ width: 28, height: 28, flexShrink: 0, padding: 0, borderRadius: 6, border: `1px solid ${t.border}`, background: t.surface, color: t.textMuted, fontSize: 14, cursor: (!j[r.deb] && !j[r.fin]) ? 'default' : 'pointer', opacity: (!j[r.deb] && !j[r.fin]) ? 0.35 : 1, fontFamily: F }}>✕</button>
              </div>
            ))}
          </div>
        ))}
      </div>

      {tente && erreurs.length > 0 && (
        <div style={{ ...bandeau(false), marginTop: 12 }}>
          {erreurs.map(e => <div key={e}>✗ {e}</div>)}
        </div>
      )}
      {msg && <div style={{ ...bandeau(msg.ok), marginTop: 12 }}>{msg.ok ? '✓ ' : '✗ '}{msg.texte}</div>}

      <button onClick={enregistrer} disabled={bloque} style={{ width: '100%', marginTop: 14, padding: '12px 0', borderRadius: 10, border: 'none', background: bloque ? t.primary + '80' : t.primary, color: '#fff', fontSize: 14, fontWeight: 700, cursor: bloque ? 'not-allowed' : 'pointer', fontFamily: F }}>
        {busy ? 'Enregistrement…' : 'Enregistrer les horaires'}
      </button>

      {/* Historique */}
      <h3 style={{ fontSize: 14, fontWeight: 700, margin: '24px 0 8px', fontFamily: F }}>Historique {lieu ? `(${lieu.nom})` : ''}</h3>
      {versions.length === 0 ? (
        <p style={{ ...texteAide, margin: 0 }}>Aucun horaire enregistré pour ce lieu.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {versions.map(v => {
            const couleur = v.statut === 'a_venir' ? t.primary : v.statut === 'en_vigueur' ? t.success : t.textMuted;
            return (
              <div key={v.date_effet} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 10, background: t.surfaceAlt, border: `1px solid ${t.border}` }}>
                <div style={{ flex: '1 1 180px', fontFamily: F }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: t.text }}>
                    À partir du {dateCourte(v.date_effet)}{' '}
                    <span style={{ fontSize: 11, fontWeight: 700, color: couleur, background: couleur + '14', borderRadius: 6, padding: '2px 6px', marginLeft: 4 }}>{STATUTS[v.statut]}</span>
                  </div>
                  <div style={{ fontSize: 12, color: t.textMuted, marginTop: 2 }}>par {v.auteur || 'inconnu'}</div>
                </div>
                <button onClick={() => reprendre(v)} style={{ ...btnSm, padding: '6px 10px', fontSize: 12, background: t.surface, color: t.text, border: `1px solid ${t.border}` }}>
                  {v.statut === 'a_venir' ? 'Modifier' : 'Repartir de celle-ci'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Ajout d'un lieu */}
      <h3 style={{ fontSize: 14, fontWeight: 700, margin: '24px 0 8px', fontFamily: F }}>Ajouter un lieu</h3>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={nouveauLieu} onChange={e => setNouveauLieu(e.target.value)} placeholder="Ex : Stand marché de Noël" onKeyDown={e => { if (e.key === 'Enter') ajouterLieu(); }} style={{ ...champ, flex: 1, padding: '10px 12px' }} />
        <button onClick={ajouterLieu} disabled={busy || !nouveauLieu.trim()} style={{ ...btnSm, padding: '10px 16px', background: (busy || !nouveauLieu.trim()) ? t.border : t.primary, color: (busy || !nouveauLieu.trim()) ? t.textMuted : '#fff' }}>Ajouter</button>
      </div>
    </div>
  );
};

export default HorairesPointageCard;
