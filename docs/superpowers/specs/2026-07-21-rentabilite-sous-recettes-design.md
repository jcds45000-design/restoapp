# Module Rentabilité v2 — recettes, sous-recettes et rendements

Date : 2026-07-21
Projet : restoapp (Kimiko)
Statut : design validé avec Jean-Claude (brainstorming du 21/07), en attente de sa relecture du présent document avant le plan d'implémentation.

> **Dépôt public.** Aucune vraie recette Kimiko ni prix d'achat n'apparaît dans ce document ni dans les fichiers committés. Les exemples ci-dessous utilisent des chiffres ronds inventés. Les vraies recettes et les prix vivent en base Supabase et dans le workspace privé.

## Contexte

Le module Rentabilité v1 modélise une recette comme une **liste plate** de produits (`recipe_lines` = `menu_item_id` + `product_id` + `qty`). Or les recettes réelles de Kimiko sont :
- **imbriquées** : une préparation maison (marinade, pâte, poulet frit) sert d'ingrédient à plusieurs produits vendus ;
- **produites au batch** : une recette produit N pièces/portions/kg, et le coût d'une unité vendue = coût du batch ÷ rendement.

L'outil qui assurait ce calcul (Ratatool) n'est plus accessible (abonnement arrêté, lecture seule). restoapp doit donc le remplacer : coster toute la carte à partir des prix du Stock, en gérant sous-recettes et rendements, tout en conservant les marges par canal déjà présentes dans le module.

## Décisions validées (21/07)

1. **Modèle « recette-batch réutilisable »** : une recette a un rendement ; les articles de la carte pointent une recette + un nombre d'unités (Approche A). Pas de recette dupliquée par format.
2. **Rattachement article → recette à la main**, avec **pré-remplissage suggéré** quand le nom de l'article est clair (ex : « Wings x5 » → recette Wings, 5). L'utilisateur valide ou corrige.
3. **Refonte propre** du schéma : `recipe_lines` est vierge en base, aucune migration de données à prévoir.
4. **Override manuel partout** : le coût calculé d'une **ligne** comme d'une **recette entière** peut être forcé à la main. Toujours signalé (pastille), toujours réversible (retour au calcul auto).
5. **Statut « sous-recette seulement »** (case à cocher, décochée par défaut) : masque une recette de la liste des articles vendables. Une recette non cochée reste utilisable comme sous-recette d'une autre.
6. **Détail par canal** conservé et mis en avant (logique déjà présente, façon prototype Emergent) : marge par canal, prix pour tenir la marge malgré la commission, simulateur.

## Modèle de données

Trois tables nouvelles ou refondues, plus deux conservées. **Toutes en RLS gérant** (lecture et écriture réservées au gérant, invisibles employé/anonyme).

### `recipes` (nouveau)
| colonne | type | rôle |
|---|---|---|
| id | uuid PK | |
| nom | text | nom de la recette |
| rendement_valeur | numeric > 0 | ex : 10 (pièces), 1 (portion) |
| rendement_unite | text in (`piece`,`portion`,`kg`,`l`) | unité produite par le batch |
| sous_recette_seulement | bool (défaut false) | true = jamais vendue, sert d'ingrédient |
| cout_force | numeric null | si renseigné, écrase le coût calculé du batch |
| categorie | text null | libre (ex : « Poulet frit »), pour trier |

### `recipe_lines` (refonte)
| colonne | type | rôle |
|---|---|---|
| id | uuid PK | |
| recipe_id | uuid FK recipes (cascade) | recette parente |
| product_id | uuid FK products null | cible : un produit du Stock |
| sous_recette_id | uuid FK recipes null | cible : une autre recette |
| qty | numeric > 0 | quantité |
| unit | text | `g`/`ml`/`piece` pour un produit ; l'unité de rendement de la sous-recette sinon |
| cout_force | numeric null | si renseigné, écrase le coût calculé de la ligne |

Contrainte base : **exactement un** de `product_id` / `sous_recette_id` est renseigné (CHECK). Les cycles (A → B → A) ne sont pas empêchés par les FK ; ils sont gérés applicativement (voir Garde-fous).

### Lien carte → recette
Sur chaque article vendu :
| colonne (sur `menu_items`) | type | rôle |
|---|---|---|
| recipe_id | uuid FK recipes null | la recette qui coste cet article (null = « à compléter ») |
| recipe_qty | numeric > 0 | nombre d'unités de rendement (ex : 5 pièces) |

### Conservées telles quelles
`menu_item_channel_prices` (prix de vente TTC par canal) et `rentabilite_settings` (TVA, seuil food cost, commissions par canal). Inchangées.

## Logique de calcul (pure, récursive, testée)

Toute la logique vit dans `src/lib/rentabilite.js` (aucune dépendance UI/Supabase), étendue en TDD.

**Coût d'un produit par unité recette** (existant, conservé)
`prixParUniteRecette(product, suppliers)` : prix du fournisseur principal, à défaut la mercuriale (`product.priceUnit`), converti en €/g, €/ml ou €/pièce. `null` si aucun prix (jamais 0).

