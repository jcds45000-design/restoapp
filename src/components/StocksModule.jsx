import { useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { I } from '../lib/icons';
import { TODAY, fmt, Badge, stockCategories, F } from '../lib/foundation';
import { getUrgency, computeShoppingList, formatShoppingListText, supplierLinksOf } from '../lib/stock';
import InventaireMode from './InventaireMode';
import FournisseursModal from './FournisseursModal';
import ProduitFournisseurs from './ProduitFournisseurs';

// Coordinateur principal du module stock : inventaire, sorties, liste de courses.
const StocksModule = ({ t, products, setProducts, sorties, setSorties, suppliers, setSuppliers, productSuppliers, setProductSuppliers, isGerant, currentUserName }) => {
  const [stockView, setStockView] = useState("inventory"); // inventory | sorties | shopping
  const [filterCat, setFilterCat] = useState("");
  const [sansSeuilOnly, setSansSeuilOnly] = useState(false);
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [showSortieModal, setShowSortieModal] = useState(false);
  const [showInventaire, setShowInventaire] = useState(false);
  const [showFournisseurs, setShowFournisseurs] = useState(false);
  const [editProduct, setEditProduct] = useState(null); // product id for inline qty edit
  const [editQty, setEditQty] = useState("");
  const [editingProduct, setEditingProduct] = useState(null); // full product object for edit modal

  // Formulaire édition produit
  const [epName, setEpName] = useState("");
  const [epCat, setEpCat] = useState("");
  const [epUnit, setEpUnit] = useState("");
  const [epSeuil, setEpSeuil] = useState("");
  const [epSeuilOrange, setEpSeuilOrange] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Formulaire ajout produit
  const [npName, setNpName] = useState("");
  const [npCat, setNpCat] = useState(stockCategories[0]);
  const [npQty, setNpQty] = useState("");
  const [npUnit, setNpUnit] = useState("kg");
  const [npSeuil, setNpSeuil] = useState("");

  // Formulaire déclaration sortie
  const [spProduct, setSpProduct] = useState("");
  const [spQty, setSpQty] = useState("");
  const [spNote, setSpNote] = useState("");

  const pidRef = useRef(100);

  // Listes dérivées
  const pendingSorties = sorties.filter(s => s.status === "pending");
  const alertProducts = products.filter(p => p.seuil != null && p.qty <= p.seuil);
  const sansSeuil = products.filter(p => p.seuil == null);
  const shoppingGroups = computeShoppingList(products, productSuppliers, suppliers);

  const addProduct = async () => {
    if (!npName.trim() || !npQty) return;
    const tmpId = pidRef.current++;
    const np = { id: tmpId, name: npName, category: npCat, qty: parseFloat(npQty), unit: npUnit, seuil: npSeuil !== "" ? parseFloat(npSeuil) : null, seuilOrange: npSeuil !== "" ? parseFloat(npSeuil) * 2 : null };
    setProducts(prev => [...prev, np]);
    setNpName(""); setNpQty(""); setNpSeuil(""); setShowAddProduct(false);
    const { data, error } = await supabase.from('products').insert({ name: np.name, category: np.category, unit: np.unit, qty: np.qty, seuil: np.seuil, seuil_orange: np.seuilOrange, stock_current: np.qty, stock_min: np.seuil }).select().single();
    if (error) { alert('Erreur à la création du produit : ' + error.message); setProducts(prev => prev.filter(p => p.id !== tmpId)); return; }
    if (data) setProducts(prev => prev.map(p => p.id === tmpId ? { ...p, _uuid: data.id } : p));
  };

  // Soumettre une sortie : insert en DB, statut pending
  const submitSortie = async () => {
    if (!spProduct || !spQty) return;
    const { data, error } = await supabase.from('stock_movements').insert({
      product_id: spProduct, type: 'out', quantity: parseFloat(spQty),
      reason: spNote, status: 'pending', employee_name: currentUserName,
    }).select().single();
    if (error) { alert('Erreur : ' + error.message); return; }
    setSorties(prev => [...prev, {
      id: data.id, productUuid: spProduct, qty: parseFloat(spQty),
      empName: currentUserName, date: TODAY,
      time: new Date().getHours() + "h" + String(new Date().getMinutes()).padStart(2, "0"),
      status: 'pending', note: spNote,
    }]);
    setSpProduct(''); setSpQty(''); setSpNote(''); setShowSortieModal(false);
  };

  // Valider une sortie : met à jour DB + décrémente le stock
  const validateSortie = async (sid) => {
    const sortie = sorties.find(s => s.id === sid);
    if (!sortie) return;
    const prod = products.find(p => p._uuid === sortie.productUuid);
    if (!prod) return;
    const newQty = Math.max(0, Math.round((prod.qty - sortie.qty) * 100) / 100);
    const { error } = await supabase.from('stock_movements')
      .update({ status: 'validated', qty_before: prod.qty, qty_after: newQty }).eq('id', sid);
    if (error) { alert('Erreur : ' + error.message); return; }
    const { error: e2 } = await supabase.from('products').update({ qty: newQty, stock_current: newQty }).eq('id', prod._uuid);
    setSorties(prev => prev.map(s => s.id === sid ? { ...s, status: 'validated' } : s));
    if (e2) { alert('Sortie validée mais stock non décrémenté : ' + e2.message); return; }
    setProducts(prev => prev.map(p => p._uuid === prod._uuid ? { ...p, qty: newQty } : p));
  };

  // Refuser une sortie : met à jour le statut en DB
  const rejectSortie = async (sid) => {
    const { error } = await supabase.from('stock_movements').update({ status: 'rejected' }).eq('id', sid);
    if (error) { alert('Erreur : ' + error.message); return; }
    setSorties(prev => prev.map(s => s.id === sid ? { ...s, status: 'rejected' } : s));
  };

  const updateQty = (pid) => {
    if (editQty === "") return;
    setProducts(prev => prev.map(p => {
      if (p.id !== pid) return p;
      const newQty = parseFloat(editQty);
      if (p._uuid) supabase.from('products').update({ qty: newQty, stock_current: newQty }).eq('id', p._uuid).then(({ error }) => { if (error) alert('Erreur Supabase: ' + error.message); });
      return { ...p, qty: newQty };
    }));
    setEditProduct(null); setEditQty("");
  };

  const openEditProduct = (p) => {
    setEpName(p.name); setEpCat(p.category); setEpUnit(p.unit);
    setEpSeuil(p.seuil != null ? String(p.seuil) : "");
    setEpSeuilOrange(p.seuilOrange != null ? String(p.seuilOrange) : "");
    setConfirmDelete(false);
    setEditingProduct(p);
  };

  const saveEditProduct = () => {
    if (!editingProduct || !epName.trim()) return;
    setProducts(prev => prev.map(p => {
      if (p.id !== editingProduct.id) return p;
      const updated = { ...p, name: epName, category: epCat, unit: epUnit, seuil: epSeuil !== "" ? parseFloat(epSeuil) : null, seuilOrange: epSeuilOrange !== "" ? parseFloat(epSeuilOrange) : null };
      if (p._uuid) supabase.from('products').update({ name: epName, category: epCat, unit: epUnit, seuil: updated.seuil, seuil_orange: updated.seuilOrange }).eq('id', p._uuid).then(() => {});
      return updated;
    }));
    setEditingProduct(null);
  };

  const deleteProduct = async () => {
    if (!editingProduct) return;
    if (editingProduct._uuid) {
      const { error } = await supabase.from('products').delete().eq('id', editingProduct._uuid);
      if (error) { alert('Erreur : ' + error.message); return; }
    }
    setProductSuppliers(prev => prev.filter(l => l.product_id !== editingProduct._uuid));
    setProducts(prev => prev.filter(p => p.id !== editingProduct.id));
    setEditingProduct(null);
  };

  const sel = { padding: "8px 12px", borderRadius: 8, border: `1px solid ${t.border}`, fontSize: 13, fontFamily: F, background: t.surface, color: t.text, outline: "none", cursor: "pointer" };
  const tabBtn = (key) => ({ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: F, borderRadius: 8, background: stockView === key ? t.primary : "transparent", color: stockView === key ? "#fff" : t.textMuted, transition: "all 0.15s" });

  // ── Vue Inventaire ──
  const InventoryView = () => {
    // Filtre "sans seuil" prioritaire, sinon filtre catégorie
    const filtered = sansSeuilOnly
      ? products.filter(p => p.seuil == null && (filterCat === "" || p.category === filterCat))
      : (filterCat ? products.filter(p => p.category === filterCat) : products);

    const grouped = {};
    filtered.forEach(p => { if (!grouped[p.category]) grouped[p.category] = []; grouped[p.category].push(p); });

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {Object.entries(grouped).map(([cat, items]) => (
          <div key={cat}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, fontFamily: F, display: "flex", alignItems: "center", gap: 8 }}>
              {cat} <span style={{ fontSize: 12, fontWeight: 500, color: t.textMuted, background: t.surfaceAlt, padding: "2px 10px", borderRadius: 10 }}>{items.length}</span>
            </div>
            <div style={{ background: t.surface, borderRadius: 12, border: `1px solid ${t.border}`, overflow: "hidden" }}>
              {items.map((p, i) => {
                const urg = getUrgency(p);
                const isEditing = editProduct === p.id;
                // 'none' = seuil null : fond neutre, jamais d'alerte rouge
                const rowBg = urg === "high" ? t.danger + "06" : "transparent";
                return (
                  <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: i < items.length - 1 ? `1px solid ${t.border}` : "none", background: rowBg }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: urg === "high" ? t.danger : urg === "medium" ? t.warning : urg === "none" ? t.border : t.success, flexShrink: 0 }} />
                    <div style={{ flex: 1, cursor: isGerant ? "pointer" : "default" }} onClick={() => { if (isGerant) openEditProduct(p); }}>
                      <div style={{ fontSize: 14, fontWeight: 500, display: "flex", alignItems: "center", gap: 6 }}>{p.name} {isGerant && <span style={{ fontSize: 10, color: t.textMuted, opacity: 0.4 }}>✎</span>}</div>
                      <div style={{ fontSize: 12, color: t.textMuted }}>
                        {p.seuil == null ? 'Seuil à définir' : `Seuil : ${p.seuil} ${p.unit}`}
                        {supplierLinksOf(p._uuid, productSuppliers, suppliers).length === 0 && ' · sans fournisseur'}
                      </div>
                    </div>
                    {isEditing ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <input value={editQty} onChange={e => setEditQty(e.target.value)} type="number" step="0.1" autoFocus style={{ ...sel, width: 70, padding: "6px 8px" }} onKeyDown={e => { if (e.key === "Enter") updateQty(p.id); if (e.key === "Escape") { setEditProduct(null); setEditQty(""); } }} />
                        <span style={{ fontSize: 12, color: t.textMuted }}>{p.unit}</span>
                        <button onClick={() => updateQty(p.id)} style={{ background: t.success, color: "#fff", border: "none", borderRadius: 6, padding: "4px 8px", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>✓</button>
                        <button onClick={() => { setEditProduct(null); setEditQty(""); }} style={{ background: t.border, color: t.textMuted, border: "none", borderRadius: 6, padding: "4px 8px", cursor: "pointer", fontSize: 12 }}>✕</button>
                      </div>
                    ) : (
                      <div onClick={() => { if (isGerant) { setEditProduct(p.id); setEditQty(String(p.qty)); } }} style={{ display: "flex", alignItems: "center", gap: 6, cursor: isGerant ? "pointer" : "default", padding: "4px 10px", borderRadius: 8, background: urg === "high" ? t.danger + "15" : urg === "medium" ? t.warning + "15" : t.surfaceAlt }}>
                        <span style={{ fontSize: 15, fontWeight: 700, color: urg === "high" ? t.danger : urg === "medium" ? t.warning : t.text }}>{p.qty}</span>
                        <span style={{ fontSize: 12, color: t.textMuted }}>{p.unit}</span>
                        {isGerant && <span style={{ fontSize: 10, color: t.textMuted, opacity: 0.5, marginLeft: 4 }}>✎</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  };

  // ── Vue Sorties ──
  const SortiesView = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {pendingSorties.length > 0 && isGerant && (
        <div style={{ background: t.warning + "08", border: `1px solid ${t.warning}25`, borderRadius: 12, padding: 16, marginBottom: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>{I.warning} <span>{pendingSorties.length} sortie{pendingSorties.length > 1 ? "s" : ""} en attente de validation</span></div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {pendingSorties.map(s => {
              const prod = products.find(p => p._uuid === s.productUuid);
              return (
                <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 10, background: t.surface, border: `1px solid ${t.border}` }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{prod ? prod.name : "Produit inconnu"} — <span style={{ color: t.primary }}>-{s.qty} {prod ? prod.unit : ""}</span></div>
                    <div style={{ fontSize: 12, color: t.textMuted }}>{s.empName} · {s.date === TODAY ? "Aujourd'hui" : fmt(s.date)} à {s.time}{s.note ? ` · ${s.note}` : ""}</div>
                  </div>
                  <button onClick={() => validateSortie(s.id)} style={{ padding: "6px 12px", borderRadius: 8, border: "none", background: t.success, color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: F }}>✓ Valider</button>
                  <button onClick={() => rejectSortie(s.id)} style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.surface, color: t.textMuted, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: F }}>✕ Refuser</button>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Historique des sorties</div>
      <div style={{ background: t.surface, borderRadius: 12, border: `1px solid ${t.border}`, overflow: "hidden" }}>
        {sorties.filter(s => s.status !== "pending").slice().reverse().map((s, i, arr) => {
          const prod = products.find(p => p._uuid === s.productUuid);
          return (
            <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderBottom: i < arr.length - 1 ? `1px solid ${t.border}` : "none" }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: s.status === "validated" ? t.success : t.danger, flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{prod ? prod.name : "?"} · <span style={{ fontWeight: 700 }}>-{s.qty} {prod ? prod.unit : ""}</span></div>
                <div style={{ fontSize: 12, color: t.textMuted }}>{s.empName} · {s.date === TODAY ? "Aujourd'hui" : fmt(s.date)} à {s.time}</div>
              </div>
              <Badge label={s.status === "validated" ? "Validé" : "Refusé"} bg={s.status === "validated" ? t.success + "18" : t.danger + "18"} color={s.status === "validated" ? t.success : t.danger} />
            </div>
          );
        })}
        {sorties.filter(s => s.status !== "pending").length === 0 && <div style={{ padding: 20, textAlign: "center", color: t.textMuted, fontSize: 13 }}>Aucune sortie enregistrée.</div>}
      </div>
    </div>
  );

  // ── Liste de courses groupée par fournisseur ──
  const ShoppingView = () => (
    <div>
      {shoppingGroups.length === 0 ? (
        <div style={{ textAlign: "center", padding: 40, color: t.textMuted, fontSize: 14 }}>Tous les stocks sont OK — rien à acheter.</div>
      ) : (
        <>
          {shoppingGroups.map((group, gi) => (
            <div key={gi} style={{ background: t.surface, borderRadius: 12, border: `1px solid ${t.border}`, overflow: "hidden", marginBottom: 12 }}>
              <div style={{ padding: "10px 16px", background: t.surfaceAlt, fontWeight: 700, fontSize: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>{group.supplier ? group.supplier.name : "Sans fournisseur"}</span>
                <span style={{ fontWeight: 400, fontSize: 13, color: t.textMuted }}>
                  {group.items.length} produit{group.items.length > 1 ? "s" : ""}
                  {group.totalHt != null && ` · ≈ ${group.totalHt.toFixed(0)} € HT`}
                </span>
              </div>
              {group.items.map((item, ii) => {
                const urg = getUrgency(item.product);
                return (
                  <div key={item.product.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", borderBottom: ii < group.items.length - 1 ? `1px solid ${t.border}` : "none" }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: urg === "high" ? t.danger : urg === "medium" ? t.warning : t.success, flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{item.product.name}</div>
                      <div style={{ fontSize: 12, color: t.textMuted }}>{item.product.category} · Reste {item.product.qty} {item.product.unit} (seuil : {item.product.seuil})</div>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: t.primary }}>≈ {item.toOrder} {item.product.unit}</div>
                  </div>
                );
              })}
            </div>
          ))}
          <button onClick={async () => {
            const txt = formatShoppingListText(shoppingGroups);
            try { await navigator.clipboard.writeText(txt); alert('Liste copiée, prête à coller dans WhatsApp/SMS.'); }
            catch { window.prompt('Copie impossible ici, sélectionne et copie :', txt); }
          }} style={{ width: "100%", marginTop: 12, padding: "12px 0", borderRadius: 10, border: "none", background: t.primary, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: F }}>📤 Partager la liste (texte)</button>
        </>
      )}
    </div>
  );

  return (
    <div>
      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
        <div style={{ background: t.surface, borderRadius: 10, padding: "14px 18px", border: `1px solid ${t.border}`, display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: t.primary }} />
          <div><div style={{ fontSize: 12, color: t.textMuted }}>Produits</div><div style={{ fontSize: 22, fontWeight: 700 }}>{products.length}</div></div>
        </div>
        <div style={{ background: t.surface, borderRadius: 10, padding: "14px 18px", border: `1px solid ${alertProducts.length > 0 ? t.danger + "40" : t.border}`, display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: t.danger }} />
          <div><div style={{ fontSize: 12, color: t.textMuted }}>Alertes stock</div><div style={{ fontSize: 22, fontWeight: 700, color: alertProducts.length > 0 ? t.danger : t.text }}>{alertProducts.length}</div></div>
        </div>
        <div style={{ background: t.surface, borderRadius: 10, padding: "14px 18px", border: `1px solid ${pendingSorties.length > 0 ? t.warning + "40" : t.border}`, display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: t.warning }} />
          <div><div style={{ fontSize: 12, color: t.textMuted }}>Sorties en attente</div><div style={{ fontSize: 22, fontWeight: 700, color: pendingSorties.length > 0 ? t.warning : t.text }}>{pendingSorties.length}</div></div>
        </div>
        <div style={{ background: t.surface, borderRadius: 10, padding: "14px 18px", border: `1px solid ${t.border}`, display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: t.success }} />
          <div><div style={{ fontSize: 12, color: t.textMuted }}>Sorties validées (jour)</div><div style={{ fontSize: 22, fontWeight: 700 }}>{sorties.filter(s => s.status === "validated" && s.date === TODAY).length}</div></div>
        </div>
      </div>

      {/* Onglets + actions */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", gap: 6, background: t.surfaceAlt, borderRadius: 10, border: `1px solid ${t.border}`, padding: 4 }}>
          <button onClick={() => setStockView("inventory")} style={tabBtn("inventory")}>{I.box} Inventaire</button>
          <button onClick={() => setStockView("sorties")} style={tabBtn("sorties")}>{I.history} Sorties {pendingSorties.length > 0 && <span style={{ background: t.warning, color: "#fff", fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 8, marginLeft: 4 }}>{pendingSorties.length}</span>}</button>
          <button onClick={() => setStockView("shopping")} style={tabBtn("shopping")}>{I.list} Liste de courses {alertProducts.length > 0 && <span style={{ background: t.danger, color: "#fff", fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 8, marginLeft: 4 }}>{alertProducts.length}</span>}</button>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {stockView === "inventory" && (
            <>
              <select value={filterCat} onChange={e => setFilterCat(e.target.value)} style={sel}>
                <option value="">Toutes catégories</option>
                {stockCategories.map(c => <option key={c}>{c}</option>)}
              </select>
              {(sansSeuilOnly || sansSeuil.length > 0) && (
                <button
                  onClick={() => setSansSeuilOnly(v => !v)}
                  style={{ padding: "8px 12px", borderRadius: 8, border: `1px solid ${t.border}`, fontSize: 13, fontWeight: 600, fontFamily: F, cursor: "pointer", background: sansSeuilOnly ? t.primary : t.surface, color: sansSeuilOnly ? "#fff" : t.text }}>
                  Seuil à définir ({sansSeuil.length})
                </button>
              )}
            </>
          )}
          <button onClick={() => setShowSortieModal(true)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.surface, color: t.text, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: F }}>📤 Déclarer une sortie</button>
          <button onClick={() => setShowInventaire(true)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.surface, color: t.text, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: F }}>📋 Faire l'inventaire</button>
          {isGerant && (
            <button onClick={() => setShowFournisseurs(true)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.surface, color: t.text, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: F }}>🏪 Fournisseurs</button>
          )}
          {isGerant && (
            <button onClick={() => setShowAddProduct(true)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, border: "none", background: t.primary, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: F }}>{I.plus} Ajouter un produit</button>
          )}
        </div>
      </div>

      {stockView === "inventory" && <InventoryView />}
      {stockView === "sorties" && <SortiesView />}
      {stockView === "shopping" && <ShoppingView />}

      {/* Modal ajout produit */}
      {showAddProduct && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={() => setShowAddProduct(false)}>
          <div style={{ background: t.surface, borderRadius: 16, padding: 28, width: 440, maxWidth: "92vw", boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, fontFamily: F }}>Ajouter un produit</h2>
              <button onClick={() => setShowAddProduct(false)} style={{ background: "none", border: "none", cursor: "pointer", color: t.textMuted, padding: 4 }}>{I.x}</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div><label style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6, display: "block", fontFamily: F }}>Nom du produit</label><input value={npName} onChange={e => setNpName(e.target.value)} placeholder="Ex: Kimchi maison" autoFocus style={{ ...sel, width: "100%" }} /></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div><label style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6, display: "block", fontFamily: F }}>Catégorie</label><select value={npCat} onChange={e => setNpCat(e.target.value)} style={{ ...sel, width: "100%" }}>{stockCategories.map(c => <option key={c}>{c}</option>)}</select></div>
                <div><label style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6, display: "block", fontFamily: F }}>Unité</label><select value={npUnit} onChange={e => setNpUnit(e.target.value)} style={{ ...sel, width: "100%" }}>{["kg","g","L","pièces","canettes","bouteilles","bottes","paires","sachets"].map(u => <option key={u}>{u}</option>)}</select></div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div><label style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6, display: "block", fontFamily: F }}>Quantité actuelle</label><input value={npQty} onChange={e => setNpQty(e.target.value)} type="number" step="0.1" placeholder="0" style={{ ...sel, width: "100%" }} /></div>
                <div><label style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6, display: "block", fontFamily: F }}>Seuil d'alerte</label><input value={npSeuil} onChange={e => setNpSeuil(e.target.value)} type="number" step="0.1" placeholder="0" style={{ ...sel, width: "100%" }} /></div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button onClick={() => setShowAddProduct(false)} style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: `1px solid ${t.border}`, background: t.surface, color: t.textMuted, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: F }}>Annuler</button>
              <button onClick={addProduct} style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "none", background: npName.trim() && npQty ? t.primary : t.border, color: npName.trim() && npQty ? "#fff" : t.textMuted, fontSize: 14, fontWeight: 600, cursor: npName.trim() && npQty ? "pointer" : "default", fontFamily: F }}>Ajouter</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal déclaration sortie */}
      {showSortieModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={() => setShowSortieModal(false)}>
          <div style={{ background: t.surface, borderRadius: 16, padding: 28, width: 440, maxWidth: "92vw", boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, fontFamily: F }}>Déclarer une sortie</h2>
              <button onClick={() => setShowSortieModal(false)} style={{ background: "none", border: "none", cursor: "pointer", color: t.textMuted, padding: 4 }}>{I.x}</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6, display: "block", fontFamily: F }}>Produit</label>
                <select value={spProduct} onChange={e => setSpProduct(e.target.value)} style={{ ...sel, width: "100%" }}>
                  <option value="">Choisir un produit…</option>
                  {products.filter(p => p._uuid).map(p => <option key={p.id} value={p._uuid}>{p.name} ({p.qty} {p.unit})</option>)}
                </select>
              </div>
              <div><label style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6, display: "block", fontFamily: F }}>Quantité prélevée</label><input value={spQty} onChange={e => setSpQty(e.target.value)} type="number" step="0.1" placeholder="0" style={{ ...sel, width: "100%" }} /></div>
              <div><label style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6, display: "block", fontFamily: F }}>Note (optionnel)</label><input value={spNote} onChange={e => setSpNote(e.target.value)} placeholder="Ex: Prépa poulet frit midi" style={{ ...sel, width: "100%" }} /></div>
            </div>
            <div style={{ background: t.surfaceAlt, borderRadius: 10, padding: "10px 14px", marginTop: 16, fontSize: 13, color: t.textMuted, fontFamily: F }}>La sortie sera soumise au gérant pour validation avant de décrémenter le stock.</div>
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button onClick={() => setShowSortieModal(false)} style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: `1px solid ${t.border}`, background: t.surface, color: t.textMuted, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: F }}>Annuler</button>
              <button onClick={submitSortie} style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "none", background: spProduct && spQty ? t.primary : t.border, color: spProduct && spQty ? "#fff" : t.textMuted, fontSize: 14, fontWeight: 600, cursor: spProduct && spQty ? "pointer" : "default", fontFamily: F }}>Déclarer</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal édition produit */}
      {editingProduct && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={() => { setEditingProduct(null); setConfirmDelete(false); }}>
          <div style={{ background: t.surface, borderRadius: 16, padding: 28, width: 440, maxWidth: "92vw", boxShadow: "0 20px 60px rgba(0,0,0,0.15)", maxHeight: "90vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, fontFamily: F }}>Modifier le produit</h2>
              <button onClick={() => { setEditingProduct(null); setConfirmDelete(false); }} style={{ background: "none", border: "none", cursor: "pointer", color: t.textMuted, padding: 4 }}>{I.x}</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div><label style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6, display: "block", fontFamily: F }}>Nom du produit</label><input value={epName} onChange={e => setEpName(e.target.value)} style={{ ...sel, width: "100%" }} /></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div><label style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6, display: "block", fontFamily: F }}>Catégorie</label><select value={epCat} onChange={e => setEpCat(e.target.value)} style={{ ...sel, width: "100%" }}>{stockCategories.map(c => <option key={c}>{c}</option>)}</select></div>
                <div><label style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6, display: "block", fontFamily: F }}>Unité</label><select value={epUnit} onChange={e => setEpUnit(e.target.value)} style={{ ...sel, width: "100%" }}>{["kg","g","L","pièces","canettes","bouteilles","bottes","paires","sachets"].map(u => <option key={u}>{u}</option>)}</select></div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div><label style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6, display: "block", fontFamily: F }}>Seuil d'alerte (rouge)</label><input value={epSeuil} onChange={e => setEpSeuil(e.target.value)} type="number" step="0.1" style={{ ...sel, width: "100%" }} /></div>
                <div><label style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6, display: "block", fontFamily: F }}>Seuil de vigilance (orange)</label><input value={epSeuilOrange} onChange={e => setEpSeuilOrange(e.target.value)} type="number" step="0.1" style={{ ...sel, width: "100%" }} /></div>
              </div>
              <div style={{ background: t.surfaceAlt, borderRadius: 10, padding: "10px 14px", fontSize: 13, color: t.textMuted }}>Quantité actuelle : <span style={{ fontWeight: 700, color: t.text }}>{editingProduct.qty} {editingProduct.unit}</span> — modifiable directement dans l'inventaire.</div>
              <ProduitFournisseurs t={t} product={editingProduct} suppliers={suppliers}
                productSuppliers={productSuppliers} setProductSuppliers={setProductSuppliers} />
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              {!confirmDelete ? (
                <button onClick={() => setConfirmDelete(true)} style={{ padding: "10px 14px", borderRadius: 8, border: `1px solid ${t.danger}30`, background: t.danger + "08", color: t.danger, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: F, display: "flex", alignItems: "center", gap: 6 }}>{I.trash} Supprimer</button>
              ) : (
                <button onClick={deleteProduct} style={{ padding: "10px 14px", borderRadius: 8, border: "none", background: t.danger, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: F }}>Confirmer la suppression</button>
              )}
              <div style={{ flex: 1 }} />
              <button onClick={() => { setEditingProduct(null); setConfirmDelete(false); }} style={{ padding: "10px 16px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.surface, color: t.textMuted, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: F }}>Annuler</button>
              <button onClick={saveEditProduct} style={{ padding: "10px 16px", borderRadius: 8, border: "none", background: epName.trim() ? t.primary : t.border, color: epName.trim() ? "#fff" : t.textMuted, fontSize: 14, fontWeight: 600, cursor: epName.trim() ? "pointer" : "default", fontFamily: F }}>Enregistrer</button>
            </div>
          </div>
        </div>
      )}

      {/* Stubs Tâches 5 et 6 */}
      {showInventaire && <InventaireMode t={t} products={products} setProducts={setProducts} stockCategories={stockCategories} onClose={() => setShowInventaire(false)} />}
      {showFournisseurs && <FournisseursModal t={t} suppliers={suppliers} setSuppliers={setSuppliers} productSuppliers={productSuppliers} onClose={() => setShowFournisseurs(false)} />}
    </div>
  );
};

export default StocksModule;
