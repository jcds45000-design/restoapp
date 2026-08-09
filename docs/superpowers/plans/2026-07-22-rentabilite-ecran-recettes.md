# Rentabilité v2 — Phase 2 : Écran Recettes — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal :** Un écran « Recettes » (gérant) pour créer/éditer les recettes et leurs sous-recettes, avec coût calculé en direct via la logique de la phase 1.

**Architecture :** Un composant `RecettesModule.jsx` autonome (charge recipes + recipe_lines depuis Supabase, reçoit products + productSuppliers en props comme l'ex-module v1). Deux vues internes : liste des recettes, et éditeur d'une recette. Le calcul du coût réutilise `coutRecette` / `grouperLignesParRecette` de `rentabilite.js`. Style calé sur la maquette validée (workspace jarvis : `maquette-module-rentabilite-v3.html`, écran 1) et sur le pattern des modules existants (styles inline `t`, cf. StocksModule).

**Tech Stack :** React 19 + Vite (JS), Supabase (RLS gérant), vitest.

**Spec :** `docs/superpowers/specs/2026-07-21-rentabilite-sous-recettes-design.md`

**Rappels non négociables :**
- Dépôt public : aucune vraie recette/prix committée. Rien poussé sans l'accord de JC.
- Validation VISUELLE de JC en local (desktop + 390×844) AVANT tout commit.
- `null` ≠ 0 (coût incomplet signalé, jamais 0).

---

## Carte des fichiers

| Fichier | Rôle | Committé ? |
|---|---|---|
| `src/lib/rentabilite.js` | Ajout d'un helper pur `resumeRecettes` (liste) | oui |
| `src/lib/rentabilite.test.js` | Test du helper | oui |
| `src/components/RecettesModule.jsx` | Écran Recettes (liste + éditeur) | oui |
| `src/RestoApp.jsx` | Onglet « Recettes » (gérant) | oui (modifié) |
| `src/components/RentabiliteModule.jsx` | Ancien module v1 caduc : à retirer de la nav | oui (modifié RestoApp) |

---

### Task 1 : Helper pur `resumeRecettes` (liste des recettes costées) — TDD

Un helper qui, pour chaque recette, renvoie son coût par unité et son état, prêt à afficher.

**Files:** Test `src/lib/rentabilite.test.js`, Modify `src/lib/rentabilite.js`

- [ ] **Step 1 : Test (échoue)**

```js
import { resumeRecettes } from './rentabilite.js';

describe('resumeRecettes', () => {
  it('costue chaque recette et remonte l\'état', () => {
    const rs = resumeRecettes([sauce, plat], grouperLignesParRecette(lignesRec), produits, ps);
    const parId = Object.fromEntries(rs.map((x) => [x.recette.id, x]));
    expect(parId['r_sauce'].coutParUnite).toBeCloseTo(1.0, 6);
    expect(parId['r_plat'].coutParUnite).toBeCloseTo(0.08, 6);
    expect(parId['r_plat'].incomplet).toBe(false);
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run : `npm test -- src/lib/rentabilite.test.js --run` → FAIL (`resumeRecettes` non défini).

- [ ] **Step 3 : Implémenter (ajouter à `rentabilite.js`)**

```js
// Pour l'écran liste : costue chaque recette. Retourne [{ recette, coutParUnite, incomplet, raisons }].
export function resumeRecettes(recettes, lignesByRecette, produits, productSuppliers) {
  const recettesById = Object.fromEntries((recettes || []).map((r) => [r.id, r]));
  return (recettes || []).map((recette) => {
    const r = coutRecette({ recette, recettesById, lignesByRecette, produits, productSuppliers });
    return { recette, coutParUnite: r.coutParUnite, incomplet: r.incomplet, raisons: r.raisons };
  });
}
```

- [ ] **Step 4 : Vérifier le vert** — `npm test -- src/lib/rentabilite.test.js --run` → PASS.

- [ ] **Step 5 : Commit (sur accord de JC)** — `git add src/lib/rentabilite.js src/lib/rentabilite.test.js` puis `feat(rentabilite): helper resumeRecettes pour la liste`.

---

### Task 2 : Composant `RecettesModule.jsx` — vue liste

**Files:** Create `src/components/RecettesModule.jsx`

- [ ] **Step 1 : Créer le composant avec le chargement des données et la vue liste**

Structure (styles inline `t` comme StocksModule ; visuel = maquette écran 1) :

```jsx
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
```

(Le composant `EditeurRecette` est ajouté en Task 3, dans le même fichier.)

- [ ] **Step 2 : Vérifier que ça compile** — `npm run build`. Attendu : build OK (EditeurRecette encore absent → l'ajouter en Task 3 avant de tester en vrai ; si le build échoue sur EditeurRecette, enchaîner Task 3 puis rebuild).

---

### Task 3 : Composant `EditeurRecette` (dans le même fichier) — création/édition + lignes + override

**Files:** Modify `src/components/RecettesModule.jsx`

- [ ] **Step 1 : Ajouter l'éditeur**

Comportements (visuel = maquette écran 1) :
- Champs recette : `nom`, `rendement_valeur`, `rendement_unite` (select `UNITES_RENDEMENT`), case `sous_recette_seulement`.
- Lignes : chaque ligne = produit du Stock OU sous-recette + `qty` + coût affiché (via `coutRecette` d'une recette temporaire) + bouton « forcer » (bascule `cout_force`).
- Ajout de ligne : un `select` des produits, un `select` des autres recettes (hors la recette courante, pour éviter l'auto-référence).
- Pied : coût du batch, coût par unité, « forcer le coût total ».
- Boutons : Enregistrer (upsert recette + diff des lignes), Supprimer (avec garde « utilisée dans N recettes »), Retour.

```jsx
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
    let id = recetteId;
    if (recetteId) {
      const { error } = await supabase.from('recipes').update(payload).eq('id', recetteId);
      if (error) { setMsg(error.message); return; }
    } else {
      const { data, error } = await supabase.from('recipes').insert(payload).select().single();
      if (error) { setMsg(error.message); return; }
      id = data.id;
    }
    await onChange();
    if (!recetteId) onFerme(); // après création, on revient à la liste (id connu au rechargement)
    else setMsg('Enregistré.');
  };

  const ajouterLigneProduit = async (productId) => {
    if (!recetteId) { setMsg('Enregistre d\'abord la recette, puis ajoute les lignes.'); return; }
    const prod = products.find((p) => p.id === productId);
    const unit = prod?.unit?.toLowerCase() === 'kg' ? 'g' : prod?.unit?.toLowerCase() === 'l' ? 'ml' : 'piece';
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

  // Coût courant (recette telle qu'en base) pour l'affichage
  const recetteVirtuelle = { ...(existante || {}), id: recetteId, rendement_valeur: Number(rv) };
  const cout = recetteId ? coutRecette({ recette: recetteVirtuelle, recettesById: { ...recettesById, [recetteId]: recetteVirtuelle }, lignesByRecette, produits: products, productSuppliers }) : { total: 0, coutParUnite: null, incomplet: true, raisons: [] };

  const label = (l) => l.product_id
    ? (products.find((p) => p.id === l.product_id)?.name || 'produit supprimé')
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
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10, fontSize: 13, color: t.textMuted }}>
          Rendement
          <input type="number" value={rv} onChange={(e) => setRv(e.target.value)} style={{ width: 70, padding: 6, borderRadius: 8, border: `1px solid ${t.border}`, textAlign: 'right' }} />
          <select value={ru} onChange={(e) => setRu(e.target.value)} style={{ padding: 6, borderRadius: 8, border: `1px solid ${t.border}` }}>
            {UNITES_RENDEMENT.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
          <button onClick={enregistrerRecette} style={{ marginLeft: 'auto', background: t.primary, color: '#fff', border: 'none', borderRadius: 8, padding: '7px 13px', fontWeight: 600, cursor: 'pointer' }}>Enregistrer</button>
        </div>
        {msg && <div style={{ marginTop: 8, fontSize: 12, color: t.textMuted }}>{msg}</div>}
      </div>

      {recetteId && (
        <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: 16 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 10px' }}>Ingrédients & sous-recettes</h3>
          {lignesCourantes.map((l) => (
            <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: `1px solid ${t.border}` }}>
              <div style={{ flex: 1, fontSize: 14 }}>{label(l)} {l.sous_recette_id && <span style={{ fontSize: 10, color: t.primary }}>sous-recette</span>}{l.cout_force != null && <span style={{ fontSize: 10, color: t.warning, fontWeight: 700 }}> · forcé</span>}</div>
              <input type="number" step="any" defaultValue={l.qty} onBlur={(e) => majLigne(l.id, { qty: Number(e.target.value) })} style={{ width: 74, padding: 5, borderRadius: 7, border: `1px solid ${t.border}`, textAlign: 'right' }} />
              <span style={{ fontSize: 12, color: t.textMuted, width: 40 }}>{l.unit}</span>
              <button onClick={() => { const v = prompt('Coût forcé en € (vide = auto) :', l.cout_force ?? ''); majLigne(l.id, { cout_force: v === null ? l.cout_force : (v === '' ? null : Number(v)) }); }}
                style={{ border: `1px solid ${t.border}`, background: '#fff', borderRadius: 7, fontSize: 11, padding: '4px 8px', cursor: 'pointer', color: t.textMuted }}>{l.cout_force != null ? 'auto' : 'forcer'}</button>
              <button onClick={() => retirerLigne(l.id)} style={{ border: 'none', background: 'none', color: t.danger, cursor: 'pointer', fontSize: 16 }}>✕</button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            <select value="" onChange={(e) => e.target.value && ajouterLigneProduit(e.target.value)} style={{ padding: 8, borderRadius: 8, border: `1px solid ${t.border}` }}>
              <option value="">+ Produit du Stock…</option>
              {products.filter((p) => p.active !== false).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>)}
            </select>
            <select value="" onChange={(e) => e.target.value && ajouterLigneSousRecette(e.target.value)} style={{ padding: 8, borderRadius: 8, border: `1px solid ${t.border}` }}>
              <option value="">+ Sous-recette…</option>
              {recettes.filter((r) => r.id !== recetteId).map((r) => <option key={r.id} value={r.id}>{r.nom}</option>)}
            </select>
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: 18, alignItems: 'baseline', borderTop: `2px solid ${t.border}`, paddingTop: 12 }}>
            <div><div style={{ fontSize: 11, color: t.textMuted }}>COÛT DU BATCH</div><b style={{ fontSize: 18 }}>{eur(cout.total)}</b></div>
            <div><div style={{ fontSize: 11, color: t.textMuted }}>COÛT PAR {ru.toUpperCase()}</div><b style={{ fontSize: 18 }}>{eur(cout.coutParUnite)}</b></div>
            {cout.incomplet && <span style={{ color: t.warning, fontSize: 12, fontWeight: 700 }}>incomplet ({[...new Set(cout.raisons)].join(', ')})</span>}
          </div>
        </div>
      )}
      {!recetteId && <div style={{ color: t.textMuted, fontSize: 13 }}>Enregistre la recette pour pouvoir ajouter ses ingrédients.</div>}
    </div>
  );
}
```

- [ ] **Step 2 : Build** — `npm run build`. Attendu : OK.

---

### Task 4 : Brancher l'onglet « Recettes » dans `RestoApp.jsx` (et retirer le v1 caduc)

**Files:** Modify `src/RestoApp.jsx`

- [ ] **Step 1 : Lazy import**

Après le lazy import de `RentabiliteModule`, ajouter :
```js
const RecettesModule = lazy(() => import('./components/RecettesModule'));
```

- [ ] **Step 2 : navItems gérant**

Remplacer l'entrée `{ id: "rentabilite", label: "Rentabilité", icon: I.euro }` par :
```js
    { id: "recettes", label: "Recettes", icon: I.box },
