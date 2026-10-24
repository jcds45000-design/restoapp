import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { F } from '../lib/foundation';
import { recapMensuel, lignesExport, versCSV, fenetreChargement, salariesDuRecap } from '../lib/recap';
import SelecteurMois from './SelecteurMois';
import { estAnomalie, estEnCours } from '../lib/pointage';
import { changementsLisibles } from '../lib/correction';
import CorrectionPresenceForm from './CorrectionPresenceForm';

// Module « Pointage » : ce que la borne a enregistré, et le récap mensuel prêt pour le
// comptable (tâche 11). Aucune règle n'est recalculée ici : tout vient de recap.js et
// pointage.js, déjà couverts par leurs tests. L'écran ne fait que charger et afficher.
// Corrections : corriger_presence et ajouter_presence (migrations 10c, 10d), motif
// obligatoire ; l'historique de chaque présence corrigée est relu dans audit_log.

const moisCourantParis = () => new Intl.DateTimeFormat('fr-CA', {
  timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit',
}).format(new Date()).slice(0, 7);

const heure = (iso) => (iso
  ? new Date(iso).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' })
  : '—');

const jourLisible = (j) => new Date(`${j}T12:00:00Z`)
  .toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'short', day: 'numeric', month: 'short' });

const hhmm = (h) => {
  const total = Math.round((Number(h) || 0) * 60);
  return `${Math.floor(total / 60)} h ${String(total % 60).padStart(2, '0')}`;
};

const ORIGINES = { borne: 'borne', declare: 'déclaré', correction: 'corrigé', cloture_auto: 'clôture auto' };
// « arrivée » est féminin : « arrivée corrigée », « arrivée déclarée ».
const ORIGINES_ARRIVEE = { ...ORIGINES, declare: 'déclarée', correction: 'corrigée' };

// « 0 midi, 1 soir, 0 hors pointe » : la répartition reste visible, le comptable en a besoin.
const detailRepas = (repas) => `${repas.midi} midi, ${repas.soir} soir, ${repas.horsPointe} hors pointe`;
const hm = (x) => String(x || '').slice(0, 5);
// 151,67 : la base mensualisée s'écrit en heures décimales, comme sur le bulletin de paie.
const heuresDecimales = (h) => Number(h).toLocaleString('fr-FR', { maximumFractionDigits: 2 });

