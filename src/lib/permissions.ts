/**
 * OPEC OpsFlow - Module-level permissions & authorization.
 * Permission core: src/lib/permission-core.ts (access groups, domains).
 * See docs/permissions-architecture.md for source of truth.
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
import {
  isSystemAdmin,
  getEffectiveAccessGroup,
  getEffectiveAccessLevel,
  getPrimaryLegacyRole,
  isOperationGroupMember,
  isAccountingGroupMember,
} from './permission-core';

export {
  isSystemAdmin,
  getEffectiveAccessGroup,
  getEffectiveAccessLevel,
  getPrimaryLegacyRole,
  getUserAccessContext,
  mapLegacyBusinessRoleToCore,
  isDepartmentGroup,
  hasMinimumLevel,
  canAccessDomain,
  canManageSystem,
  isAccountingGroupMember,
  isOperationGroupMember,
  canAccessOpsSchedulingModules,
  canAccessAccountingFinanceModules,
  DOMAINS_BY_ACCESS_GROUP,
  ALL_ACCESS_DOMAINS,
  LEGACY_BUSINESS_ROLE_TO_CORE,
  CORE_PRIMARY_ROLE_KEYS,
  type AccessGroup,
  type CoreAccessLevel,
  type AccessDomain,
  type CorePrimaryRoleKey,
  type UserAccessContext,
} from './permission-core';
import { legacyDeptToDepartmentGroup } from './permission-profile-helpers';
import {
  resolvePayrollMatrixDecision,
  type PayrollMatrixAction,
  type PayrollMatrixResource,
} from './permission-payroll-matrix';

export {
  legacyDeptToDepartmentGroup,
  getProfileDepartmentGroup,
  deriveLegacyDepartmentForGroup,
  ACCESS_LEVELS_BY_DEPARTMENT_GROUP,
  isAccessLevelAllowedForGroup,
  profileAllowedForTargetUser,
  validateProfileAssignment,
  getUserFieldsFromPermissionProfile,
  analyzeUserProfileBinding,
  deriveBusinessRoleKeyFromPermissionProfile,
  accessGroupFromAssignedRoleKey,
  type ProfileAuditIssue,
} from './permission-profile-helpers';

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

  { group: 'HR & Payroll (บุคคล)', key: 'hr_hub', label: 'ศูนย์กลาง HR (แดชบอร์ด / ตั้งค่า)' },
  { group: 'HR & Payroll (บุคคล)', key: 'timesheets', label: 'ลงเวลาทำงาน (Timesheets)' },
  { group: 'HR & Payroll (บุคคล)', key: 'worker_payroll', label: 'จ่ายเงินคนงาน (Worker Payroll)' },
  { group: 'HR & Payroll (บุคคล)', key: 'office_payroll', label: 'เงินเดือนออฟฟิศ (Office Payroll — ดู/แก้ตามโปรไฟล์)' },
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
  { group: 'Finance & Accounting (การเงิน)', key: 'executive_payroll', label: 'เงินเดือนผู้บริหาร (Executive Payroll)' },

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

/**
 * Modules restricted to Managers and Admins only.
 * Officers and Viewers will be denied access regardless of group allowedModules.
 */
const MANAGEMENT_ONLY_MODULES = new Set<ModuleKey>([
  'main_contracts',
  'sales_contract_terms',
  'labor_cost_contract_terms',
  'office_payroll',
  'executive_payroll',
]);

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
  'hr_hub',
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
  'office_payroll',
  'executive_payroll',
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

/**
 * Managers across Commercial / HR & Payroll / Operations (and store, under Ops nav)
 * share the same module envelope: all operation-side pillars + store, never accounting or admin-only keys.
 */
const CROSS_PILLAR_OPERATION_MANAGER_ROLES = new Set<string>([
  'sales_manager',
  'hr_manager',
  'operations_manager',
  'operation_manager',
  'store_manager',
]);

function isCrossPillarOperationManager(user: User | null): boolean {
  const u = normalizeCurrentUserPermissions(user);
  if (!u) return false;
  if (getEffectiveAccessGroup(u) !== 'operation') return false;
  if (getEffectiveAccessLevel(u) !== 'manager') return false;

  const pr = getPrimaryLegacyRole(u);
  if (pr && CROSS_PILLAR_OPERATION_MANAGER_ROLES.has(pr)) return true;

  const d = u.department;
  return d === 'sales' || d === 'hr' || d === 'operations' || d === 'store';
}

