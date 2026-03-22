/**
 * @fileOverview OPEC OpsFlow - Centralized Permissions & Authorization Source of Truth.
 * Uses at most one permission profile for module checks (no additive merge across profiles).
 */

import { User, PermissionProfile, ModulePermission, DeptType, AccessLevel, RoleType } from './types';
import { resolvePermissionModuleKey } from './permission-module-map';

/**
 * List of fields that govern system access.
 * These should ONLY be modified by a system_admin.
 */
export const SECURITY_SENSITIVE_FIELDS = [
  'roleId', 'roleIds', 
  'assignedRoleKey', 'assignedRoleKeys', 
  'permissionProfileKey', 'permissionProfileKeys', 
  'department', 'level', 
  'isActive', 'approvalStatus',
  'customerId', 'userType', 'dataAccess', 'portalRole', 'mustResetPassword'
];

/**
 * Registry of all modules in the system.
 */
export const SYSTEM_MODULES = [
  { group: 'Overview', key: 'overview_dashboard', label: 'แดชบอร์ดหลัก (Main Dashboard)' },
  { group: 'Commercial (การค้า)', key: 'customers', label: 'ทะเบียนลูกค้า (Customers)' },
  { group: 'Commercial (การค้า)', key: 'main_contracts', label: 'สัญญาหลัก (Contracts)' },
  { group: 'Commercial (การค้า)', key: 'customer_pos', label: 'ใบสั่งซื้อลูกค้า (Customer POs)' },
  { group: 'Commercial (การค้า)', key: 'quotations', label: 'ใบเสนอราคา (Quotations)' },
  { group: 'Commercial (การค้า)', key: 'sales_contract_terms', label: 'เงื่อนไขการขาย (Sales Terms)' },
  { group: 'Commercial (การค้า)', key: 'rate_conditions', label: 'กฎการคำนวณราคา (Rate Conditions)' },
  { group: 'Commercial (การค้า)', key: 'profit_estimates', label: 'ประมาณการกำไร (Profit Estimates)' },
  { group: 'HR & Payroll (บุคคล)', key: 'timesheets', label: 'ลงเวลาทำงาน (Timesheets)' },
  { group: 'HR & Payroll (บุคคล)', key: 'worker_payroll', label: 'จ่ายเงินคนงาน (Worker Payroll)' },
  { group: 'HR & Payroll (บุคคล)', key: 'office_payroll', label: 'เงินเดือนออฟฟิศ (Office Payroll)' },
  { group: 'HR & Payroll (บุคคล)', key: 'payment_export_batches', label: 'ไฟล์โอนเงินธนาคาร (Payment Exports)' },
  { group: 'HR & Payroll (บุคคล)', key: 'labor_cost_contract_terms', label: 'เงื่อนไขต้นทุน (Labor Cost Terms)' },
  { group: 'HR & Payroll (บุคคล)', key: 'positions', label: 'ตำแหน่งงาน (Positions)' },
  { group: 'HR & Payroll (บุคคล)', key: 'workers', label: 'ทะเบียนคนงาน (Workers)' },
  { group: 'HR & Payroll (บุคคล)', key: 'office_staff', label: 'พนักงานออฟฟิศ (Office Staff)' },
  { group: 'Operations (ปฏิบัติการ)', key: 'waves', label: 'กลุ่มรอบการทำงาน (Waves)' },
  { group: 'Operations (ปฏิบัติการ)', key: 'assignments', label: 'การมอบหมายงาน (Assignments)' },
  { group: 'Operations (ปฏิบัติการ)', key: 'mobilization', label: 'การเตรียมส่งตัว (Mobilization)' },
  { group: 'Operations (ปฏิบัติการ)', key: 'vendors', label: 'คู่ค้า/ผู้ขาย (Vendors)' },
  { group: 'Operations (ปฏิบัติการ)', key: 'purchases', label: 'การซื้อสินค้า/บริการ (Purchases)' },
  { group: 'Operations (ปฏิบัติการ)', key: 'store_inventory', label: 'คลังอุปกรณ์ (Store / Inventory)' },
  { group: 'Finance & Accounting (การเงิน)', key: 'billing_notes', label: 'ใบวางบิลลูกหนี้ (Billing Notes)' },
  { group: 'Finance & Accounting (การเงิน)', key: 'tax_invoices', label: 'ใบกำกับภาษี (Tax Invoices)' },
  { group: 'Finance & Accounting (การเงิน)', key: 'receipts', label: 'ใบเสร็จรับเงิน (Receipts)' },
  { group: 'Finance & Accounting (การเงิน)', key: 'ap_bills', label: 'รับวางบิลเจ้าหนี้ (AP Bills)' },
  { group: 'Finance & Accounting (การเงิน)', key: 'accounts_receivable', label: 'ลูกหนี้การค้า (AR)' },
  { group: 'Finance & Accounting (การเงิน)', key: 'accounts_payable', label: 'เจ้าหนี้การค้า (AP)' },
  { group: 'Finance & Accounting (การเงิน)', key: 'cashbook', label: 'รายรับรายจ่าย (Cashbook)' },
  { group: 'Finance & Accounting (การเงิน)', key: 'bank_accounts', label: 'บัญชีธนาคาร (Bank Accounts)' },
  { group: 'Administration (ระบบ)', key: 'system_admin', label: 'จัดการผู้ใช้/ระบบ (System Admin)' },
  { group: 'Administration (ระบบ)', key: 'client_portal', label: 'Client Portal (หน้าของลูกค้า)' },
  { group: 'Administration (ระบบ)', key: 'document_numbering', label: 'รันเลขที่เอกสาร (Numbering)' },
  { group: 'Administration (ระบบ)', key: 'audit_logs', label: 'ประวัติกิจกรรม (Audit Logs)' },
] as const;

