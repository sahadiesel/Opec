/**
 * Simplified 3-tier RBAC: admin | accounting | internal (default).
 * Align with firestore.rules (status/user_type/role + legacy camelCase).
 */

import {
  User,
  PermissionProfile,
  ModulePermission,
  RoleType,
  BusinessRoleKey,
} from './types';
import { resolvePermissionModuleKey } from './permission-module-map';
import {
  isSystemAdmin,
  getEffectiveAccessGroup,
  getEffectiveAccessLevel,
  getPrimaryLegacyRole,
  isHrManager,
  isOperationManager,
  isStoreOfficer,
  canEditMasterContractCostBaseline,
  isOperationsOfficer,
  isPayrollOfficer,
  canEditEmployeeCompensation,
  canActAsHrManager,
  getUserAccessContext,
  mapBusinessRoleToCore,
  mapLegacyBusinessRoleToCore,
  isDepartmentGroup,
  hasMinimumLevel,
  canAccessDomain,
  canManageSystem,
  isAccountingGroupMember,
  isOperationGroupMember,
  isOperationsPillarExecutive,
  isPrimaryHrOfficer,
  canAccessOpsSchedulingModules,
  canAccessAccountingFinanceModules,
  DOMAINS_BY_ACCESS_GROUP,
  ALL_ACCESS_DOMAINS,
  BUSINESS_ROLE_TO_CORE,
  LEGACY_BUSINESS_ROLE_TO_CORE,
  CORE_PRIMARY_ROLE_KEYS,
  type AccessGroup,
  type CoreAccessLevel,
  type AccessDomain,
  type CorePrimaryRoleKey,
  type UserAccessContext,
} from './permission-core';
import { normalizePermissionProfileDocumentId } from './role-key-normalizer';
import type { PayrollMatrixAction, PayrollMatrixResource } from './permission-payroll-matrix';
import {
  ACCOUNTING_ONLY_MODULE_KEYS,
  ADMIN_ONLY_MODULE_KEYS,
  isActiveForApp,
  isInternalTypeUser,
  isSimpleAccounting,
  isSimpleAdmin,
  isSimpleInternalEligible,
} from './simple-tier-model';

export {
  isSystemAdmin,
  getEffectiveAccessGroup,
  getEffectiveAccessLevel,
  getPrimaryLegacyRole,
  isHrManager,
  isOperationManager,
  isStoreOfficer,
  canEditMasterContractCostBaseline,
  isOperationsOfficer,
  isPayrollOfficer,
  canEditEmployeeCompensation,
  canActAsHrManager,
  getUserAccessContext,
  mapBusinessRoleToCore,
  mapLegacyBusinessRoleToCore,
  isDepartmentGroup,
  hasMinimumLevel,
  canAccessDomain,
  canManageSystem,
  isAccountingGroupMember,
  isOperationGroupMember,
  isOperationsPillarExecutive,
  isPrimaryHrOfficer,
  canAccessOpsSchedulingModules,
  canAccessAccountingFinanceModules,
  DOMAINS_BY_ACCESS_GROUP,
  ALL_ACCESS_DOMAINS,
  BUSINESS_ROLE_TO_CORE,
  LEGACY_BUSINESS_ROLE_TO_CORE,
  CORE_PRIMARY_ROLE_KEYS,
  type AccessGroup,
  type CoreAccessLevel,
  type AccessDomain,
  type CorePrimaryRoleKey,
  type UserAccessContext,
} from './permission-core';

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
  'user_type',
  'status',
  'role',
  'dataAccess',
  'portalRole',
  'mustResetPassword',
] as const;

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
  { group: 'HR & Payroll (บุคคล)', key: 'payroll_runs', label: 'รอบจ่ายคนงาน (Payroll runs)' },
  { group: 'HR & Payroll (บุคคล)', key: 'payslips', label: 'สลิปเงินเดือนคนงาน (Payslips)' },
  { group: 'HR & Payroll (บุคคล)', key: 'office_payroll', label: 'เงินเดือนออฟฟิศ (Office Payroll — ดู/แก้ตามโปรไฟล์)' },
  { group: 'HR & Payroll (บุคคล)', key: 'payment_export_batches', label: 'ไฟล์โอนเงินธนาคาร (Payment Exports)' },
  { group: 'HR & Payroll (บุคคล)', key: 'labor_cost_contract_terms', label: 'เงื่อนไขต้นทุน (Labor Cost Terms)' },
  { group: 'HR & Payroll (บุคคล)', key: 'positions', label: 'ตำแหน่งงาน (Positions)' },
  { group: 'HR & Payroll (บุคคล)', key: 'workers', label: 'ทะเบียนคนงาน (Workers)' },
  { group: 'HR & Payroll (บุคคล)', key: 'worker_documents', label: 'เอกสารบุคลากรกลาง (Worker document catalog)' },
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

