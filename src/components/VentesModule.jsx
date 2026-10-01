import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { normaliserTicket, recapImport, dedupTickets, preparerEnregistrement } from '../lib/ventes';
import { ticketsDepuisExportTickets } from '../lib/ventesExportTickets';

// ============================================================================
// Phase 2 du chantier Kimiko Pilotage : module Ventes (spec maître §15-16).
// Onglet Mapping : associer chaque article Abill à un article de la carte.
// Onglet Imports : import du fichier « Historique des tickets » du back-office
// Abill (en attendant l'API, inopérante), et journal des imports.
// ============================================================================

const dateFr = (iso) => (iso ? new Date(iso).toLocaleDateString('fr-FR') : '—');
const euros = (n) => (n ?? 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });

// Supabase plafonne une lecture à 1000 lignes : on pagine, sinon un mois de
// tickets déjà importés serait vu à moitié et les doublons passeraient.
async function abillIdsExistants(debut, fin) {
  const ids = new Set();
  for (let de = 0; ; de += 1000) {
    const { data, error } = await supabase.from('sales_tickets').select('abill_id')
      .gte('date_service', debut).lte('date_service', fin).order('abill_id').range(de, de + 999);
    if (error) throw error;
    for (const r of data) ids.add(r.abill_id);
    if (data.length < 1000) return ids;
  }
}

async function insererParPaquets(table, lignes, taille) {
  for (let i = 0; i < lignes.length; i += taille) {
    const { error } = await supabase.from(table).insert(lignes.slice(i, i + taille));
    if (error) throw error;
  }
}

function totauxParCanal(jours) {
  const parCanal = {};
  for (const j of jours) {
    for (const [canal, v] of Object.entries(j.parCanal)) {
      const c = parCanal[canal] || { nb_tickets: 0, total_ttc: 0 };
      c.nb_tickets += v.nb_tickets;
      c.total_ttc += v.total_ttc;
      parCanal[canal] = c;
    }
  }
  return Object.entries(parCanal).sort((a, b) => b[1].total_ttc - a[1].total_ttc);
}

