import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { F } from '../lib/foundation';
import { supplierLinksOf } from '../lib/stock';

// Section fournisseurs dans la modale d'édition d'un produit (gérant uniquement).
// Props : { t, product, suppliers, productSuppliers, setProductSuppliers }
const ProduitFournisseurs = ({ t, product, suppliers, productSuppliers, setProductSuppliers }) => {
  // État du formulaire d'ajout
  const [addSupplierId, setAddSupplierId] = useState('');
  const [addPrice, setAddPrice] = useState('');

  const sel = {
    padding: '6px 10px', borderRadius: 8, border: `1px solid ${t.border}`,
    fontSize: 13, fontFamily: F, background: t.surface, color: t.text, outline: 'none',
  };

  // Si le produit n'est pas encore enregistré en DB
  if (!product._uuid) {
    return (
      <div style={{ background: t.surfaceAlt, borderRadius: 10, padding: '10px 14px', fontSize: 13, color: t.textMuted, fontFamily: F, marginTop: 4 }}>
        Enregistre d'abord le produit pour gérer ses fournisseurs.
      </div>
    );
  }

  const links = supplierLinksOf(product._uuid, productSuppliers, suppliers);

  // Fournisseurs actifs non encore liés à ce produit
  const linkedIds = new Set(productSuppliers.filter(l => l.product_id === product._uuid).map(l => l.supplier_id));
  const availableSuppliers = suppliers.filter(s => s.active !== false && !linkedIds.has(s.id));

  // Définir le fournisseur principal (deux updates séquentiels pour respecter l'index unique partiel)
  const setPrimary = async (link) => {
    const old = productSuppliers.find(l => l.product_id === product._uuid && l.is_primary && l.id !== link.id);
    if (old) {
      const { error: e1 } = await supabase.from('product_suppliers').update({ is_primary: false }).eq('id', old.id);
      if (e1) { alert('Erreur : ' + e1.message); return; }
    }
    const { error } = await supabase.from('product_suppliers').update({ is_primary: true }).eq('id', link.id);
    if (error) { alert('Erreur : ' + error.message); return; }
    setProductSuppliers(prev => prev.map(l =>
      l.product_id !== product._uuid ? l : { ...l, is_primary: l.id === link.id }
    ));
  };

  // Mettre à jour le prix HT au blur
  const updatePrice = async (link, rawValue) => {
    const parsed = rawValue === '' ? null : parseFloat(rawValue);
    if (parsed !== null && isNaN(parsed)) return;
    const { error } = await supabase.from('product_suppliers').update({ price_ht: parsed }).eq('id', link.id);
    if (error) { alert('Erreur : ' + error.message); return; }
    setProductSuppliers(prev => prev.map(l => l.id === link.id ? { ...l, price_ht: parsed } : l));
  };

  // Retirer un lien fournisseur
  const removeLink = async (link) => {
    const { error } = await supabase.from('product_suppliers').delete().eq('id', link.id);
    if (error) { alert('Erreur : ' + error.message); return; }
    setProductSuppliers(prev => prev.filter(l => l.id !== link.id));
  };

  // Ajouter un fournisseur à ce produit
  const addLink = async () => {
    if (!addSupplierId) return;
    const price = addPrice === '' ? null : parseFloat(addPrice);
    if (price !== null && isNaN(price)) return;
    const hasPrimary = productSuppliers.some(l => l.product_id === product._uuid && l.is_primary);
    const { data, error } = await supabase
      .from('product_suppliers')
      .insert({ product_id: product._uuid, supplier_id: addSupplierId, price_ht: price, is_primary: !hasPrimary })
      .select()
      .single();
    if (error) { alert('Erreur : ' + error.message); return; }
    setProductSuppliers(prev => [...prev, data]);
    setAddSupplierId('');
    setAddPrice('');
  };

  return (
    <div style={{ marginTop: 8 }}>
      {/* Titre de section */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: t.textMuted, letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: F }}>
          Fournisseurs
        </span>
        {product.priceUnit != null && (
          <span style={{ fontSize: 12, color: t.textMuted, fontFamily: F }}>
            Prix mercuriale : {product.priceUnit} € HT/{product.unit}
          </span>
        )}
      </div>

      {/* Liste des liaisons existantes */}
      {links.length === 0 && (
        <div style={{ fontSize: 13, color: t.textMuted, fontFamily: F, marginBottom: 8 }}>
          Aucun fournisseur lié.
        </div>
      )}
      {links.map(link => (
        <div key={link.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          {/* Bouton principal */}
          <button
            onClick={() => !link.is_primary && setPrimary(link)}
            title={link.is_primary ? 'Fournisseur principal' : 'Définir comme principal'}
            style={{
              background: 'none', border: 'none', cursor: link.is_primary ? 'default' : 'pointer',
              fontSize: 16, padding: 0, lineHeight: 1, color: link.is_primary ? t.warning : t.border,
            }}
          >
            {link.is_primary ? '⭐' : '☆'}
          </button>

          {/* Nom du fournisseur */}
          <span style={{ flex: 1, fontSize: 13, fontWeight: 500, fontFamily: F }}>
            {link.supplier ? link.supplier.name : '—'}
          </span>

          {/* Prix HT */}
          <input
            type="number"
            step="0.01"
            placeholder="prix HT"
            defaultValue={link.price_ht ?? ''}
            key={link.id + '_price'}
            onBlur={e => updatePrice(link, e.target.value)}
            style={{ ...sel, width: 80, textAlign: 'right' }}
          />
          <span style={{ fontSize: 12, color: t.textMuted, fontFamily: F }}>€</span>

          {/* Retirer */}
          <button
            onClick={() => removeLink(link)}
            title="Retirer ce fournisseur"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.textMuted, fontSize: 16, padding: '0 2px', lineHeight: 1 }}
          >
            ✕
          </button>
        </div>
      ))}

      {/* Formulaire ajout fournisseur */}
      {availableSuppliers.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <select
            value={addSupplierId}
            onChange={e => setAddSupplierId(e.target.value)}
            style={{ ...sel, flex: 1 }}
          >
            <option value="">+ Ajouter un fournisseur…</option>
            {availableSuppliers.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <input
            type="number"
            step="0.01"
            placeholder="prix HT"
            value={addPrice}
            onChange={e => setAddPrice(e.target.value)}
            style={{ ...sel, width: 80, textAlign: 'right' }}
          />
          <span style={{ fontSize: 12, color: t.textMuted, fontFamily: F }}>€</span>
          <button
            onClick={addLink}
            disabled={!addSupplierId}
            style={{
              padding: '6px 12px', borderRadius: 8, border: 'none',
              background: addSupplierId ? t.primary : t.border,
              color: addSupplierId ? '#fff' : t.textMuted,
              fontSize: 13, fontWeight: 600, cursor: addSupplierId ? 'pointer' : 'default', fontFamily: F,
            }}
          >
            Lier
          </button>
        </div>
      )}
    </div>
  );
};

export default ProduitFournisseurs;
