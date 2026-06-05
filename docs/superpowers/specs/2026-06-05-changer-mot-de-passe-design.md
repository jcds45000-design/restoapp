# Changer son mot de passe (compte connecté)

Date : 2026-06-05

## Contexte

L'utilisateur (Jean-Claude) a voulu changer son mot de passe et a constaté qu'aucune
option ne le permet dans l'app. Le besoin est limité à **son propre compte connecté**,
pas à une gestion de mots de passe par salarié.

Rappel du modèle d'auth existant : la connexion passe par Supabase Auth
(`signInWithPassword`), un seul compte est réellement connecté à la fois, et un menu
déroulant permet de basculer l'affichage entre salariés (impersonation UI). La plupart des
salariés n'ont pas de compte de connexion. Les mots de passe sont gérés par Supabase Auth,
jamais stockés en base.

## Objectif

Permettre à l'utilisateur réellement connecté de changer son mot de passe depuis l'écran
Paramètres.

## Comportement

- Une section **« Mon mot de passe »** ajoutée en haut de l'écran **Paramètres**
  (`SettingsModule`, déjà accessible en mode gérant).
- Affiche l'**email du compte connecté** (`authUser.email`), pour lever toute ambiguïté
  avec le nom affiché dans le menu déroulant.
- Deux champs : **nouveau mot de passe** (avec bouton oeil afficher/masquer) et
  **confirmation**.
- Validations côté client avant l'appel :
  - au moins 6 caractères (règle Supabase) ;
  - les deux champs doivent être identiques.
- Bouton **« Mettre à jour »**. Message de succès ou d'erreur, même style que le formulaire
  de création de compte existant.
- En cas de succès, les champs sont vidés.

## Détails techniques

Tout dans `src/RestoApp.jsx`, composant `SettingsModule`.

- `SettingsModule` reçoit une nouvelle prop `authUser` (déjà disponible dans `RestoApp`,
  ligne 1644 ; passée à l'appel ligne 2069).
- Nouveau handler :
  ```js
  const changePassword = async () => {
    if (npNew.length < 6) { /* message erreur */ return; }
    if (npNew !== npConfirm) { /* message erreur */ return; }
    const { error } = await supabase.auth.updateUser({ password: npNew });
    // message succès / erreur
  };
  ```
- `updateUser` agit sur la session active, donc sur le **compte réellement connecté**,
  indépendamment du nom sélectionné dans le menu déroulant.

## Décision validée

- **Pas de demande du mot de passe actuel.** L'utilisateur est déjà authentifié, c'est son
  compte, il est seul à l'utiliser. La friction n'apporterait quasiment pas de sécurité ici.

## Vérification

- `npm run build` OK.
- Test navigateur **non destructif** : afficher la section (email du compte connecté
  visible), déclencher les deux validations d'erreur (mot de passe trop court, non
  concordants). Le changement réel n'est pas exécuté pour ne pas modifier le mot de passe
  du compte de test ; l'appel `updateUser` est standard et validé par le build.

## Hors périmètre

- Comptes individuels par salarié et changement de mot de passe pour autrui.
- Réinitialisation par email (mot de passe oublié).
- Fermeture de la faille du menu déroulant (sujet sécurité séparé, non prioritaire tant que
  l'app n'est pas adoptée).