/** Legacy matrix removed; kept export shape for older imports. */
export const PERMISSION_MATRIX: Record<string, unknown> = {};

type BasePermissionAction = 'view' | 'create' | 'edit' | 'delete' | 'approve';

const MODULE_KEY_SET = new Set<ModuleKey>(SYSTEM_MODULES.map((m) => m.key));
const MODULE_KEYS_WITHOUT_DOMAIN_ALIAS: ReadonlySet<string> = new Set(['payroll_runs', 'payslips']);

/** HR Officer: daily HR prep / master data only — no commercial, no payroll runs or registries. */
const HR_OFFICER_BLOCKED_MODULE_KEYS = new Set<ModuleKey>([
  'customers',
  'quotations',
  'main_contracts',
  'customer_pos',
  'sales_contract_terms',
  'rate_conditions',
  'profit_estimates',
  'office_staff',
  'office_payroll',
  'workers',
  'timesheets',
  'worker_payroll',
  'payroll_runs',
  'payslips',
  'payment_export_batches',
]);

function clonePermission(p: ModulePermission): ModulePermission {
  return { ...p };
}

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

  const normalizedProfileKeys = permissionProfileKeys.map(
    (k) => normalizePermissionProfileDocumentId(k) ?? k
  );

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
    permissionProfileKeys: normalizedProfileKeys,
    permissionProfileKey: user.permissionProfileKey
      ? normalizePermissionProfileDocumentId(user.permissionProfileKey) ?? user.permissionProfileKey
      : user.permissionProfileKey,
    approvalStatus,
    isActive,
    userType,
  } as User;
}

export function isClient(user: User | null): boolean {
  return getEffectiveAccessGroup(user) === 'client';
}

export function isInternalUser(user: User | null): boolean {
  const u = normalizeCurrentUserPermissions(user);
  if (!u) return false;
  return isSimpleInternalEligible(u);
}

export function getPermissions(
  user: User | null,
  rawModuleKey: string,
  _profile?: PermissionProfile | null
): ModulePermission {
  const u = normalizeCurrentUserPermissions(user);
  if (!u || !isActiveForApp(u)) return clonePermission(NO_ACCESS);

  if (getEffectiveAccessGroup(u) === 'client') {
    const moduleKey = resolvePermissionModuleKey(rawModuleKey) as ModuleKey;
    if (moduleKey === 'client_portal' || moduleKey === 'timesheets') {
      return u.portalRole === 'approver'
        ? { ...READ_ONLY, edit: true, approve: true }
        : clonePermission(READ_ONLY);
    }
    if (
      moduleKey === 'workers' ||
      moduleKey === 'quotations' ||
      moduleKey === 'customer_pos' ||
      moduleKey === 'main_contracts'
    ) {
      return clonePermission(READ_ONLY);
    }
    return clonePermission(NO_ACCESS);
  }

  if (!isInternalTypeUser(u)) return clonePermission(NO_ACCESS);

  if (isSimpleAdmin(u)) return clonePermission(FULL_ACCESS);

  const moduleKey = (
    MODULE_KEYS_WITHOUT_DOMAIN_ALIAS.has(rawModuleKey)
      ? rawModuleKey
      : resolvePermissionModuleKey(rawModuleKey)
  ) as ModuleKey;
  if (!MODULE_KEY_SET.has(moduleKey)) return clonePermission(NO_ACCESS);

  if (ADMIN_ONLY_MODULE_KEYS.has(moduleKey)) return clonePermission(NO_ACCESS);

  if (ACCOUNTING_ONLY_MODULE_KEYS.has(moduleKey)) {
    return isSimpleAccounting(u) ? clonePermission(FULL_ACCESS) : clonePermission(NO_ACCESS);
  }

  if (isPrimaryHrOfficer(u) && HR_OFFICER_BLOCKED_MODULE_KEYS.has(moduleKey)) {
    return clonePermission(NO_ACCESS);
  }

  return clonePermission(FULL_ACCESS);
}

