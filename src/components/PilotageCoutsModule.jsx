import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { SETTINGS_DEFAUT, couleurFoodCostMatiere, infoPrixIngredient, grouperLignesParRecette,
  prixConseille, arrondi10ctsSup, CANAUX, prixCanal, ttcVersHT } from '../lib/rentabilite.js';
import { etatArticles, alertes as calculAlertes, dashboard as calculDashboard, simuler, recettesUtilisant } from '../lib/pilotage.js';

const eur = (n, d = 2) => (n === null || n === undefined ? '—' : `${Number(n).toFixed(d)} €`);
const pct = (n, d = 1) => (n === null || n === undefined ? '—' : `${Number(n).toFixed(d)} %`);

// Le feu tricolore du food cost matière. Seuils configurables en base.
function Feu({ valeur, settings, t }) {
  const c = couleurFoodCostMatiere(valeur, settings);
  const map = { success: t.success, warning: t.warning, danger: t.danger, neutral: t.textMuted };
  const col = map[c];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 8,
      background: col + '18', color: col, fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap' }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: col }} />
      {pct(valeur)}
    </span>
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

export default function PilotageCoutsModule({ t, products = [], productSuppliers = [] }) {
  const [recipes, setRecipes] = useState([]);
  const [lignes, setLignes] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [packagings, setPackagings] = useState([]);
  const [historique, setHistorique] = useState([]);
  const [channelPrices, setChannelPrices] = useState([]);
  const [liensEmballage, setLiensEmballage] = useState([]);
  const [settings, setSettings] = useState(SETTINGS_DEFAUT);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [onglet, setOnglet] = useState('dashboard');
  const [ouvert, setOuvert] = useState(null);

  // Simulateur : modifications temporaires, jamais écrites en base.
  const [simIngredient, setSimIngredient] = useState('');
  const [simPrix, setSimPrix] = useState('');

  useEffect(() => {
    (async () => {
      const [rc, rl, mi, pk, hi, st, cp, lp] = await Promise.all([
        supabase.from('recipes').select('*'),
        supabase.from('recipe_lines').select('*'),
        supabase.from('menu_items').select('id,name,price,category,recipe_id,recipe_qty,huile_absorbee_g,cout_energie,cout_autres').order('name'),
        supabase.from('packaging').select('*'),
        supabase.from('product_price_history').select('*').order('saisi_le', { ascending: false }).limit(200),
        supabase.from('rentabilite_settings').select('*').eq('id', 1).maybeSingle(),
        supabase.from('menu_item_channel_prices').select('*'),
        supabase.from('menu_item_packaging').select('*'),
      ]);
      const err = rc.error || rl.error || mi.error || pk.error || hi.error || st.error || cp.error || lp.error;
      if (err) { setErreur(err.message); setChargement(false); return; }
      setRecipes(rc.data || []); setLignes(rl.data || []); setMenuItems(mi.data || []);
      setPackagings(pk.data || []); setHistorique(hi.data || []); setChannelPrices(cp.data || []);
      setLiensEmballage(lp.data || []);
      if (st.data) setSettings({ ...SETTINGS_DEFAUT, ...st.data });
      setChargement(false);
    })();
  }, []);

  const base = useMemo(() => ({
    produits: products, productSuppliers, recettes: recipes, lignes,
    packagings, menuItems, historique, settings, liensEmballage,
  }), [products, productSuppliers, recipes, lignes, packagings, menuItems, historique, settings, liensEmballage]);

  const articles = useMemo(() => (chargement ? [] : etatArticles(base)), [base, chargement]);
  const alertes = useMemo(() => (chargement ? [] : calculAlertes(base)), [base, chargement]);
  const dash = useMemo(() => (chargement ? null : calculDashboard(base)), [base, chargement]);
  const lignesByRecette = useMemo(() => grouperLignesParRecette(lignes), [lignes]);

  // Ingrédients réellement utilisés en recette : les seuls qui ont un sens à simuler.
  const ingredientsUtiles = useMemo(() => {
    if (chargement) return [];
    return products
      .filter((p) => recettesUtilisant(p._uuid ?? p.id, recipes, lignesByRecette).toutes.length > 0)
      .map((p) => ({ p, info: infoPrixIngredient(p, productSuppliers, { settings }) }))
      .sort((a, b) => a.p.name.localeCompare(b.p.name));
  }, [products, productSuppliers, recipes, lignesByRecette, settings, chargement]);

  // Usage réel de l'ingrédient sélectionné, calculé même sans simulation :
  // « aucun impact » et « ingrédient inutilisé » sont deux choses différentes.
  const usage = useMemo(() => {
    if (!simIngredient) return null;
    const dep = recettesUtilisant(simIngredient, recipes, lignesByRecette);
    const vendues = recipes.filter((r) => dep.toutes.includes(r.id) && !r.sous_recette_seulement);
    const arts = menuItems.filter((m) => vendues.some((r) => r.id === m.recipe_id));
    const prod = products.find((p) => (p._uuid ?? p.id) === simIngredient) || null;
    const info = prod ? infoPrixIngredient(prod, productSuppliers, { settings }) : null;
    return { nbRecettes: dep.toutes.length, vendues, articles: arts, prod, info };
  }, [simIngredient, recipes, lignesByRecette, menuItems, products, productSuppliers, settings]);

  const simulation = useMemo(() => {
    const prix = Number(simPrix);
    if (!simIngredient || !Number.isFinite(prix) || prix <= 0) return null;
    if (usage && usage.info && usage.info.prix !== null && Number(usage.info.prix) === prix) return null;
    return simuler({ ...base, changements: { prixIngredient: { [simIngredient]: prix } } });
  }, [base, simIngredient, simPrix, usage]);

  if (chargement) return <div style={{ padding: 40, textAlign: 'center', color: t.textMuted }}>Chargement des coûts…</div>;
  if (erreur) return (
    <Carte t={t} style={{ borderColor: t.danger + '55', background: t.danger + '08' }}>
      <div style={{ color: t.danger, fontWeight: 600 }}>Erreur : {erreur}</div>
    </Carte>
  );

  const critiques = alertes.filter((a) => a.niveau === 3).length;
  const tri = [...articles].sort((a, b) => (b.foodCostPct ?? -1) - (a.foodCostPct ?? -1));

  return (
    <div>
      <Onglets t={t} actif={onglet} setActif={setOnglet} items={[
        { id: 'dashboard', label: 'Tableau de bord' },
        { id: 'couts', label: `Coûts (${articles.length})` },
        { id: 'simulateur', label: 'Simulateur' },
        { id: 'alertes', label: 'Alertes', badge: alertes.length },
      ]} />

      {/* ------------------------------------------------ TABLEAU DE BORD */}
      {onglet === 'dashboard' && dash && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 12 }}>
            <Carte t={t}>
              <div style={{ fontSize: 12, color: t.textMuted, fontWeight: 600 }}>FOOD COST MOYEN</div>
              <div style={{ fontSize: 30, fontWeight: 800, color: t.text, margin: '6px 0' }}>
                {dash.foodCostMoyen === null ? '—' : pct(dash.foodCostMoyen)}
              </div>
              <div style={{ fontSize: 12, color: dash.representatif ? t.textMuted : t.warning, fontWeight: dash.representatif ? 400 : 700 }}>
                {dash.nbDansMoyenne} article(s) sur {dash.nbVendusTotal}
                {!dash.representatif && ' — non représentatif'}
              </div>
              <div style={{ fontSize: 11, color: t.textMuted, marginTop: 4, fontStyle: 'italic' }}>
                {dash.methodeFoodCost}
              </div>
            </Carte>
            <Carte t={t}>
              <div style={{ fontSize: 12, color: t.textMuted, fontWeight: 600 }}>COÛT DIRECT MOYEN</div>
              <div style={{ fontSize: 30, fontWeight: 800, color: t.text, margin: '6px 0' }}>{eur(dash.coutDirectMoyen)}</div>
              <div style={{ fontSize: 12, color: t.textMuted }}>matière + emballage</div>
            </Carte>
            <Carte t={t}>
              <div style={{ fontSize: 12, color: t.textMuted, fontWeight: 600 }}>ALERTES</div>
              <div style={{ fontSize: 30, fontWeight: 800, color: critiques > 0 ? t.danger : t.success, margin: '6px 0' }}>{alertes.length}</div>
              <div style={{ fontSize: 12, color: t.textMuted }}>{critiques} critique(s)</div>
            </Carte>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 12 }}>
            <Carte t={t}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Les plus rentables</div>
              {dash.plusRentables.map((x, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: i < 4 ? `1px solid ${t.border}` : 'none' }}>
                  <span style={{ fontSize: 13 }}>{x.nom}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: t.success }}>{eur(x.margeMatiere)}</span>
                </div>
              ))}
            </Carte>
            <Carte t={t}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Les moins rentables</div>
              {dash.moinsRentables.map((x, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: i < 4 ? `1px solid ${t.border}` : 'none' }}>
                  <span style={{ fontSize: 13 }}>{x.nom}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: t.textMuted }}>{eur(x.margeMatiere)}</span>
                </div>
              ))}
            </Carte>
          </div>

          {dash.plusFortesHausses.length > 0 && (
            <Carte t={t}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Dernières évolutions de prix</div>
              {dash.plusFortesHausses.map((h, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0' }}>
                  <span style={{ fontSize: 13 }}>{h.nom}</span>
                  <span style={{ fontSize: 13 }}>
                    <span style={{ color: t.textMuted }}>{eur(h.ancien, 4)} → {eur(h.nouveau, 4)}</span>
                    <span style={{ marginLeft: 10, fontWeight: 700, color: h.variation > 0 ? t.danger : t.success }}>
                      {h.variation > 0 ? '+' : ''}{h.variation.toFixed(1)} %
                    </span>
                  </span>
                </div>
              ))}
            </Carte>
          )}

          {dash.blocagesParFrequence.length > 0 && (
            <Carte t={t} style={{ borderColor: t.warning + '55', background: t.warning + '08' }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>Ce qui empêche de chiffrer</div>
              <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 12 }}>
                Renseigner ces prix débloque le calcul, en commençant par le premier.
              </div>
              {dash.blocagesParFrequence.map((b, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{b.cause}</span>
                  <span style={{ fontSize: 13, color: t.textMuted }}>{b.produits} produit(s)</span>
                </div>
              ))}
            </Carte>
          )}
        </div>
      )}

      {/* ------------------------------------------------ COÛTS */}
      {onglet === 'couts' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tri.length === 0 && <Carte t={t}><div style={{ color: t.textMuted }}>Aucun article rattaché à une recette.</div></Carte>}
          {tri.map((a) => {
            const dep = ouvert === a.articleId;
            return (
              <Carte key={a.articleId} t={t} style={{ padding: 0, overflow: 'hidden' }}>
                <button onClick={() => setOuvert(dep ? null : a.articleId)} style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px',
                  background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', color: t.text,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{a.nom}</div>
                    <div style={{ fontSize: 12, color: t.textMuted, marginTop: 2 }}>
                      {eur(a.prixTTC)} TTC · coût {eur(a.coutMatiere, 4)}
                    </div>
                  </div>
                  <Feu valeur={a.foodCostPct} settings={settings} t={t} />
                </button>

                {dep && (
                  <div style={{ padding: '0 16px 16px', borderTop: `1px solid ${t.border}` }}>
                    {a.incomplet && (
                      <div style={{ margin: '12px 0', padding: 10, borderRadius: 8, background: t.danger + '10', color: t.danger, fontSize: 13, fontWeight: 600 }}>
                        Coût incomplet. Manque : {a.raisons.join(', ')}
                      </div>
                    )}
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 12 }}>
                      <tbody>
                        {[
                          ['Prix de vente TTC', eur(a.prixTTC)],
                          ['Prix de vente HT', eur(a.prixHT)],
                          ['Coût matière', eur(a.coutMatiere, 4)],
                          ['Emballage', eur(a.emballage, 4)],
                          ['Huile absorbée', eur(a.huile, 4)],
                          ['Énergie', eur(a.energie, 4)],
                          ['Autres coûts directs', eur(a.autres, 4)],
                          ['Coût direct total', eur(a.coutDirect, 4)],
                          ['Food cost matière', pct(a.foodCostPct)],
                          ['Ratio coût direct', pct(a.ratioCoutDirectPct)],
                          ['Marge après matière', eur(a.margeMatiere)],
                          ['Marge après coûts directs', eur(a.margeCoutDirect)],
                        ].map(([k, v], i) => (
                          <tr key={i} style={{ borderBottom: `1px solid ${t.border}` }}>
                            <td style={{ padding: '7px 0', color: t.textMuted }}>{k}</td>
                            <td style={{ padding: '7px 0', textAlign: 'right', fontWeight: 600 }}>{v}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div style={{ fontSize: 11, color: t.textMuted, marginTop: 10, fontStyle: 'italic' }}>
                      Le food cost porte sur la matière première seule. L'emballage et l'énergie
                      entrent dans le ratio coût direct, jamais dans le food cost.
                    </div>
                  </div>
                )}
              </Carte>
            );
          })}
        </div>
      )}

      {/* ------------------------------------------------ SIMULATEUR */}
      {onglet === 'simulateur' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Carte t={t}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Et si le prix d'un ingrédient changeait ?</div>
            <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 14 }}>
              Rien n'est enregistré : la simulation reste en mémoire.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, display: 'block', marginBottom: 6 }}>Ingrédient</label>
                <select value={simIngredient} onChange={(e) => {
                  setSimIngredient(e.target.value);
                  const trouve = ingredientsUtiles.find((x) => (x.p._uuid ?? x.p.id) === e.target.value);
                  setSimPrix(trouve && trouve.info.prix !== null ? String(trouve.info.prix) : '');
                }} style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: `1px solid ${t.border}`, background: t.surface, color: t.text, fontSize: 14 }}>
                  <option value="">— Choisir —</option>
                  {ingredientsUtiles.map(({ p, info }) => (
                    <option key={p._uuid ?? p.id} value={p._uuid ?? p.id}>
                      {p.name}{info.prix !== null ? ` (${info.prix} €/${p.unit})` : ' (sans prix)'}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, display: 'block', marginBottom: 6 }}>Nouveau prix</label>
                <input type="number" step="0.01" min="0" value={simPrix} onChange={(e) => setSimPrix(e.target.value)}
                  placeholder="ex : 7.00"
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: `1px solid ${t.border}`, background: t.surface, color: t.text, fontSize: 14 }} />
              </div>
            </div>
          </Carte>

          {usage && (
            <Carte t={t} style={{ background: t.surfaceAlt }}>
              {usage.articles.length > 0 ? (
                <div style={{ fontSize: 13 }}>
                  <b>{usage.prod?.name}</b> entre dans <b>{usage.articles.length} article(s) vendu(s)</b>
                  {usage.nbRecettes > usage.articles.length && ` et ${usage.nbRecettes} recette(s) au total, sous-recettes comprises`} :
                  <span style={{ color: t.textMuted }}> {usage.articles.map((m) => m.name).join(', ')}</span>
                </div>
              ) : (
                <div style={{ fontSize: 13, color: t.warning, fontWeight: 600 }}>
                  {usage.prod?.name} n'entre dans aucun article vendu rattaché à une recette.
                </div>
              )}
              {usage.info && usage.info.prix !== null && (
                <div style={{ fontSize: 12, color: t.textMuted, marginTop: 6 }}>
                  Prix actuel : <b>{usage.info.prix} €</b>
                  {usage.info.source ? ` · source ${usage.info.source}` : ''}
                  {usage.info.perime ? ' · prix ancien' : ''}
                </div>
              )}
            </Carte>
          )}

          {usage && usage.articles.length > 0 && !simulation && (
            <Carte t={t}>
              <div style={{ fontSize: 13, color: t.textMuted }}>
                {usage.info && usage.info.prix !== null && Number(usage.info.prix) === Number(simPrix)
                  ? `Saisissez un prix différent de ${usage.info.prix} € pour voir l'impact.`
                  : `Saisissez un nouveau prix pour voir l'impact.`}
              </div>
            </Carte>
          )}

          {simulation && (
            <Carte t={t}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
                {simulation.nbAffectes} produit(s) affecté(s)
              </div>
              {simulation.impacts.length === 0 && (
                <div style={{ color: t.textMuted, fontSize: 13 }}>
                  Ce changement de prix ne modifie le coût d'aucun produit vendu.
                </div>
              )}
              {simulation.impacts.map((i) => {
                const hausse = (i.delta ?? 0) > 0;
                const col = hausse ? t.danger : t.success;
                // Une ligne par produit : chaque chiffre porte son libellé,
                // sinon le tableau est illisible, surtout sur téléphone.
                const lignes = [
                  ['Coût matière', eur(i.avant.coutMatiere, 4), eur(i.apres.coutMatiere, 4),
                   i.delta === null ? null : `${hausse ? '+' : ''}${i.delta.toFixed(4)} €`],
                  ['Food cost', pct(i.avant.foodCostPct), pct(i.apres.foodCostPct),
                   i.avant.foodCostPct === null || i.apres.foodCostPct === null ? null
                     : `${i.apres.foodCostPct > i.avant.foodCostPct ? '+' : ''}${(i.apres.foodCostPct - i.avant.foodCostPct).toFixed(1)} pt`],
                  ['Marge par vente', eur(i.avant.margeMatiere), eur(i.apres.margeMatiere),
                   i.avant.margeMatiere === null || i.apres.margeMatiere === null ? null
                     : `${i.apres.margeMatiere > i.avant.margeMatiere ? '+' : ''}${(i.apres.margeMatiere - i.avant.margeMatiere).toFixed(2)} €`],
                ];
                return (
                  <div key={i.recetteId} style={{ padding: '12px 0', borderBottom: `1px solid ${t.border}` }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 14, fontWeight: 700 }}>{i.nom}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: col }}>
                        {i.delta === null ? '—' : `${hausse ? '+' : ''}${i.delta.toFixed(4)} € par portion`}
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: col }}>
                        {i.deltaPct === null ? '' : `(${i.deltaPct > 0 ? '+' : ''}${i.deltaPct.toFixed(1)} %)`}
                      </span>
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ color: t.textMuted }}>
                          <th style={{ textAlign: 'left', fontWeight: 600, padding: '2px 0' }}></th>
                          <th style={{ textAlign: 'right', fontWeight: 600, padding: '2px 0' }}>Aujourd'hui</th>
                          <th style={{ textAlign: 'right', fontWeight: 600, padding: '2px 0' }}>Simulé</th>
                          <th style={{ textAlign: 'right', fontWeight: 600, padding: '2px 0' }}>Écart</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lignes.map(([lib, av, ap, ec], k) => (
                          <tr key={k}>
                            <td style={{ padding: '3px 0', color: t.textMuted }}>{lib}</td>
                            <td style={{ padding: '3px 0', textAlign: 'right' }}>{av}</td>
                            <td style={{ padding: '3px 0', textAlign: 'right', fontWeight: 600 }}>{ap}</td>
                            <td style={{ padding: '3px 0', textAlign: 'right', fontWeight: 700, color: ec ? col : t.textMuted }}>{ec || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {/* Quel prix pratiquer pour encaisser la hausse ? Deux logiques
                        distinctes : garder le même euro de marge, ou garder le même
                        pourcentage de food cost. La seconde est plus exigeante. */}
                    {i.avant.coutMatiere !== null && i.apres.coutMatiere !== null && (() => {
                      const art = menuItems.find((m) => m.recipe_id === i.recetteId);
                      if (!art) return null;
                      const tva = Number(settings.tva) || 0;
                      // Un même prix affiché ne rapporte pas la même chose selon le canal :
                      // Uber et Deliveroo prélèvent leur commission sur l'encaissement.
                      const lignesCanal = CANAUX.map((c) => {
                        const com = Number(settings.commissions?.[c.id]) || 0;
                        const ttc = prixCanal(art, channelPrices, c.id);
                        const netHT = ttcVersHT(ttc * (1 - com / 100), tva);
                        if (!(netHT > 0)) return null;
                        const margeAv = netHT - i.avant.coutMatiere;
                        const tauxMarge = (margeAv / netHT) * 100;
                        const pvMarge = arrondi10ctsSup(((i.apres.coutMatiere + margeAv) * (1 + tva / 100)) / (1 - com / 100));
                        const pvRatio = prixConseille(i.apres.coutMatiere, tauxMarge, com, tva);
                        const dedie = channelPrices.some((x) => x.menu_item_id === art.id && x.channel === c.id);
                        return { c, com, ttc, margeAv, pvMarge, pvRatio, dedie };
                      }).filter(Boolean);
                      return (
                        <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: t.surfaceAlt }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: t.textMuted, marginBottom: 8 }}>
                            PRIX DE VENTE À PRATIQUER, PAR CANAL
                          </div>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                            <thead>
                              <tr style={{ color: t.textMuted }}>
                                <th style={{ textAlign: 'left', fontWeight: 600, padding: '2px 0' }}>Canal</th>
                                <th style={{ textAlign: 'right', fontWeight: 600 }}>Prix</th>
                                <th style={{ textAlign: 'right', fontWeight: 600 }}>Marge auj.</th>
                                <th style={{ textAlign: 'right', fontWeight: 600 }}>Même marge</th>
                                <th style={{ textAlign: 'right', fontWeight: 600 }}>Même ratio</th>
                              </tr>
                            </thead>
                            <tbody>
                              {lignesCanal.map((l) => {
                                // Sans prix dédié, tout ce qui en découle est une hypothèse :
                                // on le montre comme tel plutôt que comme un chiffre acquis.
                                const suppose = !l.dedie && l.com > 0;
                                const gris = suppose ? { color: t.textMuted, fontStyle: 'italic' } : {};
                                return (
                                  <tr key={l.c.id}>
                                    <td style={{ padding: '3px 0', color: t.textMuted }}>
                                      {l.c.nom}{l.com > 0 ? ` (${l.com} %)` : ''}
                                    </td>
                                    <td style={{ textAlign: 'right', ...gris }}>
                                      {eur(l.ttc)}{suppose ? ' ?' : ''}
                                    </td>
                                    <td style={{ textAlign: 'right', ...gris, color: suppose ? t.textMuted : (l.margeAv < 0 ? t.danger : t.text) }}>
                                      {suppose ? '—' : eur(l.margeAv)}
                                    </td>
                                    <td style={{ textAlign: 'right', fontWeight: suppose ? 400 : 700, ...gris }}>
                                      {suppose ? '—' : eur(l.pvMarge)}
                                    </td>
                                    <td style={{ textAlign: 'right', fontWeight: suppose ? 400 : 700, ...gris }}>
                                      {suppose ? '—' : eur(l.pvRatio)}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                          {lignesCanal.some((l) => !l.dedie && l.com > 0) && (
                            <div style={{ marginTop: 8, padding: '7px 9px', borderRadius: 6, background: t.warning + '14',
                              color: t.warning, fontSize: 11, fontWeight: 600 }}>
                              Prix de vente non saisi pour {lignesCanal.filter((l) => !l.dedie && l.com > 0).map((l) => l.c.nom).join(' et ')}.
                              Sans lui, ni la marge ni le prix conseillé ne peuvent être calculés sur ce canal.
                              Les prix par canal se saisissent dans l'onglet Rentabilité.
                            </div>
                          )}
                          <div style={{ fontSize: 10, color: t.textMuted, marginTop: 6, fontStyle: 'italic' }}>
                            Marge calculée après commission. Arrondi aux 10 centimes supérieurs.
                            Prix conseillés, jamais appliqués automatiquement.
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </Carte>
          )}
        </div>
      )}

      {/* ------------------------------------------------ ALERTES */}
      {onglet === 'alertes' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {alertes.length === 0 && (
            <Carte t={t}><div style={{ color: t.success, fontWeight: 600 }}>Aucune alerte.</div></Carte>
          )}
          {alertes.map((a, i) => {
            const col = a.niveau === 3 ? t.danger : a.niveau === 2 ? t.warning : t.textMuted;
            const lib = a.niveau === 3 ? 'CRITIQUE' : a.niveau === 2 ? 'IMPORTANT' : 'INFO';
            return (
              <Carte key={i} t={t} style={{ borderLeft: `4px solid ${col}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 10, fontWeight: 800, color: col, letterSpacing: 0.5 }}>{lib}</span>
                  <span style={{ fontSize: 11, color: t.textMuted }}>{a.type.replace(/_/g, ' ')}</span>
                </div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{a.message}</div>
                {a.detail && <div style={{ fontSize: 12, color: t.textMuted, marginTop: 4 }}>{a.detail}</div>}
              </Carte>
            );
          })}
        </div>
      )}
    </div>
  );
}
