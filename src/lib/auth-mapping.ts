/**
 * OPEC OpsFlow - Authorization & Menu Mapping Configuration
 * Transitional stabilization pass:
 * - single-role primary mapping
 * - future model = accessGroup/accessLevel
 * - legacy business-role helpers retained for compatibility only
 */

import {
  DeptType,
  AccessLevel,
  RoleType,
  User,
  BusinessRoleKey,
  DataAccessClass,
  UserType,
} from './types';
import { isSystemAdmin, normalizeCurrentUserPermissions } from './permissions';

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
};

function canonicalizeRoleKey(roleKey?: string | null): BusinessRoleKey | null {
  if (!roleKey) return null;
  const mapped = LEGACY_TO_CANONICAL_MAP[roleKey] || roleKey;
  return mapped in BUSINESS_ROLES ? (mapped as BusinessRoleKey) : null;
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
  if (u.department === 'client') return 'client_user';
  if (u.department === 'operations') return u.level === 'manager' ? 'operations_manager' : 'operations_officer';
  if (u.department === 'sales') return u.level === 'manager' ? 'sales_manager' : 'sales_officer';
  if (u.department === 'hr') return u.level === 'manager' ? 'hr_manager' : 'hr_officer';
  if (u.department === 'accounting') return u.level === 'manager' ? 'accounting_manager' : 'accounting_officer';
  if (u.department === 'store') return u.level === 'manager' ? 'store_manager' : 'store_officer';

  return 'hr_officer';
}

function mapBusinessRoleToAccessGroup(roleKey: BusinessRoleKey): 'admin' | 'operation' | 'accounting' | 'client' {
  if (roleKey === 'system_admin') return 'admin';
  if (roleKey === 'client_user') return 'client';

  if (
    roleKey === 'accounting_manager' ||
    roleKey === 'accounting_officer' ||
    roleKey === 'store_manager' ||
    roleKey === 'store_officer'
  ) {
    return 'accounting';
  }

  return 'operation';
}

function mapBusinessRoleToAccessLevel(roleKey: BusinessRoleKey): 'admin' | 'manager' | 'officer' | 'viewer' {
  if (roleKey === 'system_admin') return 'admin';
  if (roleKey === 'client_user') return 'viewer';
  return BUSINESS_ROLES[roleKey].level;
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
  if (primary === 'system_admin') return 'admin';
  return 'staff';
}

function getProfileKeyForRole(roleKey: BusinessRoleKey): string {
  if (roleKey === 'client_user') return 'client_user';
  const role = BUSINESS_ROLES[roleKey];
  return `${role.dept}_${role.level}`;
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
    accessLevel,
    dataAccess,
    userType,
    updatedAt: Date.now(),
  };
}

/**
 * Transitional helper only.
 * IMPORTANT: does NOT preserve additive multi-role behavior.
 * Uses the first valid role as the effective role.
 */
export function getFieldsForBusinessRoles(roleKeys: BusinessRoleKey[]): Partial<User> {
  const primary = roleKeys.find((key) => key in BUSINESS_ROLES) || 'hr_officer';
  return getFieldsForBusinessRole(primary);
}

export function getMigratedUserFields(user: Partial<User>): Partial<User> {
  const primary = deriveBusinessRoleKey(user);
  return getFieldsForBusinessRole(primary);
}

export function getLegacyRoles(dept: DeptType, level: AccessLevel): RoleType[] {
  if (dept === 'admin') return ['system_admin'];
  if (dept === 'client') return ['client_user'];

  const match = Object.values(BUSINESS_ROLES).find((role) => role.dept === dept && role.level === level);
  if (match) return [match.canonicalRole];

  return [`${dept}_officer` as RoleType];
}
