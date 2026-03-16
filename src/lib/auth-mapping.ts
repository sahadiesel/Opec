/**
 * OPEC OpsFlow - Authorization & Menu Mapping Configuration
 * Centralized mapping from Business Roles to Dept + Level + Legacy Roles.
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
  legacyRoles: RoleType[];
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
    legacyRoles: ['system_admin'],
    descriptionTh: 'เข้าถึงและจัดการได้ทุกส่วนของระบบ รวมถึงการตั้งค่าสิทธิ์และความปลอดภัย'
  },
  hr_manager: {
    key: 'hr_manager',
    labelTh: 'ผู้จัดการฝ่ายบุคคล',
    labelEn: 'HR Manager',
    dept: 'hr',
    level: 'manager',
    legacyRoles: ['hr_manager', 'hr_officer', 'payroll_officer'],
    descriptionTh: 'จัดการข้อมูลคนงาน ตำแหน่งงาน และอนุมัติการจ่ายเงินเดือน (Payroll)'
  },
  hr_officer: {
    key: 'hr_officer',
    labelTh: 'เจ้าหน้าที่ฝ่ายบุคคล',
    labelEn: 'HR Officer',
    dept: 'hr',
    level: 'officer',
    legacyRoles: ['hr_officer', 'payroll_officer'],
    descriptionTh: 'บันทึกประวัติคนงาน ใบเซอร์ และจัดเตรียมข้อมูลการลงเวลาทำงาน'
  },
  operations_manager: {
    key: 'operations_manager',
    labelTh: 'ผู้จัดการฝ่ายปฏิบัติการ',
    labelEn: 'Operations Manager',
    dept: 'operations',
    level: 'manager',
    legacyRoles: ['operations_officer'],
    descriptionTh: 'วางแผนรอบการทำงาน (Waves) มอบหมายงาน และอนุมัติการเตรียมตัวส่งคน (Mobilization)'
  },
  operations_officer: {
    key: 'operations_officer',
    labelTh: 'เจ้าหน้าที่ฝ่ายปฏิบัติการ',
    labelEn: 'Operations Officer',
    dept: 'operations',
    level: 'officer',
    legacyRoles: ['operations_officer'],
    descriptionTh: 'จัดการตารางงาน การมอบหมายตัวบุคคล และตรวจสอบความพร้อมหน้างาน'
  },
  accounting_manager: {
    key: 'accounting_manager',
    labelTh: 'ผู้จัดการฝ่ายบัญชีและการเงิน',
    labelEn: 'Accounting Manager',
    dept: 'accounting',
    level: 'manager',
    legacyRoles: ['finance_officer'],
    descriptionTh: 'จัดการระบบลูกหนี้/เจ้าหนี้ อนุมัติการจ่ายเงิน และสรุปงบการเงินบริษัท'
  },
  accounting_officer: {
    key: 'accounting_officer',
    labelTh: 'เจ้าหน้าที่ฝ่ายบัญชี',
    labelEn: 'Accounting Officer',
    dept: 'accounting',
    level: 'officer',
    legacyRoles: ['finance_officer'],
    descriptionTh: 'ออกใบแจ้งหนี้ บันทึกรับชำระเงิน และจัดการรายการ Cashbook'
  },
  sales_manager: {
    key: 'sales_manager',
    labelTh: 'ผู้จัดการฝ่ายขาย',
    labelEn: 'Sales Manager',
    dept: 'sales',
    level: 'manager',
    legacyRoles: ['sales_officer'],
    descriptionTh: 'บริหารจัดการสัญญาหลัก (Contracts) และใบสั่งซื้อจากลูกค้า (POs)'
  },
  sales_officer: {
    key: 'sales_officer',
    labelTh: 'เจ้าหน้าที่ฝ่ายขาย',
    labelEn: 'Sales Officer',
    dept: 'sales',
    level: 'officer',
    legacyRoles: ['sales_officer'],
    descriptionTh: 'บันทึกข้อมูลลูกค้า และจัดเตรียมรายละเอียดสัญญาเบื้องต้น'
  },
  store_officer: {
    key: 'store_officer',
    labelTh: 'เจ้าหน้าที่คลังและจัดซื้อ',
    labelEn: 'Store & Procurement',
    dept: 'store',
    level: 'officer',
    legacyRoles: ['store_officer'],
    descriptionTh: 'จัดการสต็อกอุปกรณ์ PPE เครื่องมือช่าง และการสั่งซื้อพัสดุเข้าคลัง'
  },
  client_approver: {
    key: 'client_approver',
    labelTh: 'ลูกค้า (ผู้มีอำนาจอนุมัติ)',
    labelEn: 'Client Approver',
    dept: 'client',
    level: 'manager',
    legacyRoles: ['client'],
    descriptionTh: 'เข้าดูประวัติพนักงานที่ส่งพิจารณา และกดยืนยันการรับตัวคนงาน'
  },
  client_viewer: {
    key: 'client_viewer',
    labelTh: 'ลูกค้า (ผู้เรียกดู)',
    labelEn: 'Client Viewer',
    dept: 'client',
    level: 'viewer',
    legacyRoles: ['client_user'],
    descriptionTh: 'เรียกดูสถานะโครงการและรายชื่อพนักงานที่กำลังปฏิบัติงาน'
  }
};

/**
 * Level hierarchy for comparison
 */
const LevelOrder: Record<AccessLevel, number> = {
  viewer: 0,
  officer: 1,
  manager: 2,
  admin: 3
};

/**
 * Legacy Role to Dept/Level Mapping for Migration
 */