const RecapPointageModule = ({ t }) => {
  const [mois, setMois] = useState(moisCourantParis);
  const [employees, setEmployees] = useState([]);
  const [presences, setPresences] = useState([]);
  const [reglages, setReglages] = useState(null);
  const [absences, setAbsences] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [ouvert, setOuvert] = useState(null);
  const [lieux, setLieux] = useState([]);
  const [journal, setJournal] = useState([]);
  // Un seul formulaire ouvert à la fois : 'ajout', 'ajout-<salarié>', 'alerte-<présence>', 'detail-<présence>'.
  const [edition, setEdition] = useState(null);
  const [historique, setHistorique] = useState(null);
  const [message, setMessage] = useState('');

  const charger = useCallback((m) => {
    const f = fenetreChargement(m);
    if (!f) return Promise.resolve();
    return Promise.all([
      supabase.from('employees').select('id,name,heures_hebdo,date_entree,date_fin,active').order('name'),
      supabase.from('presences').select('*').gte('jour', f.debut).lte('jour', f.fin).order('debut'),
      supabase.from('pointage_settings').select('*').eq('id', 1).maybeSingle(),
      // Congés, maladie et absences injustifiées posés dans le Planning.
      supabase.from('schedule').select('employee_id,employee_name,date,shift')
        .gte('date', f.debut).lte('date', f.fin).in('shift', ['conges', 'conge', 'maladie', 'absence']),
      supabase.from('pointage_lieux').select('id,nom,actif').eq('actif', true).order('created_at'),
    ]).then(async ([re, rp, rr, ra, rl]) => {
      // Historique des corrections : seulement pour les présences marquées corrigées.
      const corrigees = (rp.data || []).filter((p) => p.corrigee).map((p) => p.id);
      const rj = corrigees.length
        ? await supabase.from('audit_log').select('id,at,user_name,user_email,action,record_id,before,after,motif')
          .eq('table_name', 'presences').in('record_id', corrigees).order('at')
        : { data: [] };
      setErreur(re.error || rp.error || rr.error ? 'Les pointages n’ont pas pu être lus. La migration 10 est-elle appliquée ?'
        : ra.error ? 'Les absences du planning n’ont pas pu être lues : l’écart au contrat ne les déduit pas.' : '');
      setEmployees(re.data || []);
      setPresences(rp.data || []);
      setReglages(rr.data || null);
      setAbsences(ra.data || []);
      setLieux(rl.data || []);
      setJournal(rj.data || []);
      setChargement(false);
    });
  }, []);

  useEffect(() => {
    let annule = false;
    charger(mois).then(() => { if (annule) return; });
    return () => { annule = true; };
  }, [mois, charger]);

  const creneaux = useMemo(() => (reglages ? {
    midiDebut: reglages.midi_debut, midiFin: reglages.midi_fin,
    soirDebut: reglages.soir_debut, soirFin: reglages.soir_fin,
  } : null), [reglages]);

  // Actifs, plus les anciens salariés qui ont pointé ou ont une absence au planning sur la période.
  const { recaps, sansContrat } = useMemo(() => {
    if (!creneaux) return { recaps: [], sansContrat: [] };
    const retenus = salariesDuRecap(employees, presences, absences);
    const ok = [];
    const ko = [];
    for (const salarie of retenus) {
      try {
        ok.push(recapMensuel({
          salarie, presences, mois, creneaux, absences,
          regleSemaine: reglages?.semaine_a_cheval || 'mois_fin',
        }));
      } catch {
        ko.push(salarie);
      }
    }
    return { recaps: ok, sansContrat: ko };
  }, [employees, presences, mois, creneaux, reglages, absences]);

  // Un salarié absent tout le mois reste visible : ses jours d'absence comptent pour la paie.
  const joursAbsence = (r) => r.absences.conges + r.absences.maladie + r.absences.injustifiees;
  const avecHeures = recaps.filter((r) => r.heuresTotales > 0 || r.qualite.anomalies > 0 || r.qualite.enCours > 0
    || joursAbsence(r) > 0);
  const anomalies = recaps.flatMap((r) => r.anomalies.map((p) => ({ ...p, nom: r.salarie.name })));
  const enCours = presences.filter(estEnCours);

  // Jours proposés à l'ajout : ceux du mois jusqu'à aujourd'hui, le plus récent d'abord.
  const aujourdhui = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const joursDuMois = useMemo(() => {
    const [an, m] = mois.split('-').map(Number);
    const nb = new Date(Date.UTC(an, m, 0)).getUTCDate();
    const liste = [];
    for (let d = nb; d >= 1; d -= 1) {
      const j = `${mois}-${String(d).padStart(2, '0')}`;
      if (j <= aujourdhui) liste.push(j);
    }
    return liste;
  }, [mois, aujourdhui]);
  const salariesActifs = employees.filter((e) => e.active !== false);
  const heuresMax = reglages?.heures_avant_cloture || 14;

  const fait = (texte) => {
    setEdition(null);
    setMessage(texte);
    charger(mois);
  };
  const formulaire = (cle, props) => (edition === cle ? (
    <CorrectionPresenceForm t={t} jours={joursDuMois} presences={presences} heuresMax={heuresMax}
      lieux={lieux} salaries={salariesActifs} onFait={fait} onAnnuler={() => setEdition(null)} {...props} />
  ) : null);
  const ouvrir = (cle) => { setMessage(''); setEdition(edition === cle ? null : cle); };
  const petitBouton = { padding: '4px 10px', borderRadius: 8, border: `1px solid ${t.border}`, background: t.surface, color: t.text, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: F };

  const exporter = () => {
    const csv = versCSV(lignesExport(avecHeures));
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `pointage-${mois}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const carte = { background: t.surface, borderRadius: 16, border: `1px solid ${t.border}`, padding: 24, marginBottom: 20 };
  const th = { textAlign: 'left', padding: '10px 10px', fontSize: 12, fontWeight: 700, color: t.textMuted, fontFamily: F, verticalAlign: 'bottom' };
  const td = { padding: '10px 10px', fontSize: 13, fontFamily: F, borderTop: `1px solid ${t.border}`, whiteSpace: 'nowrap' };

  return (
    <div>
      <div style={{ ...carte, display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6, display: 'block', fontFamily: F }}>Mois</label>
          <SelecteurMois t={t} valeur={mois} max={moisCourantParis()}
            onChange={(m) => { setChargement(true); setMois(m); }} />
        </div>
        <button onClick={exporter} disabled={!avecHeures.length}
          style={{ padding: '10px 16px', borderRadius: 8, border: 'none', fontSize: 14, fontWeight: 600, fontFamily: F,
            background: avecHeures.length ? t.primary : t.border, color: avecHeures.length ? '#fff' : t.textMuted,
            cursor: avecHeures.length ? 'pointer' : 'default' }}>Exporter en CSV pour le comptable</button>
        <button onClick={() => ouvrir('ajout')}
          style={{ padding: '10px 16px', borderRadius: 8, border: `1px solid ${t.border}`, fontSize: 14, fontWeight: 600, fontFamily: F,
            background: t.surface, color: t.text, cursor: 'pointer' }}>+ Ajouter une présence</button>
        <div style={{ fontSize: 12, color: t.textMuted, fontFamily: F, lineHeight: 1.5, flex: 1, minWidth: 220 }}>
          Une semaine à cheval sur deux mois est comptée entière, dans le mois où tombe son {reglages?.semaine_a_cheval === 'mois_debut' ? 'lundi' : 'dimanche'}.
        </div>
      </div>

      {edition === 'ajout' && <div style={{ ...carte, padding: 12 }}>{formulaire('ajout', { mode: 'ajouter' })}</div>}
      {message && (
        <div role="status" style={{ ...carte, padding: '12px 16px', color: t.success, background: t.success + '10', borderColor: t.success + '33', fontSize: 14, fontWeight: 600, fontFamily: F }}>
          {message}
        </div>
      )}
      {erreur && <div style={{ ...carte, color: t.danger, fontSize: 14, fontFamily: F }}>{erreur}</div>}

      {chargement ? (
        <div style={{ ...carte, fontSize: 14, color: t.textMuted, fontFamily: F }}>Lecture des pointages…</div>
      ) : (
        <>
          {(anomalies.length > 0 || enCours.length > 0) && (
            <div style={{ ...carte, borderColor: t.warning + '55', background: t.warning + '0C' }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 10px', fontFamily: F }}>À regarder</h3>
              {enCours.map((p) => (
                <div key={p.id} style={{ fontSize: 13, fontFamily: F, marginBottom: 8, lineHeight: 1.5 }}>
                  <strong>{employees.find((e) => e.id === p.employee_id)?.name || '?'}</strong> est en poste depuis {jourLisible(p.jour)} {heure(p.debut)}, sans départ pointé.{' '}
                  <button onClick={() => ouvrir(`alerte-${p.id}`)} style={petitBouton}>Corriger</button>
                  {formulaire(`alerte-${p.id}`, { mode: 'corriger', presence: p })}
                </div>
              ))}
              {anomalies.map((p) => (
                <div key={p.id} style={{ fontSize: 13, fontFamily: F, marginBottom: 8, lineHeight: 1.5 }}>
                  <strong>{p.nom}</strong> : {jourLisible(p.jour)}, arrivée à {heure(p.debut)} sans départ. Fermée d’office, <strong>0 h comptée</strong> tant que ce n’est pas corrigé.{' '}
                  <button onClick={() => ouvrir(`alerte-${p.id}`)} style={petitBouton}>Corriger</button>
                  {formulaire(`alerte-${p.id}`, { mode: 'corriger', presence: p })}
                </div>
              ))}
            </div>
          )}

          <div style={carte}>
            <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 4px', fontFamily: F }}>Récap du mois</h3>
            <p style={{ fontSize: 13, color: t.textMuted, margin: '0 0 14px', fontFamily: F, lineHeight: 1.5 }}>
              Les heures supplémentaires sont comptées semaine par semaine, jamais sur le total du mois. « dont déclarées » sont les heures saisies après coup, pas mesurées par la borne.
            </p>
            {creneaux && (
              <p style={{ fontSize: 13, color: t.textMuted, margin: '0 0 14px', fontFamily: F, lineHeight: 1.5 }}>
                Repas : un par heure de pointe où la personne a travaillé au moins 1 h (midi {hm(creneaux.midiDebut)} à {hm(creneaux.midiFin)}, soir {hm(creneaux.soirDebut)} à {hm(creneaux.soirFin)}). Sans pointe couverte, 5 h de travail dans la journée donnent un repas hors pointe. C’est la règle de la convention restauration rapide.
              </p>
            )}
            <p style={{ fontSize: 13, color: t.textMuted, margin: '0 0 14px', fontFamily: F, lineHeight: 1.5 }}>
              Écart au contrat du mois : heures faites moins les heures dues sur les semaines du mois (par exemple 4 semaines × 35 h = 140 h), après déduction des congés et arrêts maladie posés dans le Planning (une journée = l’horaire de la semaine divisé par 5). Une absence injustifiée n’est pas déduite. La base mensualisée payée (35 h × 52 ÷ 12 = 151,67 h) est indiquée pour repère : elle ne sert pas à l’écart, sinon un mois de 4 semaines afficherait un faux manque et un mois de 5 semaines un faux excédent.
            </p>
            {avecHeures.length === 0 ? (
              <div style={{ fontSize: 14, color: t.textMuted, fontFamily: F }}>Aucun pointage sur ce mois.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 880 }}>
                  <thead>
                    <tr>
                      <th style={th}>Salarié</th>
                      <th style={th}>Heures</th>
                      <th style={th}>dont pointées</th>
                      <th style={th}>dont déclarées</th>
                      <th style={th}>Heures sup</th>
                      <th style={th}>Repas</th>
                      <th style={th}>Absences</th>
                      <th style={th}>Écart au contrat<br />du mois</th>
                      <th style={th}>Fiabilité</th>
                      <th style={th} />
                    </tr>
                  </thead>
                  <tbody>
                    {avecHeures.map((r) => {
                      const sup = Math.round(r.semaines.reduce((s, x) => s + x.supplementaires + x.complementaires, 0) * 100) / 100;
                      const ouvre = ouvert === r.salarie.id;
                      return (
                        <tr key={r.salarie.id}>
                          <td style={{ ...td, fontWeight: 600 }}>{r.salarie.name}</td>
                          <td style={td}>{hhmm(r.heuresTotales)}</td>
                          <td style={td}>{hhmm(r.heuresPointees)}</td>
                          <td style={{ ...td, color: r.heuresDeclarees > 0 ? t.warning : t.textMuted }}>{hhmm(r.heuresDeclarees)}</td>
                          <td style={td}>{sup > 0 ? hhmm(sup) : '—'}</td>
                          <td style={td}>
                            <div>{r.repas.total}</div>
                            <div style={{ fontSize: 11, color: t.textMuted, lineHeight: 1.4 }}>{detailRepas(r.repas)}</div>
                          </td>
                          <td style={td}>
                            {joursAbsence(r) === 0 ? <span style={{ color: t.textMuted }}>—</span> : (
                              <span>{[
                                r.absences.conges && `${r.absences.conges} j congés`,
                                r.absences.maladie && `${r.absences.maladie} j maladie`,
                                r.absences.injustifiees && `${r.absences.injustifiees} j injustifiée${r.absences.injustifiees > 1 ? 's' : ''}`,
                              ].filter(Boolean).join(' · ')}</span>
                            )}
                          </td>
                          <td style={td}>
                            <div style={{ color: r.ecartContratHeures < 0 ? t.danger : t.success }}>
                              {r.ecartContratHeures > 0 ? '+' : r.ecartContratHeures < 0 ? '−' : ''}{hhmm(Math.abs(r.ecartContratHeures))}
                            </div>
                            <div style={{ fontSize: 11, color: t.textMuted, lineHeight: 1.4 }}>
                              sur {hhmm(r.heuresContractuellesMois - r.heuresAbsencesJustifiees)} dus
                              <br />payé {heuresDecimales(r.baseMensualisee)} h/mois
                            </div>
                          </td>
                          <td style={{ ...td, color: r.qualite.tauxFiabilite < 90 ? t.warning : t.textMuted }}>{r.qualite.tauxFiabilite} %</td>
                          <td style={td}>
                            <button onClick={() => setOuvert(ouvre ? null : r.salarie.id)}
                              style={{ padding: '6px 10px', borderRadius: 8, border: `1px solid ${t.border}`, background: t.surface, color: t.text, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: F }}>
                              {ouvre ? 'Masquer' : 'Jour par jour'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {ouvert && avecHeures.filter((r) => r.salarie.id === ouvert).map((r) => (
            <div key={r.salarie.id} style={carte}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 12 }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0, fontFamily: F }}>{r.salarie.name}, jour par jour</h3>
                <button onClick={() => ouvrir(`ajout-${r.salarie.id}`)} style={petitBouton}>+ Ajouter une présence</button>
              </div>
              {formulaire(`ajout-${r.salarie.id}`, { mode: 'ajouter', salarieId: r.salarie.id })}
              {r.jours.length === 0 ? (
                <div style={{ fontSize: 14, color: t.textMuted, fontFamily: F }}>Aucun jour pointé ce mois.</div>
              ) : r.jours.map((j) => (
                <div key={j.jour} style={{ borderTop: `1px solid ${t.border}`, padding: '10px 0' }}>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
                    <span style={{ fontSize: 13, fontWeight: 700, fontFamily: F, minWidth: 110 }}>{jourLisible(j.jour)}</span>
                    <span style={{ fontSize: 13, fontFamily: F }}>{hhmm(j.minutes / 60)}</span>
                    <span style={{ fontSize: 12, color: t.textMuted, fontFamily: F }}>{j.repas.total} repas ({detailRepas(j.repas)})</span>
                  </div>
                  {j.presences.map((p) => {
                    const entrees = journal.filter((e) => e.record_id === p.id);
                    const voirHisto = historique === p.id;
                    return (
                      <div key={p.id} style={{ marginTop: 4 }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 12, color: estAnomalie(p) ? t.danger : t.textMuted, fontFamily: F, lineHeight: 1.5 }}>
                            {heure(p.debut)} → {heure(p.fin)} · arrivée {ORIGINES_ARRIVEE[p.debut_origine] || p.debut_origine}
                            {p.fin_origine ? ` · départ ${ORIGINES[p.fin_origine] || p.fin_origine}` : ''}
                            {estAnomalie(p) ? ' · anomalie, non comptée' : ''}
                            {/* « corrigée » seulement si aucun des deux bouts ne le dit déjà */}
                            {p.corrigee && p.debut_origine !== 'correction' && p.fin_origine !== 'correction' ? ' · corrigée' : ''}
                          </span>
                          <button onClick={() => ouvrir(`detail-${p.id}`)} style={petitBouton}>Corriger</button>
                          {entrees.length > 0 && (
                            <button onClick={() => setHistorique(voirHisto ? null : p.id)} aria-expanded={voirHisto} style={petitBouton}>
                              Historique {voirHisto ? '▴' : '▾'}
                            </button>
                          )}
                        </div>
                        {voirHisto && entrees.map((e) => (
                          <div key={e.id} style={{ fontSize: 12, fontFamily: F, lineHeight: 1.5, margin: '6px 0 0 12px', paddingLeft: 10, borderLeft: `2px solid ${t.border}` }}>
                            <div style={{ color: t.textMuted }}>
                              {new Date(e.at).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}, {e.user_name || e.user_email || 'inconnu'}
                            </div>
                            {changementsLisibles(e).map((l) => <div key={l}>{l}</div>)}
                            <div>motif : {e.motif}</div>
                          </div>
                        ))}
                        {formulaire(`detail-${p.id}`, { mode: 'corriger', presence: p })}
                      </div>
                    );
                  })}
                </div>
              ))}
              <div style={{ marginTop: 12, fontSize: 12, color: t.textMuted, fontFamily: F, lineHeight: 1.5 }}>
                Semaines : {r.semaines.map((s) => `${s.cle} ${hhmm(s.heures)}`).join(' · ') || '—'}
              </div>
            </div>
          ))}

          {sansContrat.length > 0 && (
            <div style={{ ...carte, borderColor: t.danger + '55' }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 8px', fontFamily: F }}>Contrat manquant</h3>
              <div style={{ fontSize: 13, fontFamily: F, lineHeight: 1.5 }}>
                {sansContrat.map((e) => e.name).join(', ')} : sans heures par semaine sur la fiche, le récap ne peut pas calculer l’écart au contrat ni les heures supplémentaires. À compléter dans Équipe.
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default RecapPointageModule;
