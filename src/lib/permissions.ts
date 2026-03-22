/**
 * @fileOverview OPEC OpsFlow - Centralized Permissions & Authorization Source of Truth.
 * Transitional stabilization pass:
 * - no multi-profile additive merge
 * - internal runtime prefers accessGroup/accessLevel fallback model
 * - legacy roles are mapped into the new simplified groups
 */

import {
  User,
  PermissionProfile,
  ModulePermission,
  DeptType,
  AccessLevel,
  RoleType,
  BusinessRoleKey,
} from './types';
import { resolvePermissionModuleKey } from './permission-module-map';

/**
 * List of fields that govern system access.
 * These should ONLY be modified by a system_admin.
 */
export const SECURITY_SENSITIVE_FIELDS = [
  'roleId',
  'roleIds',
  'assignedRoleKey',
  'assignedRoleKeys',
  'permissionProfileKey',
  'permissionProfileKeys',
  'department',
  'level',
  'accessGroup',
  'accessLevel',
  'allowedModules',
  'isActive',
  'approvalStatus',
  'customerId',
  'userType',
  'dataAccess',
  'portalRole',
  'mustResetPassword',
] as const;

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

export type ModuleKey = (typeof SYSTEM_MODULES)[number]['key'];

export const FULL_ACCESS: ModulePermission = {
  view: true,
  create: true,
  edit: true,
  delete: true,
  approve: true,
};

export const OFFICER_ACCESS: ModulePermission = {
  view: true,
  create: true,
  edit: true,
  delete: false,
  approve: false,
};

export const READ_ONLY: ModulePermission = {
  view: true,
  create: false,
  edit: false,
  delete: false,
  approve: false,
};

export const NO_ACCESS: ModulePermission = {
  view: false,
  create: false,
  edit: false,
  delete: false,
  approve: false,
};

function clonePermission(permission: ModulePermission): ModulePermission {
  return { ...permission };
}

export const INITIAL_PERMISSIONS_TEMPLATE: Record<string, ModulePermission> = SYSTEM_MODULES.reduce(
  (acc, mod) => {
    acc[mod.key] = clonePermission(NO_ACCESS);
    return acc;
  },
  {} as Record<string, ModulePermission>
);

const MODULE_KEY_SET = new Set<ModuleKey>(SYSTEM_MODULES.map((m) => m.key));

const SALES_MODULES: readonly ModuleKey[] = [
  'customers',
  'main_contracts',
  'customer_pos',
  'quotations',
  'sales_contract_terms',
  'rate_conditions',
  'profit_estimates',
];

const HR_MODULES: readonly ModuleKey[] = [
  'timesheets',
  'worker_payroll',
  'office_payroll',
  'payment_export_batches',
  'labor_cost_contract_terms',
  'positions',
  'workers',
  'office_staff',
];

const OPERATIONS_MODULES: readonly ModuleKey[] = ['waves', 'assignments', 'mobilization'];

const STORE_MODULES: readonly ModuleKey[] = ['vendors', 'purchases', 'store_inventory'];

const ACCOUNTING_MODULES: readonly ModuleKey[] = [
  'billing_notes',
  'tax_invoices',
  'receipts',
  'ap_bills',
  'accounts_receivable',
  'accounts_payable',
  'cashbook',
  'bank_accounts',
];

const ADMIN_ONLY_MODULES = new Set<ModuleKey>(['system_admin', 'document_numbering', 'audit_logs']);

const CLIENT_VISIBLE_MODULES = new Set<ModuleKey>([
  'client_portal',
  'timesheets',
  'workers',
  'quotations',
  'customer_pos',
  'main_contracts',
]);

const OPERATION_GROUP_MODULES = new Set<ModuleKey>([
  ...SALES_MODULES,
  ...HR_MODULES,
  ...OPERATIONS_MODULES,
]);

const ACCOUNTING_GROUP_MODULES = new Set<ModuleKey>([
  ...SALES_MODULES,
  ...HR_MODULES,
  ...STORE_MODULES,
  ...ACCOUNTING_MODULES,
]);

