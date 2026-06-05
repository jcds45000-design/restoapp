# Piocher une tâche du catalogue dans « Nouvelle tâche »

Date : 2026-06-05

## Contexte

Le catalogue des ~50 tâches habituelles (`TASK_TEMPLATES`) n'était utilisable qu'en
générant le **Template du jour**, qui répartit automatiquement toutes les tâches entre les
présents. Impossible d'assigner manuellement une tâche connue à une personne précise sans
générer toute la journée. Le bouton « + Nouvelle tâche » existait déjà mais imposait de
**retaper l'intitulé à la main**.

## Objectif

Depuis la fenêtre « Nouvelle tâche », pouvoir choisir une tâche du catalogue qui
pré-remplit l'intitulé, la catégorie et la priorité, puis l'assigner à la personne voulue,
sans passer par le Template du jour.

## Comportement

- Un menu déroulant **« Piocher dans la liste habituelle (optionnel) »** ajouté en haut du
  modal `TaskModal`, au-dessus du champ Intitulé.
- Les tâches sont groupées par moment via `<optgroup>` : **Ouverture**, **Service**,
  **Fermeture** (le champ `creneau` du catalogue).
- En choisissant une tâche : l'**intitulé**, la **catégorie** et la **priorité** se
  remplissent automatiquement. L'utilisateur choisit ensuite la **personne** (Assigné à) et
  la **date**, puis valide.
- Les champs restent **éditables** après le pioché (intitulé, catégorie, priorité).
- La saisie **libre** reste possible : si la tâche n'est pas dans la liste, on ignore le
  menu et on tape l'intitulé comme avant.
- Le menu revient sur « — Choisir une tâche habituelle — » après chaque pioché (c'est un
  menu d'action, pas un champ d'état) ; l'intitulé rempli en dessous reflète le choix.

## Périmètre

- **Inclus** : modal « Nouvelle tâche » (`TaskModal`), une tâche à la fois.
- **Exclus** : sélection multiple, assignation en masse, édition du catalogue lui-même
  (spec séparé `2026-06-02-catalogue-taches-editable`). Le Template du jour reste inchangé.

## Détails techniques

Tout dans `src/RestoApp.jsx`, composant `TaskModal`.

- Le `<select>` lit la constante existante `TASK_TEMPLATES` (déjà au niveau module).
- `value` de l'option = index dans `TASK_TEMPLATES` ; `onChange` récupère
  `TASK_TEMPLATES[index]` et appelle `setTitle`, `setC` (catégorie), `setP` (priorité).
- Les catégories du catalogue (`Admin, Cuisine, Nettoyage, Stock, Service`) et les priorités
  (`haute, moyenne, basse`) sont toutes présentes dans `categoryList` / `priorityList`, donc
  le pré-remplissage est cohérent avec les sélecteurs existants.
- `addTask` (insertion en base) reste inchangé.

## Vérification

- `npm run build` OK.
- Test navigateur non destructif : ouvrir « Nouvelle tâche », piocher une tâche du
  catalogue, vérifier que l'intitulé / la catégorie / la priorité se remplissent. La tâche
  n'est pas réellement créée pendant le test (pas de clic « Créer »).