export type ModuleKey = typeof SYSTEM_MODULES[number]['key'];

export const FULL_ACCESS: ModulePermission = { view: true, create: true, edit: true, delete: true, approve: true };
export const OFFICER_ACCESS: ModulePermission = { view: true, create: true, edit: true, delete: false, approve: false };
export const READ_ONLY: ModulePermission = { view: true, create: false, edit: false, delete: false, approve: false };
export const NO_ACCESS: ModulePermission = { view: false, create: false, edit: false, delete: false, approve: false };

export const INITIAL_PERMISSIONS_TEMPLATE: Record<string, ModulePermission> = 
  SYSTEM_MODULES.reduce((acc, mod) => ({ ...acc, [mod.key]: NO_ACCESS }), {});

/**
 * Normalizes user data to ensure role arrays and status fields are populated correctly.
 */
export function normalizeCurrentUserPermissions(user: any): User | null {
  if (!user) return null;

  const roleIds = Array.isArray(user.roleIds) ? [...user.roleIds] : [];
  if (user.roleId && !roleIds.includes(user.roleId)) {
    roleIds.push(user.roleId as RoleType);
  }

  const assignedRoleKeys = Array.isArray(user.assignedRoleKeys) ? [...user.assignedRoleKeys] : [];
  if (user.assignedRoleKey && !assignedRoleKeys.includes(user.assignedRoleKey)) {
    assignedRoleKeys.push(user.assignedRoleKey);
  }

  const permissionProfileKeys = Array.isArray(user.permissionProfileKeys) ? [...user.permissionProfileKeys] : [];
  if (user.permissionProfileKey && !permissionProfileKeys.includes(user.permissionProfileKey)) {
    permissionProfileKeys.push(user.permissionProfileKey);
  }

  return {
    ...user,
    roleIds,
    assignedRoleKeys,
    permissionProfileKeys,
    isActive: user.isActive ?? (user.approvalStatus === 'ACTIVE'),
    approvalStatus: user.approvalStatus ?? (user.isActive ? 'ACTIVE' : 'PENDING')
  } as User;
}

/** Checks if user has a specific role (canonical or business key) */
export function hasRole(user: User | null, roleKey: string): boolean {
  if (!user) return false;
  const u = normalizeCurrentUserPermissions(user);
  if (!u) return false;
  
  return (
    u.roleIds.includes(roleKey as RoleType) || 
    u.assignedRoleKeys?.includes(roleKey as any) ||
    u.roleId === roleKey ||
    u.assignedRoleKey === roleKey
  );
}

