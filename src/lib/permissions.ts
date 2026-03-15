/**
 * OPEC OpsFlow - Permissions & UI Access Utility
 * Primary source of truth for what a user can see and do.
 */

import { User, PermissionProfile, ModulePermission } from './types';
import { inferDeptAndLevel, isAdminUser } from './auth-mapping';

/**
 * Standard Module Keys for the entire system
 */
export type ModuleKey = 
  | 'overview_dashboard'
  | 'customers'
  | 'main_contracts'
  | 'customer_pos'
  | 'timesheets'
  | 'worker_payroll'
  | 'office_payroll'
  | 'positions'
  | 'workers'
  | 'office_staff'
  | 'waves'
  | 'assignments'
  | 'mobilization'
  | 'vendors'
  | 'purchases'
  | 'store_inventory'
  | 'billing_notes'
  | 'tax_invoices'
  | 'receipts'
  | 'ap_bills'
  | 'accounts_receivable'
  | 'accounts_payable'
  | 'cashbook'
  | 'bank_accounts'
  | 'system_admin'
  | 'client_portal';

/**
 * Default "Full Access" for System Admins
 */
const ADMIN_PERMISSIONS: ModulePermission = {
  view: true,
  create: true,
  edit: true,
  delete: true,
  approve: true
};

/**
 * Default "Restricted" for unknown states
 */
const RESTRICTED_PERMISSIONS: ModulePermission = {
  view: false,
  create: false,
  edit: false,
  delete: false,
  approve: false
};

/**
 * Primary helper to check permissions for a specific module
 */
