/**
 * OPEC OpsFlow - Authorization & Menu Mapping Configuration
 * Centralized mapping from Department + Access Level to Menu Visibility and Roles.
 */

import { DeptType, AccessLevel, RoleType, User } from './types';

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

export function hasLevel(userLevel: AccessLevel, requiredLevel: AccessLevel): boolean {
  return LevelOrder[userLevel] >= LevelOrder[requiredLevel];
}

/**
 * NEW: Authorization Helpers for App Code
 * Supports both new Dept/Level model and legacy roleIds for migration.
 */

export const isAdmin = (user: User | null) => 
  user?.department === 'admin' && user?.level === 'admin' || user?.roleIds?.includes('system_admin');

export const isHRViewer = (user: User | null) => 
  isAdmin(user) || (user?.department === 'hr' && hasLevel(user.level, 'viewer')) || user?.roleIds?.some(r => ['hr_manager', 'hr_officer'].includes(r));

export const isHROfficerOrHigher = (user: User | null) => 
  isAdmin(user) || (user?.department === 'hr' && hasLevel(user.level, 'officer')) || user?.roleIds?.some(r => ['hr_manager', 'hr_officer'].includes(r));

export const isHRManager = (user: User | null) => 
  isAdmin(user) || (user?.department === 'hr' && hasLevel(user.level, 'manager')) || user?.roleIds?.includes('hr_manager');

export const isSalesOfficerOrHigher = (user: User | null) => 
  isAdmin(user) || (user?.department === 'sales' && hasLevel(user.level, 'officer')) || user?.roleIds?.includes('sales_officer');

export const isOperationsOfficerOrHigher = (user: User | null) => 
  isAdmin(user) || (user?.department === 'operations' && hasLevel(user.level, 'officer')) || user?.roleIds?.includes('operations_officer');

export const isStoreOfficerOrHigher = (user: User | null) => 
  isAdmin(user) || (user?.department === 'store' && hasLevel(user.level, 'officer')) || user?.roleIds?.includes('store_officer');

export const isAccountingViewer = (user: User | null) => 
  isAdmin(user) || (user?.department === 'accounting' && hasLevel(user.level, 'viewer')) || user?.roleIds?.includes('finance_officer');

export const isAccountingOfficerOrHigher = (user: User | null) => 
  isAdmin(user) || (user?.department === 'accounting' && hasLevel(user.level, 'officer')) || user?.roleIds?.includes('finance_officer');

export const isClientUser = (user: User | null) => 
  user?.department === 'client' || user?.roleIds?.some(r => ['client', 'client_user'].includes(r));

export const sameCustomer = (user: User | null, recordCustomerId: string) => 
  isAdmin(user) || (isClientUser(user) && user?.customerId === recordCustomerId);

/**
 * Maps Dept + Level to legacy roleIds for Firestore Security Rules
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
 * Visibility and Access Rules per Menu
 * Note: Grouping in sidebar is different from functional ownership.
 */
export const MENU_PERMISSIONS: Record<MenuKey, { depts: DeptType[]; minLevel: AccessLevel; readOnlyDepts?: DeptType[] }> = {
  dashboard: { depts: ['admin', 'hr', 'operations', 'sales', 'accounting', 'store', 'client'], minLevel: 'viewer' },
  
  // Commercial
  customers: { depts: ['admin', 'sales', 'accounting', 'operations'], minLevel: 'viewer', readOnlyDepts: ['accounting', 'operations'] },
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
  vendors: { depts: ['admin', 'store', 'operations', 'accounting'], minLevel: 'officer', readOnlyDepts: ['accounting'] },
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
  
  // Functional Write rules
  if (menu === 'office_payroll' && dept === 'accounting') return false; // Accounting only pays, HR prepares
  if (menu === 'worker_payroll' && dept === 'accounting') return false;
  
  return config.depts.includes(dept) && hasLevel(level, 'officer');
}
