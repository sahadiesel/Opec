/**
 * OPEC OpsFlow - Role-to-fields mapping for users UI, setup-admin repair, migration.
 * Uses permission-core for group resolution. See docs/permissions-architecture.md.
 */

import {
  DeptType,
  AccessLevel,
  RoleType,
  User,
  BusinessRoleKey,
  DepartmentGroup,
  DataAccessClass,
  UserType,
  PortalRole,
} from './types';
import { isSystemAdmin, normalizeCurrentUserPermissions } from './permissions';
import { normalizeBusinessRoleKey, normalizePermissionProfileDocumentId } from './role-key-normalizer';
import { sanitizeFirestorePayload } from './utils';
import { ROLE_CATALOG } from './roles/role-catalog';
import { getPrimaryLegacyRole as resolvePrimaryLegacyRoleString } from './permission-core';

export interface BusinessRole {
  key: BusinessRoleKey;
  labelTh: string;
  labelEn: string;
  dept: DeptType;
  level: AccessLevel;
  canonicalRole: RoleType;
  descriptionTh: string;
}

export const BUSINESS_ROLES: Record<BusinessRoleKey, BusinessRole> = Object.fromEntries(
  Object.entries(ROLE_CATALOG).map(([key, entry]) => [
    key,
    {
      key: entry.key,
      labelTh: entry.displayNameTh,
      labelEn: entry.displayNameEn,
      dept: entry.department,
      level: entry.accessLevel,
      canonicalRole: entry.canonicalRole,
      descriptionTh: entry.descriptionTh,
    } satisfies BusinessRole,
  ])
) as Record<BusinessRoleKey, BusinessRole>;

export const OPERATION_DEFAULT_MODULES = [
  'customers',
  'quotations',
  'main_contracts',
  'sales_contract_terms',
  'customer_pos',
  'rate_conditions',
  'profit_estimates',
  'timesheets',
  'hr_hub',
  'worker_payroll',
  'office_payroll',
  'payment_export_batches',
  'labor_cost_contract_terms',
  'positions',
  'workers',
  'office_staff',
  'waves',
  'assignments',
  'mobilization',
] as const;

export const ACCOUNTING_DEFAULT_MODULES = [
  'customers',
  'quotations',
  'main_contracts',
  'sales_contract_terms',
  'customer_pos',
  'timesheets',
  'hr_hub',
  'worker_payroll',
  'office_payroll',
  'payment_export_batches',
  'labor_cost_contract_terms',
  'positions',
  'workers',
  'office_staff',
  'vendors',
  'purchases',
  'store_inventory',
  'billing_notes',
  'tax_invoices',
  'receipts',
  'ap_bills',
  'accounts_receivable',
  'accounts_payable',
  'cashbook',
  'bank_accounts',
  'executive_payroll',
] as const;

function canonicalizeRoleKey(roleKey?: string | null): BusinessRoleKey | null {
  const mapped = normalizeBusinessRoleKey(roleKey);
  if (!mapped) return null;
  return mapped in BUSINESS_ROLES ? (mapped as BusinessRoleKey) : null;
}

/** Single source of truth with permission-core (role, assignedRoleKey, assignedRoleKeys[0], profiles). */
function primaryBusinessRoleFromUser(user: Partial<User> | null): BusinessRoleKey | null {
  if (!user) return null;
  const u = normalizeCurrentUserPermissions(user);
  if (!u) return null;
  const raw = resolvePrimaryLegacyRoleString(u);
  return raw ? canonicalizeRoleKey(raw) : null;
}

function businessRoleFromDeptLevel(dept: DeptType, level: AccessLevel): BusinessRoleKey {
  if (dept === 'admin') return 'system_admin';
  if (dept === 'accounting') return level === 'manager' ? 'accounting_manager' : 'accounting_officer';
  if (dept === 'sales') return level === 'manager' ? 'sales_manager' : 'sales_officer';
  if (dept === 'hr') return level === 'manager' ? 'hr_manager' : 'hr_officer';
  if (dept === 'store') return 'store_officer';
  if (dept === 'operations') return level === 'manager' ? 'operations_manager' : 'operations_officer';
  if (dept === 'client') return 'client_user';
  return 'operations_officer';
}