**Coût d'une recette** (nouveau, récursif)
`coutRecette(recette, recettes, lignesParRecette, produits, suppliers, pile)` retourne `{ total, coutParUnite, incomplet, details }` :
- si `recette.cout_force` renseigné → `total = cout_force` (marqué forcé), on s'arrête ;
- sinon on somme les lignes de la recette :
  - **ligne produit** : `cout_force` si renseigné, sinon `prixParUniteRecette × qty` ; si le prix est `null` → recette **incomplète**, la ligne est signalée ;
  - **ligne sous-recette** : `cout_force` si renseigné, sinon `coutRecette(sous).coutParUnite × qty` (récursion) ; si la sous-recette est incomplète, l'incomplétude **remonte** ;
- `coutParUnite = total / rendement_valeur` si `rendement_valeur > 0`, sinon incomplet (« rendement manquant »).

**Coût d'un article de carte**
`coutArticle(menuItem, ...) = coutRecette(recette).coutParUnite × recipe_qty`. Incomplet si la recette est incomplète, ou si l'article n'a pas de recette rattachée.

**Marges par canal** (existant, inchangé) : `rentabiliteCanal`, `prixEquivalence`, `prixConseille` s'appliquent sur `coutArticle`. Pas de modification de cette partie.

## Écrans

### Écran 1 — Recettes (nouveau)
- **Liste** de toutes les recettes : nom, rendement, coût par unité calculé, statut (vendable / sous-recette seulement), alerte si coût incomplet.
- **Éditeur d'une recette** : nom ; rendement (valeur + unité) ; case « sous-recette seulement » ; lignes (ajouter un **produit du Stock** ou une **sous-recette** via recherche, quantité, coût de la ligne en direct, bouton « forcer » réversible) ; en pied : coût du batch, coût par unité, et override du coût total.

### Écran 2 — Ta carte (évolution du tableau de bord actuel)
- Liste des articles vendus avec **prix de vente, coût matière, marge €, food cost coloré** (vert/orange/rouge selon le seuil).
- Chaque article affiche **« Recette : X × N »**, modifiable. À l'ouverture d'un article sans recette, une **suggestion pré-remplie** est proposée si le nom est clair. Article sans recette = « à compléter » (jamais une erreur).

### Écran 3 — Détail d'un article (au clic)
- En tête : la recette rattachée, le coût matière.
- **Une carte par canal** (sur place, click & collect, Uber Eats, Deliveroo), empilées (lisibles au téléphone, pas de tableau qui défile) : prix de vente, montant prélevé par la plateforme, encaissé HT, marge € et marge % colorée, et le conseil **« pour tenir ta marge du sur-place, vends à X € »** avec un bouton **Appliquer**.
- En bas : **simulateur** (marge cible → prix conseillé pour un canal).

**Mobile d'abord** : la saisie des recettes se fera surtout sur PC ; la consultation carte/détail au téléphone. Tous les écrans vérifiés en 390×844.

## Garde-fous / cas limites

- **Boucle infinie** (A contient B contient A) : détectée via la pile de récursion ; la recette est marquée incomplète (« boucle détectée ») au lieu de boucler. À la saisie, on ne propose pas comme sous-recette une recette qui contient déjà la recette éditée.
- **Coût incomplet** : un produit sans prix ne vaut jamais 0 ; la recette devient « incomplète » et l'alerte **remonte l'arbre** jusqu'à l'article.
- **Sous-recette sans rendement** (0 ou vide) : bloquée avec message clair (division impossible).
- **Suppression** d'un produit ou d'une recette utilisé ailleurs : avertissement (« utilisé dans N recettes ») avant action, pas de casse silencieuse.
- **Article sans recette** : « à compléter », jamais une erreur bloquante.
- **Valeur forcée** : signalée par une pastille partout où elle apparaît, réversible d'un clic (« auto »).

## Tests

- Logique pure en TDD : coût récursif avec sous-recettes, fractions de sous-recette, conversion d'unités (×1000), rendement appliqué, détection de cycle, coût incomplet qui remonte, override ligne et recette, rendement manquant.
- Les 34 tests existants du module restent verts (marges par canal, équivalence, prix conseillé, couleurs).
- **Validation visuelle de Jean-Claude en local (desktop + 390×844) avant tout commit.**

## Hors périmètre (volontairement)

- Branchement au CA réel / ventes (attend l'accès aux données de la caisse Bill).
- Historisation des prix d'achat et des marges dans le temps.
- Variantes multiples par article au-delà du couple (recette + facteur).
- Nutrition / allergènes (Ratatool les gérait ; non nécessaires ici).

## Migration et confidentialité

- `recipe_lines` est refondu (table vierge, aucune donnée à migrer).
- La migration SQL (nouvelles colonnes/tables + RLS) est un **fichier local non committé**, exécuté une fois dans Supabase, selon la pratique établie du dépôt (les migrations du module ne sont pas committées car le dépôt est public).
- Aucune vraie recette ni prix ne part sur le dépôt.