const HR_MODULE_SET = new Set<ModuleKey>(HR_MODULES);
const SALES_MODULE_SET = new Set<ModuleKey>(SALES_MODULES);
const OPERATIONS_MODULE_SET = new Set<ModuleKey>(OPERATIONS_MODULES);
const STORE_MODULE_SET = new Set<ModuleKey>(STORE_MODULES);
const ACCOUNTING_MODULE_SET = new Set<ModuleKey>(ACCOUNTING_MODULES);

type EffectiveAccessGroup = 'admin' | 'operation' | 'accounting' | 'client' | null;

const LEGACY_ROLE_ALIASES: Record<string, string> = {
  finance_officer: 'accounting_officer',
  payroll_officer: 'hr_officer',
  safety_officer: 'operations_officer',
  client: 'client_user',
  client_viewer: 'client_user',
  client_approver: 'client_user',
  customer_viewer: 'client_user',
  customer_approver: 'client_user',
};

function aliasLegacyRole(roleKey?: string | null): string | null {
  if (!roleKey) return null;
  return LEGACY_ROLE_ALIASES[roleKey] || roleKey;
}

function isFutureAccessGroup(value: unknown): value is 'admin' | 'operation' | 'accounting' | 'client' {
  return value === 'admin' || value === 'operation' || value === 'accounting' || value === 'client';
}

function isFutureAccessLevel(value: unknown): value is 'admin' | 'manager' | 'officer' | 'viewer' {
  return value === 'admin' || value === 'manager' || value === 'officer' || value === 'viewer';
}

function buildPermissionMap(
  allowedKeys: readonly ModuleKey[],
  access: ModulePermission
): Record<string, ModulePermission> {
  const allowedSet = new Set<ModuleKey>(allowedKeys);
  return SYSTEM_MODULES.reduce((acc, mod) => {
    if (mod.key === 'overview_dashboard') {
      acc[mod.key] = clonePermission(READ_ONLY);
    } else if (allowedSet.has(mod.key)) {
      acc[mod.key] = clonePermission(access);
    } else {
      acc[mod.key] = clonePermission(NO_ACCESS);
    }
    return acc;
  }, {} as Record<string, ModulePermission>);
}

/**
 * Normalizes user data to ensure transitional arrays and status fields are populated safely.
 * Important: this does NOT grant additive permissions across multiple roles/profiles.
 */
export function normalizeCurrentUserPermissions(user: Partial<User> | null | undefined): User | null {
  if (!user) return null;

  const roleIds = Array.isArray(user.roleIds) ? [...user.roleIds] : [];
  if (user.roleId && !roleIds.includes(user.roleId)) {
    roleIds.unshift(user.roleId as RoleType);
  }

  const assignedRoleKeys = Array.isArray(user.assignedRoleKeys) ? [...user.assignedRoleKeys] : [];
  if (user.assignedRoleKey && !assignedRoleKeys.includes(user.assignedRoleKey)) {
    assignedRoleKeys.unshift(user.assignedRoleKey as BusinessRoleKey);
  }

  const permissionProfileKeys = Array.isArray(user.permissionProfileKeys)
    ? [...user.permissionProfileKeys]
    : [];
  if (user.permissionProfileKey && !permissionProfileKeys.includes(user.permissionProfileKey)) {
    permissionProfileKeys.unshift(user.permissionProfileKey);
  }

  const approvalStatus = user.approvalStatus ?? (user.isActive ? 'ACTIVE' : 'PENDING');
  const isActive = user.isActive ?? (approvalStatus === 'ACTIVE');

  let userType = user.userType;
  if (!userType) {
    const isPortalLike =
      user.portalRole != null ||
      user.accessGroup === 'client' ||
      user.department === 'client' ||
      roleIds.includes('client_user') ||
      assignedRoleKeys.includes('client_user');

    userType = isPortalLike ? 'customer_portal' : 'internal';
  }

  return {
    ...(user as User),
    roleIds,
    assignedRoleKeys,
    permissionProfileKeys,
    approvalStatus,
    isActive,
    userType,
  } as User;
}

