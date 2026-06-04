# Vue hebdomadaire des tâches (grille semaine, reportable, éditable)

Date : 2026-06-01
Projet : restoapp (Kimiko)
Statut : design validé, en attente du plan d'implémentation

## Contexte

Aujourd'hui les tâches ne se voient que jour par jour, dans le module Tâches (vues Liste et Kanban). Il manque une vue d'ensemble de la semaine, la possibilité de reporter une semaine sur la suivante, et une édition rapide des affectations.

## Le fonctionnement voulu (déroulé)

1. **La première fois**, le gérant saisit la semaine **à la main**, du **mardi au samedi** (le lundi reste vide). Il assigne les tâches aux salariés, jour par jour. Un bouton optionnel **« Pré-remplir équitablement »** est disponible s'il veut un point de départ proposé par l'appli, qu'il ajuste ensuite ; il n'est pas obligé de l'utiliser.
2. Ce remplissage constitue **le tableau de la semaine** (la grille du lundi au samedi).
3. **Chaque semaine suivante**, le gérant clique sur **« Copier vers la semaine suivante »** : le tableau est reporté à l'identique, puis il modifie les cases qu'il veut.
4. La **modification manuelle reste toujours possible** sur n'importe quelle semaine : absents à remplacer, réattributions, une personne qui ne peut pas faire une tâche.
5. Le **lundi** reste vide pour l'instant, mais sa colonne existe, prête pour le jour où le restaurant ouvrira ce jour-là.

## Décisions

1. Forme : grille semaine. Lignes = tâches (groupées par moment), colonnes = jours du lundi au samedi, cellule = salarié assigné.
2. Jours affichés : lundi à samedi (6 colonnes). Le lundi est vide tant que le restaurant y est fermé, mais la colonne est prévue pour une ouverture future. Dimanche n'est pas affiché.
3. Remplissage initial : **manuel**, par le gérant. Un bouton **« Pré-remplir équitablement »** (optionnel) propose une répartition de départ via le moteur `repartir` déjà en place.
4. Report : **« Copier vers la semaine suivante »** recopie la semaine affichée à l'identique.
5. Édition : chaque cellule est modifiable, on peut choisir n'importe quel salarié actif (pas seulement les présents), pour gérer les incompatibilités et les absences à la main.
6. Aucune modification du schéma Supabase. Tout s'appuie sur la table `tasks` existante.
7. La checklist quotidienne actuelle (cocher les tâches faites) ne change pas. La vue Semaine sert à préparer et ajuster, la vue jour sert à exécuter.

## Où ça vit

Une nouvelle vue **« Semaine »** dans le module Tâches, à côté de Liste et Kanban. Navigation par semaine (boutons semaine précédente / suivante), en réutilisant les helpers existants `getMonday`, `getWeekDays`, `addDays` et le motif de grille déjà présent dans le module Planning (`PlanningModule`). Réservée au gérant.

## La grille

- **Colonnes** : les 6 jours du lundi au samedi. Calculés depuis le lundi de la semaine affichée : lundi = lundi + 0, ..., samedi = lundi + 5.
- **Lignes** : les tâches de `TASK_TEMPLATES`, dans leur ordre, regroupées sous trois en-têtes : Ouverture, Service, Fermeture.
- **Cellule** (tâche × jour) : le prénom du salarié assigné ce jour-là à cette tâche, ou vide si rien n'est assigné. La colonne lundi est donc vide tant que personne n'y travaille.
- Repère visuel : les corvées (poids 2, cf. `taskDispatch.js`) sont signalées discrètement, pour voir leur répartition d'un coup d'œil.

## Données et flux

La source de vérité reste la table `tasks` (une ligne par tâche et par jour : `title`, `assignee_name`, `category`, `priority`, `status`, `due_date`).

1. À l'ouverture de la vue Semaine, on lit les tâches dont `due_date` est l'un des 6 jours (lundi à samedi).
2. On pivote ces lignes en une structure `grille[titre][date] = { id, assignee }`.
3. L'affichage croise `TASK_TEMPLATES` (les lignes) avec les 6 dates (les colonnes).

## Modifier une cellule

