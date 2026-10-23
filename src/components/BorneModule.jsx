// Borne de pointage (spec §5.1). Plein écran, aucun accès au reste de l'application.
// Un seul bouton, déduit de l'état du salarié : on ne peut pas se tromper de bouton.
// La borne ne lit aucune table : la liste vient de salaries_borne() (migration 10b),
// l'état de etat_pointage(), et seul le jeton de la tablette les ouvre.
// Un départ oublié se régularise ici, avant de pointer (tâche 9) : on ne pointe pas
// tant qu'il en reste un, et l'heure saisie est marquée « déclarée », pas mesurée.
import { useState, useRef, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { F } from '../lib/foundation';
import {
  libelleBouton, dureeLisible, minutesDepuis, heureParis, messagePointage, messageErreurBorne,
  jourParis, departDeclare, messageRegularisation, CLE_JETON,
} from '../lib/borne';

const DUREE_MESSAGE_MS = 3000;
// Clavier abandonné (appel en cuisine, client) : retour à la grille pour que le
// suivant ne pointe pas sous le nom d'un collègue.
const DUREE_INACTIVITE_MS = 30000;
const LISTE_RAFRAICHIE_MS = 5 * 60 * 1000;

function lireJeton() {
  try { return localStorage.getItem(CLE_JETON) || ''; } catch { return ''; }
}

function initiales(nom) {
  return nom.split(' ').filter(Boolean).map((n) => n[0]).join('').slice(0, 2).toUpperCase();
}

export default function BorneModule({ t }) {
  const [salaries, setSalaries] = useState(null);
  const [erreurListe, setErreurListe] = useState(null);
  const [salarie, setSalarie] = useState(null);
  const [etat, setEtat] = useState(null);
  const [code, setCode] = useState('');
  const [erreurCode, setErreurCode] = useState(null);
  // Départ oublié : heure saisie « HHMM », validée avant de passer au code.
  const [heure, setHeure] = useState('');
  const [heureValidee, setHeureValidee] = useState(false);
  const [erreurHeure, setErreurHeure] = useState(null);
  const [regularise, setRegularise] = useState(null);
  const [message, setMessage] = useState(null);
  const [enCours, setEnCours] = useState(false);
  // null = en attente, true = active, false = indisponible
  const [camera, setCamera] = useState(() => (navigator.mediaDevices?.getUserMedia ? null : false));
  const [largeur, setLargeur] = useState(() => window.innerWidth);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const minuterieMessage = useRef(null);
  const demandeEtat = useRef(0);

  useEffect(() => {
    const surRedim = () => setLargeur(window.innerWidth);
    window.addEventListener('resize', surRedim);
    return () => window.removeEventListener('resize', surRedim);
  }, []);
  const mobile = largeur < 768;
  const deuxColonnes = largeur >= 900;

  const chargerListe = useCallback(() => supabase.rpc('salaries_borne', { p_jeton: lireJeton() })
    .then(({ data, error }) => {
      if (error) { setErreurListe(messageErreurBorne(error.message)); return; }
      setErreurListe(null);
      setSalaries(Array.isArray(data) ? data : []);
    }), []);

  useEffect(() => {
    chargerListe();
    const id = setInterval(chargerListe, LISTE_RAFRAICHIE_MS);
    return () => clearInterval(id);
  }, [chargerListe]);

  // Caméra ouverte une seule fois pour toute la session de la borne.
  useEffect(() => {
    let annule = false;
    if (!navigator.mediaDevices?.getUserMedia) return undefined;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
      .then((stream) => {
        if (annule) { stream.getTracks().forEach((p) => p.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setCamera(true);
      })
      // Caméra refusée ou absente : on continue SANS photo. Bloquer le pointage
      // renverrait vers le déclaratif, donc détruirait la mesure (spec §8).
      .catch(() => { streamRef.current = null; setCamera(false); });
    return () => {
      annule = true;
      streamRef.current?.getTracks().forEach((p) => p.stop());
    };
  }, []);

  useEffect(() => () => clearTimeout(minuterieMessage.current), []);

  const retourGrille = useCallback(() => {
    demandeEtat.current += 1; // une réponse etat_pointage en retard ne rouvre pas le clavier
    setSalarie(null);
    setEtat(null);
    setCode('');
    setErreurCode(null);
    setHeure('');
    setHeureValidee(false);
    setErreurHeure(null);
    setRegularise(null);
  }, []);

  useEffect(() => {
    if (!salarie || message || enCours) return undefined;
    const id = setTimeout(retourGrille, DUREE_INACTIVITE_MS);
    return () => clearTimeout(id);
  }, [salarie, code, heure, heureValidee, message, enCours, retourGrille]);

  function afficherPuisRevenir(msg) {
    setMessage(msg);
    clearTimeout(minuterieMessage.current);
    minuterieMessage.current = setTimeout(() => { setMessage(null); retourGrille(); }, DUREE_MESSAGE_MS);
  }

  function fermerMessage() {
    clearTimeout(minuterieMessage.current);
    setMessage(null);
    retourGrille();
  }

  // Avant le clavier : ARRIVÉE ou DÉPART, et reste-t-il un oubli ? Lu par etat_pointage()
  // et non dans presences, que la RLS ne montrerait pas au compte de la tablette.
  async function chargerEtat(emp) {
    const numero = ++demandeEtat.current;
    setEtat(null);
    const { data, error } = await supabase.rpc('etat_pointage', { p_jeton: lireJeton(), p_employee: emp.id });
    if (numero !== demandeEtat.current) return;
    if (error) { afficherPuisRevenir({ ok: false, texte: messageErreurBorne(error.message) }); return; }
    // Durée calculée ici, à l'ouverture du clavier, et non pendant le rendu.
    setEtat({ ...data, minutesEnPoste: data?.en_poste ? minutesDepuis(data.debut) : 0 });
  }

  function choisirSalarie(emp) {
    retourGrille();
    setSalarie(emp);
    chargerEtat(emp);
  }

  const oubli = etat?.a_regulariser || null;
  // 'heure' : on demande l'heure du départ oublié ; 'code' : on demande le code, pour
  // enregistrer cette heure s'il reste un oubli, sinon pour pointer.
  const etape = !etat ? null : oubli && !heureValidee ? 'heure' : 'code';
  const departSaisi = oubli && heure.length === 4 ? departDeclare(oubli.debut, heure) : null;
  const minutesDeclarees = departSaisi ? minutesDepuis(oubli.debut, Date.parse(departSaisi)) : 0;

  function taperHeure(chiffre) {
    setErreurHeure(null);
    setHeure((h) => (h.length >= 4 ? h : h + chiffre));
  }

  function validerHeure() {
    if (!departSaisi) return;
    if (Date.parse(departSaisi) > Date.now()) { setErreurHeure('Cette heure n’est pas encore passée.'); return; }
    setErreurHeure(null);
    setHeureValidee(true);
  }

  async function validerOubli() {
    if (enCours || !departSaisi || code.length < 4) return;
    setEnCours(true);
    setErreurCode(null);
    const { data, error } = await supabase.rpc('declarer_depart', {
      p_employee: salarie.id,
      p_pin: code,
      p_jeton: lireJeton(),
      p_presence: oubli.id,
      p_heure: departSaisi,
    });
    setEnCours(false);
    if (error) { setCode(''); afficherPuisRevenir({ ok: false, texte: messageErreurBorne(error.message) }); return; }
    const msg = messageRegularisation(data, oubli);
    if (msg.etape === 'code') { setCode(''); setErreurCode(msg.texte); return; }
    if (msg.etape === 'heure') { setHeureValidee(false); setErreurHeure(msg.texte); return; }
    if (!msg.ok) { setCode(''); afficherPuisRevenir(msg); return; }
    // Code reconnu et oubli réglé : on garde le code, il ne reste qu'à pointer d'un appui.
    // L'état est relu : un second oubli éventuel est demandé à son tour.
    setRegularise(msg.texte);
    setHeure('');
    setHeureValidee(false);
    chargerEtat(salarie);
  }

  // Capture la photo et la dépose dans le bucket privé. Le nom est tiré au sort côté
  // client pour n'écrire qu'une seule fois en base ensuite.
  async function capturerPhoto() {
    const video = videoRef.current;
    if (!streamRef.current || !video || !video.videoWidth) return null;
    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = Math.round((video.videoHeight / video.videoWidth) * 480);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.7));
    if (!blob) return null;
    const chemin = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.jpg`;
    const { error } = await supabase.storage.from('pointages').upload(chemin, blob);
    return error ? null : chemin;
  }

  async function valider() {
    if (oubli) { validerOubli(); return; }
    if (enCours || !etat || code.length < 4) return;
    setEnCours(true);
    setErreurCode(null);
    const photo = await capturerPhoto().catch(() => null);
    const { data, error } = await supabase.rpc('pointer', {
      p_employee: salarie.id,
      p_pin: code,
      p_jeton: lireJeton(),
      p_photo: photo,
    });
    setEnCours(false);
    setCode('');
    if (error) { afficherPuisRevenir({ ok: false, texte: messageErreurBorne(error.message) }); return; }
    const msg = messagePointage(data, Boolean(photo));
    // Code faux : on reste sur le clavier du même salarié pour qu'il réessaie aussitôt.
    if (data?.action === 'erreur' && data.motif !== 'trop_de_tentatives') { setErreurCode(msg.texte); return; }
    afficherPuisRevenir(msg);
  }

  function taper(chiffre) {
    if (enCours) return;
    setErreurCode(null);
    setCode((c) => (c.length >= 6 ? c : c + chiffre));
  }

  // Clavier physique : pratique pour un test sur ordinateur, sans effet sur la tablette.
  useEffect(() => {
    if (!salarie || message) return undefined;
    const surTouche = (e) => {
      if (/^[0-9]$/.test(e.key)) chiffre(e.key);
      else if (e.key === 'Backspace') effacerUn();
      else if (e.key === 'Enter') appuiBouton();
      else if (e.key === 'Escape') retourGrille();
    };
    window.addEventListener('keydown', surTouche);
    return () => window.removeEventListener('keydown', surTouche);
  });

  // Le clavier sert à l'heure du départ oublié OU au code, jamais aux deux à la fois.
  function chiffre(c) {
    if (etape === 'heure') taperHeure(c); else taper(c);
  }
  function effacerUn() {
    if (etape === 'heure') { setErreurHeure(null); setHeure((h) => h.slice(0, -1)); }
    else setCode((c) => c.slice(0, -1));
  }
  function effacerTout() {
    if (etape === 'heure') { setErreurHeure(null); setHeure(''); }
    else { setCode(''); setErreurCode(null); }
  }
  function appuiBouton() {
    if (etape === 'heure') validerHeure(); else valider();
  }

  // Toujours UN seul bouton. Tant qu'un oubli reste à régulariser, ce n'est pas un
  // bouton de pointage : ARRIVÉE ou DÉPART n'apparaît qu'une fois l'oubli réglé.
  let libelle = libelleBouton(etat);
  let actif = Boolean(libelle) && code.length >= 4 && !enCours;
  let couleurBouton = etat?.en_poste ? t.primary : t.success;
  if (etape === 'heure') {
    libelle = 'SUIVANT';
    actif = Boolean(departSaisi);
    couleurBouton = t.text;
  } else if (oubli) {
    libelle = 'VALIDER L’HEURE';
    actif = Boolean(departSaisi) && code.length >= 4 && !enCours;
    couleurBouton = t.text;
  }
  const heureAffichee = [0, 1, 2, 3].map((i) => heure[i] || '–');
  const heureImpossible = heure.length === 4 && !departSaisi;
  // Au téléphone, l'encart d'oubli ou le bandeau de confirmation pousserait le bouton hors
  // de l'écran : on resserre espacements et touches (au-dessus de 44 px), sans retirer de texte.
  // Sur tablette, c'est l'encart d'oubli cumulé au bandeau ou à une erreur qui déborde.
  const serre = Boolean(oubli) || (mobile && Boolean(regularise));
  const hTouche = !mobile ? 80 : serre ? 54 : 68;

  const bouton = {
    border: 'none', borderRadius: 16, fontFamily: F, cursor: 'pointer',
    touchAction: 'manipulation', userSelect: 'none', WebkitTapHighlightColor: 'transparent',
  };

  return (
    <div style={{ minHeight: '100vh', background: t.bg, color: t.text, fontFamily: F,
      padding: mobile ? 16 : 28, boxSizing: 'border-box', position: 'relative' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
        marginBottom: mobile ? 16 : 24, minHeight: 72 }}>
        <div>
          <div style={{ fontSize: mobile ? 24 : 30, fontWeight: 700, letterSpacing: -0.5 }}>
            <span style={{ color: t.primary }}>●</span> Pointage
          </div>
          <div style={{ fontSize: mobile ? 14 : 16, color: t.textMuted, marginTop: 4 }}>
            {!salarie ? 'Touche ton nom' : etape === 'heure' ? 'Indique ton heure de départ' : 'Tape ton code puis valide'}
          </div>
        </div>
        <figure style={{ margin: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <video ref={videoRef} autoPlay playsInline muted aria-label="Aperçu de la caméra de pointage"
            style={{ width: mobile ? 72 : 112, height: mobile ? 54 : 84, objectFit: 'cover', borderRadius: 10,
              background: t.surfaceAlt, border: `1px solid ${t.border}`, transform: 'scaleX(-1)',
              display: camera === false ? 'none' : 'block' }} />
          <figcaption style={{ fontSize: 11, color: t.textMuted, textAlign: 'center', maxWidth: mobile ? 110 : 150 }}>
            {camera === false ? 'Caméra indisponible : pointage sans photo' : 'Photo prise au pointage'}
          </figcaption>
        </figure>
      </header>

      {!salarie && (
        <main>
          {erreurListe && (
            <div role="alert" style={{ background: t.surface, border: `2px solid ${t.danger}`, borderRadius: 16,
              padding: 24, fontSize: 20, fontWeight: 600, textAlign: 'center' }}>
              {erreurListe}
              <div>
                <button onClick={chargerListe} style={{ ...bouton, marginTop: 16, padding: '14px 28px', fontSize: 18,
                  fontWeight: 700, background: t.primary, color: '#fff' }}>Réessayer</button>
              </div>
            </div>
          )}
          {!erreurListe && salaries === null && (
            <div style={{ fontSize: 18, color: t.textMuted, textAlign: 'center', padding: 40 }}>Chargement…</div>
          )}
          {!erreurListe && salaries?.length === 0 && (
            <div style={{ fontSize: 20, color: t.textMuted, textAlign: 'center', padding: 40 }}>
              Aucun salarié n’a encore de code de pointage. Le gérant les attribue dans Équipe.
            </div>
          )}
          {!erreurListe && salaries?.length > 0 && (
            <div style={{ display: 'grid', gap: mobile ? 12 : 16,
              gridTemplateColumns: `repeat(auto-fill, minmax(${mobile ? 150 : 200}px, 1fr))` }}>
              {salaries.map((emp) => (
                <button key={emp.id} onClick={() => choisirSalarie(emp)}
                  style={{ ...bouton, minHeight: mobile ? 112 : 128, padding: '16px 12px', background: t.surface,
                    border: `2px solid ${t.border}`, borderTop: `8px solid ${emp.couleur || t.primary}`,
                    boxShadow: t.cardShadow || 'none', display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center', gap: 10, color: t.text }}>
                  <span aria-hidden="true" style={{ width: mobile ? 48 : 56, height: mobile ? 48 : 56, borderRadius: '50%',
                    background: emp.couleur || t.primary, color: '#fff', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', fontSize: mobile ? 18 : 22, fontWeight: 700,
                    textShadow: '0 1px 2px rgba(0,0,0,0.35)' }}>{initiales(emp.nom)}</span>
                  <span style={{ fontSize: mobile ? 18 : 21, fontWeight: 700, lineHeight: 1.2, textAlign: 'center',
                    overflowWrap: 'anywhere' }}>{emp.nom}</span>
                </button>
              ))}
            </div>
          )}
        </main>
      )}

      {salarie && (
        <main style={{ display: deuxColonnes ? 'grid' : 'flex', flexDirection: 'column',
          gridTemplateColumns: deuxColonnes ? '1fr 1fr' : undefined, gap: deuxColonnes ? 40 : serre ? 10 : 16,
          maxWidth: deuxColonnes ? 900 : 440, margin: '0 auto', alignItems: deuxColonnes ? 'center' : 'stretch' }}>
          <section style={{ display: 'flex', flexDirection: 'column', gap: serre ? 10 : oubli && !mobile ? 16 : mobile ? 14 : 20 }}>
            <button onClick={retourGrille} style={{ ...bouton, alignSelf: 'flex-start', minHeight: 52,
              padding: '0 22px', fontSize: 18, fontWeight: 600, background: t.surface, color: t.text,
              border: `2px solid ${t.border}` }}>← Retour</button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <span aria-hidden="true" style={{ width: serre ? 48 : 60, height: serre ? 48 : 60, borderRadius: '50%', flexShrink: 0,
                background: salarie.couleur || t.primary, color: '#fff', display: 'flex', alignItems: 'center',
                justifyContent: 'center', fontSize: 22, fontWeight: 700, textShadow: '0 1px 2px rgba(0,0,0,0.35)' }}>
                {initiales(salarie.nom)}</span>
              <div>
                <div style={{ fontSize: mobile ? 24 : 28, fontWeight: 700, lineHeight: 1.15 }}>{salarie.nom}</div>
                <div style={{ fontSize: 16, color: t.textMuted, marginTop: 4 }}>
                  {!etat ? 'Vérification…'
                    : etat.en_poste
                      ? `En poste depuis ${heureParis(etat.debut)} (${dureeLisible(etat.minutesEnPoste)})`
                      : 'Pas en poste'}
                </div>
              </div>
            </div>

            {regularise && (
              <div role="status" style={{ background: t.success + '18', border: `2px solid ${t.success}`, borderRadius: 14,
                padding: '12px 16px', fontSize: 17, fontWeight: 600, color: t.text, lineHeight: 1.35 }}>
                ✓ {regularise}{!oubli && etat && ' Tu peux pointer.'}
              </div>
            )}

            {oubli && (
              <div style={{ background: t.warning + '18', border: `2px solid ${t.warning}`, borderRadius: 14,
                padding: serre ? '10px 12px' : '14px 18px', lineHeight: 1.35 }}>
                <div style={{ fontSize: mobile ? 18 : 20, fontWeight: 700 }}>
                  Le {jourParis(oubli.debut)}, ton départ n’a pas été pointé.
                </div>
                <div style={{ fontSize: 16, color: t.textMuted, marginTop: 4 }}>
                  {etape === 'heure'
                    ? `Arrivée à ${heureParis(oubli.debut)}. Quelle était ton heure de départ ? Elle sera notée comme déclarée.`
                    : `Départ déclaré : ${heureParis(departSaisi)} (${dureeLisible(minutesDeclarees)} de présence). Tape ton code pour l’enregistrer.`}
                </div>
                {etape === 'code' && (
                  <button onClick={() => { setHeureValidee(false); setErreurCode(null); }}
                    style={{ ...bouton, marginTop: 10, minHeight: 44, padding: '0 16px', fontSize: 16, fontWeight: 600,
                      background: t.surface, color: t.text, border: `2px solid ${t.border}` }}>Modifier l’heure</button>
                )}
              </div>
            )}

            {etape === 'heure' ? (
              <>
                <div aria-label={`Heure de départ : ${heureAffichee.slice(0, 2).join('')} heures ${heureAffichee.slice(2).join('')}`}
                  style={{ display: 'flex', justifyContent: 'center', alignItems: 'baseline', gap: 4, fontSize: serre ? 40 : mobile ? 44 : 52,
                    fontWeight: 800, fontVariantNumeric: 'tabular-nums', letterSpacing: 2 }}>
                  {heureAffichee.slice(0, 2).map((c, i) => <span key={i} style={{ color: heure[i] ? t.text : t.border }}>{c}</span>)}
                  <span>:</span>
                  {heureAffichee.slice(2).map((c, i) => <span key={i} style={{ color: heure[i + 2] ? t.text : t.border }}>{c}</span>)}
                </div>
                <div style={{ minHeight: 24, textAlign: 'center', fontSize: serre ? 15 : 17, color: t.textMuted }}>
                  {departSaisi && `Départ le ${jourParis(departSaisi)} à ${heureParis(departSaisi)}, soit ${dureeLisible(minutesDeclarees)} de présence`}
                </div>
                <div role="alert" style={{ minHeight: serre ? 0 : 28, textAlign: 'center', fontSize: serre ? 18 : 20,
                  fontWeight: 700, color: t.danger }}>
                  {erreurHeure || (heureImpossible && 'Cette heure n’existe pas. Exemple : 2215 pour 22 h 15.')}
                </div>
              </>
            ) : (
              <>
                <div aria-label={`${code.length} chiffres saisis`} style={{ display: 'flex', gap: 14, justifyContent: 'center',
                  padding: '8px 0' }}>
                  {Array.from({ length: Math.max(4, code.length) }).map((_, i) => (
                    <span key={i} style={{ width: 22, height: 22, borderRadius: '50%',
                      background: i < code.length ? t.text : 'transparent', border: `3px solid ${t.text}` }} />
                  ))}
                </div>
                <div role="alert" style={{ minHeight: serre ? 0 : 28, textAlign: 'center', fontSize: serre ? 18 : 20,
                  fontWeight: 700, color: t.danger }}>
                  {erreurCode}
                </div>
              </>
            )}
            {deuxColonnes && (
              <button onClick={appuiBouton} disabled={!actif} style={{ ...bouton, minHeight: 96, fontSize: 32,
                fontWeight: 800, letterSpacing: 1, background: actif ? couleurBouton : t.border,
                color: actif ? '#fff' : t.textMuted, cursor: actif ? 'pointer' : 'default' }}>
                {enCours ? 'Enregistrement…' : (libelle || '…')}
              </button>
            )}
          </section>

          <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: serre ? 8 : mobile ? 10 : 14 }}>
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((c) => (
                <button key={c} onClick={() => chiffre(c)} style={{ ...bouton, minHeight: hTouche,
                  fontSize: 32, fontWeight: 700, background: t.surface, color: t.text,
                  border: `2px solid ${t.border}` }}>{c}</button>
              ))}
              <button onClick={effacerTout} aria-label={etape === 'heure' ? 'Effacer toute l’heure' : 'Effacer tout le code'}
                style={{ ...bouton, minHeight: hTouche, fontSize: 18, fontWeight: 600,
                  background: t.surfaceAlt, color: t.textMuted, border: `2px solid ${t.border}` }}>Effacer</button>
              <button onClick={() => chiffre('0')} style={{ ...bouton, minHeight: hTouche, fontSize: 32,
                fontWeight: 700, background: t.surface, color: t.text, border: `2px solid ${t.border}` }}>0</button>
              <button onClick={effacerUn} aria-label="Effacer le dernier chiffre"
                style={{ ...bouton, minHeight: hTouche, fontSize: 28, background: t.surfaceAlt,
                  color: t.textMuted, border: `2px solid ${t.border}` }}>⌫</button>
            </div>
            {!deuxColonnes && (
              <button onClick={appuiBouton} disabled={!actif} style={{ ...bouton, minHeight: serre ? 72 : 88, fontSize: 30,
                fontWeight: 800, letterSpacing: 1, background: actif ? couleurBouton : t.border,
                color: actif ? '#fff' : t.textMuted, cursor: actif ? 'pointer' : 'default' }}>
                {enCours ? 'Enregistrement…' : (libelle || '…')}
              </button>
            )}
          </section>
        </main>
      )}

      {message && (
        <div role="status" onClick={fermerMessage} style={{ position: 'fixed', inset: 0, zIndex: 10,
          background: message.ok ? t.success : t.danger, color: '#fff', display: 'flex',
          flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32,
          textAlign: 'center', gap: 18, cursor: 'pointer' }}>
          <div aria-hidden="true" style={{ fontSize: mobile ? 56 : 72, lineHeight: 1 }}>{message.ok ? '✓' : '!'}</div>
          <div style={{ fontSize: mobile ? 26 : 36, fontWeight: 700, lineHeight: 1.3, maxWidth: 800 }}>{message.texte}</div>
          {message.sansPhoto && (
            <div style={{ fontSize: 18, opacity: 0.9 }}>Pointage enregistré sans photo (caméra indisponible).</div>
          )}
        </div>
      )}
    </div>
  );
}