export function canAccess(
  user: Partial<User> | null | undefined,
  module: string,
  action: BasePermissionAction = 'view'
): boolean {
  const p = getPermissions(user as User, module, null);
  return Boolean(p[action]);
}

export function isMatrixControlledRole(_user: Partial<User> | null | undefined): boolean {
  return false;
}

export function canPreparePayroll(user: User | null): boolean {
  return isSimpleInternalEligible(normalizeCurrentUserPermissions(user));
}

export function canGeneratePayslips(user: User | null, _payrollStatus?: string | null): boolean {
  return isSimpleInternalEligible(normalizeCurrentUserPermissions(user));
}

export function canApprovePayroll(user: User | null): boolean {
  return isSimpleInternalEligible(normalizeCurrentUserPermissions(user));
}

export function canExportPayroll(user: User | null, _payrollStatus?: string | null): boolean {
  return isSimpleInternalEligible(normalizeCurrentUserPermissions(user));
}

export const INITIAL_PERMISSIONS_TEMPLATE: Record<string, ModulePermission> = SYSTEM_MODULES.reduce(
  (acc, mod) => {
    acc[mod.key] = clonePermission(NO_ACCESS);
    return acc;
  },
  {} as Record<string, ModulePermission>
);

function buildPermissionMap(keys: readonly ModuleKey[], perm: ModulePermission): Record<string, ModulePermission> {
  const out: Record<string, ModulePermission> = {};
  for (const k of keys) {
    out[k] = clonePermission(perm);
  }
  return out;
}

const ALL_MODULE_KEYS = SYSTEM_MODULES.map((m) => m.key as ModuleKey);
const ACCOUNTING_KEYS_LIST: ModuleKey[] = [
  'billing_notes',
  'tax_invoices',
  'receipts',
  'ap_bills',
  'accounts_receivable',
  'accounts_payable',
  'cashbook',
  'bank_accounts',
  'executive_payroll',
];

const HR_PILLAR_UI_KEYS: ModuleKey[] = [
  'hr_hub',
  'workers',
  'worker_documents',
  'worker_payroll',
  'office_payroll',
  'office_staff',
  'timesheets',
  'positions',
  'labor_cost_contract_terms',
  'payment_export_batches',
];

const SALES_PILLAR_UI_KEYS: ModuleKey[] = [
  'customers',
  'quotations',
  'main_contracts',
  'customer_pos',
  'rate_conditions',
  'profit_estimates',
];