Au clic sur une cellule, un menu déroulant s'ouvre avec la liste de tous les salariés actifs (les présents du jour affichés en premier, mais tout le monde est sélectionnable, pour contourner une incompatibilité ou couvrir un absent). Au choix :

- Si une ligne `tasks` existe déjà pour ce titre et cette date, on met à jour son `assignee_name` (par son `id`).
- Sinon, on insère une nouvelle ligne `tasks` pour ce titre et cette date, avec la catégorie et la priorité issues de `TASK_TEMPLATES`, `status` = `todo`.
- Une option "personne" (vide) permet de retirer une affectation.

L'état local et Supabase sont mis à jour ensemble, comme l'édition de shift du planning. C'est ainsi qu'on remplit la grille la première fois, et qu'on ajuste ensuite chaque semaine.

## Bouton « Pré-remplir équitablement » (optionnel)

Pour aider le gérant quand il ne veut pas tout choisir à la main.

- Pour chaque jour travaillé (au moins une personne présente au planning), on calcule les affectations avec le moteur existant : présents du jour (Sarah exclue), heures sur 7 jours, historique, puis `repartir`. C'est la logique de `genererTemplate`, appliquée en boucle sur les jours.
- Un jour sans présence au planning (le lundi aujourd'hui) est ignoré et reste vide. La génération de semaine ne bascule pas sur "tous les actifs" pour un jour fermé.
- Le résultat remplace les tâches existantes de la semaine (suppression puis insertion), après confirmation si la semaine contient déjà des tâches. Le gérant ajuste ensuite à la main.

## Bouton « Copier vers la semaine suivante »

Le report d'une semaine sur l'autre, à l'identique.

- Pour chaque ligne `tasks` des 6 jours affichés, on crée une copie avec `due_date` décalée de +7 jours, même `assignee_name`, `title`, `category`, `priority`, `status` = `todo`, `completed_by_name` = null.
- Pour éviter les doublons, on supprime d'abord les tâches existantes de la semaine cible (ses 6 dates), après confirmation si elle contient déjà des tâches, puis on insère les copies.
- Le lundi vide reste vide après copie.

## Cas limites

- Jour fermé / sans planning (lundi actuel) : colonne vide, aucune génération, mais saisie manuelle possible cellule par cellule.
- Semaine vide : grille avec cellules vides ; on la remplit à la main, ou via "Pré-remplir", ou via "Copier".
- Absent de dernière minute : on réajuste à la main les cases de la personne absente.
- Échec réseau Supabase : on n'écrase rien, on affiche un message, on garde l'état précédent.

## Mobile et densité

Avec une cinquantaine de tâches sur six jours, la grille est dense. On gère par :

- le regroupement repliable par moment (Ouverture / Service / Fermeture),
- le défilement horizontal sur petit écran, comme la grille du planning,
- des prénoms courts dans les cellules.

## Hors périmètre

- Les incompatibilités personne/tâche automatiques (interdire telle tâche à telle personne) : gérées à la main, évolution séparée si besoin un jour.
- L'ouverture du dimanche (même principe que le lundi le moment venu).
- La génération automatique récurrente sans intervention.
- Toute modification du schéma Supabase.

## Fichiers concernés (à préciser dans le plan)

- `src/RestoApp.jsx` : nouvelle vue Semaine dans le module Tâches (toggle Liste / Kanban / Semaine), navigation par semaine, grille, édition de cellule, boutons « Pré-remplir équitablement » et « Copier vers la semaine suivante ».
- `src/lib/taskDispatch.js` : réutilisation de `repartir`. Extraction de deux petites fonctions pures testables : le pivot tâches → grille, et le décalage des dates d'une semaine (+7 jours).
- Tests vitest pour ces fonctions pures.

## Tests (vitest)

- Pivot : à partir d'une liste de tâches de plusieurs jours, on obtient bien `grille[titre][date] = assignee`.
- Décalage de semaine : les dates de la semaine cible sont exactement celles de la semaine source + 7 jours, lundi à samedi.
- Pré-remplissage : un jour sans présence reste vide ; un jour avec présents reçoit une affectation par tâche respectant les règles déjà testées de `repartir`.
