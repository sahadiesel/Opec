/**
 * OPEC OpsFlow - Permission core (access groups, domains, gates).
 * Source of truth for getEffectiveAccessGroup, canAccessDomain, isOperationGroupMember.
 * See docs/permissions-architecture.md.
 */

import type { BusinessRoleKey, DeptType, RoleType, User } from './types';

// ---------------------------------------------------------------------------
// Canonical types
// ---------------------------------------------------------------------------

/** Primary access partition (internal + client portal bucket). */
export type AccessGroup = 'admin' | 'operation' | 'accounting' | 'client';

/** Rank within an access group (aligns with User.accessLevel). */
export type CoreAccessLevel = 'viewer' | 'officer' | 'manager' | 'admin';

/** Coarse business areas for routing / future rules (not Firestore module keys). */
export type AccessDomain =
  | 'sales'
  | 'operations'
  | 'hr'
  | 'store'
  | 'accounting'
  | 'system'
  | 'client';

/** Minimum required role keys for the new model (extend via string for legacy). */
export type CorePrimaryRoleKey =
  | 'admin_admin'
  | 'operation_officer'
  | 'operation_manager'
  | 'accounting_officer'
  | 'accounting_manager'
  | 'client_user';

/** Canonical keys for migrations, tests, and future UI. */
export const CORE_PRIMARY_ROLE_KEYS = [
  'admin_admin',
  'operation_officer',
  'operation_manager',
  'accounting_officer',
  'accounting_manager',
  'client_user',
] as const satisfies readonly CorePrimaryRoleKey[];

export const ALL_ACCESS_DOMAINS: readonly AccessDomain[] = [
  'sales',
  'operations',
  'hr',
  'store',
  'accounting',
  'system',
  'client',
];

/**
 * Base domain coverage per access group (before legacy union).
 * - admin: all domains
 * - operation: sales / operations / hr
 * - accounting: sales / hr / store / accounting
 * - client: client only
 */
export const DOMAINS_BY_ACCESS_GROUP: Record<AccessGroup, readonly AccessDomain[]> = {
  admin: ALL_ACCESS_DOMAINS,
  operation: ['sales', 'operations', 'hr'],
  accounting: ['sales', 'hr', 'store', 'accounting'],
  client: ['client'],
};

const LEVEL_RANK: Record<CoreAccessLevel, number> = {
  viewer: 0,
  officer: 1,
  manager: 2,
  admin: 3,
};

// ---------------------------------------------------------------------------
// Legacy → core (compatibility: prefer union / conservative upgrades, never drop access)
// ---------------------------------------------------------------------------

const LEGACY_ROLE_ALIASES: Record<string, string> = {
  finance_officer: 'accounting_officer',
  payroll_officer: 'hr_officer',
  safety_officer: 'operations_officer',
  client: 'client_user',
  client_viewer: 'client_user',
  client_approver: 'client_user',
  customer_viewer: 'client_user',
  customer_approver: 'client_user',
};

function aliasLegacyRole(roleKey?: string | null): string | null {
  if (!roleKey) return null;
  return LEGACY_ROLE_ALIASES[roleKey] || roleKey;
}

/** Maps legacy BusinessRoleKey to canonical core primary key + group + level (best-effort). */
export const LEGACY_BUSINESS_ROLE_TO_CORE: Record<
  BusinessRoleKey,
  { group: AccessGroup; level: CoreAccessLevel; primaryKey: CorePrimaryRoleKey | string }
> = {
  system_admin: { group: 'admin', level: 'admin', primaryKey: 'admin_admin' },
  hr_manager: { group: 'operation', level: 'manager', primaryKey: 'operation_manager' },
  hr_officer: { group: 'operation', level: 'officer', primaryKey: 'operation_officer' },
  operations_manager: { group: 'operation', level: 'manager', primaryKey: 'operation_manager' },
  operations_officer: { group: 'operation', level: 'officer', primaryKey: 'operation_officer' },
  sales_manager: { group: 'operation', level: 'manager', primaryKey: 'operation_manager' },
  sales_officer: { group: 'operation', level: 'officer', primaryKey: 'operation_officer' },
  accounting_manager: { group: 'accounting', level: 'manager', primaryKey: 'accounting_manager' },
  accounting_officer: { group: 'accounting', level: 'officer', primaryKey: 'accounting_officer' },
  store_manager: { group: 'operation', level: 'manager', primaryKey: 'operation_manager' },
  store_officer: { group: 'operation', level: 'officer', primaryKey: 'operation_officer' },
  operation_officer: { group: 'operation', level: 'officer', primaryKey: 'operation_officer' },
  operation_manager: { group: 'operation', level: 'manager', primaryKey: 'operation_manager' },
  admin_admin: { group: 'admin', level: 'admin', primaryKey: 'admin_admin' },
  client_user: { group: 'client', level: 'viewer', primaryKey: 'client_user' },
};