/** Store officer: เฉพาะคลัง/จัดซื้อ (vendors, purchases, store_inventory) — ไม่รวมขาย/HR/ปฏิบัติการอื่น */
export function isStoreOfficer(user: User | null): boolean {
  const u = normalizeCurrentUserPermissions(user);
  if (!u) return false;
  if (getEffectiveAccessGroup(u) !== 'operation') return false;
  if (getEffectiveAccessLevel(u) !== 'officer') return false;
  const pr = getPrimaryLegacyRole(u);
  if (pr === 'store_officer') return true;
  return u.department === 'store' && getEffectiveAccessLevel(u) === 'officer';
}

function getOperationGroupModules(user: User | null): Set<ModuleKey> {
  const base = new Set<ModuleKey>(OPERATION_GROUP_MODULES);
  const normalized = normalizeCurrentUserPermissions(user);
  if (!normalized) return base;

  if (isStoreOfficer(normalized)) {
    return new Set<ModuleKey>(STORE_MODULES);
  }

  if (isCrossPillarOperationManager(normalized)) {
    const expanded = new Set<ModuleKey>(base);
    STORE_MODULES.forEach((key) => expanded.add(key));
    return expanded;
  }

  return base;
}

/** Accounting group: can view operational scheduling for billing accuracy. */
const ACCOUNTING_GROUP_MODULES = new Set<ModuleKey>([
  ...SALES_MODULES,
  ...HR_MODULES.filter((k) => k !== 'timesheets'),
  ...STORE_MODULES,
  ...ACCOUNTING_MODULES,
  ...OPERATIONS_MODULES, // Added waves, assignments, mobilization for Accounting visibility
]);

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

