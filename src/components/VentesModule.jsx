import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';

// ============================================================================
// Phase 2 du chantier Kimiko Pilotage : module Ventes (spec maître §15-16).
// Onglet Mapping : associer chaque article Abill à un article de la carte.
// Onglet Imports : journal des imports de tickets (API / CSV).
// Les tickets eux-mêmes arriveront quand l'API Abill sera souscrite.
// ============================================================================

const dateFr = (iso) => (iso ? new Date(iso).toLocaleDateString('fr-FR') : '—');

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
          id Abill : {m.abill_product_id}
          {aMapper && <span style={{ marginLeft: 8, color: t.danger, fontWeight: 700 }}>à mapper</span>}
          {ignore && <span style={{ marginLeft: 8, color: t.textMuted, fontWeight: 700 }}>ignoré</span>}
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

  useEffect(() => {
    (async () => {
      const [mp, mi, im] = await Promise.all([
      supabase.from('abill_item_mapping').select('*').order('updated_at', { ascending: false }),
      supabase.from('menu_items').select('id,name,category,recipe_id').order('name'),
      supabase.from('sales_imports').select('*').order('created_at', { ascending: false }).limit(50),
      ]);
      const err = mp.error || mi.error || im.error;
      if (err) { setErreur(err.message); setChargement(false); return; }
      setMappings(mp.data || []); setMenuItems(mi.data || []); setImports(im.data || []);
      setChargement(false);
    })();
  }, []);

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
                  ? 'Aucun article Abill pour le moment : la liste se remplira au premier import de tickets.'
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
        <Carte t={t}>
          <div style={{ fontWeight: 700, color: t.text, marginBottom: 10, fontSize: 14 }}>Journal des imports</div>
          {imports.length === 0 && (
            <div style={{ padding: '14px 0', color: t.textMuted, fontSize: 13, lineHeight: 1.5 }}>
              Aucun import pour le moment. Les tickets arriveront ici quand l’API Abill sera souscrite
              (ou par import de fichier en secours). Chaque import est tracé : période couverte, tickets,
              lignes, doublons écartés.
            </div>
          )}
          {imports.map((im) => (
            <div key={im.id} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center',
              padding: '10px 0', borderBottom: `1px solid ${t.border}`, fontSize: 13 }}>
              <span style={{ fontWeight: 700, color: t.text }}>{im.source}</span>
              <span style={{ color: t.textMuted }}>{dateFr(im.periode_debut)} → {dateFr(im.periode_fin)}</span>
              <span style={{ color: t.text }}>{im.nb_tickets} tickets, {im.nb_lignes} lignes</span>
              {im.nb_doublons > 0 && <span style={{ color: t.warning }}>{im.nb_doublons} doublons écartés</span>}
              <span style={{ color: t.textMuted, marginLeft: 'auto' }}>{dateFr(im.created_at)}</span>
            </div>
          ))}
        </Carte>
      )}
    </div>
  );
}
