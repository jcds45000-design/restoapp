# Répartition équitable des tâches avec mémoire

Date : 2026-06-01
Projet : restoapp (Kimiko)
Statut : design validé, en attente du plan d'implémentation

## Contexte

L'application génère un "template du jour" : une liste de tâches affectées aux salariés présents. Aujourd'hui, la répartition se fait par tour de rôle figé (`computeTemplateAssignments`) ou par mélange aléatoire (`shuffleTemplateAssignments`) dans `src/RestoApp.jsx`. Deux défauts :

- Aucune mémoire d'un jour à l'autre. Sans cliquer sur "mélanger", c'est toujours la même personne sur la même tâche.
- Toutes les tâches comptent pareil et le hasard ne garantit ni la rotation des corvées ni l'équilibre de la charge.

Objectif : une répartition qui évite que ce soient toujours les mêmes sur les mêmes tâches (rotation), qui équilibre la charge entre les présents, et qui tient compte de la durée de présence de chacun.

## Décisions

1. Pondération : corvées pénibles à poids 2, toutes les autres tâches à poids 1.
2. Mémoire : fenêtre glissante de 7 jours.
3. Algorithme : "le moins chargé par heure de présence d'abord", corvées traitées en premier.
4. Gérants (Thomas, Chainez) : éligibles aux tâches normales, jamais aux corvées.
5. Sarah : exclue de la répartition tant que son nom n'est pas confirmé.
6. La modification manuelle des affectations est conservée. Le bouton "mélanger" devient "régénérer".
7. Aucune modification du schéma Supabase (la clé disponible est la clé publique).

## Liste des corvées (poids 2)

1. Nettoyer les toilettes
2. Nettoyer l'escalier
3. Faire la vaisselle (le passage régulier)
4. Nettoyer et remplir les pots de sauce
5. Changer les poubelles
6. Lavage sol / surfaces / étagères de son poste
7. Nettoyage sol, pieds de table, tables
8. Nettoyer le frigo intérieur et extérieur
9. Nettoyer le mur
10. Couper et mariner le poulet

Toutes les autres tâches (ouverture, service, cuisine, contrôles de stock) restent à poids 1. À l'implémentation, ces libellés seront alignés sur les titres exacts présents dans `TASK_TEMPLATES`, via une clé stable plutôt qu'une comparaison de texte fragile.

## Architecture

Le cœur de l'algorithme sort de `RestoApp.jsx` dans un module pur `src/lib/taskDispatch.js`, sans React ni Supabase. Il prend des données en entrée et rend des affectations, donc il est testable isolément.

`taskDispatch.js` expose :

- `CORVEES` : l'ensemble des tâches à poids 2.
- `poidsTache(titre)` : 1 ou 2.
- `repartir({ taches, presents, historique, heures7j, seed })` : rend la liste des affectations.

`RestoApp.jsx` ne fait plus que récupérer les données (présents, historique, heures) et appeler `repartir`.

## Algorithme `repartir`

Entrées :

- `taches` : les entrées de `TASK_TEMPLATES`, chacune avec son `creneau` (ouverture / fermeture / service) et son poids.
- `presents` : `[{ name, shift, isGerant }]`, issus du planning du jour, Sarah retirée.
- `historique` : tâches des 7 jours précédents `[{ assignee, title, due_date }]`.
- `heures7j` : map `name -> heures de présence cumulées sur les 7 derniers jours, aujourd'hui inclus`.
- `seed` : graine pour le tirage de départage (change à chaque "régénérer").

Déroulé :

1. Charge initiale de chacun = somme des poids de ses tâches dans `historique`.
2. Tri des tâches : corvées (poids 2) d'abord, puis poids 1.
3. Pour chaque tâche :
   - Pool éligible = présents dont le créneau correspond (une tâche de fermeture ne va qu'à quelqu'un qui ferme, idem ouverture ; les tâches "service" vont à tout présent).
   - Si la tâche est une corvée, on retire les gérants du pool.
   - Si le pool est vide, on retombe sur l'ensemble des présents (dernier recours).
   - On choisit la personne qui minimise le ratio `(charge + poids) / heures7j`.
   - Départage 1 : celui qui a fait cette tâche précise le moins récemment (jamais faite = prioritaire).
   - Départage 2 : tirage pseudo-aléatoire déterministe basé sur `seed`.
   - On ajoute le poids à la charge de la personne choisie.
