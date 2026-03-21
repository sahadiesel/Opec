
/**
 * OPEC OpsFlow - Authorization & Menu Mapping Configuration
 * Centralized mapping from Business Roles to Dept + Level + Canonical Roles.
 */

import { DeptType, AccessLevel, RoleType, User, ApprovalStatus, BusinessRoleKey } from './types';

/**
 * Definition of a Business-facing role
 */
export interface BusinessRole {
  key: BusinessRoleKey;
  labelTh: string;
  labelEn: string;
  dept: DeptType;
  level: AccessLevel;
  canonicalRole: RoleType;
  descriptionTh: string;
}

/**
 * Master Dictionary of Business Roles (Role Templates)
 */
export const BUSINESS_ROLES: Record<BusinessRoleKey, BusinessRole> = {
  system_admin: {
    key: 'system_admin',
    labelTh: 'ผู้ดูแลระบบสูงสุด',
    labelEn: 'System Administrator',
    dept: 'admin',
    level: 'admin',
    canonicalRole: 'system_admin',
    descriptionTh: 'เข้าถึงและจัดการได้ทุกส่วนของระบบ รวมถึงการตั้งค่าสิทธิ์และความปลอดภัย'
  },
  hr_manager: {
    key: 'hr_manager',
    labelTh: 'ผู้จัดการฝ่ายบุคคล',
    labelEn: 'HR Manager',
    dept: 'hr',
    level: 'manager',
    canonicalRole: 'hr_manager',
    descriptionTh: 'จัดการข้อมูลคนงาน ตำแหน่งงาน และอนุมัติการจ่ายเงินเดือน (Payroll)'
  },
  hr_officer: {
    key: 'hr_officer',
    labelTh: 'เจ้าหน้าที่ฝ่ายบุคคล',
    labelEn: 'HR Officer',
    dept: 'hr',
    level: 'officer',
    canonicalRole: 'hr_officer',
    descriptionTh: 'บันทึกประวัติคนงาน ใบเซอร์ และจัดเตรียมข้อมูลการลงเวลาทำงาน'
  },
  operations_manager: {
    key: 'operations_manager',
    labelTh: 'ผู้จัดการฝ่ายปฏิบัติการ',
    labelEn: 'Operations Manager',
    dept: 'operations',
    level: 'manager',
    canonicalRole: 'operations_manager',
    descriptionTh: 'วางแผนรอบการทำงาน (Waves) มอบหมายงาน และอนุมัติการเตรียมตัวส่งคน (Mobilization)'
  },
  operations_officer: {
    key: 'operations_officer',
    labelTh: 'เจ้าหน้าที่ฝ่ายปฏิบัติการ',
    labelEn: 'Operations Officer',
    dept: 'operations',
    level: 'officer',
    canonicalRole: 'operations_officer',
    descriptionTh: 'จัดการตารางงาน การมอบหมายตัวบุคคล และตรวจสอบความพร้อมหน้างาน'
  },
  accounting_manager: {
    key: 'accounting_manager',
    labelTh: 'ผู้จัดการฝ่ายบัญชีและการเงิน',
    labelEn: 'Accounting Manager',
    dept: 'accounting',
    level: 'manager',
    canonicalRole: 'accounting_manager',
    descriptionTh: 'จัดการระบบลูกหนี้/เจ้าหนี้ อนุมัติการจ่ายเงิน และสรุปงบการเงินบริษัท'
  },
  accounting_officer: {
    key: 'accounting_officer',
    labelTh: 'เจ้าหน้าที่ฝ่ายบัญชี',
    labelEn: 'Accounting Officer',
    dept: 'accounting',
    level: 'officer',
    canonicalRole: 'accounting_officer',
    descriptionTh: 'ออกใบแจ้งหนี้ บันทึกรับชำระเงิน และจัดการรายการ Cashbook'
  },
  sales_manager: {
    key: 'sales_manager',
    labelTh: 'ผู้จัดการฝ่ายขาย',
    labelEn: 'Sales Manager',
    dept: 'sales',
    level: 'manager',
    canonicalRole: 'sales_manager',
    descriptionTh: 'บริหารจัดการสัญญาหลัก (Contracts) และใบสั่งซื้อจากลูกค้า (POs)'
  },
  sales_officer: {
    key: 'sales_officer',
    labelTh: 'เจ้าหน้าที่ฝ่ายขาย',
    labelEn: 'Sales Officer',
    dept: 'sales',
    level: 'officer',
    canonicalRole: 'sales_officer',
    descriptionTh: 'บันทึกข้อมูลลูกค้า และจัดเตรียมรายละเอียดสัญญาเบื้องต้น'
  },
  store_manager: {
    key: 'store_manager',
    labelTh: 'ผู้จัดการคลังสินค้า',
    labelEn: 'Store Manager',
    dept: 'store',
    level: 'manager',
    canonicalRole: 'store_manager',
    descriptionTh: 'ควบคุมดูแลคลังสินค้า PPE และเครื่องมือช่าง รวมถึงนโยบายการจัดซื้อ'
  },
  store_officer: {
    key: 'store_officer',
    labelTh: 'เจ้าหน้าที่คลังและจัดซื้อ',
    labelEn: 'Store & Procurement',
    dept: 'store',
    level: 'officer',
    canonicalRole: 'store_officer',
    descriptionTh: 'จัดการสต็อกอุปกรณ์ PPE เครื่องมือช่าง และการสั่งซื้อพัสดุเข้าคลัง'
  },
  client_user: {
    key: 'client_user',
    labelTh: 'ลูกค้า / ผู้ใช้งานภายนอก',
    labelEn: 'Client User',
    dept: 'client',
    level: 'viewer',
    canonicalRole: 'client_user',
    descriptionTh: 'เข้าดูประวัติพนักงานที่ส่งพิจารณา และกดยืนยันการรับตัวคนงานหรืออนุมัติเวลา'
  }
};