// Import d'un fichier : lecture et analyse dans le navigateur, récapitulatif
// affiché, puis enregistrement seulement sur validation (règle maison).
function ImportFichier({ t, mappings, onTermine }) {
  const [etape, setEtape] = useState('attente'); // attente | analyse | pret | enregistrement
  const [fichier, setFichier] = useState(null);
  const [analyse, setAnalyse] = useState(null);
  const [erreur, setErreur] = useState('');

  const reinitialiser = () => { setEtape('attente'); setFichier(null); setAnalyse(null); setErreur(''); };

  const analyser = async (f) => {
    if (!f) return;
    setErreur(''); setAnalyse(null); setFichier(f); setEtape('analyse');
    try {
      const { readSheet } = await import('read-excel-file/browser');
      const rows = await readSheet(f);
      const { tickets, erreurs } = ticketsDepuisExportTickets(rows);
      if (tickets.length === 0) throw new Error(erreurs[0] || 'Aucun ticket trouvé dans ce fichier.');
      const normalises = tickets.map(normaliserTicket);
      const dates = normalises.filter((n) => !n.erreur).map((n) => n.ticket.date_service).sort();
      const existants = await abillIdsExistants(dates[0], dates[dates.length - 1]);
      const recap = recapImport(normalises, existants, mappings);
      const connus = new Set(mappings.map((m) => m.abill_product_id));
      setAnalyse({
        normalises, existants, recap,
        // Période du FICHIER (le récap ne couvre que les tickets nouveaux :
        // vide si tout est déjà importé).
        periode: { debut: dates[0], fin: dates[dates.length - 1] },
        erreursLecture: erreurs,
        canaux: totauxParCanal(recap.jours),
        nbNouveauxArticles: recap.non_mappes.filter((a) => !connus.has(a.abill_product_id)).length,
      });
      setEtape('pret');
    } catch (e) {
      setErreur(e.message || String(e)); setEtape('attente');
    }
  };

  const enregistrer = async () => {
    setErreur(''); setEtape('enregistrement');
    const importId = crypto.randomUUID();
    const { recap } = analyse;
    let importCree = false;
    try {
      const { nouveaux } = dedupTickets(analyse.normalises, analyse.existants);
      const p = preparerEnregistrement(nouveaux, { importId, mappings, genId: () => crypto.randomUUID() });
      const { data: auth } = await supabase.auth.getUser();
      const { error: e1 } = await supabase.from('sales_imports').insert({
        id: importId, source: 'CSV', periode_debut: recap.periode_debut, periode_fin: recap.periode_fin,
        nb_tickets: recap.nb_tickets, nb_lignes: recap.nb_lignes, nb_doublons: recap.nb_doublons,
        created_by: auth?.user?.id ?? null,
        meta: {
          format: 'export_tickets_abill', fichier: fichier?.name ?? null,
          total_ttc: Math.round(recap.total_ttc * 100) / 100, nb_erreurs: recap.nb_erreurs + analyse.erreursLecture.length,
          par_canal: Object.fromEntries(analyse.canaux.map(([c, v]) => [c, { nb_tickets: v.nb_tickets, total_ttc: Math.round(v.total_ttc * 100) / 100 }])),
        },
      });
      if (e1) throw e1;
      importCree = true;
      await insererParPaquets('sales_tickets', p.tickets, 500);
      await insererParPaquets('sales_lines', p.lignes, 1000);
      if (p.nouveauxArticles.length) {
        const { error: e2 } = await supabase.from('abill_item_mapping')
          .upsert(p.nouveauxArticles, { onConflict: 'abill_product_id', ignoreDuplicates: true });
        if (e2) throw e2;
      }
      reinitialiser();
      onTermine(`Import enregistré : ${recap.nb_tickets} tickets, ${recap.nb_lignes} lignes, ${euros(recap.total_ttc)}.`
        + (p.nouveauxArticles.length ? ` ${p.nouveauxArticles.length} nouveaux articles à mapper.` : ''));
    } catch (e) {
      // Pas de transaction côté navigateur : on défait ce qui a été écrit pour
      // cet import (les lignes suivent leurs tickets par cascade).
      if (importCree) {
        await supabase.from('sales_tickets').delete().eq('import_id', importId);
        await supabase.from('sales_imports').delete().eq('id', importId);
      }
      setErreur(`Enregistrement annulé, rien n’a été conservé. Détail : ${e.message || e}`);
      setEtape('pret');
    }
  };

  const r = analyse?.recap;
  const nbErreurs = r ? r.nb_erreurs + analyse.erreursLecture.length : 0;
  const bouton = (actif) => ({ padding: '9px 18px', borderRadius: 8, border: 'none', fontWeight: 600, fontSize: 13,
    cursor: actif ? 'pointer' : 'not-allowed', background: actif ? t.primary : t.surface,
    color: actif ? '#fff' : t.textMuted, outline: actif ? 'none' : `1px dashed ${t.border}` });

  return (
    <Carte t={t} style={{ marginBottom: 14 }}>
      <div style={{ fontWeight: 700, color: t.text, marginBottom: 6, fontSize: 14 }}>Importer les ventes depuis Abill</div>
      <div style={{ fontSize: 13, color: t.textMuted, lineHeight: 1.5, marginBottom: 12 }}>
        Dans le back-office Abill : Documents, Tickets, choisir la période, puis « Fichier Excel ».
        Déposez ce fichier ici. Rien n’est enregistré avant votre validation, et un ticket déjà importé
        n’est jamais compté deux fois. Les noms des clients présents dans le fichier ne sont pas lus.
      </div>

      {etape === 'attente' && (
        <input type="file" accept=".xlsx" onChange={(e) => analyser(e.target.files?.[0])}
          style={{ fontSize: 13, color: t.text }} />
      )}
      {etape === 'analyse' && <div style={{ fontSize: 13, color: t.textMuted }}>Lecture de « {fichier?.name} »…</div>}

      {erreur && (
        <div style={{ marginTop: 10, color: t.danger, fontWeight: 600, fontSize: 13 }}>{erreur}</div>
      )}

      {r && (etape === 'pret' || etape === 'enregistrement') && (
        <div style={{ marginTop: 4 }}>
          <div style={{ fontSize: 13, color: t.textMuted, marginBottom: 10 }}>
            Fichier : <b style={{ color: t.text }}>{fichier?.name}</b>, du {dateFr(analyse.periode.debut)} au {dateFr(analyse.periode.fin)}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 12 }}>
            {[
              ['Tickets à enregistrer', r.nb_tickets],
              ['Lignes de vente', r.nb_lignes],
              ['Chiffre d’affaires TTC', euros(r.total_ttc)],
              ['Déjà importés (écartés)', r.nb_doublons],
            ].map(([lib, val]) => (
              <div key={lib} style={{ border: `1px solid ${t.border}`, borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ fontSize: 12, color: t.textMuted }}>{lib}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: t.text }}>{val}</div>
              </div>
            ))}
          </div>

          {analyse.canaux.length > 0 && (
            <div style={{ marginBottom: 12, maxWidth: 560 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: t.text, marginBottom: 6 }}>Par canal</div>
              {analyse.canaux.map(([canal, v]) => (
                <div key={canal} style={{ display: 'flex', gap: 12, fontSize: 13, padding: '5px 0',
                  borderBottom: `1px solid ${t.border}` }}>
                  <span style={{ flex: 1, color: t.text, fontWeight: 600 }}>{canal}</span>
                  <span style={{ color: t.textMuted }}>{v.nb_tickets} tickets</span>
                  <span style={{ color: t.text, minWidth: 100, textAlign: 'right' }}>{euros(v.total_ttc)}</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ fontSize: 13, color: t.text, lineHeight: 1.6, marginBottom: 12 }}>
            {analyse.nbNouveauxArticles > 0
              ? `${analyse.nbNouveauxArticles} articles jamais vus seront ajoutés au mapping, marqués « à mapper ».`
              : 'Aucun nouvel article : tous sont déjà connus du mapping.'}
            {r.non_mappes.length > analyse.nbNouveauxArticles
              && ` ${r.non_mappes.length - analyse.nbNouveauxArticles} autres articles, déjà connus, restent à associer à la carte.`}
            {nbErreurs > 0 && (
              <div style={{ color: t.warning, fontWeight: 600 }}>
                {nbErreurs} ligne(s) illisible(s) écartée(s).
                {analyse.erreursLecture.slice(0, 3).map((e) => <div key={e} style={{ fontWeight: 400 }}>{e}</div>)}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={enregistrer} disabled={etape === 'enregistrement' || r.nb_tickets === 0}
              style={bouton(etape !== 'enregistrement' && r.nb_tickets > 0)}>
              {etape === 'enregistrement' ? 'Enregistrement…' : r.nb_tickets === 0 ? 'Rien de nouveau à enregistrer' : `Enregistrer ${r.nb_tickets} tickets`}
            </button>
            <button onClick={reinitialiser} disabled={etape === 'enregistrement'}
              style={{ padding: '9px 18px', borderRadius: 8, border: `1px solid ${t.border}`, background: t.surface,
                color: t.textMuted, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Annuler</button>
          </div>
        </div>
      )}
    </Carte>
  );
}

function Onglets({ actif, setActif, items, t }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 18 }}>
      {items.map((o) => (
        <button key={o.id} onClick={() => setActif(o.id)} style={{
          padding: '9px 16px', borderRadius: 10, cursor: 'pointer', fontSize: 14, fontWeight: 600,
          border: actif === o.id ? 'none' : `1px solid ${t.border}`,
          background: actif === o.id ? t.primary : t.surface,
          color: actif === o.id ? '#fff' : t.textMuted,
        }}>
          {o.label}{o.badge > 0 && (
            <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 9,
              background: actif === o.id ? 'rgba(255,255,255,0.25)' : t.danger + '18',
              color: actif === o.id ? '#fff' : t.danger }}>{o.badge}</span>
          )}
        </button>
      ))}
    </div>
  );
}

