import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { F } from '../lib/foundation';
import {
  MOTIFS, versChamps, instantsSaisis, garderOrigine, composerMotif, verifierSaisie, messageErreur,
} from '../lib/correction';

// Formulaire de correction (mode 'corriger', `presence` fournie) ou d'ajout (mode
// 'ajouter') d'une présence par le gérant. Les contrôles de verifierSaisie reprennent
// ceux de la base ; la base reste juge et son refus éventuel est affiché tel quel.
// Heures choisies dans deux listes (heures, minutes) plutôt qu'un champ d'heure natif,
// qui passe en AM/PM sur un navigateur réglé en anglais. Minutes à la minute près :
// une heure pointée par la borne (21:58) doit pouvoir s'afficher telle quelle.

const jourLisible = (j) => new Date(`${j}T12:00:00Z`)
  .toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'short', day: 'numeric', month: 'short' });

const deux = (n) => String(n).padStart(2, '0');
const HEURES = Array.from({ length: 24 }, (_, i) => deux(i));
const MINUTES = Array.from({ length: 60 }, (_, i) => deux(i));

// valeur : 'HH:MM' ou '' (aucune heure). Choisir l'heure seule met les minutes à 00.
const SelecteurHeure = ({ valeur, onChange, libelle, videLibelle = '--', style }) => {
  const [h, m] = valeur ? valeur.split(':') : ['', ''];
  return (
    <div role="group" aria-label={libelle} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <select aria-label={`${libelle}, heures`} value={h} style={{ ...style, width: videLibelle.length > 2 ? 110 : 82, flex: 'none' }}
        onChange={(e) => onChange(e.target.value ? `${e.target.value}:${m || '00'}` : '')}>
        <option value="">{videLibelle}</option>
        {HEURES.map((x) => <option key={x} value={x}>{x} h</option>)}
      </select>
      <select aria-label={`${libelle}, minutes`} value={m} disabled={!h} style={{ ...style, width: 70, flex: 'none', opacity: h ? 1 : 0.5 }}
        onChange={(e) => onChange(`${h}:${e.target.value}`)}>
        {!h && <option value="">--</option>}
        {MINUTES.map((x) => <option key={x} value={x}>{x}</option>)}
      </select>
    </div>
  );
};

