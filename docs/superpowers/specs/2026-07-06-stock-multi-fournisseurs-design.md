# Refonte stock multi-fournisseurs — Design

**Date :** 2026-07-06
**Statut :** validé par JC section par section (session du 06/07)
**Périmètre :** remplacement de la gestion de stock de restoapp par le modèle « inventaire physique régulier » avec fournisseurs multiples par produit.

---

## 1. Objectif

Le stock actuel n'est pas exploité. On le remplace par une vraie gestion :

- Quelqu'un (gérant **ou employé**) compte ce qui reste 1 à 2 fois par semaine, sur téléphone.
- L'appli compare aux seuils et produit une **liste de courses classée par fournisseur**, partageable en texte (WhatsApp/SMS).
- La saisie de sortie rapide est conservée uniquement pour les grosses pertes (casse, erreur), avec validation gérant.
- Chaque produit peut avoir **plusieurs fournisseurs** (un principal + des alternatives), car les achats se font selon dispo et prix.

Source des données : mercuriale Kimiko (65 matières + 14 emballages, prix HT normalisés) + rapprochement fournisseurs **validé à la main par JC le 06/07** (63/65 produits avec fournisseur principal). 10 fournisseurs réels issus du catalogue factures : Metro, LX France, SDA Centre, Kedy Pack, Leclerc, Pomme Rouge, Auchan, Carrefour, ABN Distribution, C Pro.

## 2. Décisions actées

| Décision | Choix |
|---|---|
| Périmètre import | 79 produits : 65 matières validées + 14 emballages (Kedy Pack par défaut) |
| Données existantes | Table `products` vidée (données de démo), remplacée intégralement |
| Catégories | Les 6 catégories larges existantes de l'appli, mapping depuis les 15 catégories mercuriale |
| Seuils | Importés à `null` = « à définir », remplis au fil de l'eau dans l'appli |
| Qui compte | Tout salarié connecté (via fonction dédiée), gestion produits/fournisseurs = gérant |
| Modèle de données | Tables normalisées `suppliers` + `product_suppliers` (approche B) |
| Import | Script SQL one-shot généré depuis l'Excel validé, lancé dans Supabase SQL Editor |
| Comptage UI | Mode inventaire guidé plein écran, **avec sommaire des catégories** (ordre libre) |
| Fournisseurs | CRUD dans l'appli (gérant) : ajouter, renommer, désactiver ; suppression réelle seulement si aucune liaison |

## 3. Modèle de données

### 3.1 Nouvelles tables

```sql
create table suppliers (
  id uuid primary key default uuid_generate_v4(),
  name text not null unique,
  active boolean default true,
  note text default '',
  created_at timestamptz default now()
);

create table product_suppliers (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid not null references products(id) on delete cascade,
  supplier_id uuid not null references suppliers(id) on delete cascade,
  price_ht numeric,              -- prix HT relevé, null si inconnu
  is_primary boolean default false,
  note text default '',
  created_at timestamptz default now(),
  unique (product_id, supplier_id)
);

-- Un seul fournisseur principal par produit
create unique index product_suppliers_one_primary
  on product_suppliers (product_id) where is_primary;
```

### 3.2 Table `products` (adaptée)

- Conservées : `name`, `category`, `unit`, `qty`, `seuil`, `seuil_orange`, `stock_current`, `stock_min`, `stock_max`, `active`.
- `price_unit` = **prix mercuriale HT normalisé** (au kg/L/pièce), sert de référence pour valoriser le stock.
- `supplier` (texte, jamais utilisé) : **supprimée**, remplacée par `product_suppliers`.
- `seuil` et `seuil_orange` : `null` = « à définir ». Un produit sans seuil n'est **jamais** en alerte (état neutre avec badge), sinon tout serait rouge au jour 1.

### 3.3 Table `stock_movements` (existante, enfin utilisée)

Devient la trace de tout ce qui touche au stock. Colonnes ajoutées :