export const LEGACY_ROLE_MAP: Record<string, { dept: DeptType; level: AccessLevel }> = {
  system_admin: { dept: 'admin', level: 'admin' },
  hr_manager: { dept: 'hr', level: 'manager' },
  hr_officer: { dept: 'hr', level: 'officer' },
  payroll_officer: { dept: 'hr', level: 'officer' },
  sales_officer: { dept: 'sales', level: 'officer' },
  finance_officer: { dept: 'accounting', level: 'officer' },
  store_officer: { dept: 'store', level: 'officer' },
  operations_officer: { dept: 'operations', level: 'officer' },
  client_user: { dept: 'client', level: 'viewer' },
  client: { dept: 'client', level: 'viewer' }
};

/**
 * Infers Dept and Level from legacy roleIds if new fields are missing.
 */
export function inferDeptAndLevel(user: Partial<User> | null): { dept: DeptType; level: AccessLevel } {
  if (!user) return { dept: 'hr', level: 'viewer' };
  
  if (user.department && user.level) {
    return { dept: user.department, level: user.level };
  }

  const roles = user.roleIds || [];
  const allRoles = [...roles];
  if (user.roleId && !allRoles.includes(user.roleId as any)) allRoles.push(user.roleId as any);
  
  if (allRoles.includes('system_admin')) return { dept: 'admin', level: 'admin' };
  if (allRoles.includes('hr_manager')) return { dept: 'hr', level: 'manager' };
  if (allRoles.includes('hr_officer') || allRoles.includes('payroll_officer')) return { dept: 'hr', level: 'officer' };
  if (allRoles.includes('finance_officer')) return { dept: 'accounting', level: 'officer' };
  if (allRoles.includes('sales_officer')) return { dept: 'sales', level: 'officer' };
  if (allRoles.includes('store_officer')) return { dept: 'store', level: 'officer' };
  if (allRoles.includes('operations_officer')) return { dept: 'operations', level: 'officer' };
  if (allRoles.includes('client') || allRoles.includes('client_user')) return { dept: 'client', level: 'viewer' };

  return { dept: 'hr', level: 'viewer' };
}

/**
 * Derives the most appropriate Business Role Key from technical fields
 */
export function deriveBusinessRoleKey(user: Partial<User>): BusinessRoleKey {
  if (user.assignedRoleKey) return user.assignedRoleKey;
  
  const { dept, level } = inferDeptAndLevel(user);
  
  // Find standard match
  const match = Object.values(BUSINESS_ROLES).find(r => r.dept === dept && r.level === level);
  if (match) return match.key;

  // Fallbacks
  if (dept === 'admin') return 'system_admin';
  if (dept === 'client') return 'client_viewer';
  return `${dept}_officer` as BusinessRoleKey;
}

/**
 * Generates technical fields based on a Business Role assignment
 */
export function getFieldsForBusinessRole(roleKey: BusinessRoleKey): Partial<User> {
  const role = BUSINESS_ROLES[roleKey];
  if (!role) throw new Error(`Invalid business role key: ${roleKey}`);

  return {
    assignedRoleKey: roleKey,
    department: role.dept,
    level: role.level,
    roleIds: role.legacyRoles,
    permissionProfileKey: `${role.dept}_${role.level}`,
    updatedAt: Date.now()
  };
}

/**
 * Maps Dept + Level to legacy roleIds for Firestore Security Rules compatibility
 */
export function getLegacyRoles(dept: DeptType, level: AccessLevel): RoleType[] {
  if (dept === 'admin' && level === 'admin') return ['system_admin'];
  
  const roles: RoleType[] = [];
  
  if (dept === 'hr') {
    if (level === 'manager' || level === 'admin') roles.push('hr_manager');
    roles.push('hr_officer');
    roles.push('payroll_officer');
  }
  
  if (dept === 'accounting') {
    roles.push('finance_officer');
  }
  
  if (dept === 'operations') {
    roles.push('operations_officer');
  }
  
  if (dept === 'sales') {
    roles.push('sales_officer');
  }
  
  if (dept === 'store') {
    roles.push('store_officer');
  }
  
  if (dept === 'client') {
    roles.push('client');
  }
  
  return roles;
}

/**
 * Generates the full set of migrated fields for a user document.
 */
export function getMigratedUserFields(user: Partial<User>): Partial<User> {
  const { dept, level } = inferDeptAndLevel(user);
  const roleKey = deriveBusinessRoleKey(user);
  
  const isActive = user.isActive ?? true;
  let approvalStatus: ApprovalStatus = user.approvalStatus || 'PENDING';
  
  if (isActive) {
    const internalDepts: DeptType[] = ['admin', 'hr', 'operations', 'sales', 'accounting', 'store'];
    if (internalDepts.includes(dept)) {
      approvalStatus = 'ACTIVE';
    }
  }

  return {
    ...getFieldsForBusinessRole(roleKey),
    assignedRoleKey: roleKey,
    isActive: isActive,
    approvalStatus: approvalStatus,
    customerId: user.customerId || null,
    notes: user.notes || "",
    updatedAt: Date.now()
  };
}

export const getEffectiveDepartment = (user: Partial<User> | null) => inferDeptAndLevel(user).dept;
export const getEffectiveLevel = (user: Partial<User> | null) => inferDeptAndLevel(user).level;

export const isAdminUser = (user: User | null) => {
  if (!user) return false;
  const { dept, level } = inferDeptAndLevel(user);
  const roles = user.roleIds || [];
  return (dept === 'admin' && level === 'admin') || roles.includes('system_admin') || user.assignedRoleKey === 'system_admin';
};

export function hasLevel(userLevel: AccessLevel, requiredLevel: AccessLevel): boolean {
  return LevelOrder[userLevel] >= LevelOrder[requiredLevel];
}

export const canSeeMenu = (menu: string, dept: DeptType, level: AccessLevel): boolean => {
  if (dept === 'admin' && level === 'admin') return true;
  return true; 
};
