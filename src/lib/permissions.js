// Rôles applicatifs et permissions granulaires (Phase 0, spec §3).
// MIROIR EXACT de private.default_permissions() dans supabase_migration7_phase0.sql :
// si l'un change, changer l'autre (le test le rappelle). La vraie décision reste
// côté base (RLS) ; ce module ne sert qu'à l'affichage (cacher ce qui sera refusé).

export const ROLES = ['admin', 'manager', 'employe', 'lecture'];

export const ROLE_LABELS = {
  admin: 'Administrateur',
  manager: 'Manager',
  employe: 'Employé',
  lecture: 'Lecture seule',
};

export const TOUTES_PERMISSIONS = [
  'voir_finances', 'voir_marges', 'voir_salaires',
  'modifier_planning', 'modifier_pointages', 'modifier_stock',
  'cloturer_inventaire', 'passer_commande', 'valider_commande',
  'receptionner_commande', 'modifier_prix_fournisseur', 'creer_salarie',
  'modifier_parametres', 'exporter_donnees', 'declarer_perte',
];

export const PERMISSION_LABELS = {
  voir_finances: 'Voir les finances',
  voir_marges: 'Voir les marges et le food cost',
  voir_salaires: 'Voir les salaires et coûts horaires',
  modifier_planning: 'Modifier le planning',
  modifier_pointages: 'Corriger les pointages',
  modifier_stock: 'Modifier le stock',
  cloturer_inventaire: 'Clôturer un inventaire',
  passer_commande: 'Préparer une commande fournisseur',
  valider_commande: 'Valider une commande fournisseur',
  receptionner_commande: 'Réceptionner une commande',
  modifier_prix_fournisseur: 'Modifier un prix fournisseur',
  creer_salarie: 'Créer ou modifier un salarié',
  modifier_parametres: 'Modifier les paramètres',
  exporter_donnees: 'Exporter des données',
  declarer_perte: 'Déclarer une perte ou une sortie',
};

const DEFAUTS = {
  admin: TOUTES_PERMISSIONS,
  manager: [
    'modifier_planning', 'modifier_pointages', 'modifier_stock',
    'cloturer_inventaire', 'passer_commande', 'valider_commande',
    'receptionner_commande', 'declarer_perte',
  ],
  employe: [],
  lecture: [],
};

// Rôle effectif à partir d'un profil (RPC mon_profil) ou, à défaut, de l'ancien
// binaire gerant/employe encore en place tant que la migration 7 n'est pas appliquée.
export function roleEffectif(profil, roleLegacy) {
  if (profil?.role && profil.role !== 'aucun') return profil.role;
  return roleLegacy === 'gerant' ? 'admin' : 'employe';
}

// can(profil, cle) : permissions du profil serveur si dispo, sinon défauts du rôle.
export function can(profil, cle, roleLegacy) {
  if (profil?.permissions) return profil.permissions.includes(cle);
  const role = roleEffectif(profil, roleLegacy);
  if (role === 'admin') return true;
  return (DEFAUTS[role] || []).includes(cle);
}

export function permissionsParDefaut(role) {
  return DEFAUTS[role] || [];
}