export function getPermissions(
  user: User | null, 
  moduleKey: ModuleKey, 
  profile?: PermissionProfile | null
): ModulePermission {
  if (!user || !user.isActive || user.approvalStatus !== 'ACTIVE') return RESTRICTED_PERMISSIONS;

  // 1. Full Admin Override
  if (isAdminUser(user)) return ADMIN_PERMISSIONS;

  // 2. Profile-based check (Primary)
  if (profile && profile.isActive && profile.permissions?.[moduleKey]) {
    return profile.permissions[moduleKey];
  }

  // 3. Fallback logic (Migration Support)
  // Derive permissions based on hardcoded department logic if profile is missing
  const { dept, level } = inferDeptAndLevel(user);
  
  // Example hardcoded fallbacks for the transition period
  const isOfficer = level === 'officer' || level === 'manager' || level === 'admin';
  const isManager = level === 'manager' || level === 'admin';

  const fallbackMap: Record<ModuleKey, ModulePermission> = {
    overview_dashboard: { view: true, create: false, edit: false, delete: false, approve: false },
    customers: { view: ['sales', 'accounting', 'operations'].includes(dept), create: dept === 'sales', edit: dept === 'sales', delete: false, approve: false },
    main_contracts: { view: ['sales', 'accounting', 'hr'].includes(dept), create: dept === 'sales', edit: dept === 'sales', delete: false, approve: false },
    customer_pos: { view: ['sales', 'accounting', 'operations'].includes(dept), create: dept === 'sales', edit: dept === 'sales', delete: false, approve: false },
    timesheets: { view: ['hr', 'operations'].includes(dept), create: isOfficer, edit: isOfficer, delete: false, approve: isManager },
    worker_payroll: { view: ['hr', 'accounting'].includes(dept), create: dept === 'hr' && isOfficer, edit: dept === 'hr' && isOfficer, delete: false, approve: dept === 'hr' && isManager },
    office_payroll: { view: ['hr', 'accounting'].includes(dept), create: dept === 'hr' && isManager, edit: dept === 'hr' && isManager, delete: false, approve: dept === 'hr' && isManager },
    positions: { view: ['hr', 'operations'].includes(dept), create: dept === 'hr' && isOfficer, edit: dept === 'hr' && isOfficer, delete: false, approve: false },
    workers: { view: ['hr', 'operations'].includes(dept), create: dept === 'hr' && isOfficer, edit: dept === 'hr' && isOfficer, delete: false, approve: false },
    office_staff: { view: dept === 'hr', create: dept === 'hr' && isOfficer, edit: dept === 'hr' && isOfficer, delete: false, approve: false },
    waves: { view: ['operations', 'hr'].includes(dept), create: dept === 'operations' && isOfficer, edit: dept === 'operations' && isOfficer, delete: false, approve: false },
    assignments: { view: ['operations', 'hr', 'sales'].includes(dept), create: dept === 'operations' && isOfficer, edit: dept === 'operations' && isOfficer, delete: false, approve: false },
    mobilization: { view: ['operations', 'hr'].includes(dept), create: isOfficer, edit: isOfficer, delete: false, approve: false },
    vendors: { view: ['store', 'operations', 'accounting'].includes(dept), create: dept === 'store' && isOfficer, edit: dept === 'store' && isOfficer, delete: false, approve: false },
    purchases: { view: ['store', 'operations', 'accounting'].includes(dept), create: ['store', 'operations'].includes(dept) && isOfficer, edit: ['store', 'operations'].includes(dept) && isOfficer, delete: false, approve: false },
    store_inventory: { view: ['store', 'operations', 'hr'].includes(dept), create: dept === 'store' && isOfficer, edit: dept === 'store' && isOfficer, delete: false, approve: false },
    billing_notes: { view: ['accounting', 'sales'].includes(dept), create: dept === 'accounting' && isOfficer, edit: dept === 'accounting' && isOfficer, delete: false, approve: dept === 'accounting' && isManager },
    tax_invoices: { view: dept === 'accounting', create: dept === 'accounting' && isOfficer, edit: dept === 'accounting' && isOfficer, delete: false, approve: false },
    receipts: { view: dept === 'accounting', create: dept === 'accounting' && isOfficer, edit: dept === 'accounting' && isOfficer, delete: false, approve: false },
    ap_bills: { view: ['accounting', 'store'].includes(dept), create: dept === 'accounting' && isOfficer, edit: dept === 'accounting' && isOfficer, delete: false, approve: false },
    accounts_receivable: { view: dept === 'accounting', create: false, edit: false, delete: false, approve: false },
    accounts_payable: { view: dept === 'accounting', create: false, edit: false, delete: false, approve: false },
    cashbook: { view: dept === 'accounting', create: dept === 'accounting' && isOfficer, edit: dept === 'accounting' && isOfficer, delete: false, approve: false },
    bank_accounts: { view: dept === 'accounting', create: dept === 'accounting' && isOfficer, edit: dept === 'accounting' && isOfficer, delete: false, approve: false },
    system_admin: { view: dept === 'admin', create: dept === 'admin', edit: dept === 'admin', delete: dept === 'admin', approve: dept === 'admin' },
    client_portal: { view: ['client', 'admin'].includes(dept), create: false, edit: false, delete: false, approve: dept === 'client' }
  };

  return fallbackMap[moduleKey] || RESTRICTED_PERMISSIONS;
}

/**
 * Functional shorthand helpers
 */
export const canView = (user: User | null, moduleKey: ModuleKey, profile?: PermissionProfile | null) => 
  getPermissions(user, moduleKey, profile).view;

export const canCreate = (user: User | null, moduleKey: ModuleKey, profile?: PermissionProfile | null) => 
  getPermissions(user, moduleKey, profile).create;

export const canEdit = (user: User | null, moduleKey: ModuleKey, profile?: PermissionProfile | null) => 
  getPermissions(user, moduleKey, profile).edit;

export const canDelete = (user: User | null, moduleKey: ModuleKey, profile?: PermissionProfile | null) => 
  getPermissions(user, moduleKey, profile).delete;

export const canApprove = (user: User | null, moduleKey: ModuleKey, profile?: PermissionProfile | null) => 
  getPermissions(user, moduleKey, profile).approve;
