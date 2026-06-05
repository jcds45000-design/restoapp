# Suppression multiple de tâches (vue checklist, mode gérant)

Date : 2026-06-05

## Contexte

Aujourd'hui, le gérant supprime les tâches une par une (croix dans le modal d'édition,
fonction `delTask(id)`). Quand plusieurs tâches affectées doivent être supprimées d'un coup,
c'est fastidieux. Objectif : permettre une suppression groupée depuis la vue checklist.

## Objectif

Dans la vue Tâches > checklist, en mode gérant, pouvoir sélectionner plusieurs tâches
et les supprimer ensemble en une seule action.

## Comportement

1. Un bouton **« Sélectionner »** est affiché en haut de la liste (mode gérant uniquement).
2. Clic sur « Sélectionner » → entrée en **mode sélection** : une case à cocher carrée
   apparaît à gauche de chaque tâche affichée. Le reste de l'interface est inchangé.
3. Une **barre d'action** s'affiche au-dessus de la liste :
   - `Tout sélectionner` (et `Tout désélectionner` une fois tout coché)
   - compteur `N sélectionnée(s)`
   - bouton rouge `Supprimer (N)` (désactivé si N = 0)
   - `Annuler` (quitte le mode sélection, vide la sélection)
4. Clic sur `Supprimer (N)` → **confirmation inline** dans la barre :
   `Supprimer N tâche(s) ? Action définitive.` avec `[Annuler] [Confirmer]`.
5. `Confirmer` → suppression en base en **une seule requête**, mise à jour de la liste
   à l'écran, sortie du mode sélection.

```
VUE TÂCHES (gérant)                          [+ Tâche]  [Sélectionner]
─────────────────────────────────────────────────────────────────────
 [✓] Tout sélectionner · 3 sélectionnées       [Supprimer (3)] [Annuler]
─────────────────────────────────────────────────────────────────────
 [✓]  ○ Nettoyer friteuse      Karim    haute
 [✓]  ○ Sortir poubelles       Sarah    moyenne
 [ ]  ○ Réassort sauces        Ilias    basse
 [✓]  ✓ Laver sol cuisine      Karim    haute
```

## Règles importantes

- **« Tout sélectionner » porte uniquement sur les tâches affichées** (date courante +
  filtres assigné `fA` et catégorie `fC` actifs). Aucune tâche masquée par un filtre ne
  peut être sélectionnée ni supprimée. C'est le comportement « cases + tout sélectionner
  qui respecte le filtre » retenu avec l'utilisateur.
- **La case de sélection (carré, à gauche) est visuellement distincte du rond de statut**
  (« terminer »), pour éviter toute confusion entre cocher-pour-supprimer et
  cocher-pour-marquer-fait.
- **Suppression définitive**, comme la croix actuelle. Pas de corbeille ni d'annulation
  après coup ; la confirmation inline sert de garde-fou.
- Si l'utilisateur change de date, de filtre ou de vue, la sélection et le mode sélection
  sont **réinitialisés** (pas de sélection « fantôme » sur des tâches non visibles).

## Périmètre

- **Inclus** : vue checklist, mode gérant.
- **Exclus (volontairement)** : vue Kanban, vue Semaine, mode employé. À rouvrir plus tard
  si le besoin se confirme.

## Détails techniques

Tout se passe dans `src/RestoApp.jsx`.

- **Nouvelle fonction parent `delTasks(ids)`** (à côté de `delTask`) :
  ```js
  const delTasks = (ids) => {
    if (!ids.length) return;
    setTasks(p => p.filter(tk => !ids.includes(tk.id)));
    supabase.from('tasks').delete().in('id', ids).then(() => {});
  };
  ```
  Passée à `ChecklistView` via `onBulkDelete={delTasks}`.

- **`ChecklistView`** porte l'état local de sélection (responsabilité isolée) :
  `selectMode` (booléen) et `selectedIds` (Set d'IDs). Le bouton « Sélectionner », la barre
  d'action et la confirmation inline vivent dans ce composant. Réinitialisation via un
  `useEffect` dépendant des filtres et de la date affichée. La sélection s'applique sur la
  liste déjà filtrée (`fl`).

- **`TaskRow`** reçoit des props optionnelles `selectable`, `selected`, `onSelectToggle`.
  Quand `selectable` est vrai, une case carrée est rendue à gauche du bouton de statut.
  Comportement strictement inchangé quand `selectable` est absent (rétrocompatible).

## Vérification

- `npm run build` OK et suite vitest existante toujours verte (aucune régression sur
  `taskDispatch`).
- Test manuel navigateur (format mobile) : entrer en mode sélection, cocher, « Tout
  sélectionner » sous filtre actif, supprimer, confirmer, vérifier la disparition en base
  (rechargement) et l'absence d'erreur console.

## Hors périmètre

- Suppression groupée dans Kanban / Semaine.
- Corbeille / annulation (soft delete).
- Sélection multi-jours (la sélection reste cadrée sur la date affichée).
