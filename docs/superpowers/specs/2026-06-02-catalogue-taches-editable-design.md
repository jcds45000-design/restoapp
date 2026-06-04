# Catalogue de tâches éditable (ajouter / modifier / retirer)

Date : 2026-06-02
Projet : restoapp (Kimiko)
Statut : design validé, en attente du plan d'implémentation

## Contexte

La liste des tâches (`TASK_TEMPLATES`) et le statut « corvée » (`CORVEES`) sont aujourd'hui codés en dur dans `src/RestoApp.jsx` / `src/lib/taskDispatch.js`. Le gérant ne peut ni ajouter, ni modifier, ni retirer une tâche de la liste. On veut rendre ce catalogue éditable, stocké en base de données.

## Objectifs

- Ajouter une nouvelle tâche au catalogue.
- Modifier une tâche existante (titre, moment, catégorie, priorité, corvée).
- Retirer une tâche du catalogue.
- Que ces changements se reflètent automatiquement dans la grille Semaine et dans la génération équitable.

## Décisions

1. CRUD complet : ajouter, modifier, retirer.
2. Champs d'une tâche : **titre**, **moment** (ouverture / service / fermeture), **catégorie**, **priorité** (haute / moyenne / basse), **corvée** (oui / non).
3. Emplacement de la gestion : **Paramètres → section « Liste des tâches »**.
4. Stockage : nouvelle table Supabase `task_templates`. Les 51 tâches actuelles y sont migrées (rien n'est perdu).
5. Le statut « corvée » (poids 2 dans la répartition) vient désormais de la case cochée sur chaque tâche, plus d'une liste figée dans le code.

## Donnée : table `task_templates`

Colonnes :

- `id` uuid (clé primaire, défaut `uuid_generate_v4()`)
- `title` text (non null)
- `creneau` text, contrainte dans (`ouverture`, `service`, `fermeture`)
- `category` text (ex : Stock, Cuisine, Service, Nettoyage, Admin)
- `priority` text, contrainte dans (`high`, `medium`, `low`)
- `corvee` boolean (défaut `false`)
- `position` int (défaut 0, ordre d'affichage dans son moment)
- `created_at` timestamptz (défaut `now()`)

RLS : politique « accès total » comme les autres tables en dev (cohérent avec le schéma existant).

La table `tasks` (les tâches assignées par jour) ne change pas. Elle référence les tâches par leur `title` (texte), indépendamment du catalogue. Supprimer une tâche du catalogue ne casse donc aucune tâche déjà assignée.

## Migration (étape manuelle, une seule fois)

Un script SQL est fourni (`supabase_task_templates.sql`) :

1. `create table if not exists task_templates (...)` avec les colonnes ci-dessus.
2. Politique RLS « accès total ».
3. `insert` des 51 tâches actuelles, reprises exactement de `TASK_TEMPLATES` (titre, creneau, category, priority), avec `corvee = true` pour les 11 corvées actuelles (toilettes, escalier, les deux vaisselles, pots de sauce, poubelles, lavage sol, nettoyage sol/pieds de table, frigo, mur, couper le poulet) et `corvee = false` pour les autres. `position` = ordre actuel dans `TASK_TEMPLATES`.

Le gérant colle ce script dans l'éditeur SQL de Supabase. C'est la seule action côté base.

## L'appli lit le catalogue depuis la base

- Au démarrage, l'appli charge `task_templates` dans un état `taskTemplates` (comme `tasks`, `products`, `schedule`, `employees`), trié par `creneau` puis `position`.
- Les usages de la constante `TASK_TEMPLATES` sont remplacés par cet état chargé : la grille Semaine, la génération équitable d'un jour (`genererTemplate`), et le pré-remplissage de semaine.
- Chaque tâche du catalogue porte son champ `corvee`.

## Conséquence sur le moteur de répartition

Aujourd'hui `repartir` (dans `taskDispatch.js`) calcule le poids via une liste `CORVEES` figée (`poidsTache(title)`). On le bascule pour qu'il lise le champ `corvee` de chaque tâche :

- `repartir` reçoit des tâches `{ title, creneau, category, priority, corvee }`.
- Le poids devient `tache.corvee ? 2 : 1`.
- La liste `CORVEES` codée en dur n'est plus utilisée par le calcul ; elle est retirée une fois la bascule faite.
- Les tests de `repartir` sont mis à jour pour passer `corvee` sur les tâches concernées.

## L'écran de gestion (Paramètres → « Liste des tâches »)

- Liste des tâches du catalogue, groupée par moment (Ouverture / Service / Fermeture), dans l'ordre `position`.
- Sur chaque tâche : un bouton **Modifier** (ouvre un formulaire pré-rempli) et un bouton **Supprimer** (avec confirmation).
- Un bouton **« Ajouter une tâche »** ouvrant un formulaire : titre (texte), moment (menu ouverture/service/fermeture), catégorie (menu depuis `categoryList`), priorité (menu haute/moyenne/basse), corvée (case à cocher).
- Création / modification / suppression écrivent dans `task_templates` (Supabase) et mettent à jour l'état local `taskTemplates`.
- Une nouvelle tâche reçoit `position` = (max des positions de son moment) + 1.

## Effets quand on ajoute ou retire

- **Retirer** une tâche du catalogue : elle disparaît des futures grilles Semaine et de la génération. Les tâches déjà assignées dans des semaines existantes (table `tasks`) ne sont pas touchées : l'historique reste intact.
- **Ajouter** une tâche : elle apparaît immédiatement comme nouvelle ligne dans la grille Semaine, prête à être assignée à la main ou via le pré-remplissage.
- **Modifier** : le changement (moment, catégorie, corvée…) s'applique aux futures générations et à l'affichage de la grille ; les tâches déjà assignées gardent ce qu'elles avaient au moment de leur création.

## Hors périmètre

- Le réordonnancement des tâches par glisser-déposer (la `position` existe, mais pas d'UI de tri pour l'instant).
- Les incompatibilités personne/tâche automatiques.
- L'ouverture du dimanche.

## Fichiers concernés (à préciser dans le plan)

- `supabase_task_templates.sql` (nouveau) : création de la table + RLS + insertion des 51 tâches.
- `src/lib/taskDispatch.js` : `repartir` lit `tache.corvee` ; retrait de l'usage de `CORVEES` figé ; tests mis à jour.
- `src/RestoApp.jsx` : chargement de `task_templates` au démarrage ; remplacement des usages de la constante `TASK_TEMPLATES` par l'état chargé (grille Semaine, `genererTemplate`, pré-remplissage) ; nouvelle section « Liste des tâches » dans Paramètres avec le CRUD.

## Tests (vitest)

- `repartir` : une tâche `{ corvee: true }` pèse 2, une `{ corvee: false }` pèse 1 ; les règles déjà testées (gérant hors corvées, rotation, créneaux, proportionnalité) restent vraies avec le poids piloté par `corvee`.
- Pivot et décalage de semaine : inchangés.