/** Checks if user has any of the provided roles */
export function hasAnyRole(user: User | null, roleKeys: string[]): boolean {
  return roleKeys.some(key => hasRole(user, key));
}

export const isSystemAdmin = (user: User | null) => hasRole(user, 'system_admin');

/** Profile keys from permission_profiles / admin UI (often UPPER_SNAKE_CASE); must align with Firestore rules. */
function permissionProfileKeysInclude(user: User | null, canonicalKeys: string[]): boolean {
  if (!user) return false;
  const u = normalizeCurrentUserPermissions(user);
  if (!u) return false;
  const keys = new Set(
    [...(u.permissionProfileKeys || []), u.permissionProfileKey].filter(Boolean).map((k) => String(k).toLowerCase())
  );
  return canonicalKeys.some((c) => keys.has(c.toLowerCase()));
}

export const isHRStaff = (user: User | null) =>
  hasAnyRole(user, ['hr_manager', 'hr_officer', 'payroll_officer', 'system_admin']) ||
  permissionProfileKeysInclude(user, ['hr_manager', 'hr_officer', 'payroll_officer']);

export const isOperationsStaff = (user: User | null) => 
  hasAnyRole(user, ['operations_manager', 'operations_officer', 'safety_officer', 'system_admin']);

export const isSalesStaff = (user: User | null) => 
  hasAnyRole(user, ['sales_manager', 'sales_officer', 'system_admin']);

export const isAccountingStaff = (user: User | null) => 
  hasAnyRole(user, ['accounting_manager', 'accounting_officer', 'finance_officer', 'system_admin']);

export const isStoreStaff = (user: User | null) => 
  hasAnyRole(user, ['store_manager', 'store_officer', 'system_admin']);

export const isInternalStaff = (user: User | null) => 
  isHRStaff(user) || isOperationsStaff(user) || isSalesStaff(user) || isAccountingStaff(user) || isStoreStaff(user);

export const isClient = (user: User | null) => {
  if (!user) return false;
  return user.userType === 'customer_portal' || hasAnyRole(user, ['client_user', 'client', 'client_approver', 'client_viewer']);
};

/** Any active internal (non-portal) employee — use to load pages / Firestore lists; UI still uses getPermissions for actions. */
export function isInternalUser(user: User | null): boolean {
  if (!user) return false;
  const u = normalizeCurrentUserPermissions(user);
  if (!u) return false;
  if (!u.isActive) return false;
  if (u.approvalStatus === 'SUSPENDED' || u.approvalStatus === 'REJECTED') return false;
  return !isClient(u);
}

export function getPermissions(
  user: User | null,
  rawModuleKey: string,
  profile?: PermissionProfile | null
): ModulePermission {
  if (!user) return NO_ACCESS;
  
  const u = normalizeCurrentUserPermissions(user);
  if (!u || !u.isActive) return NO_ACCESS;

  const moduleKey = resolvePermissionModuleKey(rawModuleKey);

  if (isSystemAdmin(u)) {
    return FULL_ACCESS;
  }

  if (u.approvalStatus !== 'ACTIVE') {
    return NO_ACCESS;
  }

  if (profile && profile.isActive) {
    return profile.permissions?.[moduleKey] || NO_ACCESS;
  }

  if (moduleKey === 'overview_dashboard') return { ...READ_ONLY, view: true };

  if (isClient(u)) {
    if (moduleKey === 'client_portal' || moduleKey === 'timesheets') {
      const level = u.portalRole === 'approver' ? 'manager' : 'viewer';
      return (level === 'manager') ? { ...READ_ONLY, approve: true, edit: true } : READ_ONLY;
    }
    if (['workers', 'quotations', 'customer_pos', 'main_contracts'].includes(moduleKey)) return READ_ONLY;
  }

  if (isHRStaff(u) && ['workers', 'positions', 'timesheets', 'worker_payroll', 'office_staff', 'labor_cost_contract_terms'].includes(moduleKey)) return OFFICER_ACCESS;
  if (isStoreStaff(u) && ['store_inventory', 'vendors', 'purchases'].includes(moduleKey)) return OFFICER_ACCESS;
  if (isAccountingStaff(u) && ['cashbook', 'billing_notes', 'tax_invoices', 'receipts', 'ap_bills', 'accounts_receivable', 'accounts_payable', 'bank_accounts'].includes(moduleKey)) return OFFICER_ACCESS;
  if (isSalesStaff(u) && ['customers', 'main_contracts', 'quotations', 'customer_pos', 'sales_contract_terms', 'rate_conditions', 'profit_estimates'].includes(moduleKey)) return OFFICER_ACCESS;
  if (isOperationsStaff(u) && ['waves', 'assignments', 'mobilization', 'timesheets'].includes(moduleKey)) return OFFICER_ACCESS;

  return NO_ACCESS;
}

