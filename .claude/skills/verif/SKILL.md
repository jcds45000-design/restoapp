---
name: verif
description: Vérifie un module de restoapp en E2E avec Playwright (login, navigation, captures d'écran dans .verif-<module>/). À utiliser après toute modification d'un module (stocks, taches, planning, equipe) ou pour vérifier la prod après un déploiement. Argument = nom du module, et optionnellement "prod" pour cibler restoapp-khaki.vercel.app au lieu du serveur local.
---

# /verif <module> [prod]

Vérification E2E standardisée de restoapp. Remplace l'écriture d'un énième script `pw_*.cjs` de zéro.

## Étapes

1. **Identifiants** : lire `RESTOAPP_EMAIL` et `RESTOAPP_PASSWORD` dans les variables d'environnement. S'ils manquent, demander à l'utilisateur de les fournir (`$env:RESTOAPP_EMAIL='...'` inline dans la commande). NE JAMAIS écrire les identifiants dans un fichier ni les afficher.
2. **Cible** : par défaut `http://localhost:5173` (vérifier que le serveur dev répond, sinon le lancer : `Start-Process powershell -ArgumentList '-Command','cd <repo>; npm run dev' -WindowStyle Hidden` puis attendre). Si l'argument `prod` est passé : `https://restoapp-khaki.vercel.app`.
3. **Script** : copier `verif-template.cjs` (dans ce dossier de skill) vers `pw_verif_<module>.cjs` à la racine du repo (pattern gitignoré), l'adapter au module demandé, l'exécuter avec les env vars.
4. **Adapter par module** (après login, cliquer le bouton du module dans la nav) :
   - `stocks` : badges « Seuil à définir » ou quantités, onglets Sorties et Liste de courses, bouton « Faire l'inventaire » (sommaire 6 catégories), bouton « Fournisseurs » (gérant).
   - `taches` : liste du jour, vue Semaine (vérifier des cellules avec prénoms si des tâches sont affectées), bouton « Habituelles ».
   - `planning` : grille de la semaine, présences.
   - `equipe` : liste des salariés (gérant uniquement).
5. **Mobile** : si le module a un usage téléphone (stocks, taches), refaire les captures clés en contexte mobile `{ viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true }`. Navigation mobile : barre du bas, « Stocks » est sous le bouton « Plus ».
6. **Rapport** : captures dans `.verif-<module>/` (gitignoré), console `OK` ou `ECHEC: <raison>` avec exit 1. Toujours REGARDER les captures produites (outil Read) au lieu de faire confiance aux seules assertions DOM : les deux se complètent.

## Règles

- Lecture seule sur les données : ne rien créer/modifier/supprimer en base pendant une vérification, sauf demande explicite ; si une mise en scène de données est nécessaire (ex. peupler la liste de courses), la faire via REST gérant et la REVERTIR en fin de run, avec vérification GET du revert.
- La grille Semaine et les longues listes scrollent dans un conteneur interne : `fullPage: true` ne capture PAS tout. Utiliser `scrollIntoViewIfNeeded()` sur l'élément visé ou un viewport haut (ex. 1300x4600) selon le besoin.
- Attentes réseau : `waitForTimeout(2000-3000)` après login (chargement Supabase), 1500 après chaque navigation.