/** Extra domains implied by legacy DeptType (union with group defaults — avoids stripping access). */
function domainsFromLegacyDepartment(dept: DeptType | undefined): Set<AccessDomain> {
  const s = new Set<AccessDomain>();
  if (!dept) return s;
  switch (dept) {
    case 'admin':
      ALL_ACCESS_DOMAINS.forEach((d) => s.add(d));
      break;
    case 'sales':
      s.add('sales');
      break;
    case 'operations':
      s.add('operations');
      break;
    case 'hr':
      s.add('hr');
      break;
    case 'accounting':
      s.add('accounting');
      break;
    case 'store':
      s.add('store');
      break;
    case 'client':
      s.add('client');
      break;
    default:
      break;
  }
  return s;
}

function isFutureAccessGroup(value: unknown): value is AccessGroup {
  return value === 'admin' || value === 'operation' || value === 'accounting' || value === 'client';
}

function isFutureAccessLevel(value: unknown): value is CoreAccessLevel {
  return value === 'admin' || value === 'manager' || value === 'officer' || value === 'viewer';
}

/** Resolves a stable legacy role string (aligned with normalizeCurrentUserPermissions merges). */
export function getPrimaryLegacyRole(user: Partial<User> | null): string | null {
  if (!user) return null;

  const roleIds = Array.isArray(user.roleIds) ? [...user.roleIds] : [];
  if (user.roleId && !roleIds.includes(user.roleId as RoleType)) {
    roleIds.unshift(user.roleId as RoleType);
  }

  const assigned = Array.isArray(user.assignedRoleKeys) ? [...user.assignedRoleKeys] : [];
  if (user.assignedRoleKey && !assigned.includes(user.assignedRoleKey as BusinessRoleKey)) {
    assigned.unshift(user.assignedRoleKey as BusinessRoleKey);
  }

  if (
    user.roleId === 'system_admin' ||
    user.assignedRoleKey === 'system_admin' ||
    user.assignedRoleKey === 'admin_admin'
  ) {
    return 'system_admin';
  }

  if (
    roleIds.includes('system_admin' as RoleType) ||
    assigned.includes('system_admin' as BusinessRoleKey) ||
    assigned.includes('admin_admin' as BusinessRoleKey)
  ) {
    return 'system_admin';
  }

  const directAssigned = aliasLegacyRole(user.assignedRoleKey);
  if (directAssigned) return directAssigned;

  const directRoleId = aliasLegacyRole(user.roleId);
  if (directRoleId) return directRoleId;

  const firstAssigned = aliasLegacyRole(assigned[0]);
  if (firstAssigned) return firstAssigned;

  const firstRoleId = aliasLegacyRole(roleIds[0] as string);
  if (firstRoleId) return firstRoleId;

  if (user.userType === 'customer_portal' || user.department === 'client') {
    return 'client_user';
  }

  if (user.department === 'admin') {
    return 'system_admin';
  }

  if (user.department === 'accounting') {
    return user.level === 'manager' ? 'accounting_manager' : 'accounting_officer';
  }

  if (user.department === 'store') {
    return user.level === 'manager' ? 'store_manager' : 'store_officer';
  }

  const dep = String(user.department || '');
  if (dep === 'operations' || dep === 'operation') {
    return user.level === 'manager' ? 'operations_manager' : 'operations_officer';
  }

  if (user.department === 'sales') {
    return user.level === 'manager' ? 'sales_manager' : 'sales_officer';
  }

  if (user.department === 'hr') {
    return user.level === 'manager' ? 'hr_manager' : 'hr_officer';
  }

  /**
   * โปรไฟล์หลักมักใช้ document id = profileKey เช่น hr_manager — ถ้า assignedRoleKey ว่าง
   * แต่ผูก permissionProfileKey ไว้ ให้ถือเป็นบทบาทเดียวกับ Firestore hasAnyAssignedRole
   */
  const pk =
    user.permissionProfileKey ??
    (Array.isArray(user.permissionProfileKeys) && user.permissionProfileKeys.length > 0
      ? user.permissionProfileKeys[0]
      : null);
  if (typeof pk === 'string' && pk.length > 0) {
    if (pk === 'admin_admin') return 'system_admin';
    if (pk === 'payroll_officer') return 'hr_officer';
    const known: readonly string[] = [
      'system_admin',
      'hr_manager',
      'hr_officer',
      'sales_manager',
      'sales_officer',
      'operations_manager',
      'operations_officer',
      'operation_manager',
      'operation_officer',
      'accounting_manager',
      'accounting_officer',
      'store_manager',
      'store_officer',
      'client_user',
    ];
    if (known.includes(pk)) return pk;
  }

  return null;
}

