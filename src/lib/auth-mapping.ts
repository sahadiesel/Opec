/**
 * OPEC OpsFlow - Authorization & Menu Mapping Configuration
 * Centralized mapping from Department + Access Level to Menu Visibility and Roles.
 */

import { DeptType, AccessLevel, RoleType, User, ApprovalStatus } from './types';

export type MenuKey = 
  | 'dashboard'
  | 'customers'
  | 'vendors'
  | 'main_contracts'
  | 'purchase_orders'
  | 'timesheets'
  | 'worker_payroll'
  | 'office_payroll'
  | 'positions'
  | 'workers'
  | 'office_staff'
  | 'waves'
  | 'assignments'
  | 'mobilization'
  | 'purchases'
  | 'store'
  | 'billing_notes'
  | 'tax_invoices'
  | 'receipts'
  | 'ap_bills'
  | 'ar'
  | 'ap'
  | 'cashbook'
  | 'bank_accounts'
  | 'system_admin'
  | 'permission_profiles'
  | 'client_portal';

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
 * Strict priority following business rules.
 */
export function inferDeptAndLevel(user: Partial<User> | null): { dept: DeptType; level: AccessLevel } {
  if (!user) return { dept: 'hr', level: 'viewer' };
  
  // 1. Use explicit fields if already migrated and present
  if (user.department && user.level) {
    return { dept: user.department, level: user.level };
  }

  // 2. Fallback logic: Priority based inference from roleIds array
  const roles = user.roleIds || [];
  
  // Highest priority: System Admin
  if (roles.includes('system_admin')) return { dept: 'admin', level: 'admin' };
  
  // Second: HR
  if (roles.includes('hr_manager')) return { dept: 'hr', level: 'manager' };
  if (roles.includes('hr_officer') || roles.includes('payroll_officer')) return { dept: 'hr', level: 'officer' };
  
  // Third: Accounting
  if (roles.includes('finance_officer')) return { dept: 'accounting', level: 'officer' };
  
  // Fourth: Sales
  if (roles.includes('sales_officer')) return { dept: 'sales', level: 'officer' };
  
  // Fifth: Store
  if (roles.includes('store_officer')) return { dept: 'store', level: 'officer' };
  
  // Sixth: Operations
  if (roles.includes('operations_officer')) return { dept: 'operations', level: 'officer' };
  
  // Seventh: Client
  if (roles.includes('client') || roles.includes('client_user')) return { dept: 'client', level: 'viewer' };

  // 3. Fallback to single roleId if array is empty
  if (user.roleId && LEGACY_ROLE_MAP[user.roleId as string]) {
    return LEGACY_ROLE_MAP[user.roleId as string];
  }

  // Default for unknown users
  return { dept: 'hr', level: 'viewer' };
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
 * Safe and idempotent.
 */
export function getMigratedUserFields(user: Partial<User>): Partial<User> {
  const { dept, level } = inferDeptAndLevel(user);
  const isActive = user.isActive ?? true;
  const approvalStatus: ApprovalStatus = user.approvalStatus || (isActive ? 'ACTIVE' : 'PENDING');
  
  return {
    department: dept,
    level: level,
    isActive: isActive,
    approvalStatus: approvalStatus,
    customerId: user.customerId || null,
    notes: user.notes || "",
    roleIds: getLegacyRoles(dept, level), // Keep sync for security rules compatibility
    updatedAt: Date.now()
  };
}

/**
 * Effective Authorization Helpers
 */
export const getEffectiveDepartment = (user: Partial<User> | null) => inferDeptAndLevel(user).dept;
export const getEffectiveLevel = (user: Partial<User> | null) => inferDeptAndLevel(user).level;

export const isAdminUser = (user: User | null) => {
  if (!user) return false;
  const { dept, level } = inferDeptAndLevel(user);
  return (dept === 'admin' && level === 'admin');
};

export const isHRUser = (user: User | null) => getEffectiveDepartment(user) === 'hr';
export const isHRManager = (user: User | null) => {
  const { dept, level } = inferDeptAndLevel(user);
  return (dept === 'hr' && (level === 'manager' || level === 'admin')) || (dept === 'admin' && level === 'admin');
};

export const isAccountingUser = (user: User | null) => getEffectiveDepartment(user) === 'accounting';
export const isSalesUser = (user: User | null) => getEffectiveDepartment(user) === 'sales';
export const isOperationsUser = (user: User | null) => getEffectiveDepartment(user) === 'operations';
export const isStoreUser = (user: User | null) => getEffectiveDepartment(user) === 'store';
export const isClientUser = (user: User | null) => getEffectiveDepartment(user) === 'client';

/**
 * Functional permission helpers
 */
export function hasLevel(userLevel: AccessLevel, requiredLevel: AccessLevel): boolean {
  return LevelOrder[userLevel] >= LevelOrder[requiredLevel];
}

export const sameCustomer = (user: User | null, recordCustomerId: string) => 
  isAdminUser(user) || (isClientUser(user) && user?.customerId === recordCustomerId);

/**
 * Visibility and Access Rules per Menu
 */
export const MENU_PERMISSIONS: Record<MenuKey, { depts: DeptType[]; minLevel: AccessLevel; readOnlyDepts?: DeptType[] }> = {
  dashboard: { depts: ['admin', 'hr', 'operations', 'sales', 'accounting', 'store', 'client'], minLevel: 'viewer' },
  
  // Commercial
  customers: { depts: ['admin', 'sales', 'accounting', 'operations'], minLevel: 'viewer', readOnlyDepts: ['accounting', 'operations'] },
  vendors: { depts: ['admin', 'store', 'operations', 'accounting'], minLevel: 'officer', readOnlyDepts: ['accounting'] },
  main_contracts: { depts: ['admin', 'sales', 'accounting', 'hr'], minLevel: 'officer', readOnlyDepts: ['accounting', 'hr'] },
  purchase_orders: { depts: ['admin', 'sales', 'operations', 'accounting'], minLevel: 'officer', readOnlyDepts: ['accounting'] },
  
  // HR & Payroll
  timesheets: { depts: ['admin', 'hr', 'operations'], minLevel: 'officer' },
  worker_payroll: { depts: ['admin', 'hr', 'accounting'], minLevel: 'officer', readOnlyDepts: ['accounting'] },
  office_payroll: { depts: ['admin', 'hr', 'accounting'], minLevel: 'manager', readOnlyDepts: ['accounting'] },
  positions: { depts: ['admin', 'hr', 'operations'], minLevel: 'officer', readOnlyDepts: ['operations'] },
  workers: { depts: ['admin', 'hr', 'operations'], minLevel: 'officer', readOnlyDepts: ['operations'] },
  office_staff: { depts: ['admin', 'hr'], minLevel: 'officer' },
  
  // Operations
  waves: { depts: ['admin', 'operations', 'hr'], minLevel: 'officer', readOnlyDepts: ['hr'] },
  assignments: { depts: ['admin', 'operations', 'hr', 'sales'], minLevel: 'officer', readOnlyDepts: ['sales'] },
  mobilization: { depts: ['admin', 'operations', 'hr'], minLevel: 'officer' },
  purchases: { depts: ['admin', 'store', 'operations', 'accounting'], minLevel: 'officer', readOnlyDepts: ['accounting'] },
  store: { depts: ['admin', 'store', 'operations', 'hr'], minLevel: 'viewer', readOnlyDepts: ['operations', 'hr'] },
  
  // Finance & Accounting
  billing_notes: { depts: ['admin', 'accounting', 'sales'], minLevel: 'officer', readOnlyDepts: ['sales'] },
  tax_invoices: { depts: ['admin', 'accounting'], minLevel: 'officer' },
  receipts: { depts: ['admin', 'accounting'], minLevel: 'officer' },
  ap_bills: { depts: ['admin', 'accounting', 'store'], minLevel: 'officer', readOnlyDepts: ['store'] },
  ar: { depts: ['admin', 'accounting'], minLevel: 'viewer' },
  ap: { depts: ['admin', 'accounting'], minLevel: 'viewer' },
  cashbook: { depts: ['admin', 'accounting'], minLevel: 'officer' },
  bank_accounts: { depts: ['admin', 'accounting'], minLevel: 'officer' },
  
  // Administration
  system_admin: { depts: ['admin'], minLevel: 'admin' },
  permission_profiles: { depts: ['admin'], minLevel: 'admin' },
  client_portal: { depts: ['admin', 'client'], minLevel: 'viewer' }
};

export function canSeeMenu(menu: MenuKey, dept: DeptType, level: AccessLevel): boolean {
  if (dept === 'admin' && level === 'admin') return true;
  const config = MENU_PERMISSIONS[menu];
  if (!config) return false;
  
  // Specific restricted access for Office Payroll (HR Manager only)
  if (menu === 'office_payroll' && dept === 'hr' && level === 'officer') return false;
  
  return config.depts.includes(dept) && hasLevel(level, config.minLevel);
}

export function canWriteMenu(menu: MenuKey, dept: DeptType, level: AccessLevel): boolean {
  if (dept === 'admin' && level === 'admin') return true;
  const config = MENU_PERMISSIONS[menu];
  if (!config) return false;
  if (config.readOnlyDepts?.includes(dept)) return false;
  
  return config.depts.includes(dept) && hasLevel(level, 'officer');
}
