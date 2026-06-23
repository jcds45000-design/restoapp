# Tâches habituelles éditables (catalogue de templates)

Date : 2026-06-23
Statut : design validé

## Objectif

Rendre éditable la liste des « tâches habituelles » (aujourd'hui figée dans le code :
`TASK_TEMPLATES`). Le gérant peut ajouter, modifier, supprimer des tâches habituelles ;
et une tâche créée peut être ajoutée à cette liste directement depuis la fenêtre de
création. Origine : le fils crée une tâche, elle ne rejoint pas les prédéfinies.

## Décisions validées

- **Stockage** : table Supabase `task_templates`, initialisée (seed) avec les ~50 tâches
  actuellement codées en dur. La liste codée devient le seed/repli.
- **Éditeur** : écran « Tâches habituelles » (gérant), accessible par un bouton dans la
  zone Tâches (à côté de « Template du jour »). Liste groupée par moment.
- **Champs d'une tâche habituelle** : titre, catégorie, priorité, moment (creneau).
- **Répercussion** : la liste dynamique remplace `TASK_TEMPLATES` aux deux endroits qui
  l'utilisent (menu « Piocher dans la liste habituelle » + « Template du jour »).
- **Catégorie** : le menu catégorie de l'éditeur utilise les catégories dynamiques
  (`task_categories`, rendues éditables précédemment).
- **Création → habituelles** : une case « Ajouter aux tâches habituelles » dans la
  fenêtre de création de tâche (révèle un choix de moment quand cochée).

## Modèle de données

- Table `task_templates` : `id uuid pk default gen_random_uuid()`, `title text not null`,
  `category text not null default 'Autre'`, `priority text not null default 'moyenne'`
  (haute/moyenne/basse), `creneau text not null check (creneau in ('ouverture','service','fermeture'))`,
  `sort_order int not null default 0`, `created_at timestamptz default now()`.
- Seed : les ~50 entrées de `TASK_TEMPLATES` (foundation.jsx), générées en SQL.
- RLS : lecture + écriture authenticated (miroir de `task_categories`).
- Migration appliquée par Jean-Claude via le SQL Editor de Supabase.

## Implémentation (app)

- **Chargement** : au démarrage (avec tasks/products/categories), charger `task_templates`
  triées par `creneau` puis `sort_order` dans un état `templates`. Repli sur le
  `TASK_TEMPLATES` codé si la table est vide/absente (comme pour les catégories).
- **`foundation.jsx`** : `TASK_TEMPLATES` conservé comme seed/repli.
- **Éditeur** (nouveau composant `TaskTemplatesModule.jsx` ou modale dédiée, gérant) :
  - liste groupée par moment (Ouverture/Service/Fermeture) ;
  - par ligne : titre, catégorie, priorité, moment + actions modifier / supprimer ;
  - formulaire d'ajout : titre, catégorie (menu dynamique), priorité, moment ;
  - suppression : retire le template (ne touche pas les tâches déjà créées).
- **Handlers CRUD** dans `RestoApp.jsx` (`addTemplate`, `updateTemplate`, `deleteTemplate`)
  : écrivent dans `task_templates` + mettent à jour l'état `templates`.
- **Branchements** :
  - `TaskModal` (foundation) : le menu « Piocher dans la liste habituelle » utilise la
    prop `templates` (repli `TASK_TEMPLATES`), groupé par moment comme aujourd'hui.
  - `genererTemplate` (RestoApp) : `repartir({ taches: templates, ... })` au lieu de
    `TASK_TEMPLATES`.
- **Case « Ajouter aux tâches habituelles »** dans `TaskModal` : checkbox + (si cochée) un
  sélecteur de moment (ouverture/service/fermeture). À l'enregistrement, en plus de créer
  la tâche, crée un `task_template` {title, category, priority, creneau}. Dédoublonnage par
  (titre + moment) : on n'ajoute pas si un template identique existe déjà.

## Hors périmètre (YAGNI)

- Pas de réordonnancement manuel par glisser-déposer (ordre = ordre de création / creneau).
- Pas de synchronisation automatique des catégories renommées vers les templates (le
  champ reste du texte, éditable à la main dans l'éditeur).

## Points d'attention

- `creneau` est obligatoire sur un template (nécessaire pour la répartition du matin et le
  regroupement). La case de création impose donc de choisir un moment.
- L'éditeur et la case sont réservés au gérant (cohérent avec le reste).
- Le seed (~50 INSERT) est généré depuis la liste codée ; idempotent si possible.

## Vérification

- `npm run build` + tests vitest (extraire en pur ce qui est testable, ex. dédoublonnage /
  groupement par creneau).
- Test navigateur (côté Jean-Claude, gérant) : éditeur (ajout/modif/suppression visibles
  dans le menu « Piocher » et le Template du jour), case « Ajouter aux habituelles » à la
  création.
- Déploiement : push `main` → Vercel, après application du SQL.