/** HR Officer baseline: คีย์ timesheet / เตรียม batch ได้ — ทะเบียนคน + อัตรา + office payroll ดูอย่างเดียว */
function buildHrOfficerPermissionMap(): Record<string, ModulePermission> {
  const base = buildPermissionMap(HR_MODULES, OFFICER_ACCESS);
  const narrowReadOnly: Partial<Record<ModuleKey, ModulePermission>> = {
    workers: READ_ONLY,
    office_staff: READ_ONLY,
    rate_conditions: READ_ONLY,
    labor_cost_contract_terms: READ_ONLY,
    office_payroll: READ_ONLY,
    payment_export_batches: READ_ONLY,
    hr_hub: READ_ONLY,
  };
  (Object.entries(narrowReadOnly) as [ModuleKey, ModulePermission][]).forEach(([key, perm]) => {
    base[key] = clonePermission(perm);
  });
  return base;
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

function getAllowedModules(user: User | null): ModuleKey[] {
  const u = normalizeCurrentUserPermissions(user);
  if (!u || !Array.isArray(u.allowedModules)) return [];

  const normalized = u.allowedModules
    .map((moduleKey) => resolvePermissionModuleKey(moduleKey) as ModuleKey)
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
  const u = normalizeCurrentUserPermissions(user);

  /** เจ้าหน้าที่คลัง: แก้ไข/ลบ/อนุมัติใน vendors, purchases, store_inventory ได้เต็มที่ */
  if (u && isStoreOfficer(u) && STORE_MODULES.includes(moduleKey)) {
    return clonePermission(FULL_ACCESS);
  }

  if (level === 'admin' || level === 'manager') {
    // Office payroll: sensitive; shared across Commercial/HR/Ops pillar managers, plus accounting managers.
    if (moduleKey === 'office_payroll' && level === 'manager') {
      const primaryRole = getPrimaryLegacyRole(u);
      if (!isCrossPillarOperationManager(u) && primaryRole !== 'accounting_manager') {
        return clonePermission(NO_ACCESS);
      }
    }
    return clonePermission(FULL_ACCESS);
  }
  
  // BUSINESS RULE: Certain modules are strictly Manager/Admin only
  if (MANAGEMENT_ONLY_MODULES.has(moduleKey)) {
    return clonePermission(NO_ACCESS);
  }

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

/** HR accessible by operation + accounting. */
export const isHRStaff = (user: User | null) =>
  isOperationGroupMember(user) || isAccountingGroupMember(user);

/** Operations: admin + operation (sales, hr, ops, store). */
export const isOperationsStaff = (user: User | null) => isOperationGroupMember(user);

/** Sales accessible by operation + accounting. */
export const isSalesStaff = (user: User | null) =>
  isOperationGroupMember(user) || isAccountingGroupMember(user);

/** Accounting: admin + accounting. */
export const isAccountingStaff = (user: User | null) => isAccountingGroupMember(user);

/** Store: admin + operation (store moved to operation group). */
export const isStoreStaff = (user: User | null) => isOperationGroupMember(user);

/** Any internal staff (admin, operation, accounting). */
export const isInternalStaff = (user: User | null) =>
  isOperationGroupMember(user) || isAccountingGroupMember(user);

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

  const moduleKey = resolvePermissionModuleKey(rawModuleKey) as ModuleKey;
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
    return hasResolvedModuleAccess(u, moduleKey, getOperationGroupModules(u));
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
      departmentGroup: 'admin',
      primaryRoleTemplateKey: 'admin_admin',
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
      departmentGroup: 'client',
      primaryRoleTemplateKey: 'client_user',
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
      departmentGroup: legacyDeptToDepartmentGroup('sales'),
      primaryRoleTemplateKey: 'sales_manager',
      department: 'sales',
      level: 'manager',
      isActive: true,
      permissions: buildPermissionMap(SALES_MODULES, FULL_ACCESS),
    },
    {
      profileKey: 'sales_officer',
      profileNameEn: 'Sales Officer',
      profileNameTh: 'เจ้าหน้าที่ฝ่ายขาย',
      departmentGroup: legacyDeptToDepartmentGroup('sales'),
      primaryRoleTemplateKey: 'sales_officer',
      department: 'sales',
      level: 'officer',
      isActive: true,
      permissions: buildPermissionMap(SALES_MODULES, OFFICER_ACCESS),
    },

    {
      profileKey: 'hr_manager',
      profileNameEn: 'HR Manager',
      profileNameTh: 'ผู้จัดการฝ่ายบุคคล',
      departmentGroup: legacyDeptToDepartmentGroup('hr'),
      primaryRoleTemplateKey: 'hr_manager',
      department: 'hr',
      level: 'manager',
      isActive: true,
      permissions: buildPermissionMap(HR_MODULES, FULL_ACCESS),
    },
    {
      profileKey: 'hr_officer',
      profileNameEn: 'HR Officer',
      profileNameTh: 'เจ้าหน้าที่ฝ่ายบุคคล',
      departmentGroup: legacyDeptToDepartmentGroup('hr'),
      primaryRoleTemplateKey: 'hr_officer',
      department: 'hr',
      level: 'officer',
      isActive: true,
      permissions: buildHrOfficerPermissionMap(),
    },

    {
      profileKey: 'operations_manager',
      profileNameEn: 'Operations Manager',
      profileNameTh: 'ผู้จัดการฝ่ายปฏิบัติการ',
      departmentGroup: 'operation',
      primaryRoleTemplateKey: 'operation_manager',
      department: 'operations',
      level: 'manager',
      isActive: true,
      permissions: buildPermissionMap(OPERATIONS_MODULES, FULL_ACCESS),
    },
    {
      profileKey: 'operations_officer',
      profileNameEn: 'Operations Officer',
      profileNameTh: 'เจ้าหน้าที่ฝ่ายปฏิบัติการ',
      departmentGroup: 'operation',
      primaryRoleTemplateKey: 'operation_officer',
      department: 'operations',
      level: 'officer',
      isActive: true,
      permissions: buildPermissionMap(OPERATIONS_MODULES, OFFICER_ACCESS),
    },

    {
      profileKey: 'accounting_manager',
      profileNameEn: 'Accounting Manager',
      profileNameTh: 'ผู้จัดการฝ่ายบัญชี',
      departmentGroup: 'accounting',
      primaryRoleTemplateKey: 'accounting_manager',
      department: 'accounting',
      level: 'manager',
      isActive: true,
      permissions: buildPermissionMap(ACCOUNTING_MODULES, FULL_ACCESS),
    },
    {
      profileKey: 'accounting_officer',
      profileNameEn: 'Accounting Officer',
      profileNameTh: 'เจ้าหน้าที่ฝ่ายบัญชี',
      departmentGroup: 'accounting',
      primaryRoleTemplateKey: 'accounting_officer',
      department: 'accounting',
      level: 'officer',
      isActive: true,
      permissions: buildPermissionMap(ACCOUNTING_MODULES, OFFICER_ACCESS),
    },

    {
      profileKey: 'store_manager',
      profileNameEn: 'Store Manager',
      profileNameTh: 'ผู้จัดการคลังสินค้า',
      departmentGroup: legacyDeptToDepartmentGroup('store'),
      primaryRoleTemplateKey: 'store_manager',
      department: 'store',
      level: 'manager',
      isActive: true,
      permissions: buildPermissionMap(STORE_MODULES, FULL_ACCESS),
    },
    {
      profileKey: 'store_officer',
      profileNameEn: 'Store Officer',
      profileNameTh: 'เจ้าหน้าที่คลังสินค้า',
      departmentGroup: legacyDeptToDepartmentGroup('store'),
      primaryRoleTemplateKey: 'store_officer',
      department: 'store',
      level: 'officer',
      isActive: true,
      permissions: buildPermissionMap(STORE_MODULES, FULL_ACCESS),
    },
  ];
}

