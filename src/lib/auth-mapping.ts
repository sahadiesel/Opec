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
import { sanitizeFirestorePayload } from './utils';

export interface BusinessRole {
  key: BusinessRoleKey;
  labelTh: string;
  labelEn: string;
  dept: DeptType;
  level: AccessLevel;
  canonicalRole: RoleType;
  descriptionTh: string;
}

export const BUSINESS_ROLES: Record<BusinessRoleKey, BusinessRole> = {
  system_admin: {
    key: 'system_admin',
    labelTh: 'ผู้ดูแลระบบสูงสุด',
    labelEn: 'System Administrator',
    dept: 'admin',
    level: 'admin',
    canonicalRole: 'system_admin',
    descriptionTh: 'เข้าถึงและจัดการได้ทุกส่วนของระบบ รวมถึงการตั้งค่าสิทธิ์และความปลอดภัย',
  },
  hr_manager: {
    key: 'hr_manager',
    labelTh: 'ผู้จัดการฝ่ายบุคคล',
    labelEn: 'HR Manager',
    dept: 'hr',
    level: 'manager',
    canonicalRole: 'hr_manager',
    descriptionTh: 'จัดการข้อมูลคนงาน ตำแหน่งงาน และอนุมัติการจ่ายเงินเดือน',
  },
  hr_officer: {
    key: 'hr_officer',
    labelTh: 'เจ้าหน้าที่ฝ่ายบุคคล',
    labelEn: 'HR Officer',
    dept: 'hr',
    level: 'officer',
    canonicalRole: 'hr_officer',
    descriptionTh: 'บันทึกข้อมูลคนงาน เอกสาร และเวลาทำงาน',
  },
  operations_manager: {
    key: 'operations_manager',
    labelTh: 'ผู้จัดการฝ่ายปฏิบัติการ',
    labelEn: 'Operations Manager',
    dept: 'operations',
    level: 'manager',
    canonicalRole: 'operations_manager',
    descriptionTh: 'จัดการ waves, assignments และ mobilization',
  },
  operations_officer: {
    key: 'operations_officer',
    labelTh: 'เจ้าหน้าที่ฝ่ายปฏิบัติการ',
    labelEn: 'Operations Officer',
    dept: 'operations',
    level: 'officer',
    canonicalRole: 'operations_officer',
    descriptionTh: 'ดูแลงานปฏิบัติการและการส่งตัว',
  },
  accounting_manager: {
    key: 'accounting_manager',
    labelTh: 'ผู้จัดการฝ่ายบัญชี',
    labelEn: 'Accounting Manager',
    dept: 'accounting',
    level: 'manager',
    canonicalRole: 'accounting_manager',
    descriptionTh: 'จัดการการเงิน บัญชี และอนุมัติการจ่ายเงิน',
  },
  accounting_officer: {
    key: 'accounting_officer',
    labelTh: 'เจ้าหน้าที่ฝ่ายบัญชี',
    labelEn: 'Accounting Officer',
    dept: 'accounting',
    level: 'officer',
    canonicalRole: 'accounting_officer',
    descriptionTh: 'บันทึกรายการบัญชี รับจ่าย และเอกสารการเงิน',
  },
  sales_manager: {
    key: 'sales_manager',
    labelTh: 'ผู้จัดการฝ่ายขาย',
    labelEn: 'Sales Manager',
    dept: 'sales',
    level: 'manager',
    canonicalRole: 'sales_manager',
    descriptionTh: 'บริหารลูกค้า สัญญา และใบเสนอราคา',
  },
  sales_officer: {
    key: 'sales_officer',
    labelTh: 'เจ้าหน้าที่ฝ่ายขาย',
    labelEn: 'Sales Officer',
    dept: 'sales',
    level: 'officer',
    canonicalRole: 'sales_officer',
    descriptionTh: 'ดูแลข้อมูลลูกค้า เอกสารขาย และสัญญาเบื้องต้น',
  },
  store_manager: {
    key: 'store_manager',
    labelTh: 'ผู้จัดการคลังสินค้า',
    labelEn: 'Store Manager',
    dept: 'store',
    level: 'manager',
    canonicalRole: 'store_manager',
    descriptionTh: 'ดูแลคลังอุปกรณ์และการจัดซื้อ',
  },
  store_officer: {
    key: 'store_officer',
    labelTh: 'เจ้าหน้าที่คลังสินค้า',
    labelEn: 'Store Officer',
    dept: 'store',
    level: 'officer',
    canonicalRole: 'store_officer',
    descriptionTh: 'ทำรายการคลังสินค้าและจัดซื้อ',
  },
  client_user: {
    key: 'client_user',
    labelTh: 'ลูกค้า / ผู้ใช้งานภายนอก',
    labelEn: 'Client User',
    dept: 'client',
    level: 'viewer',
    canonicalRole: 'client_user',
    descriptionTh: 'เข้าดูข้อมูลลูกค้าของตนเองและทำรายการใน client portal',
  },
  operation_officer: {
    key: 'operation_officer',
    labelTh: 'เจ้าหน้าที่ปฏิบัติการ',
    labelEn: 'Operations Officer',
    dept: 'operations',
    level: 'officer',
    canonicalRole: 'operations_officer',
    descriptionTh: 'ขาย/บุคคล/ปฏิบัติการ/คลัง (รวม)',
  },
  operation_manager: {
    key: 'operation_manager',
    labelTh: 'ผู้จัดการปฏิบัติการ',
    labelEn: 'Operations Manager',
    dept: 'operations',
    level: 'manager',
    canonicalRole: 'operations_manager',
    descriptionTh: 'ขาย/บุคคล/ปฏิบัติการ/คลัง (รวม)',
  },
  admin_admin: {
    key: 'admin_admin',
    labelTh: 'ผู้ดูแลระบบ',
    labelEn: 'System Administrator',
    dept: 'admin',
    level: 'admin',
    canonicalRole: 'system_admin',
    descriptionTh: 'สิทธิ์สูงสุด',
  },
};