function Carte({ children, t, style }) {
  return (
    <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 12, padding: 16, ...style }}>
      {children}
    </div>
  );
}

// Une ligne de mapping : l'article Abill à gauche, la cible à droite.
function LigneMapping({ m, menuItems, t, onChoisir }) {
  const aMapper = m.cible_type === 'a_mapper';
  const ignore = m.cible_type === 'ignorer';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', flexWrap: 'wrap',
      borderBottom: `1px solid ${t.border}` }}>
      <div style={{ flex: '1 1 220px', minWidth: 180 }}>
        <div style={{ fontWeight: 600, color: t.text, fontSize: 14 }}>{m.libelle_abill || '(libellé inconnu)'}</div>
        <div style={{ fontSize: 12, color: t.textMuted }}>
          {!String(m.abill_product_id).startsWith('lib:') && (
            <span style={{ marginRight: 8 }}>Réf. caisse : {m.abill_product_id}</span>
          )}
          {aMapper && <span style={{ color: t.danger, fontWeight: 700 }}>à mapper</span>}
          {ignore && <span style={{ fontWeight: 700 }}>ignoré</span>}
        </div>
      </div>
      <select
        value={ignore ? '__ignorer' : (m.menu_item_id || '')}
        onChange={(e) => onChoisir(m, e.target.value)}
        style={{ flex: '1 1 240px', maxWidth: 320, padding: '8px 10px', borderRadius: 8, fontSize: 13,
          border: `1px solid ${aMapper ? t.danger + '88' : t.border}`, background: t.surface, color: t.text }}>
        <option value="">— À mapper —</option>
        <option value="__ignorer">Ignorer (hors ventes : pourboire, divers…)</option>
        {menuItems.map((mi) => (
          <option key={mi.id} value={mi.id}>{mi.name}{mi.category ? ` (${mi.category})` : ''}</option>
        ))}
      </select>
    </div>
  );
}