/** Effective access group: explicit User.accessGroup wins, else legacy-derived. */
export function getEffectiveAccessGroup(user: User | null): AccessGroup | null {
  if (!user) return null;
  const dep = String(user.department || '');

  if (isFutureAccessGroup(user.accessGroup)) {
    return user.accessGroup;
  }

  const legacyRole = getPrimaryLegacyRole(user);

  if (legacyRole === 'system_admin') return 'admin';
  if (legacyRole === 'client_user') return 'client';

  if (
    legacyRole === 'accounting_manager' ||
    legacyRole === 'accounting_officer' ||
    legacyRole === 'finance_officer'
  ) {
    return 'accounting';
  }

  if (
    legacyRole === 'hr_manager' ||
    legacyRole === 'hr_officer' ||
    legacyRole === 'sales_manager' ||
    legacyRole === 'sales_officer' ||
    legacyRole === 'operations_manager' ||
    legacyRole === 'operations_officer' ||
    legacyRole === 'operation_officer' ||
    legacyRole === 'operation_manager' ||
    legacyRole === 'store_manager' ||
    legacyRole === 'store_officer'
  ) {
    return 'operation';
  }

  if (user.userType === 'customer_portal') return 'client';
  if (user.department === 'admin') return 'admin';
  if (user.department === 'accounting') return 'accounting';
  if (user.department === 'client') return 'client';
  if (dep === 'hr' || dep === 'sales' || dep === 'operations' || dep === 'operation' || dep === 'store') {
    return 'operation';
  }

  return null;
}

/** Effective access level: explicit User.accessLevel wins, else legacy-derived. */
export function getEffectiveAccessLevel(user: User | null): CoreAccessLevel {
  if (!user) return 'viewer';

  if (isFutureAccessLevel(user.accessLevel)) {
    return user.accessLevel;
  }

  const group = getEffectiveAccessGroup(user);
  if (group === 'admin') return 'admin';
  if (group === 'client') return user.portalRole === 'approver' ? 'manager' : 'viewer';

  const legacyRole = getPrimaryLegacyRole(user);
  if (
    legacyRole === 'hr_manager' ||
    legacyRole === 'sales_manager' ||
    legacyRole === 'operations_manager' ||
    legacyRole === 'operation_manager' ||
    legacyRole === 'accounting_manager' ||
    legacyRole === 'store_manager'
  ) {
    return 'manager';
  }

  if (
    legacyRole === 'hr_officer' ||
    legacyRole === 'sales_officer' ||
    legacyRole === 'operations_officer' ||
    legacyRole === 'accounting_officer' ||
    legacyRole === 'store_officer' ||
    legacyRole === 'finance_officer'
  ) {
    return 'officer';
  }

  if (user.level) return user.level as CoreAccessLevel;
  return 'officer';
}

/** Map a legacy business role key to canonical core metadata when possible. */
export function mapLegacyBusinessRoleToCore(roleKey: string): {
  group: AccessGroup;
  level: CoreAccessLevel;
  primaryKey: CorePrimaryRoleKey | string;
} | null {
  const canonical = aliasLegacyRole(roleKey) || roleKey;
  const mapped = LEGACY_BUSINESS_ROLE_TO_CORE[canonical as BusinessRoleKey];
  return mapped ?? null;
}

export interface UserAccessContext {
  accessGroup: AccessGroup | null;
  accessLevel: CoreAccessLevel;
  /** Canonical core key when mappable, else legacy string. */
  primaryRoleKey: CorePrimaryRoleKey | string | null;
  legacySourceRole: string | null;
  /** True when accessGroup/accessLevel were set on the user document. */
  explicitAccess: boolean;
  /** Domains the user may access (group defaults ∪ legacy department hints). */
  domains: ReadonlySet<AccessDomain>;
}

function unionDomains(base: readonly AccessDomain[], extra: Set<AccessDomain>): Set<AccessDomain> {
  const out = new Set<AccessDomain>(base);
  extra.forEach((d) => out.add(d));
  return out;
}