4. Retour des affectations.

Le ratio `charge / heures` fait qu'une personne présente longtemps encaisse plus de poids avant d'être au niveau d'une personne présente peu de temps. Un nouvel arrivant a une charge de 0 sur la fenêtre, donc un ratio bas, donc il récupère des tâches en premier, ce qui est voulu avec une fenêtre de 7 jours. Le dénominateur inclut aujourd'hui, donc il est toujours strictement positif pour un présent.

## Données et flux

À l'ouverture du modal "Template du jour" pour une date D :

1. Présents : depuis le planning déjà en mémoire pour D, filtrés sur la présence, Sarah retirée, drapeau `isGerant` déduit du rôle.
2. Historique : requête Supabase sur `tasks` où `due_date` est dans `[D-7, D-1]`.
3. Heures sur 7 jours : calculées depuis le planning avec `calcHours`, sur `[D-7, D]` (aujourd'hui inclus). Si une partie de la fenêtre n'est pas en mémoire, on la charge depuis Supabase.
4. Appel de `repartir`.
5. Affichage des affectations, modification manuelle possible, puis "Charger" insère les tâches du jour dans `tasks` avec `due_date = D`.

Le poids n'est pas stocké en base. La charge passée se recalcule en relisant les tâches existantes et en appliquant `poidsTache` sur leur titre. Aucune migration n'est nécessaire.

## Modification manuelle et régénérer

- Réassignation manuelle : on peut changer l'assigné de n'importe quelle ligne avant de charger. La valeur manuelle est prise telle quelle. Comme elle finit en base, elle compte dans la charge des jours suivants.
- "Régénérer" remplace "mélanger" : relance `repartir` avec une nouvelle graine pour proposer une autre répartition également équilibrée.

## Cas limites

- Pas de planning pour ce jour : on prend tous les salariés actifs (comportement actuel conservé).
- Une seule personne présente : tout pour elle.
- Corvée sans aucun éligible (par exemple seuls des gérants présents) : dernier recours, on l'attribue à un présent malgré la règle, plutôt que de la laisser sans personne.
- Échec de la requête d'historique : on retombe sur le tour de rôle simple, sans bloquer, avec un message discret.

## Fichiers touchés

- Nouveau : `src/lib/taskDispatch.js` (logique pure).
- Nouveau : `src/lib/taskDispatch.test.js` (tests vitest).
- Modifié : `src/RestoApp.jsx` (`computeTemplateAssignments` devient asynchrone et appelle `repartir` ; "mélanger" devient "régénérer").
- Modifié : `package.json` (dépendance vitest + script `test`).

## Tests (vitest)

- Charge équilibrée à heures égales : répartition par poids équilibrée.
- Proportionnalité : à charge passée nulle, une personne présente deux fois plus longtemps reçoit environ deux fois plus de poids.
- Rotation d'une corvée : une corvée faite par X la veille (dans l'historique) ne revient pas à X le lendemain s'il existe un autre éligible.
- Gérant : un gérant ne reçoit jamais de corvée.
- Créneaux : une tâche d'ouverture ne va pas à quelqu'un qui ne travaille que le soir, idem fermeture.
- Une seule personne présente : elle reçoit tout.

## Hors périmètre

- Les rôles tenus en continu pendant le service (annoncer les commandes, faire les boissons, s'occuper des DLC, faire le riz) ne sont pas dans la répartition pondérée.
- L'intégration des contrôles de stock avec le module stock.
- La génération automatique quotidienne (la génération reste déclenchée manuellement).
- L'inclusion de Sarah.
- Toute modification du schéma Supabase.
