# Catégories de tâches éditables (CRUD)

Date : 2026-06-23
Statut : design validé

## Objectif

Permettre au gérant de créer, renommer et supprimer les catégories de tâches
(aujourd'hui figées dans le code : Service, Cuisine, Nettoyage, Stock, Admin, Autre),
directement depuis l'appli.

## Décisions validées

- **Stockage** : nouvelle table Supabase `task_categories` (pas un tableau dans un
  réglage). Initialisée avec les 6 catégories actuelles.
- **Où** : section « Catégories de tâches » dans **Réglages**, visible en mode **gérant**.
- **Ajouter** : la catégorie apparaît partout (filtre + choix à la création/édition de tâche).
- **Renommer** : toutes les tâches portant l'ancien nom prennent le nouveau (bulk update).
- **Supprimer** : les tâches concernées passent dans « Autre » (bulk update), puis la
  catégorie est supprimée.
- **« Autre » est protégée** : non supprimable (c'est la cible de réaffectation).
- **Modèle du jour** : option (a) retenue. Le TEMPLATE codé en dur n'est PAS modifié par
  cette fonctionnalité. Conséquence assumée : supprimer/renommer une des 5 catégories de
  base que le modèle utilise fera réapparaître l'ancien nom sur les tâches générées.
  Rendre le modèle éditable = chantier séparé, ultérieur.

## Modèle de données

- Table `task_categories` : `id uuid pk default gen_random_uuid()`, `name text not null
  unique`, `sort_order int not null default 0`, `created_at timestamptz default now()`.
- Seed : Service, Cuisine, Nettoyage, Stock, Admin, Autre (sort_order 1..6).
- `tasks.category` reste un **texte** (pas de clé étrangère) : le renommage/suppression
  agit par bulk update sur ce texte. Évite un gros refactor et reste cohérent avec
  l'existant (le TEMPLATE et le code manipulent la catégorie en texte).
- RLS : lecture + écriture pour utilisateur authentifié, en miroir des tables existantes
  (le filtrage gérant est côté client, comme le reste de l'app aujourd'hui).
- À appliquer par Jean-Claude via le SQL Editor de Supabase (DDL non applicable à distance).

## Implémentation (côté app)

- **Chargement** : au démarrage (là où `tasks`/`products` sont chargés dans `RestoApp.jsx`),
  charger `task_categories` triées par `sort_order` dans un état `categories`.
- **`foundation.jsx`** : l'export figé `categoryList` est retiré (ou conservé seulement
  comme valeurs de seed/repli). Les composants reçoivent la liste dynamique.
- **UI Réglages (`SettingsModule.jsx`)** : section gérant « Catégories de tâches » :
  - liste ordonnée des catégories ;
  - ajouter (champ + bouton ; refuse vide et doublon, comparaison trim/insensible aux
    espaces) ;
  - renommer (édition en ligne) -> update `task_categories.name` + `update tasks set
    category = <new> where category = <old>` ;
  - supprimer (confirmation, affiche le nb de tâches concernées) -> `update tasks set
    category = 'Autre' where category = <old>` puis delete de la ligne ; « Autre » sans
    bouton supprimer.
- **Branchements** : filtre catégories, select catégorie du formulaire d'ajout/édition de
  tâche, `CategoryTag` (inchangé visuellement) -> tous lisent la liste dynamique.

## Hors périmètre (YAGNI)

- Le TEMPLATE du jour reste codé (cf. décision option a).
- Pas de couleur par catégorie (l'étiquette garde la couleur primaire actuelle).
- Pas de clé étrangère `tasks.category` -> `task_categories`.
- Pas de réordonnancement manuel des catégories par glisser-déposer (ordre = ordre de
  création ; ajustable plus tard si besoin).

## Points d'attention

- Noms uniques (contrainte `unique`) : empêcher les doublons à la saisie aussi côté UI.
- « Autre » doit toujours exister (cible de réaffectation) : protégée à la suppression.
- Renommer « Autre » : autorisé mais déconseillé ; si fait, la cible de réaffectation
  reste « Autre » par nom -> on protège aussi le renommage de « Autre » (plus simple).

## Vérification

- `npm run build` + tests vitest (extraire la logique de réaffectation/renommage en
  fonction pure testable si pertinent).
- Test navigateur : ajouter une catégorie (visible au filtre + au formulaire), renommer
  (tâches mises à jour), supprimer (tâches basculées dans « Autre »), « Autre » non
  supprimable.
- Déploiement : push sur `main` -> Vercel redéploie.
