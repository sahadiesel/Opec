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
 * Priority: Admin > HR > Accounting > Sales > Store > Operations > Client
 */
export function inferDeptAndLevel(user: Partial<User> | null): { dept: DeptType; level: AccessLevel } {
  if (!user) return { dept: 'hr', level: 'viewer' };
  
  // 1. If explicit migrated fields exist, use them
  if (user.department && user.level) {
    return { dept: user.department, level: user.level };
  }

  // 2. Fallback logic: Strict priority based inference from roleIds array
  const roles = user.roleIds || [];
  const singleRole = user.roleId as string;
  const allRoles = [...roles];
  if (singleRole && !allRoles.includes(singleRole)) allRoles.push(singleRole);
  
  // Priority 1: System Admin
  if (allRoles.includes('system_admin')) return { dept: 'admin', level: 'admin' };
  
  // Priority 2: HR
  if (allRoles.includes('hr_manager')) return { dept: 'hr', level: 'manager' };
  if (allRoles.includes('hr_officer') || allRoles.includes('payroll_officer')) return { dept: 'hr', level: 'officer' };
  
  // Priority 3: Accounting
  if (allRoles.includes('finance_officer')) return { dept: 'accounting', level: 'officer' };
  
  // Priority 4: Sales
  if (allRoles.includes('sales_officer')) return { dept: 'sales', level: 'officer' };
  
  // Priority 5: Store
  if (allRoles.includes('store_officer')) return { dept: 'store', level: 'officer' };
  
  // Priority 6: Operations
  if (allRoles.includes('operations_officer')) return { dept: 'operations', level: 'officer' };
  
  // Priority 7: Client
  if (allRoles.includes('client') || allRoles.includes('client_user')) return { dept: 'client', level: 'viewer' };

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
 */
export function getMigratedUserFields(user: Partial<User>): Partial<User> {
  const { dept, level } = inferDeptAndLevel(user);
  
  const isActive = user.isActive ?? true;
  
  // Logic for initial approval status
  let approvalStatus: ApprovalStatus = user.approvalStatus || 'PENDING';
  if (isActive) {
    const internalDepts: DeptType[] = ['admin', 'hr', 'operations', 'sales', 'accounting', 'store'];
    if (internalDepts.includes(dept)) {
      approvalStatus = 'ACTIVE';
    }
  }

  // Use existing profile key if present and not empty, otherwise derive from context
  const profileKey = user.permissionProfileKey && user.permissionProfileKey !== "" 
    ? user.permissionProfileKey 
    : `${dept}_${level}`;

  return {
    department: dept,
    level: level,
    permissionProfileKey: profileKey,
    isActive: isActive,
    approvalStatus: approvalStatus,
    customerId: user.customerId || null,
    notes: user.notes || "",
    roleIds: getLegacyRoles(dept, level), // Keep synced for security rules
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
  // Admin is anyone with admin/admin or legacy system_admin role
  const { dept, level } = inferDeptAndLevel(user);
  const roles = user.roleIds || [];
  return (dept === 'admin' && level === 'admin') || roles.includes('system_admin');
};

export function hasLevel(userLevel: AccessLevel, requiredLevel: AccessLevel): boolean {
  return LevelOrder[userLevel] >= LevelOrder[requiredLevel];
}

export const canSeeMenu = (menu: MenuKey, dept: DeptType, level: AccessLevel): boolean => {
  if (dept === 'admin' && level === 'admin') return true;
  // This logic is now handled more precisely by the Permission Profiles system
  return true; 
};