function inferPortalRole(user: Partial<User>): PortalRole {
  if (user.portalRole === 'approver' || user.portalRole === 'viewer') {
    return user.portalRole;
  }
  return 'viewer';
}

function mapBusinessRoleToAccessGroup(roleKey: BusinessRoleKey): 'admin' | 'operations' | 'accounting' | 'client' {
  return ROLE_CATALOG[roleKey]?.accessGroup ?? 'operations';
}

/** Persist only canonical partition spelling (`operations`, never legacy `operation`). */
function coerceCanonicalAccessPartition(
  g: string | undefined | null
): 'admin' | 'operations' | 'accounting' | 'client' | undefined {
  if (g == null || g === '') return undefined;
  const s = String(g).trim().toLowerCase();
  if (s === 'operation') return 'operations';
  if (s === 'admin' || s === 'operations' || s === 'accounting' || s === 'client') return s;
  return undefined;
}

function mapBusinessRoleToAccessLevel(roleKey: BusinessRoleKey): 'admin' | 'manager' | 'officer' | 'viewer' {
  return ROLE_CATALOG[roleKey]?.accessLevel ?? 'officer';
}

function getDefaultAllowedModules(
  accessGroup: 'admin' | 'operations' | 'accounting' | 'client',
  accessLevel: 'admin' | 'manager' | 'officer' | 'viewer'
): string[] | undefined {
  if (accessLevel !== 'officer') return undefined;
  if (accessGroup === 'operations') return [...OPERATION_DEFAULT_MODULES];
  if (accessGroup === 'accounting') return [...ACCOUNTING_DEFAULT_MODULES];
  return undefined;
}

export function inferDeptAndLevel(user: Partial<User> | null): { dept: DeptType; level: AccessLevel } {
  const u = normalizeCurrentUserPermissions(user);
  if (!u) return { dept: 'hr', level: 'viewer' };

  const primaryRole = primaryBusinessRoleFromUser(u);
  if (primaryRole) {
    const role = BUSINESS_ROLES[primaryRole];
    return { dept: role.dept, level: role.level };
  }

  if (u.department && u.level) {
    return { dept: u.department, level: u.level };
  }

  return { dept: 'hr', level: 'viewer' };
}

export const getEffectiveDepartment = (user: Partial<User> | null) => inferDeptAndLevel(user).dept;
export const getEffectiveLevel = (user: Partial<User> | null) => inferDeptAndLevel(user).level;

export const isAdminUser = (user: User | null) => isSystemAdmin(user);

export const isOperationUser = (user: Partial<User> | null) => {
  const u = normalizeCurrentUserPermissions(user);
  if (!u) return false;
  if (u.accessGroup === 'operations' || u.accessGroup === 'operation') return true;
  const role = primaryBusinessRoleFromUser(u);
  return role != null && mapBusinessRoleToAccessGroup(role) === 'operations';
};

export const isAccountingUser = (user: Partial<User> | null) => {
  const u = normalizeCurrentUserPermissions(user);
  if (!u) return false;
  if (u.accessGroup === 'accounting') return true;
  const role = primaryBusinessRoleFromUser(u);
  return role != null && mapBusinessRoleToAccessGroup(role) === 'accounting';
};

export const isClientUser = (user: Partial<User> | null) => {
  const u = normalizeCurrentUserPermissions(user);
  if (!u) return false;
  return (
    u.userType === 'customer_portal'
    && u.accessGroup === 'client'
    && normalizeBusinessRoleKey(u.assignedRoleKey) === 'client_user'
  );
};