/** Checks if user has a specific role (compatibility helper only). */
export function hasRole(user: User | null, roleKey: string): boolean {
  const u = normalizeCurrentUserPermissions(user);
  if (!u) return false;

  return (
    u.roleId === roleKey ||
    u.assignedRoleKey === roleKey ||
    u.roleIds.includes(roleKey as RoleType) ||
    (u.assignedRoleKeys || []).includes(roleKey as BusinessRoleKey)
  );
}

/** Checks if user has any of the provided roles (compatibility helper only). */
export function hasAnyRole(user: User | null, roleKeys: string[]): boolean {
  return roleKeys.some((roleKey) => hasRole(user, roleKey));
}

function getPrimaryLegacyRole(user: User | null): string | null {
  const u = normalizeCurrentUserPermissions(user);
  if (!u) return null;

  if (u.roleId === 'system_admin' || u.assignedRoleKey === 'system_admin') {
    return 'system_admin';
  }

  if (u.roleIds.includes('system_admin') || (u.assignedRoleKeys || []).includes('system_admin')) {
    return 'system_admin';
  }

  const directAssigned = aliasLegacyRole(u.assignedRoleKey);
  if (directAssigned) return directAssigned;

  const directRoleId = aliasLegacyRole(u.roleId);
  if (directRoleId) return directRoleId;

  const firstAssigned = aliasLegacyRole(u.assignedRoleKeys?.[0]);
  if (firstAssigned) return firstAssigned;

  const firstRoleId = aliasLegacyRole(u.roleIds?.[0]);
  if (firstRoleId) return firstRoleId;

  if (u.userType === 'customer_portal' || u.department === 'client') {
    return 'client_user';
  }

  if (u.department === 'admin') {
    return 'system_admin';
  }

  if (u.department === 'accounting') {
    return u.level === 'manager' ? 'accounting_manager' : 'accounting_officer';
  }

  if (u.department === 'store') {
    return u.level === 'manager' ? 'store_manager' : 'store_officer';
  }

  if (u.department === 'operations') {
    return u.level === 'manager' ? 'operations_manager' : 'operations_officer';
  }

  if (u.department === 'sales') {
    return u.level === 'manager' ? 'sales_manager' : 'sales_officer';
  }

  if (u.department === 'hr') {
    return u.level === 'manager' ? 'hr_manager' : 'hr_officer';
  }

  return null;
}

function getEffectiveAccessGroup(user: User | null): EffectiveAccessGroup {
  const u = normalizeCurrentUserPermissions(user);
  if (!u) return null;

  if (isFutureAccessGroup(u.accessGroup)) {
    return u.accessGroup;
  }

  const legacyRole = getPrimaryLegacyRole(u);

  if (legacyRole === 'system_admin') return 'admin';
  if (legacyRole === 'client_user') return 'client';

  if (
    legacyRole === 'accounting_manager' ||
    legacyRole === 'accounting_officer' ||
    legacyRole === 'store_manager' ||
    legacyRole === 'store_officer' ||
    legacyRole === 'finance_officer'
  ) {
    return 'accounting';
  }

  if (
    legacyRole === 'hr_manager' ||
    legacyRole === 'hr_officer' ||
    legacyRole === 'sales_manager' ||
    legacyRole === 'sales_officer' ||
    legacyRole === 'operations_manager' ||
    legacyRole === 'operations_officer'
  ) {
    return 'operation';
  }

  if (u.userType === 'customer_portal') return 'client';
  if (u.department === 'admin') return 'admin';
  if (u.department === 'accounting' || u.department === 'store') return 'accounting';
  if (u.department === 'client') return 'client';
  if (u.department === 'hr' || u.department === 'sales' || u.department === 'operations') return 'operation';

  return null;
}