/** Full resolved context for new + legacy users. */
export function getUserAccessContext(user: User | null): UserAccessContext | null {
  if (!user) return null;

  const explicitAccess =
    isFutureAccessGroup(user.accessGroup) && isFutureAccessLevel(user.accessLevel);

  const accessGroup = getEffectiveAccessGroup(user);
  const accessLevel = getEffectiveAccessLevel(user);
  const legacySourceRole = getPrimaryLegacyRole(user);

  let primaryRoleKey: CorePrimaryRoleKey | string | null = null;
  if (legacySourceRole) {
    const mapped = mapLegacyBusinessRoleToCore(legacySourceRole);
    primaryRoleKey = mapped?.primaryKey ?? legacySourceRole;
  }

  if (accessGroup === 'admin') {
    primaryRoleKey = primaryRoleKey ?? 'admin_admin';
  }

  const baseDomains = accessGroup ? [...DOMAINS_BY_ACCESS_GROUP[accessGroup]] : [];
  const legacyExtra = domainsFromLegacyDepartment(user.department);
  const domains = unionDomains(baseDomains, legacyExtra);

  return {
    accessGroup,
    accessLevel,
    primaryRoleKey,
    legacySourceRole,
    explicitAccess: Boolean(explicitAccess),
    domains,
  };
}

/** System administrator: explicit admin group or legacy system_admin role. */
export function isSystemAdmin(user: User | null): boolean {
  if (!user) return false;
  if (user.accessGroup === 'admin') return true;
  return getPrimaryLegacyRole(user) === 'system_admin';
}

/**
 * True if user is HR Manager (labour cost / payroll baseline on contracts).
 * Excludes hr_officer — cost baseline entry is manager + admin only in UI policy.
 */
export function isHrManager(user: User | null): boolean {
  if (!user) return false;
  if (getPrimaryLegacyRole(user) === 'hr_manager') return true;
  const keys: string[] = [];
  if (user.assignedRoleKey) keys.push(String(user.assignedRoleKey));
  if (user.roleId) keys.push(String(user.roleId));
  if (Array.isArray(user.assignedRoleKeys)) keys.push(...user.assignedRoleKeys.map(String));
  if (Array.isArray(user.roleIds)) keys.push(...user.roleIds.map(String));
  if (user.permissionProfileKey) keys.push(String(user.permissionProfileKey));
  if (Array.isArray(user.permissionProfileKeys)) keys.push(...user.permissionProfileKeys.map(String));
  return keys.some((k) => k === 'hr_manager');
}

/**
 * Whether the user belongs to the given access group (same as "department group" in the new model).
 */
export function isDepartmentGroup(user: User | null, group: AccessGroup): boolean {
  return getEffectiveAccessGroup(user) === group;
}

/** Compare effective level to a minimum (inclusive). */
export function hasMinimumLevel(user: User | null, minLevel: CoreAccessLevel): boolean {
  const lv = getEffectiveAccessLevel(user);
  return LEVEL_RANK[lv] >= LEVEL_RANK[minLevel];
}

/** Domain access: uses resolved domain set (group ∪ legacy department). */
export function canAccessDomain(user: User | null, domain: AccessDomain): boolean {
  const ctx = getUserAccessContext(user);
  if (!ctx) return false;
  return ctx.domains.has(domain);
}

/** System management (users, security, numbering, audit): admin group + admin level or legacy system admin. */
export function canManageSystem(user: User | null): boolean {
  if (!user) return false;
  if (isSystemAdmin(user)) return true;
  const g = getEffectiveAccessGroup(user);
  const l = getEffectiveAccessLevel(user);
  return g === 'admin' && l === 'admin';
}

/** Admin or accounting access group (finance / store / HR minus timesheet routing). */
export function isAccountingGroupMember(user: User | null): boolean {
  return isSystemAdmin(user) || isDepartmentGroup(user, 'accounting');
}

/** Admin or operation access group (sales / ops scheduling / HR timesheets / waves). */
export function isOperationGroupMember(user: User | null): boolean {
  return isSystemAdmin(user) || isDepartmentGroup(user, 'operation');
}

/** Timesheets + waves + assignments + mobilization: admin or operation only (not accounting-only). */
export function canAccessOpsSchedulingModules(user: User | null): boolean {
  return isOperationGroupMember(user);
}

/** Finance & accounting module gate: admin or accounting (not operation-only). */
export function canAccessAccountingFinanceModules(user: User | null): boolean {
  return isAccountingGroupMember(user);
}
