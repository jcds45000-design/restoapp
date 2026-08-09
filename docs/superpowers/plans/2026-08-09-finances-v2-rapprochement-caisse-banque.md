# Module Finances v2 — Rapprochement caisse↔banque : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un module « Finances » gérant-seul qui rapproche chaque semaine les totaux caisse (saisis) et les mouvements banque (CSV Caisse d'Épargne importé), suit le coffre théorique d'espèces en cumul FIFO et alerte en cas d'anomalie.

**Architecture:** Moteur en fonctions pures dans `src/lib/finances.js` (parsing CSV, classification, rattachement par date de vente, dédoublonnage, agrégats, coffre FIFO, rapprochement/statuts), testé par Vitest. UI dense dans `src/components/FinancesModule.jsx` (patron `RentabiliteModule`), branchée en lazy dans `RestoApp.jsx` (l'entrée sidebar `finances` existe déjà et tombe sur le placeholder 🚧). Données dans Supabase, RLS `private.is_gerant()`.

**Tech Stack:** React 19 + Vite, Supabase JS, Vitest. Aucune dépendance nouvelle.

**Spec de référence:** `docs/superpowers/specs/2026-08-08-finances-v2-rapprochement-caisse-banque-design.md`

---

## Règles du projet (NON NÉGOCIABLES, lues dans CLAUDE.md et .gitignore)

1. **Dépôt PUBLIC.** La migration SQL est gitignorée (comme les migrations 3-5). AUCUN libellé bancaire réel, AUCUN montant réel, AUCUN numéro de contrat dans le code, les tests ou les commits : les jeux de test utilisent des libellés SYNTHÉTIQUES au même format.
2. **Toute modification visible de l'UI : validation VISUELLE de Jean-Claude en local AVANT le commit.** Les tâches UI (10 à 13) se terminent par un checkpoint « JC valide » avant `git commit`.
3. Commits en français, format `type(scope): description`. PowerShell 5.1 : JAMAIS de guillemets doubles dans `git commit -m`, utiliser un here-string simple `@'...'@`.
4. Après le déploiement final : re-vérifier en prod (restoapp-khaki.vercel.app) comme un vrai utilisateur. Quirk connu : si la prod ne bouge pas ~5 min après un push, commit vide + re-push.

## Format CSV réel (vérifié le 09/08 sur un export Caisse d'Épargne)

- Ligne 1 = en-tête, PAS de préambule : `Date comptable;Libelle simplifie;Reference;Informations complementaires;Type operation;Debit;Credit;Date operation;Date de valeur;Pointage`
- Délimiteur `;`, dates `JJ/MM/AAAA`, décimales à la virgule.
- `Credit` préfixé `+` (ex. `+1130,60`), `Debit` préfixé `-` (ex. `-0,94`), colonnes mutuellement exclusives.
- ⚠️ Certains libellés ont un ESPACE en tête (ex. ` CB COM KIMIKO 070826`) → toujours `trim()`.
- La colonne `Type operation` est la clé de classification (`Remise CB`, `Frais et extournes`, `Depot especes`, `Retrait especes`, `Virement`, `Prelevement SDD`, `Paiement CB`).

## Seuils par défaut (décision du plan, éditables en base, JAMAIS codés en dur dans le moteur)

| Paramètre | Défaut | Justification |
|---|---|---|
| `tolerance_cb` | 10 € | écart d'arrondi/décalage acceptable par semaine |
| `plafond_coffre` | 2000 € | ~1 mois d'espèces au rythme courant |
| `anciennete_max_semaines` | 4 | au-delà, alerte « espèces non déposées » |
| `bande_especes_min` / `max` | 8 % / 18 % | bande « normale » de part d'espèces dans le CA |

## Fichiers

- Create: `supabase_migration6_finances.sql` (racine, GITIGNORÉ, exécuté à la main par JC)
- Modify: `.gitignore`
- Create: `src/lib/finances.js` (moteur pur, aucune dépendance UI/Supabase)
- Create: `src/lib/finances.test.js` (Vitest)
- Create: `src/components/FinancesModule.jsx` (vue gérant)
- Modify: `src/RestoApp.jsx` (lazy import + rendu section + retirer `finances` du placeholder)

---

### Task 1 : Migration SQL (tables + RLS gérant)

**Files:**
- Create: `supabase_migration6_finances.sql`
- Modify: `.gitignore`

- [ ] **Step 1 : Écrire la migration**

Créer `supabase_migration6_finances.sql` à la racine :

```sql
-- ============================================================
-- MIGRATION 6 : module Finances v2, rapprochement caisse-banque
-- (2026-08-09). NE PAS COMMITTER (dépôt public). À exécuter UNE
-- FOIS dans Supabase SQL Editor. Prérequis : private.is_gerant()
-- (rls_hardening_2026-06-29.sql) déjà en place.
-- ============================================================
begin;

-- 1. Trace des imports CSV (créée en premier : référencée par les lignes)
create table if not exists public.finance_imports (
  id uuid primary key default uuid_generate_v4(),
  importe_le timestamptz not null default now(),
  nb_lignes int not null default 0,
  periode_min date,
  periode_max date
);

-- 2. Une ligne par semaine ISO (lundi). Écart CB et « espèces à
--    déposer » sont DÉRIVÉS par le moteur, pas stockés.
create table if not exists public.finance_semaines (
  id uuid primary key default uuid_generate_v4(),
  semaine_debut date not null unique,
  statut text not null default 'en_cours'
    check (statut in ('en_cours','a_deposer','attente_banque','reconciliee','ecart')),
  -- Côté caisse (saisi par le gérant, ou API en phase 2)
  caisse_cb numeric,
  caisse_especes numeric,
  caisse_uber numeric,
  caisse_deliveroo numeric,
  caisse_autres numeric,
  caisse_source text check (caisse_source in ('manuelle','caisse_web','api')),
  caisse_saisi_le timestamptz,
  -- Côté banque (agrégats recalculés à chaque import)
  banque_cb numeric,
  banque_depot_especes numeric,
  banque_uber numeric,
  banque_deliveroo numeric,
  banque_direct numeric,
  banque_titres numeric,
  notes text,
  created_at timestamptz not null default now()
);

-- 3. Lignes brutes du CSV, classées. Clé de dédoublonnage : une
--    même opération réimportée n'est JAMAIS comptée deux fois.
create table if not exists public.finance_banque_lignes (
  id uuid primary key default uuid_generate_v4(),
  date_operation date not null,
  libelle text not null,
  montant numeric not null,
  categorie text not null check (categorie in (
    'remise_cb','frais_cb','depot_especes','retrait_especes',
    'versement_uber','versement_deliveroo','direct_click_collect',
    'titres_resto','charges','autre')),
  semaine_rattachee date not null,
  date_estimee boolean not null default false,
  import_id uuid references public.finance_imports(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (date_operation, montant, libelle)
);

-- 4. Seuils et tolérances (une seule ligne, éditable)
create table if not exists public.finance_settings (
  id int primary key default 1 check (id = 1),
  tolerance_cb numeric not null default 10,
  plafond_coffre numeric not null default 2000,
  anciennete_max_semaines int not null default 4,
  bande_especes_min numeric not null default 8,
  bande_especes_max numeric not null default 18
);
insert into public.finance_settings (id) values (1) on conflict do nothing;

-- 5. RLS : données bancaires = gérant uniquement, lecture ET écriture
alter table public.finance_imports enable row level security;
create policy finance_imports_all on public.finance_imports
  for all to authenticated
  using ( private.is_gerant() ) with check ( private.is_gerant() );

alter table public.finance_semaines enable row level security;
create policy finance_semaines_all on public.finance_semaines
  for all to authenticated
  using ( private.is_gerant() ) with check ( private.is_gerant() );

alter table public.finance_banque_lignes enable row level security;
create policy finance_banque_lignes_all on public.finance_banque_lignes
  for all to authenticated
  using ( private.is_gerant() ) with check ( private.is_gerant() );

alter table public.finance_settings enable row level security;
create policy finance_settings_all on public.finance_settings
  for all to authenticated
  using ( private.is_gerant() ) with check ( private.is_gerant() );

commit;
```

- [ ] **Step 2 : Gitignorer la migration**

Ajouter à la fin de `.gitignore` :

```gitignore
# Module Finances : données bancaires, jamais committé (dépôt public)
supabase_migration6_finances.sql
```

- [ ] **Step 3 : Vérifier que git ne voit pas la migration**

Run : `git status --short`
Expected : `.gitignore` modifié apparaît, `supabase_migration6_finances.sql` N'APPARAÎT PAS.

- [ ] **Step 4 : Commit du .gitignore seul**

```powershell
git add .gitignore
git commit -m @'
chore(finances): gitignore de la migration 6 (depot public)
'@
```

- [ ] **Step 5 : CHECKPOINT MANUEL — exécution par Jean-Claude**

JC copie le contenu de `supabase_migration6_finances.sql` dans le SQL Editor de Supabase (projet `udhqiasudfiiiovhmspz`) et l'exécute. Vérification dans le SQL Editor :

```sql
select count(*) from public.finance_settings;  -- attendu : 1
select count(*) from public.finance_semaines;  -- attendu : 0
```

Ne pas passer à la Task 10 (UI branchée sur Supabase) avant ce checkpoint. Les Tasks 2 à 9 (moteur pur) n'en dépendent pas.

---

### Task 2 : Moteur — `parseBankCSV`

**Files:**
- Create: `src/lib/finances.js`
- Create: `src/lib/finances.test.js`

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `src/lib/finances.test.js`. Libellés SYNTHÉTIQUES au format réel, jamais de vraies données :

```js
import { describe, it, expect } from 'vitest';
import { parseBankCSV } from './finances.js';

// En-tête réel d'un export Caisse d'Épargne (vérifié le 09/08/2026).
const HEADER_CE = 'Date comptable;Libelle simplifie;Reference;Informations complementaires;Type operation;Debit;Credit;Date operation;Date de valeur;Pointage';

const CSV_OK = [
  HEADER_CE,
  '05/01/2026;CB KIMIKO 040126;12345620260104;CONTRAT 0000000 REM 123456;Remise CB;;+500,00;05/01/2026;06/01/2026;Non',
  '05/01/2026; CB COM KIMIKO 040126;;CONTRAT 0000000 REM 123456;Frais et extournes;-2,50;;05/01/2026;06/01/2026;Non',
  '',
].join('\n');

describe('parseBankCSV', () => {
  it('parse une remise CB : crédit positif, virgule décimale, date ISO', () => {
    const lignes = parseBankCSV(CSV_OK);
    expect(lignes).toHaveLength(2);
    expect(lignes[0]).toEqual({
      dateOperation: '2026-01-05',
      libelle: 'CB KIMIKO 040126',
      reference: '12345620260104',
      infos: 'CONTRAT 0000000 REM 123456',
      typeOperation: 'Remise CB',
      montant: 500,
    });
  });
  it('parse un débit en négatif et trime l\'espace en tête du libellé', () => {
    const lignes = parseBankCSV(CSV_OK);
    expect(lignes[1].montant).toBeCloseTo(-2.5, 6);
    expect(lignes[1].libelle).toBe('CB COM KIMIKO 040126');
  });
  it('accepte les fins de ligne CRLF et ignore les lignes vides', () => {
    expect(parseBankCSV(CSV_OK.replace(/\n/g, '\r\n'))).toHaveLength(2);
  });
  it('rejette un CSV sans les colonnes attendues, sans rien retourner', () => {
    expect(() => parseBankCSV('a;b;c\n1;2;3')).toThrow(/Format de CSV inattendu/);
  });
  it('rejette un fichier vide', () => {
    expect(() => parseBankCSV('')).toThrow(/Format de CSV inattendu/);
  });
  it('rejette une ligne au montant illisible', () => {
    const csv = [HEADER_CE, '05/01/2026;X;;;Remise CB;;abc;05/01/2026;;Non'].join('\n');
    expect(() => parseBankCSV(csv)).toThrow(/Format de CSV inattendu/);
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run : `npm test`
Expected : FAIL, `finances.js` introuvable.

- [ ] **Step 3 : Implémenter le parseur**

Créer `src/lib/finances.js` :

```js
// Logique pure du module Finances. Aucune dépendance UI ni Supabase.
// Dépôt PUBLIC : aucun libellé bancaire réel, montant réel ni numéro de
// contrat dans ce fichier ni dans les tests (jeux synthétiques).

// ─── Parsing du CSV Caisse d'Épargne ───
// Format réel vérifié (09/08/2026) : en-tête en ligne 1 (pas de préambule),
// délimiteur ';', dates JJ/MM/AAAA, Credit préfixé '+', Debit préfixé '-',
// colonnes Debit/Credit mutuellement exclusives, libellés parfois précédés
// d'un espace parasite.

const COLONNES_REQUISES = ['Date comptable', 'Type operation', 'Debit', 'Credit', 'Date operation'];

function parseDateFR(jjmmaaaa) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((jjmmaaaa || '').trim());
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function parseMontantFR(s) {
  const clean = (s || '').trim().replace(/\+/g, '').replace(/\s/g, '').replace(',', '.');
  if (!clean) return null;
  const n = Number(clean);
  return Number.isNaN(n) ? null : n;
}

// → [{ dateOperation:'2026-01-05', libelle, reference, infos,
//      typeOperation:'Remise CB', montant: 500 }]  (débits en négatif)
// Jette une Error('Format de CSV inattendu…') au moindre doute :
// on n'enregistre RIEN plutôt que d'enregistrer faux.
export function parseBankCSV(text) {
  const lignes = (text || '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (!lignes.length) throw new Error('Format de CSV inattendu : fichier vide.');
  const entete = lignes[0].split(';').map((c) => c.trim());
  const idx = {};
  for (const col of COLONNES_REQUISES) {
    const i = entete.indexOf(col);
    if (i === -1) throw new Error(`Format de CSV inattendu : colonne « ${col} » absente.`);
    idx[col] = i;
  }
  const iLibelle = entete.indexOf('Libelle simplifie');
  const iRef = entete.indexOf('Reference');
  const iInfos = entete.indexOf('Informations complementaires');
  const resultat = [];
  for (const brute of lignes.slice(1)) {
    const c = brute.split(';');
    const dateOperation = parseDateFR(c[idx['Date operation']]) || parseDateFR(c[idx['Date comptable']]);
    const credit = parseMontantFR(c[idx['Credit']]);
    const debit = parseMontantFR(c[idx['Debit']]);
    const montant = credit !== null ? credit : debit;
    if (dateOperation === null || montant === null) {
      throw new Error(`Format de CSV inattendu : ligne illisible « ${brute.slice(0, 40)} »`);
    }
    resultat.push({
      dateOperation,
      libelle: (c[iLibelle] || '').trim(),
      reference: (c[iRef] || '').trim(),
      infos: (c[iInfos] || '').trim(),
      typeOperation: (c[idx['Type operation']] || '').trim(),
      montant,
    });
  }
  return resultat;
}
```

- [ ] **Step 4 : Vérifier le vert**

Run : `npm test`
Expected : PASS (6 tests `parseBankCSV`).

- [ ] **Step 5 : Commit**

```powershell
git add src/lib/finances.js src/lib/finances.test.js
git commit -m @'
feat(finances): parseur du CSV Caisse d Epargne (moteur pur)
'@
```

---

### Task 3 : Moteur — `categorizeBankLine`

**Files:**
- Modify: `src/lib/finances.js`
- Modify: `src/lib/finances.test.js`

- [ ] **Step 1 : Écrire les tests qui échouent**

Ajouter à `finances.test.js` (compléter l'import : `import { parseBankCSV, categorizeBankLine } from './finances.js';`) :

```js
// Fabrique une ligne déjà parsée (même forme que la sortie de parseBankCSV).
const ligne = (typeOperation, libelle, extra = {}) =>
  ({ dateOperation: '2026-01-05', libelle, reference: '', infos: '', typeOperation, montant: 100, ...extra });

describe('categorizeBankLine', () => {
  it('Remise CB → remise_cb', () => {
    expect(categorizeBankLine(ligne('Remise CB', 'CB KIMIKO 040126'))).toBe('remise_cb');
  });
  it('Frais et extournes + CB COM → frais_cb', () => {
    expect(categorizeBankLine(ligne('Frais et extournes', 'CB COM KIMIKO 040126'))).toBe('frais_cb');
  });
  it('Frais et extournes sans CB COM → autre', () => {
    expect(categorizeBankLine(ligne('Frais et extournes', 'EXTOURNE DIVERSE'))).toBe('autre');
  });
  it('Depot especes → depot_especes', () => {
    expect(categorizeBankLine(ligne('Depot especes', 'DEPOT ESPECE GAB 0000000'))).toBe('depot_especes');
  });
  it('Retrait especes → retrait_especes', () => {
    expect(categorizeBankLine(ligne('Retrait especes', 'RETRAIT GAB'))).toBe('retrait_especes');
  });
  it('Virement Deliveroo → versement_deliveroo', () => {
    expect(categorizeBankLine(ligne('Virement', 'VIR SEPA DELIVEROO FR'))).toBe('versement_deliveroo');
  });
  it('Virement STICHTING CUSTODIAN UB → versement_uber (Uber ne dit jamais UBER)', () => {
    expect(categorizeBankLine(ligne('Virement', 'VIR SEPA STICHTING CUSTODIAN UB'))).toBe('versement_uber');
  });
  it('Virement STRIPE + réf FULLE → direct_click_collect', () => {
    expect(categorizeBankLine(ligne('Virement', 'VIR SEPA STRIPE', { reference: 'FULLE-000' }))).toBe('direct_click_collect');
  });
  it('Virement STRIPE sans FULLE → autre', () => {
    expect(categorizeBankLine(ligne('Virement', 'VIR SEPA STRIPE'))).toBe('autre');
  });
  it('titres resto : EDENRED, PLUXEE, UP COOP, SWILE → titres_resto', () => {
    for (const emetteur of ['EDENRED', 'PLUXEE', 'UP COOP', 'SWILE']) {
      expect(categorizeBankLine(ligne('Virement', `VIR SEPA ${emetteur} FRANCE`))).toBe('titres_resto');
    }
  });
  it('Virement inconnu → autre', () => {
    expect(categorizeBankLine(ligne('Virement', 'VIR SEPA QUELCONQUE'))).toBe('autre');
  });
  it('Prelevement SDD et Paiement CB → charges (hors rapprochement V1)', () => {
    expect(categorizeBankLine(ligne('Prelevement SDD', 'PRLV FOURNISSEUR'))).toBe('charges');
    expect(categorizeBankLine(ligne('Paiement CB', 'CUMUL DES DEBITS DIFFERES'))).toBe('charges');
  });
  it('Type operation inconnu → autre', () => {
    expect(categorizeBankLine(ligne('Cheque', 'CHEQUE 123'))).toBe('autre');
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run : `npm test`
Expected : FAIL, `categorizeBankLine` non exporté.

- [ ] **Step 3 : Implémenter la classification**

Ajouter à `finances.js` :

```js
// ─── Classification ───
// D'abord par « Type operation » (colonne fiable de la banque), puis
// affinage par libellé. Les règles vivent dans un objet unique, faciles
// à ajuster ici ; un éditeur in-app est en phase 2 si besoin.

export const REGLES_VIREMENT = [
  { categorie: 'versement_deliveroo', motif: /DELIVEROO/i },
  { categorie: 'versement_uber', motif: /STICHTING CUSTODIAN UB/i },   // Uber ne dit jamais « UBER »
  { categorie: 'titres_resto', motif: /(EDENRED|PLUXEE|UP COOP|SWILE)/i },
];

export function categorizeBankLine(l) {
  const type = (l.typeOperation || '').toLowerCase();
  const texte = `${l.libelle} ${l.infos} ${l.reference}`;
  if (type === 'remise cb') return 'remise_cb';
  if (type === 'frais et extournes') return /CB COM/i.test(l.libelle) ? 'frais_cb' : 'autre';
  if (type === 'depot especes') return 'depot_especes';
  if (type === 'retrait especes') return 'retrait_especes';
  if (type === 'virement') {
    for (const r of REGLES_VIREMENT) if (r.motif.test(texte)) return r.categorie;
    // Direct / click & collect : Stripe encaisse pour le webshop Fülle.
    if (/STRIPE/i.test(texte) && /FULLE/i.test(texte)) return 'direct_click_collect';
    return 'autre';
  }
  if (type === 'prelevement sdd' || type === 'paiement cb') return 'charges';
  return 'autre';
}
```

- [ ] **Step 4 : Vérifier le vert**

Run : `npm test`
Expected : PASS (tous les tests, dont 13 `categorizeBankLine`).

- [ ] **Step 5 : Commit**

```powershell
git add src/lib/finances.js src/lib/finances.test.js
git commit -m @'
feat(finances): classification des lignes banque par Type operation
'@
```

---

### Task 4 : Moteur — date de vente CB et rattachement à la semaine

**Files:**
- Modify: `src/lib/finances.js`
- Modify: `src/lib/finances.test.js`

- [ ] **Step 1 : Écrire les tests qui échouent**

Ajouter à `finances.test.js` (compléter l'import avec `extractSaleDateFromCB, mondayOf, attachToSaleWeek`). Repère calendaire : en janvier 2026, le 5, le 12 et le 19 sont des lundis, le 18 est un dimanche.

```js
describe('extractSaleDateFromCB', () => {
  it('lit la date de vente JJMMAA dans le libellé', () => {
    expect(extractSaleDateFromCB('CB KIMIKO 180126')).toBe('2026-01-18');
  });
  it('ne matche PAS un libellé de frais « CB COM KIMIKO … »', () => {
    expect(extractSaleDateFromCB('CB COM KIMIKO 180126')).toBeNull();
  });
  it('rejette une date impossible', () => {
    expect(extractSaleDateFromCB('CB KIMIKO 999999')).toBeNull();
  });
  it('rejette un libellé sans date', () => {
    expect(extractSaleDateFromCB('VIR SEPA QUELCONQUE')).toBeNull();
  });
});

describe('mondayOf', () => {
  it('un dimanche se rattache au lundi qui le précède', () => {
    expect(mondayOf('2026-01-18')).toBe('2026-01-12');
  });
  it('un lundi reste lui-même', () => {
    expect(mondayOf('2026-01-12')).toBe('2026-01-12');
  });
  it('traverse un changement de mois', () => {
    expect(mondayOf('2026-02-01')).toBe('2026-01-26');
  });
});

describe('attachToSaleWeek', () => {
  const remise = { dateOperation: '2026-01-20', libelle: 'CB KIMIKO 180126' };
  it('remise CB → semaine de la date de VENTE (pas de l\'opération)', () => {
    expect(attachToSaleWeek(remise, 'remise_cb'))
      .toEqual({ semaineRattachee: '2026-01-12', dateEstimee: false });
  });
  it('remise CB sans date lisible → semaine de l\'opération, signalée estimée', () => {
    const l = { dateOperation: '2026-01-20', libelle: 'CB KIMIKO SANSDATE' };
    expect(attachToSaleWeek(l, 'remise_cb'))
      .toEqual({ semaineRattachee: '2026-01-19', dateEstimee: true });
  });
  it('les autres catégories → semaine de l\'opération', () => {
    const depot = { dateOperation: '2026-01-21', libelle: 'DEPOT ESPECE GAB 0000000' };
    expect(attachToSaleWeek(depot, 'depot_especes'))
      .toEqual({ semaineRattachee: '2026-01-19', dateEstimee: false });
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run : `npm test`
Expected : FAIL, fonctions non exportées.

- [ ] **Step 3 : Implémenter**

Ajouter à `finances.js` :

```js
// ─── Rattachement à la semaine de VENTE ───
// Libellé « CB KIMIKO 180126 » : les 6 chiffres sont la date de vente
// (JJMMAA). C'est ce qui permet de rapprocher une remise CB de la bonne
// semaine, même si elle tombe en banque 1 à 3 jours plus tard.

export function extractSaleDateFromCB(libelle) {
  const m = /CB KIMIKO (\d{6})/.exec(libelle || '');
  if (!m) return null;
  const jj = m[1].slice(0, 2), mm = m[1].slice(2, 4), aa = m[1].slice(4, 6);
  if (Number(jj) < 1 || Number(jj) > 31 || Number(mm) < 1 || Number(mm) > 12) return null;
  return `20${aa}-${mm}-${jj}`;
}

// Lundi (ISO) de la semaine d'une date ISO. Calcul à midi UTC : aucun
// risque de bascule de jour liée au fuseau.
export function mondayOf(dateISO) {
  const d = new Date(`${dateISO}T12:00:00Z`);
  const decalage = (d.getUTCDay() + 6) % 7;   // lundi=0 … dimanche=6
  d.setUTCDate(d.getUTCDate() - decalage);
  return d.toISOString().slice(0, 10);
}

// → { semaineRattachee, dateEstimee }. Une remise CB se rattache à la
// semaine de la date de vente ; à défaut (date illisible → signalé),
// ou pour toute autre catégorie, à la semaine de la date d'opération.
export function attachToSaleWeek(l, categorie) {
  if (categorie === 'remise_cb') {
    const dateVente = extractSaleDateFromCB(l.libelle);
    if (dateVente) return { semaineRattachee: mondayOf(dateVente), dateEstimee: false };
    return { semaineRattachee: mondayOf(l.dateOperation), dateEstimee: true };
  }
  return { semaineRattachee: mondayOf(l.dateOperation), dateEstimee: false };
}
```

- [ ] **Step 4 : Vérifier le vert**

Run : `npm test`
Expected : PASS.

- [ ] **Step 5 : Commit**

```powershell
git add src/lib/finances.js src/lib/finances.test.js
git commit -m @'
feat(finances): rattachement des remises CB a leur semaine de vente
'@
```

---

### Task 5 : Moteur — dédoublonnage

**Files:**
- Modify: `src/lib/finances.js`
- Modify: `src/lib/finances.test.js`

- [ ] **Step 1 : Écrire les tests qui échouent**

Ajouter à `finances.test.js` (compléter l'import avec `dedupKey, dedupBankLines`) :

```js
describe('dedupBankLines', () => {
  const a = { dateOperation: '2026-01-05', libelle: 'CB KIMIKO 040126', montant: 500 };
  const b = { dateOperation: '2026-01-06', libelle: 'CB KIMIKO 050126', montant: 320 };
  it('réimport à l\'identique → zéro nouvelle ligne', () => {
    const existantes = new Set([dedupKey(a), dedupKey(b)]);
    expect(dedupBankLines([a, b], existantes)).toEqual({ nouvelles: [], doublons: 2 });
  });
  it('chevauchement partiel → seules les inconnues passent', () => {
    const existantes = new Set([dedupKey(a)]);
    const { nouvelles, doublons } = dedupBankLines([a, b], existantes);
    expect(nouvelles).toEqual([b]);
    expect(doublons).toBe(1);
  });
  it('doublon INTERNE au même fichier → une seule occurrence gardée', () => {
    const { nouvelles, doublons } = dedupBankLines([a, a], new Set());
    expect(nouvelles).toEqual([a]);
    expect(doublons).toBe(1);
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run : `npm test`
Expected : FAIL.

- [ ] **Step 3 : Implémenter**

Ajouter à `finances.js` :

```js
// ─── Dédoublonnage ───
// Clé métier (date, montant, libellé), identique à la contrainte unique
// de finance_banque_lignes : réimporter un CSV qui chevauche une période
// déjà importée ne compte JAMAIS deux fois une opération.

export function dedupKey(l) {
  return `${l.dateOperation}|${l.montant}|${l.libelle}`;
}

// clesExistantes : Set des clés déjà en base. → { nouvelles, doublons }
export function dedupBankLines(lignes, clesExistantes) {
  const vues = new Set(clesExistantes || []);
  const nouvelles = [];
  let doublons = 0;
  for (const l of lignes) {
    const cle = dedupKey(l);
    if (vues.has(cle)) { doublons++; continue; }
    vues.add(cle);
    nouvelles.push(l);
  }
  return { nouvelles, doublons };
}
```

- [ ] **Step 4 : Vérifier le vert**

Run : `npm test`
Expected : PASS.

- [ ] **Step 5 : Commit**

```powershell
git add src/lib/finances.js src/lib/finances.test.js
git commit -m @'
feat(finances): dedoublonnage des lignes banque a la reimportation
'@
```

---

### Task 6 : Moteur — agrégats banque par semaine

**Files:**
- Modify: `src/lib/finances.js`
- Modify: `src/lib/finances.test.js`

- [ ] **Step 1 : Écrire les tests qui échouent**

Ajouter à `finances.test.js` (compléter l'import avec `aggregateBanqueParSemaine`) :

```js
describe('aggregateBanqueParSemaine', () => {
  it('somme chaque catégorie d\'encaissement dans sa colonne, par semaine', () => {
    const lignes = [
      { montant: 500, categorie: 'remise_cb', semaineRattachee: '2026-01-12' },
      { montant: 320, categorie: 'remise_cb', semaineRattachee: '2026-01-12' },
      { montant: 600, categorie: 'depot_especes', semaineRattachee: '2026-01-19' },
      { montant: 250, categorie: 'versement_uber', semaineRattachee: '2026-01-12' },
      { montant: 90, categorie: 'titres_resto', semaineRattachee: '2026-01-12' },
    ];
    expect(aggregateBanqueParSemaine(lignes)).toEqual({
      '2026-01-12': { banque_cb: 820, banque_depot_especes: 0, banque_uber: 250, banque_deliveroo: 0, banque_direct: 0, banque_titres: 90 },
      '2026-01-19': { banque_cb: 0, banque_depot_especes: 600, banque_uber: 0, banque_deliveroo: 0, banque_direct: 0, banque_titres: 0 },
    });
  });
  it('ignore frais_cb, charges, retraits et « autre » (hors encaissements)', () => {
    const lignes = [
      { montant: -2.5, categorie: 'frais_cb', semaineRattachee: '2026-01-12' },
      { montant: -800, categorie: 'charges', semaineRattachee: '2026-01-12' },
      { montant: -100, categorie: 'retrait_especes', semaineRattachee: '2026-01-12' },
      { montant: 42, categorie: 'autre', semaineRattachee: '2026-01-12' },
    ];
    expect(aggregateBanqueParSemaine(lignes)).toEqual({});
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run : `npm test`
Expected : FAIL.

- [ ] **Step 3 : Implémenter**

Ajouter à `finances.js` :

```js
// ─── Agrégats banque par semaine ───
// catégorie → colonne de finance_semaines. Les catégories absentes de la
// table (frais, charges, retraits, autre) ne participent pas aux totaux
// d'encaissement ; elles restent visibles ligne à ligne.

const COLONNE_PAR_CATEGORIE = {
  remise_cb: 'banque_cb',
  depot_especes: 'banque_depot_especes',
  versement_uber: 'banque_uber',
  versement_deliveroo: 'banque_deliveroo',
  direct_click_collect: 'banque_direct',
  titres_resto: 'banque_titres',
};

// lignes : [{ montant, categorie, semaineRattachee }]
// → { '2026-01-12': { banque_cb: 820, banque_depot_especes: 0, … } }
export function aggregateBanqueParSemaine(lignes) {
  const parSemaine = {};
  for (const l of lignes) {
    const colonne = COLONNE_PAR_CATEGORIE[l.categorie];
    if (!colonne) continue;
    if (!parSemaine[l.semaineRattachee]) {
      parSemaine[l.semaineRattachee] = {
        banque_cb: 0, banque_depot_especes: 0, banque_uber: 0,
        banque_deliveroo: 0, banque_direct: 0, banque_titres: 0,
      };
    }
    parSemaine[l.semaineRattachee][colonne] += l.montant;
  }
  return parSemaine;
}
```

- [ ] **Step 4 : Vérifier le vert**

Run : `npm test`
Expected : PASS.

- [ ] **Step 5 : Commit**

```powershell
git add src/lib/finances.js src/lib/finances.test.js
git commit -m @'
feat(finances): agregats banque par semaine de vente
'@
```

---

### Task 7 : Moteur — coffre théorique (cumul FIFO)

**Files:**
- Modify: `src/lib/finances.js`
- Modify: `src/lib/finances.test.js`

- [ ] **Step 1 : Écrire les tests qui échouent**

Ajouter à `finances.test.js` (compléter l'import avec `SEUILS_DEFAUT, computeCoffreTheorique`) :

```js
describe('computeCoffreTheorique', () => {
  const semaines = [
    { semaine_debut: '2026-01-05', caisse_especes: 500 },
    { semaine_debut: '2026-01-12', caisse_especes: 400 },
    { semaine_debut: '2026-01-19', caisse_especes: 300 },
  ];
  it('sans dépôt : solde = cumul, origine = semaine la plus ancienne', () => {
    const r = computeCoffreTheorique(semaines, [], '2026-01-26');
    expect(r.solde).toBe(1200);
    expect(r.semaineOrigine).toBe('2026-01-05');
    expect(r.couvertes).toEqual({ '2026-01-05': false, '2026-01-12': false, '2026-01-19': false });
  });
  it('un dépôt couvre la 1re semaine en FIFO, la 2e devient l\'origine', () => {
    const r = computeCoffreTheorique(semaines, [{ montant: 500 }], '2026-01-26');
    expect(r.solde).toBe(700);
    expect(r.semaineOrigine).toBe('2026-01-12');
    expect(r.couvertes['2026-01-05']).toBe(true);
    expect(r.couvertes['2026-01-12']).toBe(false);
  });
  it('un dépôt PARTIEL ne solde pas la semaine (origine inchangée)', () => {
    const r = computeCoffreTheorique(semaines, [{ montant: 300 }], '2026-01-26');
    expect(r.semaineOrigine).toBe('2026-01-05');
    expect(r.couvertes['2026-01-05']).toBe(false);
  });
  it('tout déposé : solde 0, pas d\'origine, pas d\'alerte', () => {
    const r = computeCoffreTheorique(semaines, [{ montant: 1200 }], '2026-06-01');
    expect(r.solde).toBe(0);
    expect(r.semaineOrigine).toBeNull();
    expect(r.alertes).toEqual([]);
  });
  it('alerte plafond quand le solde dépasse plafond_coffre', () => {
    const grosses = [{ semaine_debut: '2026-01-05', caisse_especes: 2500 }];
    const r = computeCoffreTheorique(grosses, [], '2026-01-12');
    expect(r.alertes).toContain('plafond_coffre');
  });
  it('alerte ancienneté au-delà de anciennete_max_semaines', () => {
    const r = computeCoffreTheorique(semaines, [], '2026-03-16'); // 10 semaines après le 05/01
    expect(r.ancienneteSemaines).toBe(10);
    expect(r.alertes).toContain('anciennete');
  });
  it('ignore les semaines sans saisie espèces (null)', () => {
    const avecTrou = [...semaines, { semaine_debut: '2026-01-26', caisse_especes: null }];
    expect(computeCoffreTheorique(avecTrou, [], '2026-02-02').solde).toBe(1200);
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run : `npm test`
Expected : FAIL.

- [ ] **Step 3 : Implémenter**

Ajouter à `finances.js` :

```js
// ─── Seuils par défaut ───
// Miroir de la table finance_settings. L'UI charge la table et passe les
// valeurs au moteur ; ces défauts ne servent qu'en secours et aux tests.
export const SEUILS_DEFAUT = {
  tolerance_cb: 10,
  plafond_coffre: 2000,
  anciennete_max_semaines: 4,
  bande_especes_min: 8,
  bande_especes_max: 18,
};

// ─── Coffre théorique d'espèces (cumul) ───
// « Combien d'espèces devraient être non déposées, là, maintenant, et
// depuis quand ». Tout l'espèces part au dépôt (pas de fond de caisse à
// soustraire). Les dépôts s'imputent en FIFO contre les semaines les
// plus anciennes ; le rapprochement espèces se ferme au niveau cumulé,
// pas semaine par semaine (le fils peut grouper les dépôts).

const EPSILON = 0.005; // tolérance d'arrondi centimes

export function computeCoffreTheorique(semaines, depots, aujourdHui, seuils = SEUILS_DEFAUT) {
  const triees = [...(semaines || [])]
    .filter((s) => s.caisse_especes !== null && s.caisse_especes !== undefined)
    .sort((a, b) => a.semaine_debut.localeCompare(b.semaine_debut));
  const totalEspeces = triees.reduce((t, s) => t + Number(s.caisse_especes), 0);
  const totalDepots = (depots || []).reduce((t, d) => t + Number(d.montant), 0);
  const solde = Math.round((totalEspeces - totalDepots) * 100) / 100;

  // Imputation FIFO : chaque dépôt couvre d'abord la semaine la plus ancienne.
  let reste = totalDepots;
  let semaineOrigine = null;
  const couvertes = {};
  for (const s of triees) {
    const du = Number(s.caisse_especes);
    if (reste >= du - EPSILON) { couvertes[s.semaine_debut] = true; reste -= du; }
    else {
      couvertes[s.semaine_debut] = false;
      if (semaineOrigine === null) semaineOrigine = s.semaine_debut;
    }
  }

  const ancienneteSemaines = semaineOrigine === null ? 0
    : Math.floor((new Date(`${aujourdHui}T12:00:00Z`) - new Date(`${semaineOrigine}T12:00:00Z`)) / (7 * 86400000));
  const alertes = [];
  if (solde > seuils.plafond_coffre) alertes.push('plafond_coffre');
  if (semaineOrigine !== null && ancienneteSemaines > seuils.anciennete_max_semaines) alertes.push('anciennete');
  return { solde, semaineOrigine, ancienneteSemaines, alertes, couvertes };
}
```

- [ ] **Step 4 : Vérifier le vert**

Run : `npm test`
Expected : PASS.

- [ ] **Step 5 : Commit**

```powershell
git add src/lib/finances.js src/lib/finances.test.js
git commit -m @'
feat(finances): coffre theorique d especes en cumul FIFO
'@
```

---

### Task 8 : Moteur — rapprochement, statuts et détecteur d'anomalie

**Files:**
- Modify: `src/lib/finances.js`
- Modify: `src/lib/finances.test.js`

Machine à états implémentée (du spec §5) : `en_cours` → `a_deposer` → `attente_banque` → `reconciliee` / `ecart`. Le distinguo « attente_banque vs ecart » repose sur une fenêtre d'attente : les remises CB d'une semaine tombent sous quelques jours ouvrés ; un manque CB n'est un écart QUE si la fenêtre est passée.

- [ ] **Step 1 : Écrire les tests qui échouent**

Ajouter à `finances.test.js` (compléter l'import avec `computeReconciliation, DELAI_REMISES_JOURS`) :

```js
describe('computeReconciliation', () => {
  // Une semaine saine : CB caisse 1000 / banque 998, 12 % d'espèces.
  const saine = {
    semaine_debut: '2026-01-05',
    caisse_cb: 1000, caisse_especes: 150, caisse_uber: 80, caisse_deliveroo: 20, caisse_autres: 0,
    banque_cb: 998,
  };
  it('totaux caisse absents → en_cours, AUCUN écart calculé (pas de faux positif)', () => {
    const r = computeReconciliation({ semaine_debut: '2026-01-05', caisse_cb: null, banque_cb: 500 }, true, SEUILS_DEFAUT, '2026-02-01');
    expect(r).toEqual({ statut: 'en_cours', ecartCb: null, especesADeposer: null, alertes: [] });
  });
  it('CB dans la tolérance + espèces couvertes → reconciliee', () => {
    const r = computeReconciliation(saine, true, SEUILS_DEFAUT, '2026-02-01');
    expect(r.statut).toBe('reconciliee');
    expect(r.ecartCb).toBe(2);
    expect(r.alertes).toEqual([]);
  });
  it('CB ok mais espèces non couvertes → a_deposer, avec le montant à déposer', () => {
    const r = computeReconciliation(saine, false, SEUILS_DEFAUT, '2026-02-01');
    expect(r.statut).toBe('a_deposer');
    expect(r.especesADeposer).toBe(150);
  });
  it('CB manquant en banque PENDANT la fenêtre → attente_banque, pas d\'alerte', () => {
    const enAttente = { ...saine, banque_cb: 400 };
    const r = computeReconciliation(enAttente, true, SEUILS_DEFAUT, '2026-01-13'); // 2 jours après la fin de semaine
    expect(r.statut).toBe('attente_banque');
    expect(r.alertes).toEqual([]);
  });
  it('CB manquant APRÈS la fenêtre → ecart + alerte anomalie (cas janvier)', () => {
    const fictive = { ...saine, caisse_cb: 5000, banque_cb: 1000 };
    const r = computeReconciliation(fictive, true, SEUILS_DEFAUT, '2026-02-15');
    expect(r.statut).toBe('ecart');
    expect(r.alertes.some((a) => a.type === 'anomalie_cb')).toBe(true);
  });
  it('part d\'espèces hors bande → alerte bande_especes (sans casser le statut)', () => {
    const bizarre = { ...saine, caisse_especes: 600 }; // ~35 % d'espèces
    const r = computeReconciliation(bizarre, false, SEUILS_DEFAUT, '2026-02-01');
    expect(r.alertes.some((a) => a.type === 'bande_especes')).toBe(true);
  });
  it('banque_cb null pendant la fenêtre → attente d\'import, pas un écart', () => {
    const fraiche = { ...saine, banque_cb: null };
    const r = computeReconciliation(fraiche, true, SEUILS_DEFAUT, '2026-01-12');
    expect(r.statut).toBe('attente_banque');
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run : `npm test`
Expected : FAIL.

- [ ] **Step 3 : Implémenter**

Ajouter à `finances.js` :

```js
// ─── Rapprochement hebdomadaire et statuts ───

// Fenêtre d'attente des remises CB : au-delà de N jours après la FIN de la
// semaine, un manque côté banque n'est plus « en attente », c'est un écart.
export const DELAI_REMISES_JOURS = 10;

// semaine : ligne de finance_semaines. especesCouvertes : booléen issu de
// computeCoffreTheorique().couvertes[semaine_debut]. On ne compare que ce
// qui existe : sans totaux caisse, aucun écart n'est calculé.
export function computeReconciliation(semaine, especesCouvertes, seuils = SEUILS_DEFAUT, aujourdHui) {
  const vide = (v) => v === null || v === undefined;
  if (vide(semaine.caisse_cb)) {
    return { statut: 'en_cours', ecartCb: null, especesADeposer: null, alertes: [] };
  }
  const especesADeposer = Number(semaine.caisse_especes) || 0;
  const banqueCb = vide(semaine.banque_cb) ? 0 : Number(semaine.banque_cb);
  const ecartCb = Math.round((Number(semaine.caisse_cb) - banqueCb) * 100) / 100;
  const cbOk = Math.abs(ecartCb) <= Number(seuils.tolerance_cb);

  const finSemaine = new Date(`${semaine.semaine_debut}T12:00:00Z`);
  finSemaine.setUTCDate(finSemaine.getUTCDate() + 6);
  const joursDepuisFin = Math.floor((new Date(`${aujourdHui}T12:00:00Z`) - finSemaine) / 86400000);
  const fenetreOuverte = joursDepuisFin < DELAI_REMISES_JOURS;

  const alertes = [];
  let statut;
  if (cbOk && especesCouvertes) statut = 'reconciliee';
  else if (!cbOk && fenetreOuverte) statut = 'attente_banque';
  else if (!cbOk) {
    // Fenêtre passée et la banque ne colle toujours pas : le détecteur
    // d'anomalie « type janvier » (ventes en caisse jamais arrivées en banque).
    statut = 'ecart';
    alertes.push({ type: 'anomalie_cb', ecart: ecartCb });
  } else statut = 'a_deposer'; // CB ok, il ne manque que le dépôt d'espèces

  // Bande « normale » de la part d'espèces dans le CA de la semaine.
  const totalCaisse = ['caisse_cb', 'caisse_especes', 'caisse_uber', 'caisse_deliveroo', 'caisse_autres']
    .reduce((t, c) => t + (Number(semaine[c]) || 0), 0);
  if (totalCaisse > 0) {
    const part = (especesADeposer / totalCaisse) * 100;
    if (part < Number(seuils.bande_especes_min) || part > Number(seuils.bande_especes_max)) {
      alertes.push({ type: 'bande_especes', part: Math.round(part * 10) / 10 });
    }
  }
  return { statut, ecartCb, especesADeposer, alertes };
}
```

- [ ] **Step 4 : Vérifier le vert**

Run : `npm test`
Expected : PASS.

- [ ] **Step 5 : Commit**

```powershell
git add src/lib/finances.js src/lib/finances.test.js
git commit -m @'
feat(finances): rapprochement hebdo, statuts et detecteur d anomalie
'@
```

---

### Task 9 : Moteur — test d'intégration « jeu janvier »

**Files:**
- Modify: `src/lib/finances.test.js`

Chaîne complète parse → classe → rattache → dédoublonne → agrège → rapproche, sur un scénario type janvier : les totaux caisse sont gonflés, presque rien n'arrive en banque, le coffre enfle. Montants et libellés SYNTHÉTIQUES.

- [ ] **Step 1 : Écrire le test (il doit passer DU PREMIER COUP : il n'introduit aucun code nouveau, il verrouille l'assemblage)**

Ajouter à `finances.test.js` :

```js
describe('intégration : scénario type janvier (ventes fictives)', () => {
  const csv = [
    'Date comptable;Libelle simplifie;Reference;Informations complementaires;Type operation;Debit;Credit;Date operation;Date de valeur;Pointage',
    // Une seule vraie remise CB pour la semaine du 05/01, et un petit dépôt.
    '07/01/2026;CB KIMIKO 050126;00000120260105;CONTRAT 0000000 REM 000001;Remise CB;;+800,00;07/01/2026;08/01/2026;Non',
    '20/01/2026;DEPOT ESPECE GAB 0000000;;;Depot especes;;+200,00;20/01/2026;20/01/2026;Non',
  ].join('\n');
  // La caisse prétend 4 semaines à 4000 € de CB et 900 € d'espèces chacune.
  const semainesCaisse = ['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26'].map((lundi) => ({
    semaine_debut: lundi,
    caisse_cb: 4000, caisse_especes: 900, caisse_uber: 300, caisse_deliveroo: 100, caisse_autres: 0,
  }));

  it('le pipeline complet déclenche écart CB, plafond coffre et ancienneté', () => {
    const { nouvelles } = dedupBankLines(parseBankCSV(csv), new Set());
    const classees = nouvelles.map((l) => {
      const categorie = categorizeBankLine(l);
      return { ...l, categorie, ...attachToSaleWeek(l, categorie) };
    });
    const agregats = aggregateBanqueParSemaine(classees);
    expect(agregats['2026-01-05'].banque_cb).toBe(800);

    const depots = classees.filter((l) => l.categorie === 'depot_especes');
    const coffre = computeCoffreTheorique(semainesCaisse, depots, '2026-04-06');
    expect(coffre.solde).toBe(3400);                 // 4×900 − 200
    expect(coffre.alertes).toContain('plafond_coffre');
    expect(coffre.alertes).toContain('anciennete');

    const s1 = { ...semainesCaisse[0], ...agregats['2026-01-05'] };
    const r1 = computeReconciliation(s1, coffre.couvertes['2026-01-05'], SEUILS_DEFAUT, '2026-04-06');
    expect(r1.statut).toBe('ecart');                 // 4000 en caisse, 800 en banque
    expect(r1.alertes.some((a) => a.type === 'anomalie_cb')).toBe(true);
  });
});
```

- [ ] **Step 2 : Vérifier le vert et l'absence de régression**

Run : `npm test`
Expected : PASS, tous les tests du fichier.

- [ ] **Step 3 : Commit**

```powershell
git add src/lib/finances.test.js
git commit -m @'
test(finances): scenario d integration type janvier (ventes fictives)
'@
```

---

### Task 10 : UI — squelette `FinancesModule` + branchement dans RestoApp

**Files:**
- Create: `src/components/FinancesModule.jsx`
- Modify: `src/RestoApp.jsx` (3 endroits : lazy imports en tête, blocs de rendu, liste du placeholder ligne ~604)

PRÉREQUIS : checkpoint de la Task 1 passé (tables créées par JC dans Supabase).

Le statut affiché est TOUJOURS celui calculé par le moteur à l'écran (source de vérité) ; la colonne `statut` en base est une trace, synchronisée en Task 12.

- [ ] **Step 1 : Créer le composant**

Créer `src/components/FinancesModule.jsx` :

```jsx
import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { F } from '../lib/foundation.jsx';
import {
  SEUILS_DEFAUT, computeCoffreTheorique, computeReconciliation,
} from '../lib/finances.js';

const eur = (n) => `${(Number(n) || 0).toFixed(2)} €`;
const fmtSemaine = (lundi) => {
  const d = new Date(`${lundi}T12:00:00Z`);
  return `Sem. du ${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}`;
};

const STATUTS = {
  en_cours:       { label: 'En cours',        color: '#6B7280' },
  a_deposer:      { label: 'À déposer',       color: '#CA8A04' },
  attente_banque: { label: 'Attente banque',  color: '#2563EB' },
  reconciliee:    { label: 'Réconciliée',     color: '#16A34A' },
  ecart:          { label: 'ÉCART',           color: '#DC2626' },
};

export default function FinancesModule({ t }) {
  const [semaines, setSemaines] = useState([]);   // triées récentes en premier
  const [lignes, setLignes] = useState([]);
  const [seuils, setSeuils] = useState(SEUILS_DEFAUT);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const aujourdHui = new Date().toISOString().slice(0, 10);

  const recharger = async () => {
    const [se, li, st] = await Promise.all([
      supabase.from('finance_semaines').select('*').order('semaine_debut', { ascending: false }),
      supabase.from('finance_banque_lignes').select('*'),
      supabase.from('finance_settings').select('*').eq('id', 1).maybeSingle(),
    ]);
    const err = se.error || li.error || st.error;
    if (err) { setErreur(err.message); setChargement(false); return; }
    setSemaines(se.data || []);
    setLignes(li.data || []);
    if (st.data) setSeuils(st.data);
    setChargement(false);
  };
  useEffect(() => { recharger(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, []);

  const depots = useMemo(
    () => lignes.filter((l) => l.categorie === 'depot_especes').map((l) => ({ montant: l.montant })),
    [lignes]
  );
  const coffre = useMemo(
    () => computeCoffreTheorique([...semaines].reverse(), depots, aujourdHui, seuils),
    [semaines, depots, aujourdHui, seuils]
  );
  const recos = useMemo(() => {
    const map = {};
    for (const s of semaines) {
      map[s.semaine_debut] = computeReconciliation(s, !!coffre.couvertes[s.semaine_debut], seuils, aujourdHui);
    }
    return map;
  }, [semaines, coffre, seuils, aujourdHui]);
  const nbAlertes = Object.values(recos).reduce((n, r) => n + r.alertes.length, 0) + coffre.alertes.length;

  const couleurCoffre = coffre.solde > Number(seuils.plafond_coffre) ? t.danger
    : coffre.solde > Number(seuils.plafond_coffre) * 0.7 ? t.warning : t.success;

  if (chargement) return <div style={{ padding: 40, textAlign: 'center', opacity: 0.6, fontFamily: F }}>Chargement…</div>;
  if (erreur) return <div style={{ padding: 40, color: t.danger, fontFamily: F }}>Erreur : {erreur}</div>;

  const th = { textAlign: 'right', padding: '10px 12px', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: t.textMuted, borderBottom: `1px solid ${t.border}` };
  const td = { textAlign: 'right', padding: '10px 12px', borderBottom: `1px solid ${t.border}` };

  return (
    <div style={{ fontFamily: F }}>
      {/* ── Bandeau cockpit ── */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', background: t.surface, border: `1px solid ${t.border}`, borderLeft: `5px solid ${couleurCoffre}`, borderRadius: 14, padding: '18px 22px', marginBottom: 20 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, color: t.textMuted }}>Coffre théorique</div>
          <div style={{ fontSize: 26, fontWeight: 700, color: couleurCoffre }}>{eur(coffre.solde)} non déposés</div>
          {coffre.semaineOrigine && (
            <div style={{ fontSize: 13, color: t.textMuted, marginTop: 2 }}>
              depuis la {fmtSemaine(coffre.semaineOrigine).toLowerCase()} ({coffre.ancienneteSemaines} sem.)
            </div>
          )}
        </div>
        {nbAlertes > 0 && (
          <div style={{ background: t.danger + '15', color: t.danger, borderRadius: 10, padding: '8px 14px', fontWeight: 700, fontSize: 13 }}>
            {nbAlertes} alerte{nbAlertes > 1 ? 's' : ''}
          </div>
        )}
      </div>

      {/* ── Tableau des semaines ── */}
      {semaines.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: t.textMuted }}>
          Aucune semaine pour l'instant. Commence par « Saisir les totaux caisse ».
        </div>
      ) : (
        <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 900 }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: 'left' }}>Semaine</th>
                <th style={{ ...th, textAlign: 'left' }}>Statut</th>
                <th style={th}>Caisse CB</th>
                <th style={th}>Espèces</th>
                <th style={th}>Uber</th>
                <th style={th}>Deliveroo</th>
                <th style={th}>Banque CB</th>
                <th style={th}>Dépôts</th>
                <th style={th}>Écart CB</th>
              </tr>
            </thead>
            <tbody>
              {semaines.map((s) => {
                const r = recos[s.semaine_debut];
                const st = STATUTS[r.statut];
                return (
                  <tr key={s.id}>
                    <td style={{ ...td, textAlign: 'left', fontWeight: 600 }}>{fmtSemaine(s.semaine_debut)}</td>
                    <td style={{ ...td, textAlign: 'left' }}>
                      <span style={{ background: st.color + '18', color: st.color, borderRadius: 8, padding: '3px 10px', fontWeight: 700, fontSize: 12 }}>{st.label}</span>
                    </td>
                    <td style={td}>{s.caisse_cb == null ? '—' : eur(s.caisse_cb)}</td>
                    <td style={td}>{s.caisse_especes == null ? '—' : eur(s.caisse_especes)}</td>
                    <td style={td}>{s.caisse_uber == null ? '—' : eur(s.caisse_uber)}</td>
                    <td style={td}>{s.caisse_deliveroo == null ? '—' : eur(s.caisse_deliveroo)}</td>
                    <td style={td}>{s.banque_cb == null ? '—' : eur(s.banque_cb)}</td>
                    <td style={td}>{s.banque_depot_especes == null ? '—' : eur(s.banque_depot_especes)}</td>
                    <td style={{ ...td, fontWeight: 700, color: r.ecartCb === null ? t.textMuted : Math.abs(r.ecartCb) <= Number(seuils.tolerance_cb) ? t.success : t.danger }}>
                      {r.ecartCb === null ? '—' : eur(r.ecartCb)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2 : Brancher dans `RestoApp.jsx`**

(a) Après la ligne `const TaskTemplatesModule = lazy(...)`, ajouter :

```jsx
const FinancesModule = lazy(() => import('./components/FinancesModule'));
```

(b) Après le bloc `{/* RENTABILITÉ (gérant seul) */}`, ajouter :

```jsx
        {/* FINANCES (gérant seul) */}
        {effectiveSection === "finances" && isGerant && (
          <Suspense fallback={<Loading />}><FinancesModule t={t} /></Suspense>
        )}
```

(c) Dans la condition du placeholder 🚧 (`!["dashboard", "tasks", …].includes(effectiveSection)`), ajouter `"finances"` à la liste. L'entrée sidebar `{ id: "finances", label: "Finances", icon: I.euro }` existe déjà, ne pas y toucher.

- [ ] **Step 3 : Vérifier lint et tests**

Run : `npm run lint` puis `npm test`
Expected : 0 erreur, tests verts.

- [ ] **Step 4 : CHECKPOINT VISUEL — validation de Jean-Claude AVANT commit**

Run : `npm run dev` → JC ouvre l'appli en local, clique « Finances » dans la sidebar : bandeau coffre à 0,00 €, message « Aucune semaine pour l'instant ». Attendre son accord explicite.

- [ ] **Step 5 : Commit**

```powershell
git add src/components/FinancesModule.jsx src/RestoApp.jsx
git commit -m @'
feat(finances): module Finances, cockpit coffre et tableau des semaines
'@
```

---

### Task 11 : UI — saisie des totaux caisse

**Files:**
- Modify: `src/components/FinancesModule.jsx`

- [ ] **Step 1 : Ajouter le bouton et la modale de saisie**

Dans `FinancesModule.jsx` :

(a) Compléter l'import du moteur avec `mondayOf` :

```jsx
import {
  SEUILS_DEFAUT, computeCoffreTheorique, computeReconciliation, mondayOf,
} from '../lib/finances.js';
```

(b) Ajouter sous les helpers du haut de fichier :

```jsx
const addDaysISO = (dateISO, n) => {
  const d = new Date(`${dateISO}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
```

(c) Ajouter les états et les actions dans le composant, après `recharger` :

```jsx
  const [showSaisie, setShowSaisie] = useState(false);
  const [formSaisie, setFormSaisie] = useState(null);

  const ouvrirSaisie = () => {
    // Par défaut : la semaine écoulée (rituel du lundi).
    setFormSaisie({
      semaine_debut: mondayOf(addDaysISO(aujourdHui, -7)),
      caisse_cb: '', caisse_especes: '', caisse_uber: '', caisse_deliveroo: '', caisse_autres: '',
      caisse_source: 'manuelle',
    });
    setShowSaisie(true);
  };

  const enregistrerSaisie = async () => {
    const f = formSaisie;
    // Virgule décimale acceptée ; champ vide = null (jamais coercé en 0).
    const num = (v) => (v === '' || v == null ? null : Number(String(v).replace(',', '.')));
    if (num(f.caisse_cb) === null || num(f.caisse_especes) === null) return; // les 2 champs du rapprochement sont requis
    const { error } = await supabase.from('finance_semaines').upsert({
      semaine_debut: mondayOf(f.semaine_debut),
      caisse_cb: num(f.caisse_cb), caisse_especes: num(f.caisse_especes),
      caisse_uber: num(f.caisse_uber), caisse_deliveroo: num(f.caisse_deliveroo),
      caisse_autres: num(f.caisse_autres),
      caisse_source: f.caisse_source, caisse_saisi_le: new Date().toISOString(),
    }, { onConflict: 'semaine_debut' });
    if (error) { setErreur(error.message); return; }
    setShowSaisie(false);
    await recharger();
  };
```

(d) Dans le rendu, juste au-dessus du bandeau cockpit, ajouter la barre d'actions :

```jsx
      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        <button onClick={ouvrirSaisie} style={{ padding: '10px 18px', borderRadius: 10, border: 'none', background: t.primary, color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: F }}>
          Saisir les totaux caisse
        </button>
      </div>
```

(e) En bas du JSX (avant le `</div>` final), la modale :

```jsx
      {showSaisie && formSaisie && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: t.surface, borderRadius: 14, padding: 24, width: 380, maxWidth: '92vw' }}>
            <h2 style={{ margin: '0 0 4px', fontSize: 17 }}>Totaux caisse de la semaine</h2>
            <p style={{ margin: '0 0 14px', fontSize: 12, color: t.textMuted }}>Depuis le rapport de la caisse (Z hebdo). CB et espèces sont requis.</p>
            <label style={{ fontSize: 12, color: t.textMuted }}>Lundi de la semaine</label>
            <input type="date" value={formSaisie.semaine_debut} onChange={(e) => setFormSaisie({ ...formSaisie, semaine_debut: e.target.value })}
              style={{ width: '100%', padding: 8, margin: '4px 0 10px', borderRadius: 8, border: `1px solid ${t.border}`, fontFamily: F }} />
            {[['caisse_cb', 'CB'], ['caisse_especes', 'Espèces'], ['caisse_uber', 'Uber Eats'], ['caisse_deliveroo', 'Deliveroo'], ['caisse_autres', 'Autres']].map(([champ, label]) => (
              <div key={champ} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <label style={{ flex: 1, fontSize: 13 }}>{label}</label>
                <input inputMode="decimal" placeholder="0,00" value={formSaisie[champ]}
                  onChange={(e) => setFormSaisie({ ...formSaisie, [champ]: e.target.value })}
                  style={{ width: 120, padding: 8, borderRadius: 8, border: `1px solid ${t.border}`, textAlign: 'right', fontFamily: F }} />
              </div>
            ))}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0 16px' }}>
              <label style={{ flex: 1, fontSize: 13 }}>Source</label>
              <select value={formSaisie.caisse_source} onChange={(e) => setFormSaisie({ ...formSaisie, caisse_source: e.target.value })}
                style={{ width: 136, padding: 8, borderRadius: 8, border: `1px solid ${t.border}`, fontFamily: F }}>
                <option value="manuelle">Manuelle</option>
                <option value="caisse_web">Back-office caisse</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowSaisie(false)} style={{ padding: '9px 16px', borderRadius: 8, border: `1px solid ${t.border}`, background: 'transparent', color: t.text, cursor: 'pointer', fontFamily: F }}>Annuler</button>
              <button onClick={enregistrerSaisie} style={{ padding: '9px 16px', borderRadius: 8, border: 'none', background: t.primary, color: '#fff', fontWeight: 600, cursor: 'pointer', fontFamily: F }}>Enregistrer</button>
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 2 : Vérifier lint et tests**

Run : `npm run lint` puis `npm test`
Expected : 0 erreur, tests verts.

- [ ] **Step 3 : Vérification fonctionnelle en local**

`npm run dev` → saisir une semaine de test avec des montants factices, vérifier : la semaine apparaît dans le tableau (statut « Attente banque » tant qu'aucun relevé n'est importé et que la fenêtre de remise n'est pas dépassée : c'est le comportement voulu du moteur, cf. Task 8 ; « À déposer » n'apparaît qu'une fois le CB rapproché par un import banque), le coffre affiche les espèces saisies. Puis RELIRE LA VALEUR EN BASE (table `finance_semaines` dans Supabase Studio) : les montants stockés sont exacts, `caisse_source = manuelle`. Note : la colonne `statut` en base reste `en_cours` à ce stade (elle n'est synchronisée qu'à l'import, Task 12) ; le statut affiché est celui calculé par le moteur. Supprimer la ligne de test en base après vérification.

- [ ] **Step 4 : CHECKPOINT VISUEL — validation de Jean-Claude AVANT commit**

JC refait la saisie de son côté et valide l'ergonomie. Attendre son accord explicite.

- [ ] **Step 5 : Commit**

```powershell
git add src/components/FinancesModule.jsx
git commit -m @'
feat(finances): saisie des totaux caisse hebdomadaires
'@
```

---

### Task 12 : UI — import du CSV banque (parser puis confirmer)

**Files:**
- Modify: `src/components/FinancesModule.jsx`

Flux : choisir le fichier → le moteur parse/classe/dédoublonne EN MÉMOIRE → récap affiché (rien en base) → JC confirme → écriture lignes + trace d'import + agrégats + statuts. En cas d'erreur de format : message clair, RIEN n'est enregistré.

- [ ] **Step 1 : Implémenter l'analyse et le récap**

(a) Compléter l'import du moteur :

```jsx
import {
  SEUILS_DEFAUT, computeCoffreTheorique, computeReconciliation, mondayOf,
  parseBankCSV, categorizeBankLine, attachToSaleWeek, dedupBankLines, dedupKey,
  aggregateBanqueParSemaine,
} from '../lib/finances.js';
```

(b) Ajouter états et actions dans le composant :

```jsx
  const [importPreview, setImportPreview] = useState(null); // { classees, doublons }
  const [importErreur, setImportErreur] = useState('');

  // Ligne en base → forme attendue par le moteur (numeric PostgREST → Number).
  const dbVersLigne = (l) => ({ montant: Number(l.montant), categorie: l.categorie, semaineRattachee: l.semaine_rattachee });

  const analyserCSV = async (file) => {
    setImportErreur('');
    try {
      const parsees = parseBankCSV(await file.text());
      const existantes = new Set(lignes.map((l) => dedupKey({ dateOperation: l.date_operation, montant: Number(l.montant), libelle: l.libelle })));
      const { nouvelles, doublons } = dedupBankLines(parsees, existantes);
      const classees = nouvelles.map((l) => {
        const categorie = categorizeBankLine(l);
        return { ...l, categorie, ...attachToSaleWeek(l, categorie) };
      });
      setImportPreview({ classees, doublons });
    } catch (e) {
      setImportErreur(e.message); // format inattendu : échec propre, rien d'enregistré
    }
  };

  // Recalcule agrégats banque + statuts de TOUTES les semaines à partir de
  // TOUTES les lignes (anciennes + nouvelles). La colonne statut en base est
  // une trace du calcul du moteur, jamais une saisie.
  const recalculerSemaines = async (toutes) => {
    const agregats = aggregateBanqueParSemaine(toutes);
    for (const [lundi, banque] of Object.entries(agregats)) {
      const { error } = await supabase.from('finance_semaines')
        .upsert({ semaine_debut: lundi, ...banque }, { onConflict: 'semaine_debut' });
      if (error) { setImportErreur(error.message); return; }
    }
    const { data: fraiches } = await supabase.from('finance_semaines').select('*');
    const depotsTous = toutes.filter((l) => l.categorie === 'depot_especes').map((l) => ({ montant: l.montant }));
    const coffreFrais = computeCoffreTheorique(fraiches || [], depotsTous, aujourdHui, seuils);
    for (const s of fraiches || []) {
      const r = computeReconciliation(s, !!coffreFrais.couvertes[s.semaine_debut], seuils, aujourdHui);
      if (r.statut !== s.statut) await supabase.from('finance_semaines').update({ statut: r.statut }).eq('id', s.id);
    }
  };

  const confirmerImport = async () => {
    const { classees } = importPreview;
    const dates = classees.map((l) => l.dateOperation).sort();
    const { data: imp, error: e1 } = await supabase.from('finance_imports')
      .insert({ nb_lignes: classees.length, periode_min: dates[0] || null, periode_max: dates[dates.length - 1] || null })
      .select().single();
    if (e1) { setImportErreur(e1.message); return; }
    const { error: e2 } = await supabase.from('finance_banque_lignes').insert(classees.map((l) => ({
      date_operation: l.dateOperation, libelle: l.libelle, montant: l.montant,
      categorie: l.categorie, semaine_rattachee: l.semaineRattachee,
      date_estimee: l.dateEstimee, import_id: imp.id,
    })));
    if (e2) { setImportErreur(e2.message); return; }
    await recalculerSemaines([...lignes.map(dbVersLigne), ...classees]);
    setImportPreview(null);
    await recharger();
  };
```

(c) Dans la barre d'actions (à côté du bouton de saisie), le sélecteur de fichier :

```jsx
        <label style={{ padding: '10px 18px', borderRadius: 10, border: `1.5px solid ${t.primary}`, color: t.primary, fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: F }}>
          Importer le relevé banque (CSV)
          <input type="file" accept=".csv,text/csv" style={{ display: 'none' }}
            onChange={(e) => { if (e.target.files[0]) analyserCSV(e.target.files[0]); e.target.value = ''; }} />
        </label>
```

(d) Sous la barre d'actions, l'erreur d'import éventuelle :

```jsx
      {importErreur && (
        <div style={{ background: t.danger + '12', color: t.danger, borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 13 }}>
          {importErreur} — rien n'a été enregistré.
        </div>
      )}
```

(e) En bas du JSX, la modale de récap (parser puis confirmer) :

```jsx
      {importPreview && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: t.surface, borderRadius: 14, padding: 24, width: 460, maxWidth: '92vw', maxHeight: '85vh', overflow: 'auto' }}>
            <h2 style={{ margin: '0 0 10px', fontSize: 17 }}>Récap avant enregistrement</h2>
            <div style={{ fontSize: 13, marginBottom: 12 }}>
              {importPreview.classees.length} nouvelle{importPreview.classees.length > 1 ? 's' : ''} ligne{importPreview.classees.length > 1 ? 's' : ''}
              {importPreview.doublons > 0 && <span style={{ color: t.textMuted }}> · {importPreview.doublons} doublon{importPreview.doublons > 1 ? 's' : ''} ignoré{importPreview.doublons > 1 ? 's' : ''}</span>}
            </div>
            <ul style={{ margin: '0 0 12px', paddingLeft: 18, fontSize: 13 }}>
              {Object.entries(importPreview.classees.reduce((c, l) => ({ ...c, [l.categorie]: (c[l.categorie] || 0) + 1 }), {}))
                .map(([cat, n]) => <li key={cat}>{cat} : {n}</li>)}
            </ul>
            {importPreview.classees.some((l) => l.categorie === 'autre') && (
              <div style={{ background: t.warning + '15', borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Non classées (règles de libellé à ajuster ?)</div>
                {importPreview.classees.filter((l) => l.categorie === 'autre').map((l, i) => (
                  <div key={i} style={{ fontSize: 12, color: t.textMuted }}>{l.dateOperation} · {l.libelle} · {eur(l.montant)}</div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setImportPreview(null)} style={{ padding: '9px 16px', borderRadius: 8, border: `1px solid ${t.border}`, background: 'transparent', color: t.text, cursor: 'pointer', fontFamily: F }}>Annuler</button>
              <button onClick={confirmerImport} style={{ padding: '9px 16px', borderRadius: 8, border: 'none', background: t.primary, color: '#fff', fontWeight: 600, cursor: 'pointer', fontFamily: F }}>Enregistrer</button>
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 2 : Vérifier lint et tests**

Run : `npm run lint` puis `npm test`
Expected : 0 erreur, tests verts.

- [ ] **Step 3 : Vérification fonctionnelle en local avec un CSV SYNTHÉTIQUE**

Créer un petit CSV de test à la main (3-4 lignes au format de la Task 2, montants factices), l'importer : récap correct, confirmation, lignes en base, agrégats remplis dans `finance_semaines`, réimport du même fichier → « 0 nouvelle ligne, N doublons ignorés ». RELIRE LES VALEURS EN BASE. Nettoyer les données de test (lignes ET semaines créées) et vérifier le retour à l'état initial.

- [ ] **Step 4 : CHECKPOINT VISUEL — validation de Jean-Claude AVANT commit**

JC teste l'import (il peut utiliser son vrai CSV : les données vont dans Supabase privé, pas dans le repo). Attendre son accord explicite.

- [ ] **Step 5 : Commit**

```powershell
git add src/components/FinancesModule.jsx
git commit -m @'
feat(finances): import du releve banque CSV avec recap avant enregistrement
'@
```

---

### Task 13 : UI — détail semaine, notes et rappel de dépôt

**Files:**
- Modify: `src/components/FinancesModule.jsx`

- [ ] **Step 1 : Implémenter**

(a) État d'ouverture, dans le composant :

```jsx
  const [semaineOuverte, setSemaineOuverte] = useState(null); // semaine_debut ou null

  const enregistrerNotes = async (id, notes) => {
    const { error } = await supabase.from('finance_semaines').update({ notes }).eq('id', id);
    if (!error) setSemaines((prev) => prev.map((s) => (s.id === id ? { ...s, notes } : s)));
  };
```

(b) Rappel « dépose X € » dans le bandeau cockpit (après le bloc du solde) :

```jsx
        {coffre.solde > 0 && (
          <div style={{ background: t.warning + '15', color: t.warning, borderRadius: 10, padding: '8px 14px', fontWeight: 700, fontSize: 13 }}>
            À déposer au GAB : {eur(coffre.solde)}
          </div>
        )}
```

(c) Rendre chaque ligne du tableau cliquable : sur le `<tr>` des semaines, ajouter :

```jsx
                  <tr key={s.id} onClick={() => setSemaineOuverte(semaineOuverte === s.semaine_debut ? null : s.semaine_debut)} style={{ cursor: 'pointer' }}>
```

(d) Juste après ce `<tr>…</tr>` (dans le même `.map`, envelopper les deux lignes dans un `<Fragment key={s.id}>` importé de react), le détail :

```jsx
                  {semaineOuverte === s.semaine_debut && (
                    <tr>
                      <td colSpan={9} style={{ padding: '14px 18px', background: t.surfaceAlt, borderBottom: `1px solid ${t.border}` }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, fontSize: 13 }}>
                          <div>
                            <div style={{ fontWeight: 700, marginBottom: 6 }}>Caisse (source : {s.caisse_source || '—'})</div>
                            {[['CB', s.caisse_cb], ['Espèces', s.caisse_especes], ['Uber', s.caisse_uber], ['Deliveroo', s.caisse_deliveroo], ['Autres', s.caisse_autres]].map(([l, v]) => (
                              <div key={l} style={{ display: 'flex', justifyContent: 'space-between' }}><span>{l}</span><span>{v == null ? '—' : eur(v)}</span></div>
                            ))}
                          </div>
                          <div>
                            <div style={{ fontWeight: 700, marginBottom: 6 }}>Banque (par semaine de vente)</div>
                            {[['CB reçu', s.banque_cb], ['Dépôts espèces', s.banque_depot_especes], ['Uber', s.banque_uber], ['Deliveroo', s.banque_deliveroo], ['Direct (Stripe)', s.banque_direct], ['Titres resto', s.banque_titres]].map(([l, v]) => (
                              <div key={l} style={{ display: 'flex', justifyContent: 'space-between' }}><span>{l}</span><span>{v == null ? '—' : eur(v)}</span></div>
                            ))}
                          </div>
                        </div>
                        <div style={{ fontWeight: 700, margin: '12px 0 6px', fontSize: 13 }}>Lignes du relevé rattachées</div>
                        {lignes.filter((l) => l.semaine_rattachee === s.semaine_debut).length === 0
                          ? <div style={{ fontSize: 12, color: t.textMuted }}>Aucune ligne importée pour cette semaine.</div>
                          : lignes.filter((l) => l.semaine_rattachee === s.semaine_debut)
                              .sort((a, b) => a.date_operation.localeCompare(b.date_operation))
                              .map((l) => (
                                <div key={l.id} style={{ display: 'flex', gap: 10, fontSize: 12, color: t.textMuted, padding: '2px 0' }}>
                                  <span style={{ width: 78 }}>{l.date_operation}</span>
                                  <span style={{ flex: 1 }}>{l.libelle}{l.date_estimee ? ' ⚠️ date estimée' : ''}</span>
                                  <span style={{ width: 90, textAlign: 'right' }}>{eur(l.montant)}</span>
                                  <span style={{ width: 130 }}>{l.categorie}</span>
                                </div>
                              ))}
                        <NotesEditor semaine={s} onSave={enregistrerNotes} t={t} />
                      </td>
                    </tr>
                  )}
```

(e) Le petit éditeur de notes, en bas du fichier (hors du composant principal) :

```jsx
function NotesEditor({ semaine, onSave, t }) {
  const [texte, setTexte] = useState(semaine.notes || '');
  return (
    <div style={{ marginTop: 10 }} onClick={(e) => e.stopPropagation()}>
      <textarea value={texte} onChange={(e) => setTexte(e.target.value)} rows={2}
        placeholder="Notes (explication d'un écart, correction…)"
        style={{ width: '100%', padding: 8, borderRadius: 8, border: `1px solid ${t.border}`, fontFamily: F, fontSize: 13, boxSizing: 'border-box' }} />
      <button onClick={() => onSave(semaine.id, texte)}
        style={{ marginTop: 6, padding: '7px 14px', borderRadius: 8, border: 'none', background: t.primary, color: '#fff', fontWeight: 600, fontSize: 12, cursor: 'pointer', fontFamily: F }}>
        Enregistrer la note
      </button>
    </div>
  );
}
```

⚠️ La modification des totaux caisse d'une semaine passée = rouvrir la modale de saisie avec le lundi correspondant (l'upsert sur `semaine_debut` fait la correction). Pas d'éditeur séparé en V1.

- [ ] **Step 2 : Vérifier lint et tests**

Run : `npm run lint` puis `npm test`
Expected : 0 erreur, tests verts.

- [ ] **Step 3 : CHECKPOINT VISUEL — validation de Jean-Claude AVANT commit**

JC déplie une semaine, vérifie la décomposition, les lignes rattachées, écrit une note, la retrouve après rechargement. Attendre son accord explicite.

- [ ] **Step 4 : Commit**

```powershell
git add src/components/FinancesModule.jsx
git commit -m @'
feat(finances): detail semaine, lignes rattachees, notes et rappel depot
'@
```

---

### Task 14 : Vérification finale, déploiement, preuve en prod

**Files:** aucun nouveau.

- [ ] **Step 1 : Batterie complète en local**

Run : `npm test` puis `npm run lint` puis `npm run build`
Expected : tests verts, 0 erreur lint, build OK.

- [ ] **Step 2 : CHECKPOINT — validation visuelle COMPLÈTE de Jean-Claude en local**

Parcours entier : saisie d'une semaine → import CSV → récap → confirmation → statuts → détail → note. Attendre son accord explicite.

- [ ] **Step 3 : Push**

```powershell
git push
```

- [ ] **Step 4 : Vérifier la prod comme un vrai utilisateur**

Ouvrir `https://restoapp-khaki.vercel.app`, se connecter en gérant, ouvrir Finances, vérifier le rendu réel. Quirk connu : si la prod ne reflète pas le push après ~5 min, commit vide + re-push :

```powershell
git commit --allow-empty -m @'
chore: relance du deploiement vercel
'@
git push
```

- [ ] **Step 5 : Vérifier la sécurité en prod**

Se connecter avec un compte EMPLOYÉ (ou vérifier via l'API REST Supabase sans être gérant) : les tables `finance_*` ne doivent rien retourner. C'est le test réel de la RLS.

- [ ] **Step 6 : Mise en service réelle**

JC importe son vrai CSV (export depuis la banque) et saisit les totaux caisse des semaines récentes depuis la back-office @Bill. Le module travaille alors sur données réelles, en base privée.

---

## Couverture du spec (self-review du 09/08)

- §4 modèle de données → Task 1 (+ `date_estimee` ajoutée pour tracer les dates illisibles ; `ecart_cb`/`especes_a_deposer` DÉRIVÉS par le moteur, pas stockés ; `finance_settings` ajoutée pour les seuils du §6)
- §5 rituel + machine à états → Tasks 8, 11, 12
- §6 classification / CB hebdo / coffre FIFO / anomalie / seuils / « on ne compare que ce qui existe » → Tasks 3, 4, 7, 8
- §7 cockpit, tableau, détail, saisie, import-récap, rappel dépôt → Tasks 10-13
- §8 cas limites → Tasks 2 (format), 5 (réimport), 8 (totaux manquants), 4 (date illisible), 12 (« autre » visible au récap)
- §9 tests → Tasks 2-9 (le jeu « janvier » en Task 9)
- §10 sécurité → Task 1 (RLS, gitignore), données synthétiques partout, vérif RLS en prod (Task 14)
- Hors V1 assumés : éditeur de règles in-app, édition des seuils dans l'UI (modifiable via Supabase Studio en attendant), rapprochement fin Uber/Deliveroo, API caisse.

## Ordre d'exécution

Tasks 2→9 (moteur) sont indépendantes de Supabase et peuvent se faire d'un trait. Task 1 (checkpoint SQL de JC) doit être passée avant la Task 10. Chaque tâche UI (10-13) se termine par la validation visuelle de JC AVANT son commit.