function getEffectiveAccessLevel(user: User | null): 'admin' | 'manager' | 'officer' | 'viewer' {
  const u = normalizeCurrentUserPermissions(user);
  if (!u) return 'viewer';

  if (isFutureAccessLevel(u.accessLevel)) {
    return u.accessLevel;
  }

  const group = getEffectiveAccessGroup(u);
  if (group === 'admin') return 'admin';
  if (group === 'client') return u.portalRole === 'approver' ? 'manager' : 'viewer';

  const legacyRole = getPrimaryLegacyRole(u);
  if (
    legacyRole === 'hr_manager' ||
    legacyRole === 'sales_manager' ||
    legacyRole === 'operations_manager' ||
    legacyRole === 'accounting_manager' ||
    legacyRole === 'store_manager'
  ) {
    return 'manager';
  }

  if (
    legacyRole === 'hr_officer' ||
    legacyRole === 'sales_officer' ||
    legacyRole === 'operations_officer' ||
    legacyRole === 'accounting_officer' ||
    legacyRole === 'store_officer' ||
    legacyRole === 'finance_officer'
  ) {
    return 'officer';
  }

  if (u.level) return u.level;
  return 'officer';
}

function getAllowedModules(user: User | null): ModuleKey[] {
  const u = normalizeCurrentUserPermissions(user);
  if (!u || !Array.isArray(u.allowedModules)) return [];

  const normalized = u.allowedModules
    .map((moduleKey) => resolvePermissionModuleKey(moduleKey))
    .filter((moduleKey): moduleKey is ModuleKey => MODULE_KEY_SET.has(moduleKey));

  return Array.from(new Set(normalized));
}

function hasResolvedModuleAccess(
  user: User | null,
  moduleKey: ModuleKey,
  allowedGroupModules: Set<ModuleKey>
): ModulePermission {
  if (!allowedGroupModules.has(moduleKey)) return clonePermission(NO_ACCESS);

  const level = getEffectiveAccessLevel(user);
  if (level === 'admin' || level === 'manager') return clonePermission(FULL_ACCESS);
  if (level === 'viewer') return clonePermission(READ_ONLY);

  const allowedModules = getAllowedModules(user);

  // Transitional default:
  // officer with no allowedModules yet = allow full group with officer capability,
  // to prevent operational lockout during migration.
  if (allowedModules.length === 0) {
    return clonePermission(OFFICER_ACCESS);
  }

  return allowedModules.includes(moduleKey)
    ? clonePermission(OFFICER_ACCESS)
    : clonePermission(NO_ACCESS);
}

function getClientPermission(user: User | null, moduleKey: ModuleKey): ModulePermission {
  const u = normalizeCurrentUserPermissions(user);
  if (!u) return clonePermission(NO_ACCESS);

  if (!CLIENT_VISIBLE_MODULES.has(moduleKey)) {
    return clonePermission(NO_ACCESS);
  }

  if (moduleKey === 'client_portal' || moduleKey === 'timesheets') {
    return u.portalRole === 'approver'
      ? { ...READ_ONLY, edit: true, approve: true }
      : clonePermission(READ_ONLY);
  }

  return clonePermission(READ_ONLY);
}

export const isSystemAdmin = (user: User | null) => {
  const u = normalizeCurrentUserPermissions(user);
  if (!u) return false;
  return u.accessGroup === 'admin' || hasRole(u, 'system_admin');
};

export const isHRStaff = (user: User | null) => {
  const group = getEffectiveAccessGroup(user);
  return group === 'admin' || group === 'operation' || group === 'accounting';
};

export const isOperationsStaff = (user: User | null) => {
  const group = getEffectiveAccessGroup(user);
  return group === 'admin' || group === 'operation';
};

export const isSalesStaff = (user: User | null) => {
  const group = getEffectiveAccessGroup(user);
  return group === 'admin' || group === 'operation' || group === 'accounting';
};

export const isAccountingStaff = (user: User | null) => {
  const group = getEffectiveAccessGroup(user);
  return group === 'admin' || group === 'accounting';
};

export const isStoreStaff = (user: User | null) => {
  const group = getEffectiveAccessGroup(user);
  return group === 'admin' || group === 'accounting';
};

