/**
 * OPEC OpsFlow - Permissions & UI Access Utility
 * Primary source of truth for what a user can see and do.
 */

import { User, PermissionProfile, ModulePermission, DeptType, AccessLevel } from './types';
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

const READ_ONLY_PERMISSIONS: ModulePermission = {
  view: true,
  create: false,
  edit: false,
  delete: false,
  approve: false
};

const OFFICER_PERMISSIONS: ModulePermission = {
  view: true,
  create: true,
  edit: true,
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

  // 1. Full Admin Override (Profile Key or Legacy Role)
  if (user.permissionProfileKey === 'admin_admin' || isAdminUser(user)) {
    return ADMIN_PERMISSIONS;
  }

  // 2. Profile-based check (Primary Source of Truth)
  if (profile && profile.isActive && profile.permissions?.[moduleKey]) {
    return profile.permissions[moduleKey];
  }

  // 3. Fallback logic (Migration Support)
  const { dept, level } = inferDeptAndLevel(user);
  
  const isOfficer = level === 'officer' || level === 'manager' || level === 'admin';
  const isManager = level === 'manager' || level === 'admin';

  const fallbackMap: Record<ModuleKey, ModulePermission> = {
    overview_dashboard: { view: true, create: false, edit: false, delete: false, approve: false },
    customers: { view: ['sales', 'accounting', 'operations'].includes(dept), create: dept === 'sales' && isOfficer, edit: dept === 'sales' && isOfficer, delete: false, approve: false },
    main_contracts: { view: ['sales', 'accounting', 'hr'].includes(dept), create: dept === 'sales' && isOfficer, edit: dept === 'sales' && isOfficer, delete: false, approve: false },
    customer_pos: { view: ['sales', 'accounting', 'operations'].includes(dept), create: dept === 'sales' && isOfficer, edit: dept === 'sales' && isOfficer, delete: false, approve: false },
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
 * Baseline Permission Profile Definitions
 */
export function getBaselineProfiles(): Partial<PermissionProfile>[] {
  const empty = RESTRICTED_PERMISSIONS;
  const read = READ_ONLY_PERMISSIONS;
  const full = ADMIN_PERMISSIONS;
  const off = OFFICER_PERMISSIONS;

  return [
    {
      profileKey: 'admin_admin',
      profileNameTh: 'ผู้ดูแลระบบสูงสุด',
      profileNameEn: 'System Administrator',
      department: 'admin',
      level: 'admin',
      isActive: true,
      permissions: Object.keys(INITIAL_PERMISSIONS_TEMPLATE).reduce((acc, key) => ({ ...acc, [key]: full }), {})
    },
    {
      profileKey: 'hr_officer',
      profileNameTh: 'เจ้าหน้าที่ฝ่ายบุคคล',
      profileNameEn: 'HR Officer',
      department: 'hr',
      level: 'officer',
      isActive: true,
      permissions: {
        ...INITIAL_PERMISSIONS_TEMPLATE,
        overview_dashboard: read,
        positions: off,
        workers: off,
        timesheets: off,
        worker_payroll: off,
        waves: off,
        assignments: off,
        mobilization: off,
        office_staff: read,
        store_inventory: read
      }
    },
    {
      profileKey: 'hr_manager',
      profileNameTh: 'ผู้จัดการฝ่ายบุคคล',
      profileNameEn: 'HR Manager',
      department: 'hr',
      level: 'manager',
      isActive: true,
      permissions: {
        ...INITIAL_PERMISSIONS_TEMPLATE,
        overview_dashboard: read,
        positions: { ...off, approve: true },
        workers: { ...off, approve: true },
        timesheets: { ...off, approve: true },
        worker_payroll: { ...off, approve: true },
        office_payroll: { ...off, approve: true },
        office_staff: { ...off, approve: true },
        waves: off,
        assignments: off,
        mobilization: off,
        store_inventory: read
      }
    },
    {
      profileKey: 'sales_officer',
      profileNameTh: 'เจ้าหน้าที่ฝ่ายขาย',
      profileNameEn: 'Sales Officer',
      department: 'sales',
      level: 'officer',
      isActive: true,
      permissions: {
        ...INITIAL_PERMISSIONS_TEMPLATE,
        overview_dashboard: read,
        customers: off,
        main_contracts: off,
        customer_pos: off,
        waves: read,
        assignments: read,
        mobilization: read,
        billing_notes: read
      }
    },
    {
      profileKey: 'operations_officer',
      profileNameTh: 'เจ้าหน้าที่ฝ่ายปฏิบัติการ',
      profileNameEn: 'Operations Officer',
      department: 'operations',
      level: 'officer',
      isActive: true,
      permissions: {
        ...INITIAL_PERMISSIONS_TEMPLATE,
        overview_dashboard: read,
        waves: off,
        assignments: off,
        mobilization: off,
        purchases: off,
        timesheets: off,
        customers: read,
        main_contracts: read,
        customer_pos: read,
        positions: read,
        workers: read,
        vendors: read,
        store_inventory: read
      }
    },
    {
      profileKey: 'store_officer',
      profileNameTh: 'เจ้าหน้าที่คลังสินค้า',
      profileNameEn: 'Store Officer',
      department: 'store',
      level: 'officer',
      isActive: true,
      permissions: {
        ...INITIAL_PERMISSIONS_TEMPLATE,
        overview_dashboard: read,
        vendors: off,
        purchases: off,
        store_inventory: off,
        positions: read,
        workers: read,
        waves: read,
        assignments: read,
        mobilization: read,
        ap_bills: read
      }
    },
    {
      profileKey: 'accounting_officer',
      profileNameTh: 'เจ้าหน้าที่บัญชีและการเงิน',
      profileNameEn: 'Accounting & Finance Officer',
      department: 'accounting',
      level: 'officer',
      isActive: true,
      permissions: {
        ...INITIAL_PERMISSIONS_TEMPLATE,
        overview_dashboard: read,
        billing_notes: off,
        tax_invoices: off,
        receipts: off,
        ap_bills: off,
        accounts_receivable: read,
        accounts_payable: read,
        cashbook: off,
        bank_accounts: off,
        customers: read,
        main_contracts: read,
        customer_pos: read,
        vendors: read,
        purchases: read,
        store_inventory: read,
        worker_payroll: read,
        office_payroll: read,
        office_staff: read,
        waves: read,
        assignments: read
      }
    },
    {
      profileKey: 'client_viewer',
      profileNameTh: 'ลูกค้า (Viewer)',
      profileNameEn: 'Client Viewer',
      department: 'client',
      level: 'viewer',
      isActive: true,
      permissions: {
        ...INITIAL_PERMISSIONS_TEMPLATE,
        client_portal: read
      }
    }
  ];
}

const INITIAL_PERMISSIONS_TEMPLATE: Record<string, ModulePermission> = {
  overview_dashboard: RESTRICTED_PERMISSIONS,
  customers: RESTRICTED_PERMISSIONS,
  main_contracts: RESTRICTED_PERMISSIONS,
  customer_pos: RESTRICTED_PERMISSIONS,
  timesheets: RESTRICTED_PERMISSIONS,
  worker_payroll: RESTRICTED_PERMISSIONS,
  office_payroll: RESTRICTED_PERMISSIONS,
  positions: RESTRICTED_PERMISSIONS,
  workers: RESTRICTED_PERMISSIONS,
  office_staff: RESTRICTED_PERMISSIONS,
  waves: RESTRICTED_PERMISSIONS,
  assignments: RESTRICTED_PERMISSIONS,
  mobilization: RESTRICTED_PERMISSIONS,
  vendors: RESTRICTED_PERMISSIONS,
  purchases: RESTRICTED_PERMISSIONS,
  store_inventory: RESTRICTED_PERMISSIONS,
  billing_notes: RESTRICTED_PERMISSIONS,
  tax_invoices: RESTRICTED_PERMISSIONS,
  receipts: RESTRICTED_PERMISSIONS,
  ap_bills: RESTRICTED_PERMISSIONS,
  accounts_receivable: RESTRICTED_PERMISSIONS,
  accounts_payable: RESTRICTED_PERMISSIONS,
  cashbook: RESTRICTED_PERMISSIONS,
  bank_accounts: RESTRICTED_PERMISSIONS,
  system_admin: RESTRICTED_PERMISSIONS,
  client_portal: RESTRICTED_PERMISSIONS,
};

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