export const canView = (user: User | null, moduleKey: string, profile?: PermissionProfile | null) =>
  getPermissions(user, moduleKey, profile).view;

export const canCreate = (user: User | null, moduleKey: string, profile?: PermissionProfile | null) =>
  getPermissions(user, moduleKey, profile).create;

export const canEdit = (user: User | null, moduleKey: string, profile?: PermissionProfile | null) =>
  getPermissions(user, moduleKey, profile).edit;

export const canDelete = (user: User | null, moduleKey: string, profile?: PermissionProfile | null) =>
  getPermissions(user, moduleKey, profile).delete;

export const canApprove = (user: User | null, moduleKey: string, profile?: PermissionProfile | null) =>
  getPermissions(user, moduleKey, profile).approve;

export function getBaselineProfiles(): Partial<PermissionProfile>[] {
  const depts: DeptType[] = ['hr', 'operations', 'sales', 'accounting', 'store'];
  const baselines: Partial<PermissionProfile>[] = [
    {
      profileKey: 'admin_admin',
      profileNameEn: 'System Administrator',
      profileNameTh: 'ผู้ดูแลระบบสูงสุด',
      department: 'admin',
      level: 'admin',
      isActive: true,
      permissions: SYSTEM_MODULES.reduce((acc, mod) => ({ ...acc, [mod.key]: FULL_ACCESS }), {})
    },
    {
      profileKey: 'client_user',
      profileNameEn: 'Client Portal User',
      profileNameTh: 'ลูกค้า / ผู้ใช้งานภายนอก',
      department: 'client',
      level: 'viewer',
      isActive: true,
      permissions: {
        ...INITIAL_PERMISSIONS_TEMPLATE,
        client_portal: READ_ONLY,
        timesheets: READ_ONLY,
      }
    }
  ];

  depts.forEach(dept => {
    baselines.push({
      profileKey: `${dept}_manager`,
      profileNameEn: `${dept.toUpperCase()} Manager`,
      profileNameTh: `ผู้จัดการฝ่าย${dept}`,
      department: dept,
      level: 'manager',
      isActive: true,
      permissions: SYSTEM_MODULES.reduce((acc, mod) => {
        const isRelevant = mod.key.includes(dept) || mod.group.toLowerCase().includes(dept);
        return { ...acc, [mod.key]: isRelevant ? FULL_ACCESS : (mod.key === 'overview_dashboard' ? READ_ONLY : NO_ACCESS) };
      }, {})
    });

    baselines.push({
      profileKey: `${dept}_officer`,
      profileNameEn: `${dept.toUpperCase()} Officer`,
      profileNameTh: `เจ้าหน้าที่ฝ่าย${dept}`,
      department: dept,
      level: 'officer',
      isActive: true,
      permissions: SYSTEM_MODULES.reduce((acc, mod) => {
        const isRelevant = mod.key.includes(dept) || mod.group.toLowerCase().includes(dept);
        return { ...acc, [mod.key]: isRelevant ? OFFICER_ACCESS : (mod.key === 'overview_dashboard' ? READ_ONLY : NO_ACCESS) };
      }, {})
    });
  });

  return baselines;
}
