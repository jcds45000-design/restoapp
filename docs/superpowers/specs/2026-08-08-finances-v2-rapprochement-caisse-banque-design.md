# Module Finances v2 — Rapprochement caisse↔banque (V1)

- **Date** : 2026-08-08
- **Statut** : design validé, prêt pour le plan d'implémentation
- **Repo** : restoapp (React + Vite + Supabase)
- **Note** : aucun chiffre réel, libellé bancaire réel ou secret ne figure dans ce document. Le dépôt est PUBLIC.

---

## 1. Objectif et périmètre

**Objectif** : un outil de **contrôle du gérant** qui rapproche chaque semaine ce que dit la caisse et ce qui arrive réellement en banque. Il sert à deux choses :

1. **Détecter une anomalie** (type ventes fictives de janvier) : quand le total caisse ne correspond pas à l'argent réellement encaissé en banque.
2. **Boucler les espèces** : savoir combien d'espèces devraient être déposées et suivre si elles le sont.

**Opérateur** : Jean-Claude (gérant). Vue posée sur ordinateur, dense. Le fils n'a qu'un geste physique : déposer les espèces au GAB quand l'appli l'indique.

**Périmètre V1** :
- **Rapprochés** : CB et espèces.
- **Affichés mais non rapprochés** : Uber et Deliveroo (leurs montants entrent dans les totaux pour que le contrôle d'anomalie reste juste, mais le rapprochement fin des versements plateformes est en phase 2).

**Hors périmètre V1 (phases suivantes)** :
- Rapprochement fin des versements Uber/Deliveroo (nets de commission, calendrier propre).
- Drill-down ligne-à-ligne complet (Approche 2).
- Éditeur de règles de libellé dans l'interface.
- Saisie/opération par le fils (autonomisation).
- Alimentation automatique par l'API caisse.
- Catégorisation des charges et tableau de bord SIG complet (chantier séparé du module finances).

---

## 2. Contexte et décisions actées

- **Caisse** = @Bill, éditeur Fülle / Force7Web, revendeur ASCE 45. L'API existe (`api.fulleapps.io`) mais est payante (~24 €/mois) ; feu vert du fils, payée par Kimiko. Souscription **après** ce cadrage.
- **Source des totaux caisse = interchangeable** : saisie manuelle par JC, ou récupération assistée depuis la back-office caisse pendant une session, ou API (phase 2). Le moteur ne dépend pas de la source ; un champ `source` note l'origine.
- **Banque** = relevé Caisse d'Épargne exporté manuellement en **CSV**. Pas d'agrégateur.
- **Approche retenue = Approche 1 : rapprochement par agrégats hebdomadaires** (totaux de semaine par moyen de paiement), pas de matching ligne-à-ligne en V1.
- **Espèces traitées en cumul** (coffre théorique), pas de rapprochement hebdo strict, car le fils peut accumuler les dépôts.

---

## 3. Architecture

- **`src/components/FinancesModule.jsx`** : la vue gérant. Suit le patron des modules existants (`StocksModule`, `RentabiliteModule`).
- **`src/lib/finances.js`** : le **moteur**, en fonctions pures, séparé de l'affichage (comme la logique horaires isolée ailleurs dans le projet). Toute la logique de parsing, tri, rattachement, cumul et rapprochement vit ici.
- **`src/lib/finances.test.js`** : tests unitaires du moteur (les fonctions pures), sur le modèle des tests existants.
- **Abstraction de la source caisse** : le module lit/écrit des *totaux caisse par semaine*. Brancher l'API plus tard = remplir les mêmes champs, sans refonte.

Toutes les données vivent dans le Supabase de restoapp, **RLS gérant uniquement**, jamais dans le dépôt.

---

## 4. Modèle de données (Supabase)

### Table `finance_semaines` (une ligne par semaine ISO)
- `id` (uuid)
- `semaine_debut` (date, lundi de la semaine, **unique**)
- `statut` (enum texte : `en_cours`, `a_deposer`, `attente_banque`, `reconciliee`, `ecart`)
- Côté caisse : `caisse_cb`, `caisse_especes`, `caisse_uber`, `caisse_deliveroo`, `caisse_autres` (numeric), `caisse_source` (`manuelle` / `caisse_web` / `api`), `caisse_saisi_le` (timestamptz)
- Côté banque (agrégats issus du tri du CSV) : `banque_cb`, `banque_depot_especes`, `banque_uber`, `banque_deliveroo` (numeric)
- Calculés/dérivés : `ecart_cb`, `especes_a_deposer` (= `caisse_especes`, aucun fond de caisse à soustraire), `notes` (texte)

### Table `finance_banque_lignes` (lignes brutes du CSV, triées)
- `id` (uuid)
- `date_operation` (date), `libelle` (texte), `montant` (numeric)
- `categorie` (enum : `remise_cb`, `depot_especes`, `versement_uber`, `versement_deliveroo`, `autre`)
- `semaine_rattachee` (date) : pour une remise CB, la semaine de la **date de vente** lue dans le libellé ; sinon la semaine de l'opération
- `import_id` (uuid)
- **Clé de dédoublonnage** : `(date_operation, montant, libelle)` — jamais compter deux fois à la réimport.

### Table `finance_imports` (trace des imports CSV)
- `id`, `importe_le` (timestamptz), `nb_lignes`, `periode_min`, `periode_max`

Stocker les lignes brutes permet : de voir quelles lignes composent un total (contrôle/confiance), de dédoublonner à la réimport, et de préparer le drill-down de la phase 2.

---

## 5. Flux hebdomadaire et machine à états

### Le rituel du lundi (3 gestes, opérés par JC)
1. **Totaux caisse** de la semaine écoulée : saisie (ou récupération assistée) des 5 totaux (CB, espèces, Uber, Deliveroo, autres). L'appli calcule aussitôt « espèces à déposer = total espèces ».
2. **Import du CSV banque** : le moteur parse, trie chaque ligne par catégorie, dédoublonne, rattache chaque ligne à sa semaine de vente.
3. **Rapprochement** : comparaison, affichage des écarts, mise à jour des statuts, action sur l'alerte éventuelle.

### Machine à états d'une semaine
`en_cours` (semaine courante) → `a_deposer` (totaux saisis, « dépose X € », en attente du dépôt) → `attente_banque` (dépôt vu, il manque des remises CB à tomber) → `reconciliee` (tout colle dans la tolérance) **ou** `ecart` (divergence hors tolérance = alerte).

La boucle espèces se ferme au niveau **cumulé** (voir §6), pas semaine par semaine : le fils dépose pendant une semaine ultérieure, un import suivant voit le dépôt, le solde du coffre théorique se réduit.

---

## 6. Logique du moteur (`src/lib/finances.js`)

### Règles de classification (CALÉES sur un vrai CSV Caisse d'Épargne, export 01/11/2025→08/08/2026)
Format réel : délimiteur `;`, décimales à la virgule, colonnes **Débit et Crédit séparées** (Crédit préfixé `+`, Débit `-`), dates JJ/MM/AAAA, colonnes `Date comptable;Libelle simplifie;Reference;Informations complementaires;Type operation;Debit;Credit;Date operation;Date de valeur;Pointage`.

Le classement s'appuie d'abord sur la colonne **`Type operation`** (bien plus fiable que le libellé libre), puis affine par libellé :
- `Type operation = Remise CB` → **remise_cb**. Libellé « CB KIMIKO JJMMAA » → la date est la **date de vente** → rattachement à cette semaine. Montant **brut** (au crédit).
- `Type operation = Frais et extournes`, libellé « CB COM … » → **frais_cb** (coût de la CB, séparé des remises ; hors rapprochement des encaissements).
- `Type operation = Depot especes` (« DEPOT ESPECE GAB … ») → **depot_especes**.
- `Type operation = Retrait especes` → **retrait_especes** (rare, suivi à part, hors coffre en V1).
- `Type operation = Virement` → sous-classer par libellé :
  - « Deliveroo » → **versement_deliveroo**
  - « STICHTING CUSTODIAN UB » → **versement_uber** (⚠️ Uber n'apparaît PAS comme « UBER »)
  - « STRIPE » + réf « FULLE » → **direct_click_collect** (commandes directes du webshop Fülle encaissées via Stripe)
  - « EDENRED » / « PLUXEE » / « UP COOP » / « SWILE » → **titres_resto**
  - autre → **autre**
- `Type operation = Prelevement SDD` et `Paiement CB` (« CUMUL DES DEBITS DIFFERES ») → **charges** (hors périmètre V1, pour le futur module SIG).

Ces règles vivent dans un objet de configuration unique, faciles à ajuster. Un éditeur in-app est en phase 2 seulement si nécessaire.

**Canaux d'encaissement supplémentaires découverts** (à afficher dans le total pour le détecteur d'anomalie) : direct/click&collect (Stripe/Fülle) et titres resto, en plus de CB / espèces / Uber / Deliveroo. Ajouter les colonnes correspondantes (`banque_direct`, `banque_titres`) à `finance_semaines`.

### CB — rapprochement hebdo
`ecart_cb` (semaine) = `caisse_cb` − `banque_cb`. Le CB tombe vite en banque, donc il se rapproche à l'échelle de la semaine.

### Espèces — coffre théorique (cumul)
Solde courant :
> `coffre_theorique` = Σ(`caisse_especes`) − Σ(`banque_depot_especes`)

C'est « combien d'espèces devraient être non déposées, là, maintenant, accumulées depuis telle semaine ». Les dépôts s'imputent en **FIFO** contre les semaines les plus anciennes. Une semaine est considérée soldée côté espèces quand le cumul des dépôts couvre son cumul théorique. On suit aussi l'**ancienneté** du plus ancien montant non déposé.

### Détecteur d'anomalie (le cœur du contrôle)
- **Anomalie type janvier** : si le total caisse dépasse largement l'argent réellement arrivé en banque (CB + dépôt + versements plateformes) au-delà d'une bande → **alerte rouge**.
- **Alerte espèces** : « X € non déposés depuis N semaines » quand le coffre théorique dépasse un plafond ou qu'un montant reste non déposé au-delà de N semaines.

### Seuils et tolérances (paramètres, jamais codés en dur)
Tolérance d'écart CB (quelques € / %), plafond du coffre théorique, ancienneté max, bande espèces « normale » (~10-16 % du CA). Valeurs par défaut à caler ensuite.

### On ne compare que ce qui existe
Si les totaux caisse manquent pour une semaine, on **ne calcule aucun écart** (pas de faux positif) tant que les deux côtés ne sont pas renseignés.

---

## 7. Interface gérant (`FinancesModule.jsx`)

- **Bandeau cockpit** en haut : **« Coffre théorique : X € non déposés depuis la semaine du … »**, coloré selon le plafond (vert/orange/rouge) + compte d'alertes actives.
- **Tableau des semaines** (récente en haut) : semaine · statut (badge coloré) · caisse (CB, espèces, Uber, Deliveroo) · banque (CB reçu, dépôt, plateformes) · écart CB · action.
- **Détail semaine** (au clic) : décomposition poste par poste + **lignes de CSV rattachées** (cliquer un total → voir ses lignes) + notes + correction manuelle.
- **Actions** : « Saisir les totaux caisse » (5 chiffres + source) ; « Importer le relevé banque (CSV) ».
- **Rappel « dépose X € »** visible quand une semaine est `a_deposer`.

### Import CSV = parser puis confirmer
Après import : **récap avant enregistrement** (N lignes lues, tant en remise CB / dépôt / plateformes / **non classé**, avec la liste des non classées). JC valide → enregistré. Beaucoup de « non classé » = signal que les règles de libellé sont à ajuster.

---

## 8. Cas limites et erreurs

- CSV au format inattendu → échec propre, message clair, **rien n'est enregistré**.
- Réimport / périodes qui se chevauchent → dédoublonnage `(date, montant, libellé)`.
- Totaux caisse manquants → aucun écart calculé tant que les deux côtés ne sont pas là.
- Ligne « autre » (remboursement, frais, montant négatif) → stockée, hors rapprochement, visible au récap.
- Date de vente illisible dans un libellé CB → rattachée par défaut à la date d'opération, signalée.
- Semaine partielle (férié, fermeture) → aucun traitement spécial, les vrais totaux reflètent la réalité.

---

## 9. Tests (moteur pur)

- `parseBankCSV` : format FR (virgule décimale), colonnes, lignes vides.
- `categorizeBankLine` : chaque règle + cas ambigus.
- `extractSaleDateFromCB` / `attachToSaleWeek` : « CB KIMIKO 180126 » → 18/01/2026 → semaine du lundi.
- `dedupBankLines` : réimport, chevauchement.
- `computeCoffreTheorique` : cumul FIFO, solde courant, ancienneté du plus ancien non déposé.
- `computeReconciliation` : écart CB, statuts, seuils/tolérances, détecteur d'anomalie.
- **Jeu « janvier »** : jeu de données où le coffre gonfle → l'alerte se déclenche.

---

## 10. Sécurité

- Données bancaires = sensibles : Supabase restoapp, **RLS gérant uniquement**, **jamais** dans le dépôt (PUBLIC).
- Clés de l'API caisse (phase 2) : **variables d'environnement uniquement**, jamais dans le code ni un commit, comme la clé n8n.

---

## 11. Points ouverts à caler avant/pendant l'implémentation

- **Format réel du CSV Caisse d'Épargne** : RÉSOLU le 08/08 sur un export réel (01/11/2025→08/08/2026). Classement par colonne `Type operation` (voir §6).
- **Libellés exacts** : CONNUS (voir §6). Points notables : Uber = « STICHTING CUSTODIAN UB », direct/click&collect = « VIR SEPA STRIPE … FULLE », titres resto = Edenred/Pluxee/Up, remises CB brutes + frais « CB COM » séparés.
- **Valeurs par défaut des seuils** : tolérance CB, plafond coffre, ancienneté max, bande espèces.

---

## 12. Suite

Une fois ce spec relu et validé, passer à la skill `writing-plans` pour le plan d'implémentation détaillé (migrations SQL + moteur + tests + UI, en phases testées).