export default function VentesModule({ t }) {
  const [mappings, setMappings] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [imports, setImports] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [onglet, setOnglet] = useState('mapping');
  const [filtre, setFiltre] = useState('');
  const [ajoutId, setAjoutId] = useState('');
  const [ajoutLibelle, setAjoutLibelle] = useState('');
  const [info, setInfo] = useState('');

  const charger = async () => {
    const [mp, mi, im] = await Promise.all([
      supabase.from('abill_item_mapping').select('*').order('updated_at', { ascending: false }),
      supabase.from('menu_items').select('id,name,category,recipe_id').order('name'),
      supabase.from('sales_imports').select('*').order('created_at', { ascending: false }).limit(50),
    ]);
    const err = mp.error || mi.error || im.error;
    if (err) { setErreur(err.message); setChargement(false); return; }
    setMappings(mp.data || []); setMenuItems(mi.data || []); setImports(im.data || []);
    setChargement(false);
  };

  useEffect(() => {
    (async () => { await charger(); })();
  }, []);

  const importTermine = async (message) => {
    setErreur('');
    await charger();
    setInfo(message);
  };

  const aMapper = useMemo(() => mappings.filter((m) => m.cible_type === 'a_mapper').length, [mappings]);

  const visibles = useMemo(() => {
    const f = filtre.trim().toLowerCase();
    const liste = f
      ? mappings.filter((m) => (m.libelle_abill || '').toLowerCase().includes(f) || String(m.abill_product_id).includes(f))
      : mappings;
    // Les « à mapper » d'abord : c'est le travail à faire.
    return [...liste].sort((a, b) => (a.cible_type === 'a_mapper' ? 0 : 1) - (b.cible_type === 'a_mapper' ? 0 : 1));
  }, [mappings, filtre]);

  // Choix d'une cible : l'article de carte porte déjà sa recette, on recopie
  // recipe_id pour que le moteur ventes n'ait pas à re-joindre menu_items.
  const choisir = async (m, valeur) => {
    setInfo('');
    let champs;
    if (valeur === '__ignorer') {
      champs = { cible_type: 'ignorer', menu_item_id: null, recipe_id: null };
    } else if (valeur === '') {
      champs = { cible_type: 'a_mapper', menu_item_id: null, recipe_id: null };
    } else {
      const mi = menuItems.find((x) => x.id === valeur);
      if (!mi) return;
      champs = {
        cible_type: mi.category === 'Menus' ? 'menu' : (mi.recipe_id ? 'recette' : 'produit'),
        menu_item_id: mi.id,
        recipe_id: mi.recipe_id || null,
      };
    }
    const { error } = await supabase.from('abill_item_mapping')
      .update({ ...champs, updated_at: new Date().toISOString() }).eq('id', m.id);
    if (error) { setErreur(error.message); return; }
    setMappings((prev) => prev.map((x) => (x.id === m.id ? { ...x, ...champs } : x)));
  };

  // Ajout manuel : utile avant le premier import (préparer le mapping), ou pour
  // un article vu sur un ticket papier. L'import API créera les siens tout seul.
  const ajouter = async () => {
    setInfo(''); setErreur('');
    const id = ajoutId.trim();
    if (!id) { setErreur('L’identifiant Abill est obligatoire.'); return; }
    if (mappings.some((m) => m.abill_product_id === id)) { setErreur(`L’id Abill ${id} existe déjà dans la liste.`); return; }
    const { data, error } = await supabase.from('abill_item_mapping')
      .insert({ abill_product_id: id, libelle_abill: ajoutLibelle.trim() || null })
      .select('*').single();
    if (error) { setErreur(error.message); return; }
    setMappings((prev) => [data, ...prev]);
    setAjoutId(''); setAjoutLibelle('');
    setInfo(`Article Abill ${id} ajouté, à mapper ci-dessous.`);
  };

  if (chargement) return <div style={{ padding: 40, textAlign: 'center', color: t.textMuted }}>Chargement des ventes…</div>;

  const inputStyle = { padding: '8px 10px', borderRadius: 8, fontSize: 13, border: `1px solid ${t.border}`,
    background: t.surface, color: t.text };

  return (
    <div>
      <Onglets t={t} actif={onglet} setActif={setOnglet} items={[
        { id: 'mapping', label: 'Mapping Abill', badge: aMapper },
        { id: 'imports', label: `Imports (${imports.length})` },
      ]} />

      {erreur && (
        <Carte t={t} style={{ borderColor: t.danger + '55', background: t.danger + '08', marginBottom: 14 }}>
          <div style={{ color: t.danger, fontWeight: 600 }}>Erreur : {erreur}</div>
        </Carte>
      )}
      {info && (
        <Carte t={t} style={{ borderColor: t.success + '55', background: t.success + '08', marginBottom: 14 }}>
          <div style={{ color: t.success, fontWeight: 600 }}>{info}</div>
        </Carte>
      )}

      {onglet === 'mapping' && (
        <>
          <Carte t={t} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 13, color: t.textMuted, lineHeight: 1.5 }}>
              Chaque article vendu chez Abill (caisse, Uber Eats, Deliveroo, site) doit pointer vers un article
              de la carte pour que les ventes alimentent les coûts, les marges et bientôt le stock.
              Les articles inconnus détectés à l’import arriveront ici tout seuls, marqués « à mapper ».
            </div>
          </Carte>

          <Carte t={t} style={{ marginBottom: 14 }}>
            <div style={{ fontWeight: 700, color: t.text, marginBottom: 10, fontSize: 14 }}>Ajouter un article Abill à la main</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input value={ajoutId} onChange={(e) => setAjoutId(e.target.value)} placeholder="Id produit Abill"
                style={{ ...inputStyle, flex: '0 1 160px' }} />
              <input value={ajoutLibelle} onChange={(e) => setAjoutLibelle(e.target.value)} placeholder="Libellé (facultatif)"
                style={{ ...inputStyle, flex: '1 1 220px' }} />
              <button onClick={ajouter} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: t.primary, color: '#fff', fontWeight: 600, fontSize: 13 }}>Ajouter</button>
            </div>
          </Carte>

          <Carte t={t}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
              <div style={{ fontWeight: 700, color: t.text, fontSize: 14, flex: 1 }}>
                Articles Abill ({mappings.length}{aMapper > 0 ? `, dont ${aMapper} à mapper` : ''})
              </div>
              <input value={filtre} onChange={(e) => setFiltre(e.target.value)} placeholder="Filtrer…"
                style={{ ...inputStyle, flex: '0 1 200px' }} />
            </div>
            {visibles.length === 0 && (
              <div style={{ padding: '18px 0', color: t.textMuted, fontSize: 13 }}>
                {mappings.length === 0
                  ? 'Aucun article Abill pour le moment : la liste se remplira au premier import de tickets (onglet Imports).'
                  : 'Aucun article ne correspond au filtre.'}
              </div>
            )}
            {visibles.map((m) => (
              <LigneMapping key={m.id} m={m} menuItems={menuItems} t={t} onChoisir={choisir} />
            ))}
          </Carte>
        </>
      )}

      {onglet === 'imports' && (
        <>
        <ImportFichier t={t} mappings={mappings} onTermine={importTermine} />
        <Carte t={t}>
          <div style={{ fontWeight: 700, color: t.text, marginBottom: 10, fontSize: 14 }}>Journal des imports</div>
          {imports.length === 0 && (
            <div style={{ padding: '14px 0', color: t.textMuted, fontSize: 13, lineHeight: 1.5 }}>
              Aucun import pour le moment. Chaque import est tracé : période couverte, tickets,
              lignes, doublons écartés.
            </div>
          )}
          {imports.map((im) => (
            <div key={im.id} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center',
              padding: '10px 0', borderBottom: `1px solid ${t.border}`, fontSize: 13 }}>
              <span style={{ fontWeight: 700, color: t.text }}>
                {im.meta?.format === 'export_tickets_abill' ? 'Fichier Abill' : im.source}
              </span>
              <span style={{ color: t.textMuted }}>{dateFr(im.periode_debut)} → {dateFr(im.periode_fin)}</span>
              <span style={{ color: t.text }}>{im.nb_tickets} tickets, {im.nb_lignes} lignes</span>
              {im.meta?.total_ttc != null && <span style={{ color: t.text, fontWeight: 600 }}>{euros(im.meta.total_ttc)}</span>}
              {im.nb_doublons > 0 && <span style={{ color: t.warning }}>{im.nb_doublons} doublons écartés</span>}
              <span style={{ color: t.textMuted, marginLeft: 'auto' }}>{dateFr(im.created_at)}</span>
            </div>
          ))}
        </Carte>
        </>
      )}
    </div>
  );
}