const OPS_PILLAR_UI_KEYS: ModuleKey[] = ['waves', 'assignments', 'mobilization'];
const STORE_PILLAR_UI_KEYS: ModuleKey[] = ['vendors', 'purchases', 'store_inventory'];
const ACCOUNTING_PILLAR_UI_KEYS: ModuleKey[] = [
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

export function canSeeHrPillarUi(user: User | null, profile?: PermissionProfile | null): boolean {
  if (!user) return false;
  return HR_PILLAR_UI_KEYS.some((k) => canView(user, k, profile));
}

export function canSeeSalesPillarUi(user: User | null, profile?: PermissionProfile | null): boolean {
  if (!user) return false;
  return SALES_PILLAR_UI_KEYS.some((k) => canView(user, k, profile));
}

export function canSeeOperationsPillarUi(user: User | null, profile?: PermissionProfile | null): boolean {
  if (!user) return false;
  return OPS_PILLAR_UI_KEYS.some((k) => canView(user, k, profile));
}

export function canSeeStorePillarUi(user: User | null, profile?: PermissionProfile | null): boolean {
  if (!user) return false;
  return STORE_PILLAR_UI_KEYS.some((k) => canView(user, k, profile));
}

export function canSeeAccountingPillarUi(user: User | null, profile?: PermissionProfile | null): boolean {
  if (!user) return false;
  return ACCOUNTING_PILLAR_UI_KEYS.some((k) => canView(user, k, profile));
}

export const isHRStaff = (user: User | null) => isSimpleInternalEligible(normalizeCurrentUserPermissions(user));
export const isOperationsStaff = (user: User | null) => isSimpleInternalEligible(normalizeCurrentUserPermissions(user));
export const isSalesStaff = (user: User | null) => isSimpleInternalEligible(normalizeCurrentUserPermissions(user));
export const isAccountingStaff = (user: User | null) =>
  isSimpleAdmin(user) || isSimpleAccounting(user);
export const isStoreStaff = (user: User | null) => isSimpleInternalEligible(normalizeCurrentUserPermissions(user));
export const isInternalStaff = (user: User | null) => isSimpleInternalEligible(normalizeCurrentUserPermissions(user));

/** อนุมัติใบสั่งซื้อภายใน (คลังส่งขอ) — ผู้จัดการปฏิบัติการ / หัวหน้าแนวเดียวกับ admin ธุรกิจ */
export function canApprovePurchaseAsManager(user: User | null): boolean {
  if (!user) return false;
  if (isSystemAdmin(user)) return true;
  return isOperationManager(user) || isOperationsPillarExecutive(user);
}

/** บันทึกว่าจ่ายเงินตามใบรับวางบิลจากคลัง */
export function canMarkPurchaseVendorBillPaid(user: User | null): boolean {
  if (!user) return false;
  return isSystemAdmin(user) || isSimpleAccounting(user);
}

export function getBaselineProfiles(): Partial<PermissionProfile>[] {
  const adminPerms = SYSTEM_MODULES.reduce(
    (acc, mod) => {
      acc[mod.key] = clonePermission(FULL_ACCESS);
      return acc;
    },
    {} as Record<string, ModulePermission>
  );

  const internalPerms = {
    ...INITIAL_PERMISSIONS_TEMPLATE,
    ...buildPermissionMap(
      ALL_MODULE_KEYS.filter((k) => !ADMIN_ONLY_MODULE_KEYS.has(k) && !ACCOUNTING_ONLY_MODULE_KEYS.has(k)),
      FULL_ACCESS
    ),
  };

  const accountingPerms = {
    ...internalPerms,
    ...buildPermissionMap(ACCOUNTING_KEYS_LIST, FULL_ACCESS),
  };

  return [
    {
      profileKey: 'system_admin',
      profileNameEn: 'System Administrator',
      profileNameTh: 'ผู้ดูแลระบบสูงสุด',
      departmentGroup: 'admin',
      primaryRoleTemplateKey: 'system_admin',
      department: 'admin',
      level: 'admin',
      isActive: true,
      permissions: adminPerms,
    },
    {
      profileKey: 'accounting_manager',
      profileNameEn: 'Accounting Manager',
      profileNameTh: 'ผู้จัดการบัญชี',
      departmentGroup: 'accounting',
      primaryRoleTemplateKey: 'accounting_manager',
      department: 'accounting',
      level: 'manager',
      isActive: true,
      permissions: accountingPerms,
    },
    {
      profileKey: 'accounting_officer',
      profileNameEn: 'Accounting Officer',
      profileNameTh: 'เจ้าหน้าที่บัญชี',
      departmentGroup: 'accounting',
      primaryRoleTemplateKey: 'accounting_officer',
      department: 'accounting',
      level: 'officer',
      isActive: true,
      permissions: accountingPerms,
    },
    {
      profileKey: 'operations_officer',
      profileNameEn: 'Internal staff (default)',
      profileNameTh: 'พนักงานภายใน (ค่าเริ่มต้น)',
      departmentGroup: 'operations',
      primaryRoleTemplateKey: 'operations_officer',
      department: 'operations',
      level: 'officer',
      isActive: true,
      permissions: internalPerms,
    },
    {
      profileKey: 'client_user',
      profileNameEn: 'Client Portal User',
      profileNameTh: 'ลูกค้า',
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
  ];
}

export type { PayrollMatrixResource, PayrollMatrixAction };

export function canPayrollPermission(
  user: User | null,
  _resource: PayrollMatrixResource,
  _action: PayrollMatrixAction
): boolean {
  return isSimpleInternalEligible(normalizeCurrentUserPermissions(user));
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