export function deriveBusinessRoleKey(user: Partial<User>): BusinessRoleKey {
  const u = normalizeCurrentUserPermissions(user);
  /** Match gates in permission-core / sidebar (accessGroup admin, profile system_admin, etc.). */
  if (u && isSystemAdmin(u)) return 'system_admin';
  const p = primaryBusinessRoleFromUser(user);
  if (p) return p;
  const fromProfileId =
    normalizePermissionProfileDocumentId(u?.permissionProfileKey ?? '') ||
    normalizePermissionProfileDocumentId(u?.permissionProfileKeys?.[0] ?? '');
  if (fromProfileId && fromProfileId in BUSINESS_ROLES) {
    return fromProfileId as BusinessRoleKey;
  }
  if (u?.department && u.level) {
    return businessRoleFromDeptLevel(u.department, u.level);
  }
  return 'operations_officer';
}

/**
 * Transitional helper only.
 * Returns a single effective role as array[0] to avoid additive runtime behavior.
 */
export function deriveBusinessRoleKeys(user: Partial<User>): BusinessRoleKey[] {
  return [deriveBusinessRoleKey(user)];
}

export function deriveDataAccess(roleKeys: BusinessRoleKey[]): DataAccessClass {
  const primary = roleKeys[0];
  if (!primary) return 'staff';
  if (primary === 'client_user') return 'client';
  if (primary === 'system_admin') return 'admin';
  return 'staff';
}

function getProfileKeyForRole(roleKey: BusinessRoleKey): string {
  return ROLE_CATALOG[roleKey]?.permissionProfileKey ?? roleKey;
}

/**
 * Primary helper: single-role mapping only.
 */
export function getFieldsForBusinessRole(roleKey: BusinessRoleKey): Partial<User> {
  const mapped = normalizeBusinessRoleKey(roleKey);
  const rk =
    mapped && mapped in BUSINESS_ROLES ? (mapped as BusinessRoleKey) : roleKey;
  const role = BUSINESS_ROLES[rk];
  const accessGroup = mapBusinessRoleToAccessGroup(rk);
  const accessLevel = mapBusinessRoleToAccessLevel(rk);
  const dataAccess = deriveDataAccess([rk]);
  const userType: UserType = dataAccess === 'client' ? 'customer_portal' : 'internal';
  const permissionProfileKey = getProfileKeyForRole(rk);
  const portalRole: PortalRole | undefined = rk === 'client_user' ? 'viewer' : undefined;
  const allowedModules = getDefaultAllowedModules(accessGroup, accessLevel);

  return {
    assignedRoleKey: rk,
    assignedRoleKeys: [rk],
    roleId: role.canonicalRole,
    roleIds: [role.canonicalRole],
    permissionProfileKey,
    permissionProfileKeys: [permissionProfileKey],
    department: role.dept,
    level: role.level,
    accessGroup,
    departmentGroup: accessGroup,
    accessLevel,
    allowedModules,
    dataAccess,
    userType,
    portalRole,
    updatedAt: Date.now(),
  };
}

/** Map repair UI / legacy strings to a canonical BusinessRoleKey. */
export function resolveRepairRoleKey(raw: string): BusinessRoleKey {
  const mapped = normalizeBusinessRoleKey(raw) ?? raw;
  if (mapped in BUSINESS_ROLES) return mapped as BusinessRoleKey;
  return 'hr_officer';
}

/**
 * Align accessGroup, departmentGroup, roleIds, permissionProfileKey(s), assignedRoleKey(s), department/level.
 * Call after composing role/profile merges and before Firestore writes.
 */
