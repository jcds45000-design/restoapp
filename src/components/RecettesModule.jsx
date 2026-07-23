import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { grouperLignesParRecette, coutRecette, resumeRecettes } from '../lib/rentabilite.js';

const UNITES_RENDEMENT = ['piece', 'portion', 'kg', 'l'];
const eur = (n) => (n === null || n === undefined ? '—' : `${Number(n).toFixed(2)} €`);

export default function RecettesModule({ t, products = [], productSuppliers = [] }) {
  const [recettes, setRecettes] = useState([]);
  const [lignes, setLignes] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [ouvert, setOuvert] = useState(null); // id de recette, 'new', ou null

  const recharger = async () => {
    const [r1, r2] = await Promise.all([
      supabase.from('recipes').select('*').order('nom'),
      supabase.from('recipe_lines').select('*'),
    ]);
    if (r1.error || r2.error) { setErreur((r1.error || r2.error).message); setChargement(false); return; }
    setRecettes(r1.data || []);
    setLignes(r2.data || []);
    setChargement(false);
  };
  useEffect(() => { recharger(); }, []);

  const lignesByRecette = useMemo(() => grouperLignesParRecette(lignes), [lignes]);
  const resume = useMemo(
    () => resumeRecettes(recettes, lignesByRecette, products, productSuppliers),
    [recettes, lignesByRecette, products, productSuppliers]
  );

  if (chargement) return <div style={{ padding: 24, color: t.textMuted }}>Chargement…</div>;
  if (erreur) return <div style={{ padding: 24, color: t.danger }}>Erreur : {erreur}</div>;

  if (ouvert) {
    return <EditeurRecette t={t} products={products} productSuppliers={productSuppliers}
      recettes={recettes} lignesByRecette={lignesByRecette}
      recetteId={ouvert === 'new' ? null : ouvert}
      onFerme={() => setOuvert(null)} onChange={recharger} />;
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <h2 style={{ flex: 1, fontSize: 18, fontWeight: 800, margin: 0 }}>Recettes</h2>
        <button onClick={() => setOuvert('new')}
          style={{ background: t.primary, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontWeight: 600, cursor: 'pointer' }}>
          + Nouvelle recette
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {resume.map(({ recette, coutParUnite, incomplet }) => (
          <button key={recette.id} onClick={() => setOuvert(recette.id)}
            style={{ textAlign: 'left', cursor: 'pointer', background: t.surface, border: `1px solid ${t.border}`, borderRadius: 12, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{recette.nom}</div>
              <div style={{ fontSize: 12, color: t.textMuted }}>
                rendement {recette.rendement_valeur} {recette.rendement_unite}
                {recette.sous_recette_seulement ? ' · sous-recette' : ''}
              </div>
            </div>
            {incomplet && <span style={{ fontSize: 12, color: t.warning, fontWeight: 700 }}>coût incomplet</span>}
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{eur(coutParUnite)}</div>
              <div style={{ fontSize: 11, color: t.textMuted }}>/ {recette.rendement_unite}</div>
            </div>
          </button>
        ))}
        {resume.length === 0 && <div style={{ color: t.textMuted, fontSize: 13 }}>Aucune recette. Crée la première.</div>}
      </div>
    </div>
  );
}

function EditeurRecette({ t, products, productSuppliers, recettes, lignesByRecette, recetteId, onFerme, onChange }) {
  const existante = recettes.find((r) => r.id === recetteId) || null;
  const [nom, setNom] = useState(existante?.nom || '');
  const [rv, setRv] = useState(existante?.rendement_valeur ?? 1);
  const [ru, setRu] = useState(existante?.rendement_unite || 'piece');
  const [sousSeule, setSousSeule] = useState(existante?.sous_recette_seulement || false);
  const [msg, setMsg] = useState('');

  const lignesCourantes = recetteId ? (lignesByRecette[recetteId] || []) : [];
  const recettesById = Object.fromEntries(recettes.map((r) => [r.id, r]));

  const enregistrerRecette = async () => {
    const payload = { nom: nom.trim(), rendement_valeur: Number(rv), rendement_unite: ru, sous_recette_seulement: sousSeule };
    if (!payload.nom) { setMsg('Le nom est requis.'); return; }
    if (recetteId) {
      const { error } = await supabase.from('recipes').update(payload).eq('id', recetteId);
      if (error) { setMsg(error.message); return; }
      await onChange();
      setMsg('Enregistré.');
    } else {
      const { error } = await supabase.from('recipes').insert(payload).select().single();
      if (error) { setMsg(error.message); return; }
      await onChange();
      onFerme(); // après création, retour à la liste
    }
  };

  const ajouterLigneProduit = async (productId) => {
    if (!recetteId) { setMsg('Enregistre d\'abord la recette, puis ajoute les lignes.'); return; }
    const prod = products.find((p) => (p._uuid ?? p.id) === productId);
    const u = (prod?.unit || '').toLowerCase();
    const unit = u === 'kg' ? 'g' : u === 'l' ? 'ml' : 'piece';
    const { error } = await supabase.from('recipe_lines').insert({ recipe_id: recetteId, product_id: productId, qty: 1, unit });
    if (error) { setMsg(error.message); return; } await onChange();
  };
  const ajouterLigneSousRecette = async (sousId) => {
    if (!recetteId) { setMsg('Enregistre d\'abord la recette.'); return; }
    const sous = recettesById[sousId];
    const { error } = await supabase.from('recipe_lines').insert({ recipe_id: recetteId, sous_recette_id: sousId, qty: 1, unit: sous.rendement_unite });
    if (error) { setMsg(error.message); return; } await onChange();
  };
  const majLigne = async (ligneId, champs) => {
    const { error } = await supabase.from('recipe_lines').update(champs).eq('id', ligneId);
    if (error) { setMsg(error.message); return; } await onChange();
  };
  const retirerLigne = async (ligneId) => {
    const { error } = await supabase.from('recipe_lines').delete().eq('id', ligneId);
    if (error) { setMsg(error.message); return; } await onChange();
  };

  const recetteVirtuelle = { ...(existante || {}), id: recetteId, rendement_valeur: Number(rv) };
  const cout = recetteId
    ? coutRecette({ recette: recetteVirtuelle, recettesById: { ...recettesById, [recetteId]: recetteVirtuelle }, lignesByRecette, produits: products, productSuppliers })
    : { total: 0, coutParUnite: null, incomplet: true, raisons: [] };

  const label = (l) => l.product_id
    ? (products.find((p) => (p._uuid ?? p.id) === l.product_id)?.name || 'produit supprimé')
    : (recettesById[l.sous_recette_id]?.nom || 'recette supprimée');

  return (
    <div>
      <button onClick={onFerme} style={{ background: 'none', border: 'none', color: t.primary, fontWeight: 700, cursor: 'pointer', padding: 0, marginBottom: 10 }}>← Retour aux recettes</button>
      <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: 16, marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Nom de la recette"
            style={{ flex: 1, minWidth: 160, padding: 8, borderRadius: 8, border: `1px solid ${t.border}`, fontSize: 15, fontWeight: 700 }} />
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <input type="checkbox" checked={sousSeule} onChange={(e) => setSousSeule(e.target.checked)} /> Sous-recette seulement
          </label>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10, fontSize: 13, color: t.textMuted, flexWrap: 'wrap' }}>
          Rendement
          <input type="number" value={rv} onChange={(e) => setRv(e.target.value)} style={{ width: 70, padding: 6, borderRadius: 8, border: `1px solid ${t.border}`, textAlign: 'right' }} />
          <select value={ru} onChange={(e) => setRu(e.target.value)} style={{ padding: 6, borderRadius: 8, border: `1px solid ${t.border}` }}>
            {UNITES_RENDEMENT.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
          <button onClick={enregistrerRecette} style={{ marginLeft: 'auto', background: t.primary, color: '#fff', border: 'none', borderRadius: 8, padding: '7px 13px', fontWeight: 600, cursor: 'pointer' }}>Enregistrer</button>
        </div>
        {msg && <div style={{ marginTop: 8, fontSize: 12, color: t.textMuted }}>{msg}</div>}
      </div>

      {recetteId ? (
        <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: 16 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 10px' }}>Ingrédients &amp; sous-recettes</h3>
          {lignesCourantes.map((l) => (
            <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: `1px solid ${t.border}` }}>
              <div style={{ flex: 1, fontSize: 14 }}>
                {label(l)}
                {l.sous_recette_id && <span style={{ fontSize: 10, color: t.primary, marginLeft: 6 }}>sous-recette</span>}
                {l.cout_force != null && <span style={{ fontSize: 10, color: t.warning, fontWeight: 700, marginLeft: 6 }}>· forcé</span>}
              </div>
              <input type="number" step="any" defaultValue={l.qty} onBlur={(e) => majLigne(l.id, { qty: Number(e.target.value) })} style={{ width: 74, padding: 5, borderRadius: 7, border: `1px solid ${t.border}`, textAlign: 'right' }} />
              <span style={{ fontSize: 12, color: t.textMuted, width: 40 }}>{l.unit}</span>
              <button onClick={() => { const v = prompt('Coût forcé en € (vide = auto) :', l.cout_force ?? ''); if (v !== null) majLigne(l.id, { cout_force: v === '' ? null : Number(v) }); }}
                style={{ border: `1px solid ${t.border}`, background: '#fff', borderRadius: 7, fontSize: 11, padding: '4px 8px', cursor: 'pointer', color: t.textMuted }}>{l.cout_force != null ? 'auto' : 'forcer'}</button>
              <button onClick={() => retirerLigne(l.id)} style={{ border: 'none', background: 'none', color: t.danger, cursor: 'pointer', fontSize: 16 }}>✕</button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            <select value="" onChange={(e) => { if (e.target.value) { ajouterLigneProduit(e.target.value); e.target.value = ''; } }} style={{ padding: 8, borderRadius: 8, border: `1px solid ${t.border}` }}>
              <option value="">+ Produit du Stock…</option>
              {products.filter((p) => p.active !== false).map((p) => <option key={p._uuid ?? p.id} value={p._uuid ?? p.id}>{p.name} ({p.unit})</option>)}
            </select>
            <select value="" onChange={(e) => { if (e.target.value) { ajouterLigneSousRecette(e.target.value); e.target.value = ''; } }} style={{ padding: 8, borderRadius: 8, border: `1px solid ${t.border}` }}>
              <option value="">+ Sous-recette…</option>
              {recettes.filter((r) => r.id !== recetteId).map((r) => <option key={r.id} value={r.id}>{r.nom}</option>)}
            </select>
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: 18, alignItems: 'baseline', borderTop: `2px solid ${t.border}`, paddingTop: 12, flexWrap: 'wrap' }}>
            <div><div style={{ fontSize: 11, color: t.textMuted }}>COÛT DU BATCH</div><b style={{ fontSize: 18 }}>{eur(cout.total)}</b></div>
            <div><div style={{ fontSize: 11, color: t.textMuted }}>COÛT PAR {String(ru).toUpperCase()}</div><b style={{ fontSize: 18 }}>{eur(cout.coutParUnite)}</b></div>
            {cout.incomplet && <span style={{ color: t.warning, fontSize: 12, fontWeight: 700 }}>incomplet ({[...new Set(cout.raisons)].join(', ')})</span>}
          </div>
        </div>
      ) : (
        <div style={{ color: t.textMuted, fontSize: 13 }}>Enregistre la recette pour pouvoir ajouter ses ingrédients.</div>
      )}
    </div>
  );
}