export const LEGACY_TO_CANONICAL_MAP: Record<string, BusinessRoleKey> = {
  finance_officer: 'accounting_officer',
  payroll_officer: 'hr_officer',
  client: 'client_user',
  client_viewer: 'client_user',
  client_approver: 'client_user',
  customer_viewer: 'client_user',
  customer_approver: 'client_user',
  safety_officer: 'operations_officer',
  super_admin: 'system_admin',
  admin: 'system_admin',
};

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
  if (!roleKey) return null;
  const mapped = LEGACY_TO_CANONICAL_MAP[roleKey] || roleKey;
  return mapped in BUSINESS_ROLES ? (mapped as BusinessRoleKey) : null;
}

function hasRawLegacyKey(user: Partial<User>, candidates: string[]): boolean {
  const values = [
    user.roleId,
    user.assignedRoleKey,
    ...(Array.isArray(user.roleIds) ? user.roleIds : []),
    ...(Array.isArray(user.assignedRoleKeys) ? user.assignedRoleKeys : []),
  ]
    .filter(Boolean)
    .map((v) => String(v));

  return candidates.some((candidate) => values.includes(candidate));
}

function inferPortalRole(user: Partial<User>): PortalRole {
  if (user.portalRole === 'approver' || user.portalRole === 'viewer') {
    return user.portalRole;
  }

  if (hasRawLegacyKey(user, ['client_approver', 'customer_approver'])) {
    return 'approver';
  }

  return 'viewer';
}

function getPrimaryLegacyRole(user: Partial<User> | null): BusinessRoleKey | null {
  const u = normalizeCurrentUserPermissions(user);
  if (!u) return null;

  if (u.accessGroup === 'admin') return 'system_admin';
  if (u.accessGroup === 'client') return 'client_user';

  const directAssigned = canonicalizeRoleKey(u.assignedRoleKey);
  if (directAssigned) return directAssigned;

  const directRoleId = canonicalizeRoleKey(u.roleId);
  if (directRoleId) return directRoleId;

  const firstAssigned = canonicalizeRoleKey(u.assignedRoleKeys?.[0]);
  if (firstAssigned) return firstAssigned;

  const firstRoleId = canonicalizeRoleKey(u.roleIds?.[0]);
  if (firstRoleId) return firstRoleId;

  if (u.userType === 'customer_portal' || u.department === 'client') {
    return 'client_user';
  }

  if (u.accessGroup === 'operation') {
    return u.accessLevel === 'manager' ? 'operations_manager' : 'operations_officer';
  }

  if (u.accessGroup === 'accounting') {
    return u.accessLevel === 'manager' ? 'accounting_manager' : 'accounting_officer';
  }

  if (u.department === 'admin') return 'system_admin';
  if (u.department === 'accounting') return u.level === 'manager' ? 'accounting_manager' : 'accounting_officer';
  if (u.department === 'store') return u.level === 'manager' ? 'store_manager' : 'store_officer';
  if (u.department === 'operations') return u.level === 'manager' ? 'operations_manager' : 'operations_officer';
  if (u.department === 'sales') return u.level === 'manager' ? 'sales_manager' : 'sales_officer';
  if (u.department === 'hr') return u.level === 'manager' ? 'hr_manager' : 'hr_officer';

  return 'hr_officer';
}

function mapBusinessRoleToAccessGroup(roleKey: BusinessRoleKey): 'admin' | 'operation' | 'accounting' | 'client' {
  if (roleKey === 'system_admin' || roleKey === 'admin_admin') return 'admin';
  if (roleKey === 'client_user') return 'client';

  if (roleKey === 'accounting_manager' || roleKey === 'accounting_officer') {
    return 'accounting';
  }

  return 'operation';
}