export function normalizeUserAuthorizationFields(draft: Partial<User>): Partial<User> {
  const raw: BusinessRoleKey =
    draft.assignedRoleKey && draft.assignedRoleKey in BUSINESS_ROLES
      ? draft.assignedRoleKey
      : deriveBusinessRoleKey(draft as User);
  const mapped = normalizeBusinessRoleKey(raw) ?? raw;
  const roleKey = (mapped in BUSINESS_ROLES ? mapped : raw) as BusinessRoleKey;

  const canonical = getFieldsForBusinessRole(roleKey);
  const merged: Partial<User> = { ...canonical, ...draft };

  merged.assignedRoleKey = roleKey;
  merged.assignedRoleKeys = [roleKey];

  const br = BUSINESS_ROLES[roleKey];
  merged.roleId = br.canonicalRole;
  merged.roleIds = [br.canonicalRole];

  const gRaw = (merged.accessGroup ?? canonical.accessGroup) as string;
  const g =
    coerceCanonicalAccessPartition(gRaw) ??
    (canonical.accessGroup as 'admin' | 'operations' | 'accounting' | 'client');
  merged.accessGroup = g;
  merged.departmentGroup = g;

  if (merged.permissionProfileKey) {
    const pk =
      normalizePermissionProfileDocumentId(String(merged.permissionProfileKey).trim()) ??
      merged.permissionProfileKey;
    merged.permissionProfileKey = pk;
    merged.permissionProfileKeys = [pk];
  } else {
    merged.permissionProfileKey = canonical.permissionProfileKey;
    merged.permissionProfileKeys = canonical.permissionProfileKeys;
  }

  if (!merged.accessLevel) merged.accessLevel = canonical.accessLevel;
  if (!merged.department) merged.department = canonical.department;
  if (!merged.level) merged.level = canonical.level;

  merged.updatedAt = Date.now();
  return sanitizeFirestorePayload(merged);
}

/** Full auth payload for setup-admin / emergency repair (role-based only). */
export function buildAuthorizationForRepairRole(rawRoleKey: string): Partial<User> {
  const rk = resolveRepairRoleKey(rawRoleKey);
  return normalizeUserAuthorizationFields(getFieldsForBusinessRole(rk));
}

export function isOperationalSystemAdmin(user: User | null | undefined): boolean {
  if (!user) return false;
  if (user.approvalStatus !== 'ACTIVE') return false;
  if (user.isActive === false) return false;
  return isSystemAdmin(user);
}

export function countOperationalSystemAdmins(users: User[]): number {
  return users.filter((u) => isOperationalSystemAdmin(u)).length;
}

/**
 * Blocks demoting/deactivating the last usable system admin (users UI only).
 */
export function assertAtLeastOneOperationalAdminAfterChange(
  allUsers: User[],
  targetId: string,
  patch: Partial<User>
): { ok: true } | { ok: false; message: string } {
  const target = allUsers.find((u) => u.id === targetId);
  if (!target) return { ok: true };

  const next = { ...target, ...patch } as User;
  const others = allUsers.filter((u) => u.id !== targetId);
  const otherAdminCount = others.filter((u) => isOperationalSystemAdmin(u)).length;
  const nextIsOpAdmin = isOperationalSystemAdmin(next);
  const wasOpAdmin = isOperationalSystemAdmin(target);

  if (!nextIsOpAdmin && wasOpAdmin && otherAdminCount === 0) {
    return {
      ok: false,
      message:
        'ไม่สามารถเปลี่ยนสิทธิ์นี้ได้ — ต้องมีผู้ดูแลระบบ (System Admin) ที่ใช้งานได้อย่างน้อย 1 บัญชีเสมอ',
    };
  }
  return { ok: true };
}

export function getMigratedUserFields(user: Partial<User>): Partial<User> {
  const primary = deriveBusinessRoleKey(user);
  const base = getFieldsForBusinessRole(primary);

  if (primary === 'client_user') {
    return normalizeUserAuthorizationFields({
      ...base,
      portalRole: inferPortalRole(user),
      accessLevel: 'viewer',
      allowedModules: undefined,
      customerId: user.customerId ?? null,
    });
  }

  return normalizeUserAuthorizationFields(base);
}

export function getLegacyRoles(dept: DeptType, level: AccessLevel): RoleType[] {
  if (dept === 'admin') return ['system_admin'];
  if (dept === 'client') return ['client_user'];

  const match = Object.values(BUSINESS_ROLES).find((role) => role.dept === dept && role.level === level);
  if (match) return [match.canonicalRole];

  return [`${dept}_officer` as RoleType];
}
