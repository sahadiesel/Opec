/**
 * OPEC OpsFlow - Authorization & Menu Mapping Configuration
 * Centralized mapping from Department + Access Level to Menu Visibility and Roles.
 */

import { DeptType, AccessLevel, RoleType } from './types';

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

export interface MenuConfig {
  group: string;
  title: string;
  href: string;
  icon: any;
  allowedDepts: DeptType[];
  minLevel: AccessLevel;
  customCheck?: (dept: DeptType, level: AccessLevel) => boolean;
}

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
 */
export const MENU_PERMISSIONS: Record<MenuKey, { depts: DeptType[]; minLevel: AccessLevel; readOnlyDepts?: DeptType[] }> = {
  dashboard: { depts: ['admin', 'hr', 'operations', 'sales', 'accounting', 'store', 'client'], minLevel: 'viewer' },
  customers: { depts: ['admin', 'sales', 'accounting'], minLevel: 'officer', readOnlyDepts: ['accounting'] },
  vendors: { depts: ['admin', 'store', 'accounting', 'sales'], minLevel: 'officer', readOnlyDepts: ['sales'] },
  main_contracts: { depts: ['admin', 'sales', 'accounting', 'hr'], minLevel: 'officer', readOnlyDepts: ['accounting', 'hr'] },
  purchase_orders: { depts: ['admin', 'sales', 'operations', 'accounting'], minLevel: 'officer', readOnlyDepts: ['accounting'] },
  timesheets: { depts: ['admin', 'hr', 'operations', 'accounting'], minLevel: 'officer', readOnlyDepts: ['accounting'] },
  worker_payroll: { depts: ['admin', 'hr', 'accounting'], minLevel: 'officer', readOnlyDepts: ['accounting'] },
  office_payroll: { depts: ['admin', 'hr', 'accounting'], minLevel: 'manager', readOnlyDepts: ['accounting'] },
  positions: { depts: ['admin', 'hr', 'operations'], minLevel: 'officer', readOnlyDepts: ['operations'] },
  workers: { depts: ['admin', 'hr', 'operations'], minLevel: 'officer', readOnlyDepts: ['operations'] },
  office_staff: { depts: ['admin', 'hr'], minLevel: 'officer' },
  waves: { depts: ['admin', 'operations', 'hr'], minLevel: 'officer', readOnlyDepts: ['hr'] },
  assignments: { depts: ['admin', 'operations', 'hr', 'sales'], minLevel: 'officer', readOnlyDepts: ['sales'] },
  mobilization: { depts: ['admin', 'operations', 'hr'], minLevel: 'officer' },
  purchases: { depts: ['admin', 'store', 'operations', 'accounting'], minLevel: 'officer', readOnlyDepts: ['accounting'] },
  store: { depts: ['admin', 'store', 'operations'], minLevel: 'officer' },
  billing_notes: { depts: ['admin', 'accounting', 'sales'], minLevel: 'officer', readOnlyDepts: ['sales'] },
  tax_invoices: { depts: ['admin', 'accounting'], minLevel: 'officer' },
  receipts: { depts: ['admin', 'accounting'], minLevel: 'officer' },
  ap_bills: { depts: ['admin', 'accounting'], minLevel: 'officer' },
  ar: { depts: ['admin', 'accounting'], minLevel: 'officer' },
  ap: { depts: ['admin', 'accounting'], minLevel: 'officer' },
  cashbook: { depts: ['admin', 'accounting'], minLevel: 'officer' },
  bank_accounts: { depts: ['admin', 'accounting'], minLevel: 'officer' },
  system_admin: { depts: ['admin'], minLevel: 'admin' },
  client_portal: { depts: ['admin', 'client'], minLevel: 'viewer' }
};

export function canSeeMenu(menu: MenuKey, dept: DeptType, level: AccessLevel): boolean {
  if (dept === 'admin' && level === 'admin') return true;
  const config = MENU_PERMISSIONS[menu];
  if (!config) return false;
  return config.depts.includes(dept) && hasLevel(level, config.minLevel);
}

export function canWriteMenu(menu: MenuKey, dept: DeptType, level: AccessLevel): boolean {
  if (dept === 'admin' && level === 'admin') return true;
  const config = MENU_PERMISSIONS[menu];
  if (!config) return false;
  if (config.readOnlyDepts?.includes(dept)) return false;
  return config.depts.includes(dept) && hasLevel(level, config.minLevel);
}