function mapBusinessRoleToAccessLevel(roleKey: BusinessRoleKey): 'admin' | 'manager' | 'officer' | 'viewer' {
  if (roleKey === 'system_admin' || roleKey === 'admin_admin') return 'admin';
  if (roleKey === 'client_user') return 'viewer';
  const br = BUSINESS_ROLES[roleKey];
  return br?.level ?? (roleKey.endsWith('_manager') ? 'manager' : 'officer');
}

function getDefaultAllowedModules(
  accessGroup: 'admin' | 'operation' | 'accounting' | 'client',
  accessLevel: 'admin' | 'manager' | 'officer' | 'viewer'
): string[] | undefined {
  if (accessLevel !== 'officer') return undefined;
  if (accessGroup === 'operation') return [...OPERATION_DEFAULT_MODULES];
  if (accessGroup === 'accounting') return [...ACCOUNTING_DEFAULT_MODULES];
  return undefined;
}

export function inferDeptAndLevel(user: Partial<User> | null): { dept: DeptType; level: AccessLevel } {
  const u = normalizeCurrentUserPermissions(user);
  if (!u) return { dept: 'hr', level: 'viewer' };

  const primaryRole = getPrimaryLegacyRole(u);
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
  if (u.accessGroup === 'operation') return true;
  const role = getPrimaryLegacyRole(u);
  return role != null && mapBusinessRoleToAccessGroup(role) === 'operation';
};

export const isAccountingUser = (user: Partial<User> | null) => {
  const u = normalizeCurrentUserPermissions(user);
  if (!u) return false;
  if (u.accessGroup === 'accounting') return true;
  const role = getPrimaryLegacyRole(u);
  return role != null && mapBusinessRoleToAccessGroup(role) === 'accounting';
};

export const isClientUser = (user: Partial<User> | null) => {
  const u = normalizeCurrentUserPermissions(user);
  if (!u) return false;
  if (u.userType === 'customer_portal' || u.accessGroup === 'client') return true;
  const role = getPrimaryLegacyRole(u);
  return role === 'client_user';
};

export function deriveBusinessRoleKey(user: Partial<User>): BusinessRoleKey {
  return getPrimaryLegacyRole(user) || 'hr_officer';
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
  if (primary === 'system_admin' || primary === 'admin_admin') return 'admin';
  return 'staff';
}

function getProfileKeyForRole(roleKey: BusinessRoleKey): string {
  if (roleKey === 'client_user') return 'client_user';
  if (roleKey === 'admin_admin' || roleKey === 'system_admin') return 'admin_admin';
  if (roleKey === 'operation_officer' || roleKey === 'operation_manager') return roleKey;
  const role = BUSINESS_ROLES[roleKey];
  return role ? `${role.dept}_${role.level}` : roleKey;
}

/**
 * Primary helper: single-role mapping only.
 */
export function getFieldsForBusinessRole(roleKey: BusinessRoleKey): Partial<User> {
  const role = BUSINESS_ROLES[roleKey];
  const accessGroup = mapBusinessRoleToAccessGroup(roleKey);
  const accessLevel = mapBusinessRoleToAccessLevel(roleKey);
  const dataAccess = deriveDataAccess([roleKey]);
  const userType: UserType = dataAccess === 'client' ? 'customer_portal' : 'internal';
  const permissionProfileKey = getProfileKeyForRole(roleKey);
  const portalRole: PortalRole | undefined = roleKey === 'client_user' ? 'viewer' : undefined;
  const allowedModules = getDefaultAllowedModules(accessGroup, accessLevel);

  return {
    assignedRoleKey: roleKey,
    assignedRoleKeys: [roleKey],
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
  const mapped = LEGACY_TO_CANONICAL_MAP[raw] ?? raw;
  if (mapped in BUSINESS_ROLES) return mapped as BusinessRoleKey;
  return 'hr_officer';
}

/**
 * Align accessGroup, departmentGroup, roleIds, permissionProfileKey(s), assignedRoleKey(s), department/level.
 * Call after composing role/profile merges and before Firestore writes.
 */
export function normalizeUserAuthorizationFields(draft: Partial<User>): Partial<User> {
  const roleKey: BusinessRoleKey =
    draft.assignedRoleKey && draft.assignedRoleKey in BUSINESS_ROLES
      ? draft.assignedRoleKey
      : deriveBusinessRoleKey(draft as User);

  const canonical = getFieldsForBusinessRole(roleKey);
  const merged: Partial<User> = { ...canonical, ...draft };

  merged.assignedRoleKey = roleKey;
  merged.assignedRoleKeys = [roleKey];

  const br = BUSINESS_ROLES[roleKey];
  merged.roleId = br.canonicalRole;
  merged.roleIds = [br.canonicalRole];

  const g = (merged.accessGroup ?? canonical.accessGroup) as DepartmentGroup;
  merged.accessGroup = g;
  merged.departmentGroup = g;

  if (merged.permissionProfileKey) {
    merged.permissionProfileKeys = [merged.permissionProfileKey];
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