```sql
alter table stock_movements add column if not exists status text default 'validated'
  check (status in ('pending','validated','rejected'));
alter table stock_movements add column if not exists employee_name text default '';
alter table stock_movements add column if not exists qty_before numeric;
alter table stock_movements add column if not exists qty_after numeric;
```

- **Comptage** : 1 ligne `type='adjustment'`, statut `validated`, avec qty_before/qty_after, employee_name, horodatage.
- **Sortie perte** : 1 ligne `type='out'`, statut `pending` à la déclaration ; le gérant valide (décrément du stock) ou refuse. Corrige le bug actuel : les sorties ne sont jamais persistées et disparaissent au rechargement de la page.

### 3.4 Mapping des 15 catégories mercuriale vers les 6 de l'appli

| Mercuriale | Appli |
|---|---|
| Viandes, Poisson | Viandes & Poissons |
| Sauces, Assaisonnement, Huiles | Sauces & Condiments |
| Produits laitiers, Œufs, Fruits & légumes, Entrées | Légumes & Frais |
| Féculents, Épicerie, Boulangerie | Sec & Féculents |
| Boissons, Boissons canettes | Boissons |
| Emballages (mercuriale, 14 items) | Emballages & Consommables |
| Corndog | ventilée par produit : Saucisses → Viandes & Poissons ; Mozzarella → Légumes & Frais ; Panko, Farine T45, Corn Flakes → Sec & Féculents |

Le mapping final produit par produit est visible dans le script SQL généré (relisible avant exécution).

## 4. Import

**Un seul script** `supabase_migration3_stock.sql` (structure + RLS + fonction + données), généré par un script Python dans `jarvis-starter-kit/context/import/` (à côté des scripts de rapprochement existants). Exécution en **une transaction** dans Supabase SQL Editor : tout ou rien, relançable.

Nettoyages faits par le générateur (pas à la charge de JC) :

- Casse normalisée vers les noms canoniques : « auchan » → Auchan, « Lx France » → LX France, « Pomme rouge » → Pomme Rouge, « SDA » → SDA Centre.
- Prix entre parenthèses extraits : « Metro (3.69 HT) » → liaison Metro, price_ht = 3.69.
- Cellules multi-fournisseurs découpées : « SDA; Metro » → 2 liaisons, la première citée = principal.
- Colonne « Autres fournisseurs » → liaisons non principales.

Exclusions volontaires :

- **Pas d'import des prix bruités** du catalogue factures (mélange de conditionnements : Œufs 0–45 €, Mayo 3,73–25,48 €). Seuls les prix explicites et propres sont importés ; le reste se remplit dans l'appli au fil des factures.
- Sriracha Flying Goose et Matcha premium : importés **sans fournisseur** (non validés), badge « sans fournisseur ».
- Pas d'écran d'import dans l'appli : usage unique.

## 5. Écrans

Nouveaux composants séparés pour ne pas faire grossir `StocksModule.jsx` (359 lignes) : `InventaireMode.jsx`, `FournisseursModal.jsx`. `StocksModule` reste le coordinateur.

### 5.1 Mode inventaire guidé (tout utilisateur connecté)

- Bouton « Faire l'inventaire » dans l'onglet Stocks.
- S'ouvre sur un **sommaire des catégories** avec progression par catégorie (« Viandes & Poissons — 3/9 ») ; on tape une catégorie pour la compter, retour au sommaire, **ordre libre**.
- Dans une catégorie : produit par produit, gros champ de saisie, dernière quantité connue affichée, boutons « Suivant » / « Passer ».
- **« Passer » ≠ 0** : passer ne touche pas la quantité ; saisir 0 = il n'y en a vraiment plus.
- **Sauvegarde au fil de l'eau** : chaque produit compté est enregistré immédiatement (appel `enregistrer_comptage`). Une coupure réseau ne fait perdre que le produit en cours (message + nouvelle tentative).
- La progression du jour se calcule depuis les traces `stock_movements` du jour : on peut s'arrêter et reprendre, même sur un autre téléphone.

