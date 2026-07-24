import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  CANAUX, SETTINGS_DEFAUT, grouperLignesParRecette, coutArticle, resumeArticle,
  rentabiliteCanal, prixCanal, prixEquivalence, prixConseille, couleurFoodCost, couleurMarge,
  suggestionRattachement,
} from '../lib/rentabilite.js';

const eur = (n) => (n === null || n === undefined ? '—' : `${Number(n).toFixed(2)} €`);
const pct = (n) => (n === null || n === undefined ? '—' : `${Number(n).toFixed(0)} %`);

export default function RentabiliteCarteModule({ t, products = [], productSuppliers = [] }) {
  const [menuItems, setMenuItems] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [lignes, setLignes] = useState([]);
  const [channelPrices, setChannelPrices] = useState([]);
  const [settings, setSettings] = useState(SETTINGS_DEFAUT);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [ouvert, setOuvert] = useState(null); // id de menu_item ou null
  const [recherche, setRecherche] = useState('');

  const recharger = async () => {
    const [mi, rc, rl, cp, st] = await Promise.all([
      supabase.from('menu_items').select('id,name,price,category,recipe_id,recipe_qty').order('name'),
      supabase.from('recipes').select('*'),
      supabase.from('recipe_lines').select('*'),
      supabase.from('menu_item_channel_prices').select('*'),
      supabase.from('rentabilite_settings').select('*').eq('id', 1).maybeSingle(),
    ]);
    const err = mi.error || rc.error || rl.error || cp.error || st.error;
    if (err) { setErreur(err.message); setChargement(false); return; }
    setMenuItems(mi.data || []);
    setRecipes(rc.data || []);
    setLignes(rl.data || []);
    setChannelPrices(cp.data || []);
    if (st.data) setSettings({ ...SETTINGS_DEFAUT, ...st.data });
    setChargement(false);
  };
  useEffect(() => { recharger(); }, []);

  const recettesById = useMemo(() => Object.fromEntries(recipes.map((r) => [r.id, r])), [recipes]);
  const lignesByRecette = useMemo(() => grouperLignesParRecette(lignes), [lignes]);
  const coutDe = (item) => coutArticle({ menuItem: item, recettesById, lignesByRecette, produits: products, productSuppliers }).total;

  const majRattachement = async (itemId, recipeId, qty) => {
    const { error } = await supabase.from('menu_items').update({ recipe_id: recipeId, recipe_qty: recipeId ? (Number(qty) || 1) : null }).eq('id', itemId);
    if (error) { setErreur(error.message); return; } await recharger();
  };
  const majPrixCanal = async (itemId, canalId, valeur) => {
    const prix = Number(valeur);
    const existante = channelPrices.find((c) => c.menu_item_id === itemId && c.channel === canalId);
    if (valeur === '' || Number.isNaN(prix)) {
      if (existante) { const { error } = await supabase.from('menu_item_channel_prices').delete().eq('id', existante.id); if (error) { setErreur(error.message); return; } }
    } else if (existante) {
      const { error } = await supabase.from('menu_item_channel_prices').update({ price_ttc: prix }).eq('id', existante.id); if (error) { setErreur(error.message); return; }
    } else {
      const { error } = await supabase.from('menu_item_channel_prices').insert({ menu_item_id: itemId, channel: canalId, price_ttc: prix }); if (error) { setErreur(error.message); return; }
    }
    await recharger();
  };
  const majSettings = async (champ, valeur) => {
    const maj = { ...settings, [champ]: valeur };
    setSettings(maj);
    await supabase.from('rentabilite_settings').update({ tva: maj.tva, seuil_food_cost: maj.seuil_food_cost, commissions: maj.commissions }).eq('id', 1);
  };

  const coul = (nom) => ({ success: t.success, warning: t.warning, danger: t.danger }[nom] || t.textMuted);

  if (chargement) return <div style={{ padding: 24, color: t.textMuted }}>Chargement…</div>;
  if (erreur) return <div style={{ padding: 24, color: t.danger }}>Erreur : {erreur}</div>;

  // ---------- Vue liste ----------
  if (!ouvert) {
    const visibles = menuItems
      .filter((m) => m.name.toLowerCase().includes(recherche.toLowerCase()))
      .map((m) => {
        const cout = coutDe(m);
        const r = resumeArticle({ prixTTC: m.price, cout, tva: settings.tva });
        return { m, cout, ...r };
      })
      .sort((a, b) => (b.foodCostPct ?? -1) - (a.foodCostPct ?? -1)); // pires food cost en premier, "à compléter" en bas

    return (
      <div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 14 }}>
          <h2 style={{ flex: 1, fontSize: 18, fontWeight: 800, margin: 0 }}>Rentabilité par article</h2>
          <input value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Rechercher…"
            style={{ padding: '8px 12px', borderRadius: 8, border: `1px solid ${t.border}`, fontSize: 13 }} />
        </div>

        <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 12, padding: 12, marginBottom: 14, display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', fontSize: 13 }}>
          <label>TVA % <input type="number" value={settings.tva} onChange={(e) => majSettings('tva', Number(e.target.value))} style={{ width: 56, marginLeft: 6, padding: 5, borderRadius: 6, border: `1px solid ${t.border}` }} /></label>
          <label>Seuil food cost % <input type="number" value={settings.seuil_food_cost} onChange={(e) => majSettings('seuil_food_cost', Number(e.target.value))} style={{ width: 56, marginLeft: 6, padding: 5, borderRadius: 6, border: `1px solid ${t.border}` }} /></label>
          {CANAUX.filter((c) => c.id !== 'sur_place').map((c) => (
            <label key={c.id}>{c.nom} % <input type="number" value={settings.commissions?.[c.id] ?? 0}
              onChange={(e) => majSettings('commissions', { ...settings.commissions, [c.id]: Number(e.target.value) })}
              style={{ width: 52, marginLeft: 6, padding: 5, borderRadius: 6, border: `1px solid ${t.border}` }} /></label>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {visibles.map(({ m, cout, marge, foodCostPct }) => {
            const sugg = !m.recipe_id ? suggestionRattachement(m.name, recipes) : null;
            return (
              <div key={m.id} style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 12, padding: '11px 14px' }}>
                <div onClick={() => m.recipe_id && setOuvert(m.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: m.recipe_id ? 'pointer' : 'default' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{m.name}</div>
                    {m.recipe_id
                      ? <div style={{ fontSize: 12, color: t.primary }}>Recette : {recettesById[m.recipe_id]?.nom || '?'} × {m.recipe_qty}</div>
                      : <div style={{ fontSize: 12, color: t.warning, fontWeight: 600 }}>à compléter</div>}
                  </div>
                  <div style={{ textAlign: 'right', minWidth: 54 }}><div style={{ fontSize: 12, color: t.textMuted }}>PV</div><b style={{ fontSize: 13 }}>{eur(m.price)}</b></div>
                  <div style={{ textAlign: 'right', minWidth: 54 }}><div style={{ fontSize: 12, color: t.textMuted }}>coût</div><b style={{ fontSize: 13 }}>{eur(cout)}</b></div>
                  <div style={{ textAlign: 'right', minWidth: 54 }}><div style={{ fontSize: 12, color: t.textMuted }}>marge</div><b style={{ fontSize: 13 }}>{eur(marge)}</b></div>
                  <span style={{ fontWeight: 800, fontSize: 13, borderRadius: 999, padding: '2px 9px', minWidth: 46, textAlign: 'center', color: '#fff', background: foodCostPct == null ? t.textMuted : coul(couleurFoodCost(foodCostPct, settings.seuil_food_cost)) }}>{pct(foodCostPct)}</span>
                </div>
                {/* rattachement */}
                <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {sugg && (
                    <div style={{ fontSize: 12, background: t.primary + '14', borderRadius: 8, padding: '5px 10px' }}>
                      💡 {m.name} → <b>{sugg.recette.nom}</b> × {sugg.qty}
                      <button onClick={() => majRattachement(m.id, sugg.recette.id, sugg.qty)} style={{ marginLeft: 8, background: t.primary, color: '#fff', border: 'none', borderRadius: 6, padding: '3px 9px', cursor: 'pointer', fontSize: 12 }}>Valider</button>
                    </div>
                  )}
                  <RattachementManuel t={t} recipes={recipes} item={m} onSet={majRattachement} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ---------- Vue détail par canal ----------
  const item = menuItems.find((m) => m.id === ouvert);
  const cout = coutDe(item);
  const conseilCanaux = CANAUX.map((c) => {
    const rc = rentabiliteCanal({ item: { id: item.id, price: item.price }, channelPrices, cout: cout || 0, settings, canalId: c.id });
    const equiv = c.id === 'sur_place' ? null : prixEquivalence(prixCanal(item, channelPrices, 'sur_place'), rc.commission);
    const prixSaisi = channelPrices.find((x) => x.menu_item_id === item.id && x.channel === c.id);
    return { c, rc, equiv, prixSaisi };
  });

  return (
    <div>
      <button onClick={() => setOuvert(null)} style={{ background: 'none', border: 'none', color: t.primary, fontWeight: 700, cursor: 'pointer', padding: 0, marginBottom: 10 }}>← Retour à la carte</button>
      <h2 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 2px' }}>{item.name}</h2>
      <div style={{ fontSize: 13, color: t.textMuted, marginBottom: 14 }}>
        Recette {recettesById[item.recipe_id]?.nom} × {item.recipe_qty} · coût matière <b>{eur(cout)}</b> · prix de référence {eur(item.price)}
      </div>

      {conseilCanaux.map(({ c, rc, equiv, prixSaisi }) => (
        <div key={c.id} style={{ border: `1px solid ${t.border}`, borderRadius: 12, padding: 12, marginBottom: 9, background: t.surface }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
            <span style={{ fontWeight: 700, fontSize: 13, flex: 1 }}>{c.nom}</span>
            <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 999, padding: '2px 8px', background: rc.commission > 0 ? '#eef2ff' : '#e5e7eb', color: rc.commission > 0 ? '#4338ca' : '#374151' }}>{rc.commission} % commission</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '3px 12px', fontSize: 12 }}>
            <span style={{ color: t.textMuted }}>Prix de vente TTC</span>
            <span style={{ textAlign: 'right' }}>
              {c.id === 'sur_place' ? eur(item.price) : (
                <input type="number" step="0.1" min="0" defaultValue={prixSaisi ? prixSaisi.price_ttc : ''} placeholder={eur(prixCanal(item, channelPrices, c.id))}
                  onBlur={(e) => majPrixCanal(item.id, c.id, e.target.value)} style={{ width: 78, padding: 4, borderRadius: 6, border: `1px solid ${t.border}`, textAlign: 'right' }} />
              )}
            </span>
            {rc.commission > 0 && (<><span style={{ color: t.textMuted }}>La plateforme prend</span><span style={{ textAlign: 'right' }}>− {eur(rc.prixTTC * rc.commission / 100)}</span></>)}
            <span style={{ color: t.textMuted }}>Tu encaisses (HT)</span><span style={{ textAlign: 'right' }}>{eur(rc.prixEncaisseHT)}</span>
          </div>
          <div style={{ marginTop: 7, paddingTop: 7, borderTop: `1px dashed ${t.border}`, display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ color: t.textMuted, fontSize: 12 }}>Marge</span>
            <b style={{ fontSize: 15 }}>{eur(rc.margeNette)}</b>
            <span style={{ fontSize: 12, fontWeight: 700, borderRadius: 999, padding: '1px 8px', color: '#fff', background: coul(couleurMarge(rc.margeNettePct)) }}>{pct(rc.margeNettePct)}</span>
          </div>
          {rc.commission > 0 && equiv !== null && (
            <div style={{ marginTop: 6, fontSize: 12, color: '#3730a3', background: t.primary + '14', borderRadius: 7, padding: '6px 9px' }}>
              💡 Pour tenir ta marge du sur-place, vends-le <b>{eur(equiv)}</b>.
              <button onClick={() => majPrixCanal(item.id, c.id, String(equiv))} style={{ marginLeft: 8, color: t.primary, fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer' }}>Appliquer</button>
            </div>
          )}
        </div>
      ))}

      <Simulateur t={t} cout={cout || 0} settings={settings} />
    </div>
  );
}

function RattachementManuel({ t, recipes, item, onSet }) {
  const [rid, setRid] = useState(item.recipe_id || '');
  const [qty, setQty] = useState(item.recipe_qty || 1);
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
      <select value={rid} onChange={(e) => setRid(e.target.value)} style={{ padding: 5, borderRadius: 6, border: `1px solid ${t.border}` }}>
        <option value="">— recette —</option>
        {recipes.filter((r) => !r.sous_recette_seulement).map((r) => <option key={r.id} value={r.id}>{r.nom}</option>)}
      </select>
      <span>×</span>
      <input type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} style={{ width: 50, padding: 5, borderRadius: 6, border: `1px solid ${t.border}`, textAlign: 'right' }} />
      <button onClick={() => onSet(item.id, rid || null, qty)} style={{ background: '#fff', color: t.primary, border: `1px solid ${t.primary}`, borderRadius: 6, padding: '4px 9px', cursor: 'pointer' }}>{item.recipe_id ? 'Modifier' : 'Rattacher'}</button>
      {item.recipe_id && <button onClick={() => onSet(item.id, null, null)} style={{ background: 'none', border: 'none', color: t.danger, cursor: 'pointer' }}>détacher</button>}
    </div>
  );
}

function Simulateur({ t, cout, settings }) {
  const [marge, setMarge] = useState(70);
  const [canal, setCanal] = useState('uber_eats');
  const commission = Number(settings.commissions?.[canal]) || 0;
  const conseil = prixConseille(cout, marge, commission, settings.tva);
  return (
    <div style={{ marginTop: 12, padding: 12, border: `1px solid ${t.border}`, borderRadius: 12, background: t.surface }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 8px' }}>Simulateur — quel prix pour quelle marge ?</h3>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
        <label>Marge nette cible : <b>{marge} %</b><br /><input type="range" min="30" max="90" value={marge} onChange={(e) => setMarge(Number(e.target.value))} style={{ width: 160 }} /></label>
        <label>Canal<br /><select value={canal} onChange={(e) => setCanal(e.target.value)} style={{ padding: 5, borderRadius: 6, border: `1px solid ${t.border}` }}>
          {CANAUX.map((c) => <option key={c.id} value={c.id}>{c.nom} · {settings.commissions?.[c.id] ?? 0} %</option>)}
        </select></label>
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <div style={{ fontSize: 12, color: t.textMuted }}>Prix TTC conseillé</div>
          <b style={{ fontSize: 20, color: t.primary }}>{conseil === null ? '—' : eur(conseil)}</b>
        </div>
      </div>
    </div>
  );
}