/**
 * Legacy to Canonical Compatibility Map
 */
export const LEGACY_TO_CANONICAL_MAP: Record<string, BusinessRoleKey> = {
  finance_officer: 'accounting_officer',
  payroll_officer: 'hr_officer',
  client: 'client_user',
  client_viewer: 'client_user',
  client_approver: 'client_user',
  customer_viewer: 'client_user',
  customer_approver: 'client_user',
  safety_officer: 'operations_officer'
};

/**
 * Infers Dept and Level from legacy roleIds if new fields are missing.
 */
export function inferDeptAndLevel(user: Partial<User> | null): { dept: DeptType; level: AccessLevel } {
  if (!user) return { dept: 'hr', level: 'viewer' };
  
  if (user.userType === 'customer_portal') {
    const level: AccessLevel = user.portalRole === 'approver' ? 'manager' : 'viewer';
    return { dept: 'client', level };
  }

  if (user.department && user.level) {
    return { dept: user.department, level: user.level };
  }

  const roles = user.roleIds || [];
  if (roles.includes('system_admin')) return { dept: 'admin', level: 'admin' };
  if (roles.includes('hr_manager')) return { dept: 'hr', level: 'manager' };
  if (roles.includes('hr_officer')) return { dept: 'hr', level: 'officer' };
  if (roles.includes('accounting_manager')) return { dept: 'accounting', level: 'manager' };
  if (roles.includes('accounting_officer')) return { dept: 'accounting', level: 'officer' };
  if (roles.includes('sales_manager')) return { dept: 'sales', level: 'manager' };
  if (roles.includes('sales_officer')) return { dept: 'sales', level: 'officer' };
  if (roles.includes('store_manager')) return { dept: 'store', level: 'manager' };
  if (roles.includes('store_officer')) return { dept: 'store', level: 'officer' };
  if (roles.includes('operations_manager')) return { dept: 'operations', level: 'manager' };
  if (roles.includes('operations_officer')) return { dept: 'operations', level: 'officer' };
  if (roles.includes('client_user')) return { dept: 'client', level: 'viewer' };

  return { dept: 'hr', level: 'viewer' };
}