### 5.2 Liste de courses par fournisseur

- Groupée par **fournisseur principal**, en-tête par groupe : nom, nombre de produits, **coût estimé HT** (quand les prix sont connus).
- Quantité à commander : formule actuelle conservée (remonter au-dessus du seuil orange, marge 20 %).
- Groupe « Sans fournisseur » en fin de liste.
- Bouton **« Partager la liste »** : export texte prêt à envoyer (WhatsApp/SMS).

### 5.3 Fiche produit (gérant)

- Nouvelle section Fournisseurs : principal (étoile), alternatives, prix HT modifiable, ajouter/retirer une liaison, changer le principal.
- Affiche le prix mercuriale de référence.

### 5.4 Gestion des fournisseurs (gérant)

- Bouton « Fournisseurs » dans l'onglet Stocks : liste, ajouter, renommer, désactiver.
- Un fournisseur lié à des produits se **désactive** (disparaît des choix, liaisons et historique conservés). Suppression réelle uniquement si aucune liaison.

### 5.5 Inventaire (liste) et badges

- Badge « seuil à définir » (gris) sur les produits sans seuil ; filtre pour les retrouver et les remplir progressivement.
- Badge « sans fournisseur » sur les produits non rattachés.
- Le clic-pour-éditer la quantité existant reste pour les corrections ponctuelles du gérant.

## 6. Sécurité (RLS)

Continuité du durcissement de `security/rls_hardening_2026-06-29.sql` :

- `suppliers`, `product_suppliers` : lecture pour tout utilisateur connecté, écriture gérant (`private.is_gerant()`), anonyme bloqué.
- `products` : inchangé, écriture gérant uniquement. Les employés ne peuvent PAS modifier seuils/prix/noms via l'API.
- **`enregistrer_comptage(product_id, nouvelle_qty)`** : fonction Postgres `security definer`, seul canal d'écriture ouvert aux employés. Vérifie que l'appelant est un salarié actif connu (ou gérant), met à jour `qty`/`stock_current` uniquement, insère la trace dans `stock_movements`. Refuse les quantités négatives.
- `stock_movements` : lecture connectée ; insertion connectée (déclaration de sortie en `pending`) ; validation/refus/suppression = gérant.
- n8n : passe par service_role (contourne la RLS), aucun impact.

## 7. Cas limites

- Import : transaction unique, tout ou rien, relançable.
- Produit sans seuil : jamais en alerte.
- Fournisseur désactivé : hors des choix, liaisons conservées.
- Écritures concurrentes sur une quantité : dernière écriture gagne (acceptable à cette échelle).
- 2 produits sans fournisseur : visibles avec badge, dans le groupe « Sans fournisseur » de la liste de courses.

## 8. Vérification avant prod

1. Build + vérification locale Playwright : connexion, comptage complet d'une catégorie, reprise d'inventaire, liste de courses groupée, partage texte, déclaration + validation de sortie, CRUD fournisseur.
2. Test des politiques RLS (comme l'audit sécurité) : anonyme bloqué partout, employé ne peut ni modifier un seuil ni écrire dans `products` directement mais peut appeler `enregistrer_comptage`, gérant peut tout.
3. Validation visuelle par JC en local **avant tout commit**.
4. Commit, push, déploiement Vercel, re-vérification en prod.

## 9. Hors périmètre (volontairement)

- Bons de commande / réception fournisseurs (approche C) : la liste de courses suffit pour commander par téléphone.
- Food cost / fiches recettes (modèle 3, déduction depuis les ventes Bill) : étape suivante, ce design en pose les fondations (prix par fournisseur + prix mercuriale normalisé).
- Historique des prix par fournisseur : la structure le permet (une liaison porte un prix), l'historisation viendra si besoin.
- Écran d'import : usage unique, hors appli.