export type { PayrollMatrixResource, PayrollMatrixAction };

function payrollMatrixModuleFallback(
  user: User | null,
  resource: PayrollMatrixResource,
  action: PayrollMatrixAction
): boolean {
  const u = normalizeCurrentUserPermissions(user);
  if (!u) return false;

  switch (resource) {
    case 'timesheet':
      if (action === 'view') return getPermissions(u, 'timesheets').view;
      if (action === 'create' || action === 'edit' || action === 'submit')
        return getPermissions(u, 'timesheets').edit;
      if (action === 'verify') return getPermissions(u, 'timesheets').approve;
      return false;
    case 'payroll_worker':
      if (action === 'view') return getPermissions(u, 'worker_payroll').view;
      if (action === 'create_batch' || action === 'edit_batch')
        return getPermissions(u, 'worker_payroll').edit || getPermissions(u, 'worker_payroll').create;
      if (action === 'approve' || action === 'lock')
        return getPermissions(u, 'worker_payroll').approve;
      if (action === 'export' || action === 'mark_paid' || action === 'finance_approve')
        return getPermissions(u, 'worker_payroll').view && getPermissions(u, 'payment_export_batches').edit;
      return false;
    case 'payroll_office':
      if (action === 'view') return getPermissions(u, 'office_payroll').view;
      if (action === 'create' || action === 'edit' || action === 'submit')
        return getPermissions(u, 'office_payroll').edit;
      if (action === 'approve' || action === 'lock' || action === 'finance_approve')
        return getPermissions(u, 'office_payroll').approve;
      return false;
    case 'policy':
      return action === 'view' ? getPermissions(u, 'hr_hub').view : getPermissions(u, 'hr_hub').edit;
    case 'worker':
      if (action === 'view') return getPermissions(u, 'workers').view;
      return getPermissions(u, 'workers').create || getPermissions(u, 'workers').edit;
    case 'office_staff':
      if (action === 'view') return getPermissions(u, 'office_staff').view;
      return getPermissions(u, 'office_staff').create || getPermissions(u, 'office_staff').edit;
    case 'rate_term_cost':
      if (action === 'view')
        return getPermissions(u, 'rate_conditions').view || getPermissions(u, 'labor_cost_contract_terms').view;
      return getPermissions(u, 'rate_conditions').edit || getPermissions(u, 'labor_cost_contract_terms').edit;
    default:
      return false;
  }
}

/**
 * สิทธิ์แบบ Role × Resource × Action สำหรับ payroll / timesheet / policy (ชั้น UI + service).
 * ค่า inherit จาก matrix จะ fallback ไป module permission เดิม
 */
export function canPayrollPermission(
  user: User | null,
  resource: PayrollMatrixResource,
  action: PayrollMatrixAction
): boolean {
  const d = resolvePayrollMatrixDecision(user, resource, action);
  if (d === 'allow') return true;
  if (d === 'deny') return false;
  return payrollMatrixModuleFallback(user, resource, action);
}

export function assertPayrollPermission(
  user: User | null,
  resource: PayrollMatrixResource,
  action: PayrollMatrixAction,
  message?: string
): void {
  if (!canPayrollPermission(user, resource, action)) {
    throw new Error(message || `Permission denied: ${resource}.${action}`);
  }
}
