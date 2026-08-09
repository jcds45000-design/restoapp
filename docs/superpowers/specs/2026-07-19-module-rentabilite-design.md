# Module Rentabilité (food cost et marges par canal)

Date : 2026-07-19
Projet : restoapp (Kimiko)
Statut : proposition de design, en attente de validation de Jean-Claude

## Contexte

Un prototype fonctionnel a été construit et validé sur Emergent (dépôt privé
`jcds45000-design/kimiko-food-cost`) : calcul du coût matière par fiche recette,
food cost, marge par canal de vente avec prix propres à chaque canal, prix
d'équivalence Uber/Deliveroo, simulateur de prix conseillé. Les formules
(`frontend/src/lib/calc.js`) ont été vérifiées ligne par ligne.

Le prototype stocke tout en LocalStorage : inutilisable au quotidien (données
liées à un navigateur) et surtout il dupliquerait la mercuriale déjà vivante
dans restoapp (78 produits, prix entretenus par le module Stock depuis le
06/07). Décision actée avec Jean-Claude : intégrer la fonctionnalité comme
module de restoapp, avec les prix d'achat comme source de vérité unique.

L'analyse des SIG 2025 (12/07) motive le module : levier prioritaire = mix de
canaux (Uber = 30 % de commission sur ~30 % du CA) et tenue du food cost.

## Décisions de design proposées

1. **Source des coûts** : le coût d'un ingrédient = `price_ht` du fournisseur
   principal (`product_suppliers.is_primary`), interprété par unité du produit
   (`products.unit` : kg, L, pièce), converti en €/g, €/ml ou €/pièce.
   Aucun prix ressaisi, jamais.
2. **Fiches recettes** : liées aux `menu_items` existants (le menu vendu).
   Une recette = liste de lignes (produit du stock, quantité en g/ml/pièce).
   Les emballages sont des produits du stock comme les autres (catégorie
   « Emballages »), inclus dans la recette.
3. **Prix par canal** : nouvelle table dédiée plutôt qu'une colonne jsonb,
   pour rester requêtable. Canaux : sur_place, click_collect, uber_eats,
   deliveroo, avec commission paramétrable. `menu_items.price` reste le prix
   de référence sur place (pas de migration destructive).
4. **Confidentialité** : les marges et prix d'achat sont des données du
   gérant. RLS : lecture et écriture réservées au gérant sur les nouvelles
   tables (comme l'écriture products/suppliers). Le module n'apparaît pas
   dans la navigation des employés.
5. **Dépôt public** : aucune donnée de prix dans le code ni les migrations
   committées. La migration SQL du module suit le modèle de la migration 3 :
   fichier local non committé, exécuté une fois dans Supabase.
6. **Logique pure** : portage de calc.js vers `src/lib/rentabilite.js`
   (adapté aux structures restoapp) avec tests vitest complets, y compris
   les cas limites déjà identifiés (conversion ×1000, TVA, commission 100 %,
   marge cible 100 %, prix par canal manquant → repli sur place).
7. **Mobile d'abord** : tous les écrans vérifiés en 390x844, comme le veut
   la convention restoapp. Usage principal attendu : consultation des marges
   au téléphone, saisie des recettes plutôt sur PC.

## Schéma de données (nouvelles tables)

```sql
-- Lignes de recette d'un item du menu
create table recipe_lines (
  id uuid primary key default uuid_generate_v4(),
  menu_item_id uuid not null references menu_items(id) on delete cascade,
  product_id uuid not null references products(id) on delete restrict,
  qty numeric not null check (qty > 0),          -- en unité recette
  unit text not null check (unit in ('g','ml','piece')),
  created_at timestamptz default now(),
  unique (menu_item_id, product_id)
);

-- Prix de vente TTC par canal (absence de ligne = repli sur menu_items.price)
create table menu_item_channel_prices (
  id uuid primary key default uuid_generate_v4(),
  menu_item_id uuid not null references menu_items(id) on delete cascade,
  channel text not null check (channel in ('sur_place','click_collect','uber_eats','deliveroo')),
  price_ttc numeric not null check (price_ttc >= 0),
  unique (menu_item_id, channel)
);

-- Paramètres du module (une seule ligne)
create table rentabilite_settings (
  id int primary key default 1 check (id = 1),
  tva numeric not null default 10,
  seuil_food_cost numeric not null default 30,
  commissions jsonb not null default '{"sur_place":0,"click_collect":0,"uber_eats":30,"deliveroo":30}'
);
```

RLS sur les trois tables : `select/insert/update/delete` réservés au rôle
gérant (même mécanisme que l'écriture `products`).

## Écrans (onglet « Rentabilité », visible gérant seul)

1. **Tableau de bord** : liste des items du menu avec coût matière, food
   cost %, marge sur place, statut couleur (seuils du prototype : vert,
   orange, rouge), tri et recherche. Items sans recette signalés « à
   compléter ».
2. **Éditeur de recette** (depuis un item) : lignes ingrédient + quantité
   avec recherche dans les produits du stock, coût matière recalculé en
   direct, prix par canal avec équivalence sur place affichée et bouton
   « Appliquer », tableau de rentabilité par canal avec écart vs sur place.
3. **Simulateur** : marge cible + canal → prix TTC conseillé (arrondi aux
   10 centimes supérieurs).
4. **Paramètres** : TVA, seuil food cost, commissions par canal (section
   dans l'écran Réglages existant ou dans l'onglet, à trancher à
   l'implémentation).

## Hors périmètre (volontairement)

- Branchement au CA réel (attend l'accès aux données Bill) : le schéma le
  permettra (recettes reliées aux menu_items que les ventes référencent).
- Historisation des prix d'achat et évolution des marges dans le temps.
- Import CSV : inutile, les produits sont déjà en base.
- Multi-recettes par item (variantes) : une recette par item au départ.

## Réponses aux questions ouvertes (validées le 19/07)

1. **La carte** : l'état de `menu_items` côté restoapp n'est pas vérifiable
   sans authentification (la RLS bloque la lecture anonyme, ce qui est sain) ;
   la requête anonyme du 19/07 revenait vide mais ne prouve rien. Peu importe :
   l'import fonctionne en upsert, table vide ou non. La carte réelle vit dans
   la base Supabase du site kimiko-orleans.fr
   (78 items, 13 catégories, vérifié dans la sauvegarde du 18/06). Décision :
   un script d'import (local, non committé) recopie la carte du site vers
   `menu_items`, en upsert par nom, relançable quand la carte change. Le CMS
   du site reste la source de vérité du menu ; restoapp porte les recettes
   et les prix par canal. Au passage, l'import signalera les doublons repérés
   dans la carte du site (« Matcha fraise » en double, « Matcha mangue » /
   « Matcha Mangue », item technique « ONIGIRI UBER ») pour nettoyage dans
   l'admin du site.
2. **Emballages** : validé, ils entrent au module Stock lors de la mise en
   service (une dizaine de références, feuille Emballages de la mercuriale).
3. **Confidentialité** : validé, marges visibles uniquement gérant et
   Jean-Claude.