/**
 * Derives the most appropriate Business Role Key from technical fields
 */
export function deriveBusinessRoleKey(user: Partial<User>): BusinessRoleKey {
  if (user.assignedRoleKey) {
    return LEGACY_TO_CANONICAL_MAP[user.assignedRoleKey] || user.assignedRoleKey;
  }
  
  if (user.userType === 'customer_portal') {
    return 'client_user';
  }

  const { dept, level } = inferDeptAndLevel(user);
  const match = Object.values(BUSINESS_ROLES).find(r => r.dept === dept && r.level === level);
  if (match) return match.key;

  if (dept === 'admin') return 'system_admin';
  if (dept === 'client') return 'client_user';
  return `${dept}_officer` as BusinessRoleKey;
}

/**
 * Derives all Business Role Keys based on canonical roleIds
 */
export function deriveBusinessRoleKeys(user: Partial<User>): BusinessRoleKey[] {
  if (user.assignedRoleKeys && user.assignedRoleKeys.length > 0) {
    return user.assignedRoleKeys;
  }
  
  const roleKey = deriveBusinessRoleKey(user);
  return [roleKey];
}

/**
 * Generates technical fields based on a list of Business Role assignments
 */
export function getFieldsForBusinessRoles(roleKeys: BusinessRoleKey[]): Partial<User> {
  if (roleKeys.length === 0) return {};

  const allRoleIds = new Set<RoleType>();
  const allProfileKeys = new Set<string>();
  
  roleKeys.forEach(key => {
    const role = BUSINESS_ROLES[key];
    if (role) {
      allRoleIds.add(role.canonicalRole);
      const profileKey = role.dept === 'client' ? 'client_user' : `${role.dept}_${role.level}`;
      allProfileKeys.add(profileKey);
    }
  });

  // Primary display context from the first role in the list
  const primary = BUSINESS_ROLES[roleKeys[0]];

  return {
    assignedRoleKeys: roleKeys,
    assignedRoleKey: roleKeys[0], // Single primary for backward compatibility
    roleIds: Array.from(allRoleIds),
    permissionProfileKeys: Array.from(allProfileKeys),
    permissionProfileKey: Array.from(allProfileKeys)[0], // Single primary for legacy support
    department: primary.dept,
    level: primary.level,
    updatedAt: Date.now()
  };
}

/**
 * Generates technical fields based on a single Business Role assignment
 */
export function getFieldsForBusinessRole(roleKey: BusinessRoleKey): Partial<User> {
  return getFieldsForBusinessRoles([roleKey]);
}

/**
 * Utility to generate the correct migration fields for a user based on their context.
 * Used by the system repair tools.
 */
export function getMigratedUserFields(user: Partial<User>): Partial<User> {
  const roleKeys = deriveBusinessRoleKeys(user);
  return getFieldsForBusinessRoles(roleKeys);
}

/**
 * Returns canonical role IDs based on department and level.
 */
export function getLegacyRoles(dept: DeptType, level: AccessLevel): RoleType[] {
  if (dept === 'admin') return ['system_admin'];
  if (dept === 'client') return ['client_user'];
  
  const match = Object.values(BUSINESS_ROLES).find(r => r.dept === dept && r.level === level);
  if (match) return [match.canonicalRole];

  return [`${dept}_officer` as RoleType];
}

export const getEffectiveDepartment = (user: Partial<User> | null) => inferDeptAndLevel(user).dept;
export const getEffectiveLevel = (user: Partial<User> | null) => inferDeptAndLevel(user).level;

export const isAdminUser = (user: User | null) => {
  if (!user) return false;
  const roles = user.roleIds || [];
  return roles.includes('system_admin') || user.assignedRoleKey === 'system_admin' || user.department === 'admin';
};