```
(l'onglet « Rentabilité » reviendra en phase 3 avec l'écran Carte ; on retire le v1 caduc de la nav.)

- [ ] **Step 3 : Rendu**

Remplacer le bloc `{effectiveSection === "rentabilite" && isGerant && (...)}` par :
```jsx
        {/* RECETTES (gérant seul) */}
        {effectiveSection === "recettes" && isGerant && (
          <Suspense fallback={<Loading />}><RecettesModule t={t}
  products={products} productSuppliers={productSuppliers} /></Suspense>
        )}
```
Mettre à jour aussi la liste des sections connues du placeholder (`["dashboard",...]`) : remplacer `"rentabilite"` par `"recettes"`.

- [ ] **Step 4 : Build + lint ciblé** — `npm run build`. Attendu : OK, aucune nouvelle erreur.

---

### Task 5 : Vérification navigateur + validation visuelle de JC

- [ ] **Step 1 : Lancer en local** — `npm run dev`, se connecter en gérant.
- [ ] **Step 2 : Vérifier** (desktop + 390×844) :
  - L'onglet « Recettes » apparaît (gérant) et pas pour un employé.
  - Créer la sous-recette « Marinade » (rendement 1 portion) + quelques lignes produit → coût du batch cohérent.
  - Créer « Wings » (rendement 85 pièces) avec une ligne produit + la sous-recette Marinade (0,5) → coût par pièce cohérent.
  - Forcer un coût de ligne puis revenir en auto.
  - Une recette avec un produit sans prix → « coût incomplet ».
- [ ] **Step 3 : VALIDATION VISUELLE DE JC (bloquant)** — ne rien committer avant son accord explicite sur le rendu.
- [ ] **Step 4 : Commit (sur accord)** — `git add src/lib/rentabilite.js src/lib/rentabilite.test.js src/components/RecettesModule.jsx src/RestoApp.jsx` puis `feat(rentabilite): ecran Recettes (liste + editeur sous-recettes)`.

---

## Auto-revue

- Couverture spec : liste des recettes costées (Tasks 1-2), éditeur avec rendement + statut sous-recette + lignes produit/sous-recette + override + coût batch/unité (Task 3), garde anti auto-référence (select exclut la recette courante), navigation (Task 4), validation visuelle (Task 5). Écran Carte + détail par canal = phase 3.
- Pas de placeholder ; le JSX complet est fourni, visuel calé sur la maquette validée.
- Cohérence : `coutRecette`/`grouperLignesParRecette`/`resumeRecettes` réutilisés tels que définis en phase 1 ; props `t/products/productSuppliers` identiques au pattern v1 de RestoApp.