const CorrectionPresenceForm = ({
  t, mode, presence = null, salarieId = '', salaries = [], jours = [], presences = [],
  heuresMax = 14, lieux = [], onFait, onAnnuler,
}) => {
  const origine = presence ? versChamps(presence.debut) : null;
  const [salarie, setSalarie] = useState(presence?.employee_id || salarieId || '');
  const [jour, setJour] = useState(origine?.jour || jours[0] || '');
  const [heureDebut, setHeureDebut] = useState(origine?.heure || '');
  const [heureFin, setHeureFin] = useState(presence?.fin ? versChamps(presence.fin).heure : '');
  const [typeMotif, setTypeMotif] = useState('');
  const [precision, setPrecision] = useState('');
  const [lieu, setLieu] = useState(lieux[0]?.id || '');
  const [erreur, setErreur] = useState('');
  const [envoi, setEnvoi] = useState(false);

  const enCours = mode === 'corriger' && presence?.statut === 'ouverte' && !presence?.fin;
  // Une présence d'un jour hors de la liste (semaine à cheval) garde son jour proposé.
  const choixJours = origine && !jours.includes(origine.jour) ? [origine.jour, ...jours] : jours;
  const saisis = instantsSaisis({ jour, heureDebut, heureFin });
  const { finLendemain } = saisis;
  const { debut, fin } = saisis.fin === undefined ? saisis : garderOrigine(presence, saisis);
  const motif = composerMotif(typeMotif, precision);

  const enregistrer = async () => {
    if (!salarie) { setErreur('Choisir la personne.'); return; }
    if (!typeMotif) { setErreur('Choisir un motif : il reste dans l’historique pour le comptable.'); return; }
    if (typeMotif === 'Autre' && !precision.trim()) { setErreur('Avec « Autre », écrire le motif dans la précision.'); return; }
    const probleme = verifierSaisie({
      mode, presence, debut, fin, motif, heuresMax,
      autres: presences.filter((p) => p.employee_id === salarie),
    });
    if (probleme) { setErreur(probleme); return; }
    setEnvoi(true);
    setErreur('');
    const { error } = mode === 'corriger'
      ? await supabase.rpc('corriger_presence', { p_presence: presence.id, p_debut: debut, p_fin: fin, p_motif: motif })
      : await supabase.rpc('ajouter_presence', {
        p_employee: salarie, p_debut: debut, p_fin: fin, p_motif: motif,
        ...(lieu ? { p_lieu: lieu } : {}),
      });
    setEnvoi(false);
    if (error) { setErreur(messageErreur(error.message)); return; }
    onFait?.(mode === 'corriger' ? 'Correction enregistrée.' : 'Présence ajoutée.');
  };

  const etiquette = { fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 4, display: 'block', fontFamily: F };
  const champ = { padding: '8px 10px', borderRadius: 8, border: `1.5px solid ${t.border}`, fontSize: 14, fontFamily: F, background: t.bg, color: t.text, outline: 'none', boxSizing: 'border-box', minWidth: 0, width: '100%' };
  const bloc = { display: 'flex', flexDirection: 'column', minWidth: 0 };

  return (
    <div style={{ marginTop: 8, padding: 14, borderRadius: 12, border: `1px solid ${t.border}`, background: t.bg, fontFamily: F }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>
        {mode === 'corriger' ? 'Corriger cette présence' : 'Ajouter une présence oubliée'}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {mode === 'ajouter' && !salarieId && (
          <label style={{ ...bloc, flex: '1 1 160px' }}>
            <span style={etiquette}>Personne</span>
            <select value={salarie} onChange={(e) => { setSalarie(e.target.value); setErreur(''); }} style={champ}>
              <option value="">Choisir…</option>
              {salaries.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        )}
        <label style={{ ...bloc, flex: '1 1 160px' }}>
          <span style={etiquette}>Jour de l’arrivée</span>
          <select value={jour} onChange={(e) => { setJour(e.target.value); setErreur(''); }} style={champ}>
            {choixJours.map((j) => <option key={j} value={j}>{jourLisible(j)}</option>)}
          </select>
        </label>
        <div style={{ ...bloc, flex: 'none' }}>
          <span style={etiquette}>Arrivée</span>
          <SelecteurHeure valeur={heureDebut} libelle="Heure d’arrivée" style={champ}
            onChange={(v) => { setHeureDebut(v); setErreur(''); }} />
        </div>
        <div style={{ ...bloc, flex: 'none' }}>
          <span style={etiquette}>Départ{finLendemain ? ' (le lendemain)' : ''}</span>
          <SelecteurHeure valeur={heureFin} libelle="Heure de départ" style={champ}
            videLibelle={enCours || mode === 'ajouter' ? 'encore là' : '--'}
            onChange={(v) => { setHeureFin(v); setErreur(''); }} />
        </div>
        {mode === 'ajouter' && lieux.length > 1 && (
          <label style={{ ...bloc, flex: '1 1 160px' }}>
            <span style={etiquette}>Lieu</span>
            <select value={lieu} onChange={(e) => setLieu(e.target.value)} style={champ}>
              {lieux.map((l) => <option key={l.id} value={l.id}>{l.nom}</option>)}
            </select>
          </label>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 10 }}>
        <label style={{ ...bloc, flex: '1 1 180px' }}>
          <span style={etiquette}>Motif (obligatoire)</span>
          <select value={typeMotif} onChange={(e) => { setTypeMotif(e.target.value); setErreur(''); }} style={champ}>
            <option value="">Choisir…</option>
            {MOTIFS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label style={{ ...bloc, flex: '2 1 240px' }}>
          <span style={etiquette}>Précision{typeMotif === 'Autre' ? ' (obligatoire)' : ''}</span>
          <input value={precision} onChange={(e) => { setPrecision(e.target.value); setErreur(''); }}
            placeholder="Ex : parti à 22 h, confirmé par Thomas" style={champ} />
        </label>
      </div>
      {erreur && (
        <div role="alert" style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, fontSize: 13, background: t.danger + '12', color: t.danger, border: `1px solid ${t.danger}22` }}>
          {erreur}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={enregistrer} disabled={envoi}
          style={{ padding: '8px 14px', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 600, fontFamily: F, background: t.primary, color: '#fff', cursor: envoi ? 'default' : 'pointer', opacity: envoi ? 0.6 : 1 }}>
          {envoi ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        <button onClick={onAnnuler} disabled={envoi}
          style={{ padding: '8px 14px', borderRadius: 8, border: `1px solid ${t.border}`, fontSize: 13, fontWeight: 600, fontFamily: F, background: t.surface, color: t.text, cursor: 'pointer' }}>
          Annuler
        </button>
        <span style={{ fontSize: 12, color: t.textMuted, lineHeight: 1.5 }}>
          Ces heures compteront en « déclarées », pas en pointées. L’ancienne valeur et le motif restent dans l’historique.
        </span>
      </div>
    </div>
  );
};

export default CorrectionPresenceForm;