export const isInternalStaff = (user: User | null) => {
  const group = getEffectiveAccessGroup(user);
  return group === 'admin' || group === 'operation' || group === 'accounting';
};

export const isClient = (user: User | null) => getEffectiveAccessGroup(user) === 'client';

/** Any active internal (non-portal) employee — use to load pages / Firestore lists. */
export function isInternalUser(user: User | null): boolean {
  const u = normalizeCurrentUserPermissions(user);
  if (!u) return false;
  if (!u.isActive) return false;
  if (u.approvalStatus !== 'ACTIVE') return false;
  return getEffectiveAccessGroup(u) !== 'client';
}

export function getPermissions(
  user: User | null,
  rawModuleKey: string,
  profile?: PermissionProfile | null
): ModulePermission {
  const u = normalizeCurrentUserPermissions(user);
  if (!u) return clonePermission(NO_ACCESS);
  if (!u.isActive) return clonePermission(NO_ACCESS);
  if (u.approvalStatus !== 'ACTIVE') return clonePermission(NO_ACCESS);

  if (isSystemAdmin(u)) {
    return clonePermission(FULL_ACCESS);
  }

  const moduleKey = resolvePermissionModuleKey(rawModuleKey);
  if (!MODULE_KEY_SET.has(moduleKey)) {
    return clonePermission(NO_ACCESS);
  }

  if (moduleKey === 'overview_dashboard') {
    return clonePermission(READ_ONLY);
  }

  const group = getEffectiveAccessGroup(u);

  if (group === 'client') {
    return getClientPermission(u, moduleKey);
  }

  if (group === 'operation') {
    if (ADMIN_ONLY_MODULES.has(moduleKey)) return clonePermission(NO_ACCESS);
    return hasResolvedModuleAccess(u, moduleKey, OPERATION_GROUP_MODULES);
  }

  if (group === 'accounting') {
    if (ADMIN_ONLY_MODULES.has(moduleKey)) return clonePermission(NO_ACCESS);
    return hasResolvedModuleAccess(u, moduleKey, ACCOUNTING_GROUP_MODULES);
  }

  // Transitional fallback:
  // only used when user cannot yet be mapped into the simplified groups.
  if (profile && profile.isActive && profile.permissions?.[moduleKey]) {
    return profile.permissions[moduleKey];
  }

  return clonePermission(NO_ACCESS);
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
  return [
    {
      profileKey: 'admin_admin',
      profileNameEn: 'System Administrator',
      profileNameTh: 'ผู้ดูแลระบบสูงสุด',
      department: 'admin',
      level: 'admin',
      isActive: true,
      permissions: SYSTEM_MODULES.reduce((acc, mod) => {
        acc[mod.key] = clonePermission(FULL_ACCESS);
        return acc;
      }, {} as Record<string, ModulePermission>),
    },

    {
      profileKey: 'client_user',
      profileNameEn: 'Client Portal User',
      profileNameTh: 'ลูกค้า / ผู้ใช้งานภายนอก',
      department: 'client',
      level: 'viewer',
      isActive: true,
      permissions: buildPermissionMap(
        ['client_portal', 'timesheets', 'workers', 'quotations', 'customer_pos', 'main_contracts'],
        READ_ONLY
      ),
    },

    {
      profileKey: 'sales_manager',
      profileNameEn: 'Sales Manager',
      profileNameTh: 'ผู้จัดการฝ่ายขาย',
      department: 'sales',
      level: 'manager',
      isActive: true,
      permissions: buildPermissionMap(SALES_MODULES, FULL_ACCESS),
    },
    {
      profileKey: 'sales_officer',
      profileNameEn: 'Sales Officer',
      profileNameTh: 'เจ้าหน้าที่ฝ่ายขาย',
      department: 'sales',
      level: 'officer',
      isActive: true,
      permissions: buildPermissionMap(SALES_MODULES, OFFICER_ACCESS),
    },

    {
      profileKey: 'hr_manager',
      profileNameEn: 'HR Manager',
      profileNameTh: 'ผู้จัดการฝ่ายบุคคล',
      department: 'hr',
      level: 'manager',
      isActive: true,
      permissions: buildPermissionMap(HR_MODULES, FULL_ACCESS),
    },
    {
      profileKey: 'hr_officer',
      profileNameEn: 'HR Officer',
      profileNameTh: 'เจ้าหน้าที่ฝ่ายบุคคล',
      department: 'hr',
      level: 'officer',
      isActive: true,
      permissions: buildPermissionMap(HR_MODULES, OFFICER_ACCESS),
    },

    {
      profileKey: 'operations_manager',
      profileNameEn: 'Operations Manager',
      profileNameTh: 'ผู้จัดการฝ่ายปฏิบัติการ',
      department: 'operations',
      level: 'manager',
      isActive: true,
      permissions: buildPermissionMap(OPERATIONS_MODULES, FULL_ACCESS),
    },
    {
      profileKey: 'operations_officer',
      profileNameEn: 'Operations Officer',
      profileNameTh: 'เจ้าหน้าที่ฝ่ายปฏิบัติการ',
      department: 'operations',
      level: 'officer',
      isActive: true,
      permissions: buildPermissionMap(OPERATIONS_MODULES, OFFICER_ACCESS),
    },

    {
      profileKey: 'accounting_manager',
      profileNameEn: 'Accounting Manager',
      profileNameTh: 'ผู้จัดการฝ่ายบัญชี',
      department: 'accounting',
      level: 'manager',
      isActive: true,
      permissions: buildPermissionMap(ACCOUNTING_MODULES, FULL_ACCESS),
    },
    {
      profileKey: 'accounting_officer',
      profileNameEn: 'Accounting Officer',
      profileNameTh: 'เจ้าหน้าที่ฝ่ายบัญชี',
      department: 'accounting',
      level: 'officer',
      isActive: true,
      permissions: buildPermissionMap(ACCOUNTING_MODULES, OFFICER_ACCESS),
    },

    {
      profileKey: 'store_manager',
      profileNameEn: 'Store Manager',
      profileNameTh: 'ผู้จัดการคลังสินค้า',
      department: 'store',
      level: 'manager',
      isActive: true,
      permissions: buildPermissionMap(STORE_MODULES, FULL_ACCESS),
    },
    {
      profileKey: 'store_officer',
      profileNameEn: 'Store Officer',
      profileNameTh: 'เจ้าหน้าที่คลังสินค้า',
      department: 'store',
      level: 'officer',
      isActive: true,
      permissions: buildPermissionMap(STORE_MODULES, OFFICER_ACCESS),
    },
  ];
}

// Compatibility helpers for legacy screens that still test department-specific access
export function canAccessHRModule(user: User | null, moduleKey: string, profile?: PermissionProfile | null): boolean {
  const resolved = resolvePermissionModuleKey(moduleKey);
  return HR_MODULE_SET.has(resolved) && canView(user, resolved, profile);
}

export function canAccessSalesModule(
  user: User | null,
  moduleKey: string,
  profile?: PermissionProfile | null
): boolean {
  const resolved = resolvePermissionModuleKey(moduleKey);
  return SALES_MODULE_SET.has(resolved) && canView(user, resolved, profile);
}

export function canAccessOperationsModule(
  user: User | null,
  moduleKey: string,
  profile?: PermissionProfile | null
): boolean {
  const resolved = resolvePermissionModuleKey(moduleKey);
  return OPERATIONS_MODULE_SET.has(resolved) && canView(user, resolved, profile);
}

export function canAccessStoreModule(
  user: User | null,
  moduleKey: string,
  profile?: PermissionProfile | null
): boolean {
  const resolved = resolvePermissionModuleKey(moduleKey);
  return STORE_MODULE_SET.has(resolved) && canView(user, resolved, profile);
}

export function canAccessAccountingModule(
  user: User | null,
  moduleKey: string,
  profile?: PermissionProfile | null
): boolean {
  const resolved = resolvePermissionModuleKey(moduleKey);
  return ACCOUNTING_MODULE_SET.has(resolved) && canView(user, resolved, profile);
}
