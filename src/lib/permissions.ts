/**
 * OPEC OpsFlow - Module-level permissions & authorization.
 * Permission core: src/lib/permission-core.ts (access groups, domains).
 * See docs/permissions-architecture.md for source of truth.
 *
 * Keep in sync with firestore.rules: roleKey()/normalizedRoleKey(), canManageHrMasterData(),
 * canAccessOperations/HR, and useAppUser (no localStorage RBAC after user-doc errors).
 * operation_manager: pillar เต็ม (ไม่รวม accounting/admin) — getPermissions ใช้แถว matrix +โมดูลใหม่อัตโนมัติ;
 * getPrimaryLegacyRole สแกน permissionProfileKeys หา operation_manager (ไม่ยึดแค่ [0]).
 * Baseline profiles in getBaselineProfiles() must match ROLE_PERMISSION_MATRIX for the same role;
 * nav-access MODULE_PREFIXES / hr-nav-items keys must use the same ModuleKey as getPermissions().
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
  isOperationManager,
  canActAsHrManager,
  isOperationGroupMember,
  isAccountingGroupMember,
} from './permission-core';

export {
  isSystemAdmin,
  getEffectiveAccessGroup,
  getEffectiveAccessLevel,
  getPrimaryLegacyRole,
  isHrManager,
  isOperationManager,
  isPayrollOfficer,
  canEditEmployeeCompensation,
  canActAsHrManager,
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
  /** งวดจ่ายคนงาน — สิทธิ์แยกจาก worker_payroll (อนุมัติงวด / ดูรอบจ่าย) */
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

type BasePermissionAction = 'view' | 'create' | 'edit' | 'delete' | 'approve';
type BasePermissionModule = { all?: true } | Partial<Record<BasePermissionAction, boolean>>;
type BasePermissionRoleMap = Record<string, BasePermissionModule>;

/** canAccess / sidebar matrix — operation_manager: CRUD ใน pillar ไม่รวม approve workflow */
const OP_MGR_FULL: BasePermissionModule = {
  view: true,
  create: true,
  edit: true,
  delete: true,
  approve: false,
};
const OP_MGR_NONE: BasePermissionModule = {
  view: false,
  create: false,
  edit: false,
  delete: false,
  approve: false,
};

/**
 * Minimal base matrix (incremental adoption).
 * This does not replace the legacy permission engine yet.
 */
export const PERMISSION_MATRIX: Record<string, BasePermissionRoleMap | { all: true }> = {
  system_admin: {
    all: true,
  },

  hr_officer: {
    workers: { view: true, create: true, edit: true },
    worker_documents: { view: true, create: true, edit: true },
    positions: { view: true, create: true, edit: true },
    assignments: { view: true, create: true, edit: true },
    mobilization: { view: true, create: true, edit: true },
    timesheets: { view: true, create: true, edit: true },
    worker_payroll: { view: true, create: true, edit: true },
    payroll_runs: { view: true, create: true, edit: true },
    payslips: { view: true, create: true, edit: true },
  },

  payroll_officer: {
    worker_payroll: { view: true, create: true, edit: true },
    payroll_runs: { view: true, create: true },
    payslips: { view: true, create: true },
    payment_export_batches: { view: true, create: true },
    workers: { view: true },
    timesheets: { view: true },
  },

  /**
   * Full operation pillar ใน UI + canAccess — สอดคล้อง ROLE_PERMISSION_MATRIX.operation_manager
   * ห้าม accounting / system admin; ไม่รวม office_payroll (ตกผลึกใน ROLE matrix)
   */
  operation_manager: {
    // Commercial
    customers: OP_MGR_FULL,
    main_contracts: OP_MGR_FULL,
    customer_pos: OP_MGR_FULL,
    quotations: OP_MGR_FULL,
    sales_contract_terms: OP_MGR_FULL,
    rate_conditions: OP_MGR_FULL,
    profit_estimates: OP_MGR_FULL,
    // HR + operations
    hr_hub: OP_MGR_FULL,
    timesheets: OP_MGR_FULL,
    worker_payroll: { view: true, create: true, edit: true, delete: false, approve: false },
    payment_export_batches: OP_MGR_FULL,
    labor_cost_contract_terms: OP_MGR_FULL,
    positions: OP_MGR_FULL,
    workers: OP_MGR_FULL,
    worker_documents: OP_MGR_FULL,
    office_staff: OP_MGR_FULL,
    waves: OP_MGR_FULL,
    assignments: OP_MGR_FULL,
    mobilization: OP_MGR_FULL,
    // Store
    vendors: OP_MGR_FULL,
    purchases: OP_MGR_FULL,
    store_inventory: OP_MGR_FULL,
    // Payroll visibility / approve (dashboard & matrix paths)
    payroll_runs: { view: true, create: false, edit: false, delete: false, approve: true },
    payslips: { view: true, create: false, edit: false, delete: false, approve: true },
    // Accounting — ห้าม
    billing_notes: OP_MGR_NONE,
    tax_invoices: OP_MGR_NONE,
    receipts: OP_MGR_NONE,
    ap_bills: OP_MGR_NONE,
    accounts_receivable: OP_MGR_NONE,
    accounts_payable: OP_MGR_NONE,
    cashbook: OP_MGR_NONE,
    bank_accounts: OP_MGR_NONE,
    executive_payroll: OP_MGR_NONE,
    office_payroll: OP_MGR_NONE,
    // System / portal
    system_admin: OP_MGR_NONE,
    document_numbering: OP_MGR_NONE,
    audit_logs: OP_MGR_NONE,
    client_portal: OP_MGR_NONE,
  },
};

/**
 * Sidebar / matrix guard — ใช้ getPrimaryLegacyRole เดียวกับ permission-core + Firestore rules
 * (รองรับ permissionProfileKey เมื่อ assignedRoleKey ว่าง)
 */
export function canAccess(
  user: Partial<User> | null | undefined,
  module: string,
  action: BasePermissionAction = 'view'
): boolean {
  if (!user) return false;

  const role = getPrimaryLegacyRole(user as User);
  if (!role) return false;
  if (role === 'system_admin') return true;

  const rolePerm = PERMISSION_MATRIX[role];
  if (!rolePerm) return false;
  if ('all' in rolePerm && rolePerm.all) return true;

  const modulePerm = (rolePerm as BasePermissionRoleMap)[module];
  if (!modulePerm) return false;

  return Boolean((modulePerm as Partial<Record<BasePermissionAction, boolean>>)[action]);
}

export function isMatrixControlledRole(user: Partial<User> | null | undefined): boolean {
  const role = getPrimaryLegacyRole(user as User);
  if (!role) return false;
  return Object.prototype.hasOwnProperty.call(PERMISSION_MATRIX, role);
}

const PAYROLL_PREPARED_STATUSES = new Set([
  'GENERATED',
  'HR_REVIEWED',
  'HR_APPROVED',
  'FINANCE_PREPARED',
  'FINANCE_APPROVED',
  'PAYMENT_EXPORTED',
  'PAID',
  'LOCKED',
  'prepared',
  'payslips_generated',
  'approved',
  'exported',
]);

const PAYROLL_APPROVED_STATUSES = new Set([
  'HR_APPROVED',
  'FINANCE_PREPARED',
  'FINANCE_APPROVED',
  'PAYMENT_EXPORTED',
  'PAID',
  'LOCKED',
  'approved',
  'exported',
]);

export function canPreparePayroll(user: User | null): boolean {
  if (!user) return false;
  if (canAccess(user, 'worker_payroll', 'create') || canAccess(user, 'worker_payroll', 'edit')) return true;
  return false;
}

export function canGeneratePayslips(user: User | null, payrollStatus?: string | null): boolean {
  if (!user) return false;
  if (payrollStatus && !PAYROLL_PREPARED_STATUSES.has(payrollStatus)) return false;
  if (canAccess(user, 'payslips', 'create')) return true;
  return canAccess(user, 'worker_payroll', 'view');
}

export function canApprovePayroll(user: User | null): boolean {
  if (!user) return false;
  if (canAccess(user, 'payroll_runs', 'approve')) return true;
  return canActAsHrManager(user);
}

export function canExportPayroll(user: User | null, payrollStatus?: string | null): boolean {
  if (!user) return false;
  if (!payrollStatus || !PAYROLL_APPROVED_STATUSES.has(payrollStatus)) return false;
  if (canAccess(user, 'payment_export_batches', 'create')) return true;
  return canAccess(user, 'payment_export_batches', 'edit');
}

/**
 * Modules restricted to Managers and Admins only.
 * Officers and Viewers will be denied access regardless of group allowedModules.
 */
/** โมดูลที่ officer ทำรายการเองไม่ได้ — ไม่รวม office_payroll เพื่อให้ hr_officer ทำงานสิ้นเดือนได้ */
const MANAGEMENT_ONLY_MODULES = new Set<ModuleKey>([
  'main_contracts',
  'sales_contract_terms',
  'labor_cost_contract_terms',
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

/** ไม่ผ่าน DOMAIN_TO_MODULE_MAP — แยกสิทธิ์งวดจ่าย/สลิปจากแบทช์ worker_payroll */
const MODULE_KEYS_WITHOUT_DOMAIN_ALIAS: ReadonlySet<string> = new Set(['payroll_runs', 'payslips']);

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
  'worker_documents',
  'office_staff',
];

const OPERATIONS_MODULES: readonly ModuleKey[] = ['waves', 'assignments', 'mobilization'];

const STORE_MODULES: readonly ModuleKey[] = ['vendors', 'purchases', 'store_inventory'];

/** ทุกแผนกภายใต้กลุ่ม operation (ขาย / บุคคล / ปฏิบัติการ / คลัง) */
const ALL_OPERATION_PILLAR_MODULES: readonly ModuleKey[] = [
  ...SALES_MODULES,
  ...HR_MODULES,
  ...OPERATIONS_MODULES,
  ...STORE_MODULES,
];

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

const ACCOUNTING_MODULE_KEY_SET = new Set<ModuleKey>(ACCOUNTING_MODULES);

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

/** Officer ทุกคนไม่ approve — ใช้กับกลุ่ม operation (และ accounting officer ด้านล่าง) */
const OFFICER_NO_APPROVE: ModulePermission = {
  ...OFFICER_ACCESS,
  approve: false,
};

const VIEWER_NO_APPROVE: ModulePermission = {
  ...READ_ONLY,
  approve: false,
};

type RoleMatrixKey =
  | 'sales_manager'
  | 'operation_manager'
  | 'hr_manager'
  | 'hr_officer'
  | 'payroll_officer'
  | 'store_officer'
  | 'accounting_manager'
  | 'accounting_officer';

const P_VIEW: ModulePermission = { view: true, create: false, edit: false, delete: false, approve: false };
const P_VCE: ModulePermission = { view: true, create: true, edit: true, delete: false, approve: false };
const P_FULL_NO_APPROVE: ModulePermission = { view: true, create: true, edit: true, delete: true, approve: false };
const P_NONE: ModulePermission = { view: false, create: false, edit: false, delete: false, approve: false };
/** สอดคล้อง PERMISSION_MATRIX.operation_manager.worker_payroll — ไม่ลบแบทช์ผ่านสิทธิ์โมดูลนี้ */
const P_OP_MGR_WORKER_PAYROLL: ModulePermission = {
  view: true,
  create: true,
  edit: true,
  delete: false,
  approve: false,
};
/** ดูงวด/สลิป + อนุมัติ — สอดคล้อง PERMISSION_MATRIX payroll_runs / payslips */
const P_OP_MGR_PAYROLL_CYCLE: ModulePermission = {
  view: true,
  create: false,
  edit: false,
  delete: false,
  approve: true,
};

const ROLE_PERMISSION_MATRIX: Record<RoleMatrixKey, Partial<Record<ModuleKey, ModulePermission>>> = {
  sales_manager: {
    overview_dashboard: P_VIEW,
    positions: { view: true, create: true, edit: false, delete: false, approve: false },
    vendors: { view: true, create: true, edit: false, delete: false, approve: false },
    customers: P_VCE,
    main_contracts: P_FULL_NO_APPROVE,
    customer_pos: P_FULL_NO_APPROVE,
    sales_contract_terms: P_FULL_NO_APPROVE,
    rate_conditions: P_FULL_NO_APPROVE,
    profit_estimates: P_FULL_NO_APPROVE,
    waves: P_VCE,
    assignments: P_VCE,
    mobilization: P_VCE,
    hr_hub: P_VCE,
    timesheets: P_VCE,
    workers: P_VIEW,
    worker_payroll: P_VIEW,
    payroll_runs: P_VIEW,
    payslips: P_VIEW,
    purchases: P_NONE,
    store_inventory: P_NONE,
    labor_cost_contract_terms: P_FULL_NO_APPROVE,
    quotations: P_NONE,
    payment_export_batches: P_NONE,
    office_payroll: P_NONE,
    office_staff: P_NONE,
  },
  /** Operation pillar เต็ม — ไม่รวมบัญชี / system admin / office payroll (เงินเดือนออฟฟิศ) */
  operation_manager: {
    overview_dashboard: P_VIEW,
    // Sales / Commercial
    customers: P_FULL_NO_APPROVE,
    main_contracts: P_FULL_NO_APPROVE,
    customer_pos: P_FULL_NO_APPROVE,
    quotations: P_FULL_NO_APPROVE,
    sales_contract_terms: P_FULL_NO_APPROVE,
    rate_conditions: P_FULL_NO_APPROVE,
    profit_estimates: P_FULL_NO_APPROVE,
    // HR / payroll operations (ไม่ใช่ office_payroll)
    hr_hub: P_FULL_NO_APPROVE,
    timesheets: P_FULL_NO_APPROVE,
    worker_payroll: P_OP_MGR_WORKER_PAYROLL,
    payroll_runs: P_OP_MGR_PAYROLL_CYCLE,
    payslips: P_OP_MGR_PAYROLL_CYCLE,
    payment_export_batches: P_FULL_NO_APPROVE,
    labor_cost_contract_terms: P_FULL_NO_APPROVE,
    positions: P_FULL_NO_APPROVE,
    workers: P_FULL_NO_APPROVE,
    worker_documents: P_FULL_NO_APPROVE,
    office_staff: P_FULL_NO_APPROVE,
    office_payroll: P_NONE,
    // Operations
    waves: P_FULL_NO_APPROVE,
    assignments: P_FULL_NO_APPROVE,
    mobilization: P_FULL_NO_APPROVE,
    // Store
    vendors: P_FULL_NO_APPROVE,
    purchases: P_FULL_NO_APPROVE,
    store_inventory: P_FULL_NO_APPROVE,
    // Accounting — ห้าม
    billing_notes: P_NONE,
    tax_invoices: P_NONE,
    receipts: P_NONE,
    ap_bills: P_NONE,
    accounts_receivable: P_NONE,
    accounts_payable: P_NONE,
    cashbook: P_NONE,
    bank_accounts: P_NONE,
    executive_payroll: P_NONE,
    // System / portal
    system_admin: P_NONE,
    document_numbering: P_NONE,
    audit_logs: P_NONE,
    client_portal: P_NONE,
  },
  hr_manager: {
    overview_dashboard: P_VIEW,
    positions: P_FULL_NO_APPROVE,
    vendors: P_FULL_NO_APPROVE,
    customers: P_FULL_NO_APPROVE,
    main_contracts: P_FULL_NO_APPROVE,
    customer_pos: P_FULL_NO_APPROVE,
    sales_contract_terms: P_FULL_NO_APPROVE,
    rate_conditions: P_FULL_NO_APPROVE,
    profit_estimates: P_FULL_NO_APPROVE,
    waves: P_FULL_NO_APPROVE,
    assignments: P_FULL_NO_APPROVE,
    mobilization: P_FULL_NO_APPROVE,
    timesheets: P_FULL_NO_APPROVE,
    worker_payroll: P_FULL_NO_APPROVE,
    office_payroll: P_FULL_NO_APPROVE,
    office_staff: P_FULL_NO_APPROVE,
    purchases: P_FULL_NO_APPROVE,
    store_inventory: P_FULL_NO_APPROVE,
    labor_cost_contract_terms: P_FULL_NO_APPROVE,
    quotations: P_FULL_NO_APPROVE,
    payment_export_batches: P_FULL_NO_APPROVE,
    workers: P_FULL_NO_APPROVE,
    worker_documents: P_FULL_NO_APPROVE,
    hr_hub: P_FULL_NO_APPROVE,
    payroll_runs: P_FULL_NO_APPROVE,
    payslips: P_FULL_NO_APPROVE,
  },
  hr_officer: {
    overview_dashboard: P_VIEW,
    positions: P_VCE,
    vendors: P_NONE,
    customers: P_VIEW,
    main_contracts: P_VIEW,
    customer_pos: P_VIEW,
    sales_contract_terms: P_VIEW,
    rate_conditions: P_VIEW,
    profit_estimates: P_VIEW,
    waves: P_VCE,
    assignments: P_VCE,
    mobilization: P_VCE,
    hr_hub: P_VCE,
    timesheets: P_VCE,
    workers: P_FULL_NO_APPROVE,
    worker_payroll: P_VCE,
    office_payroll: P_VCE,
    office_staff: P_VCE,
    purchases: P_VCE,
    store_inventory: P_VCE,
    labor_cost_contract_terms: P_VCE,
    quotations: P_VIEW,
    payment_export_batches: P_VCE,
    worker_documents: P_FULL_NO_APPROVE,
    payroll_runs: P_VCE,
    payslips: P_VCE,
  },
  /** จ่ายเงิน/สลิป/งวด — อ่านทะเบียนได้ แต่ไม่สร้างตำแหน่ง/ไม่แก้ master เงินเดือน */
  payroll_officer: {
    overview_dashboard: P_VIEW,
    positions: P_VIEW,
    vendors: P_NONE,
    customers: P_VIEW,
    main_contracts: P_VIEW,
    customer_pos: P_VIEW,
    sales_contract_terms: P_VIEW,
    rate_conditions: P_VIEW,
    profit_estimates: P_VIEW,
    waves: P_VIEW,
    assignments: P_VIEW,
    mobilization: P_VIEW,
    hr_hub: P_VIEW,
    timesheets: P_VIEW,
    workers: P_VIEW,
    worker_documents: P_VIEW,
    worker_payroll: P_VCE,
    office_payroll: P_VCE,
    office_staff: P_VIEW,
    purchases: P_NONE,
    store_inventory: P_NONE,
    labor_cost_contract_terms: P_VIEW,
    quotations: P_VIEW,
    payment_export_batches: P_VCE,
    payroll_runs: P_VCE,
    payslips: P_VCE,
  },
  store_officer: {
    positions: P_VIEW,
    vendors: P_VCE,
    waves: P_NONE,
    assignments: P_NONE,
    mobilization: P_NONE,
    purchases: P_VCE,
    store_inventory: P_FULL_NO_APPROVE,
    office_payroll: P_NONE,
    office_staff: P_NONE,
    workers: P_NONE,
    customers: P_NONE,
    main_contracts: P_NONE,
    customer_pos: P_NONE,
    quotations: P_NONE,
  },
  accounting_manager: {
    positions: P_VCE,
    vendors: P_FULL_NO_APPROVE,
    customers: P_VCE,
    main_contracts: P_FULL_NO_APPROVE,
    customer_pos: P_FULL_NO_APPROVE,
    sales_contract_terms: P_FULL_NO_APPROVE,
    rate_conditions: P_FULL_NO_APPROVE,
    profit_estimates: P_FULL_NO_APPROVE,
    waves: P_FULL_NO_APPROVE,
    assignments: P_FULL_NO_APPROVE,
    mobilization: P_FULL_NO_APPROVE,
    hr_hub: P_FULL_NO_APPROVE,
    timesheets: P_FULL_NO_APPROVE,
    workers: P_VCE,
    worker_payroll: P_FULL_NO_APPROVE,
    office_payroll: P_FULL_NO_APPROVE,
    office_staff: P_FULL_NO_APPROVE,
    purchases: P_FULL_NO_APPROVE,
    store_inventory: P_FULL_NO_APPROVE,
    labor_cost_contract_terms: P_FULL_NO_APPROVE,
    quotations: P_VIEW,
    payment_export_batches: P_FULL_NO_APPROVE,
    payroll_runs: P_FULL_NO_APPROVE,
    payslips: P_FULL_NO_APPROVE,
  },
  accounting_officer: {
    positions: P_NONE,
    vendors: P_NONE,
    customers: P_NONE,
    main_contracts: P_VIEW,
    customer_pos: P_VIEW,
    sales_contract_terms: P_VIEW,
    rate_conditions: P_VIEW,
    profit_estimates: P_VIEW,
    waves: P_VIEW,
    assignments: P_VIEW,
    mobilization: P_VIEW,
    hr_hub: P_VIEW,
    timesheets: P_VIEW,
    workers: P_VIEW,
    worker_payroll: P_VIEW,
    office_payroll: P_VIEW,
    office_staff: P_VIEW,
    purchases: P_VIEW,
    store_inventory: P_VIEW,
    labor_cost_contract_terms: P_VIEW,
    quotations: P_VIEW,
    payment_export_batches: P_VIEW,
    payroll_runs: P_VIEW,
    payslips: P_VIEW,
  },
};

/**
 * ชุดเมนูตามบทบาท (กลุ่ม Operation — แผนกขาย / บุคคล / ปฏิบัติการ / คลัง)
 * hr_manager = ทุกแผนก; sales_manager = ขาย+ปฏิบัติการ;
 * operation_manager = operation pillar เต็ม (ขาย+HR+ปฏิบัติการ+คลัง) ไม่รวมบัญชี/ระบบ;
 * hr_officer = บุคคลทั้งหมด; store_* = คลัง+จัดซื้อ
 */
function operationModulesForPrimaryRole(primaryRole: string | null): Set<ModuleKey> {
  if (!primaryRole) {
    return new Set<ModuleKey>(OPERATION_GROUP_MODULES);
  }
  if (primaryRole === 'hr_manager') {
    return new Set<ModuleKey>(ALL_OPERATION_PILLAR_MODULES);
  }
  if (primaryRole === 'sales_manager') {
    return new Set<ModuleKey>([...SALES_MODULES, ...OPERATIONS_MODULES]);
  }
  if (primaryRole === 'operation_manager') {
    return new Set<ModuleKey>(ALL_OPERATION_PILLAR_MODULES);
  }
  if (primaryRole === 'hr_officer' || primaryRole === 'payroll_officer') {
    return new Set<ModuleKey>(HR_MODULES);
  }
  if (primaryRole === 'store_officer' || primaryRole === 'store_manager') {
    return new Set<ModuleKey>(STORE_MODULES);
  }
  if (primaryRole === 'sales_officer') {
    return new Set<ModuleKey>(SALES_MODULES);
  }
  if (
    primaryRole === 'operation_officer'
  ) {
    return new Set<ModuleKey>(OPERATIONS_MODULES);
  }
  /* legacy / ยังไม่ระบุบทบาทชัด — เปิดชุดเดิมทั้งกลุ่ม operation */
  return new Set<ModuleKey>(OPERATION_GROUP_MODULES);
}

/** ผู้จัดการที่ควรเข้า office_payroll ในกลุ่ม operation (มีแผนกบุคคล) */
function operationManagerMayOfficePayroll(primaryRole: string | null): boolean {
  return (
    primaryRole === 'hr_manager' ||
    primaryRole === 'operation_manager'
  );
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
  const normalized = normalizeCurrentUserPermissions(user);
  if (!normalized) {
    return new Set<ModuleKey>(OPERATION_GROUP_MODULES);
  }

  if (isStoreOfficer(normalized)) {
    return new Set<ModuleKey>(STORE_MODULES);
  }

  const pr = getPrimaryLegacyRole(normalized);
  let set = operationModulesForPrimaryRole(pr);

  /* ยัง map บทบาทไม่ได้แต่เป็น manager + แผนกรู้จัก — คลุมทุกแผนกเหมือน hr_manager ชั่วคราว */
  if (
    !pr &&
    getEffectiveAccessLevel(normalized) === 'manager' &&
    getEffectiveAccessGroup(normalized) === 'operation'
  ) {
    const d = normalized.department;
    if (d === 'hr' || d === 'sales' || d === 'operations' || d === 'store') {
      set = new Set<ModuleKey>(ALL_OPERATION_PILLAR_MODULES);
    }
  }

  return set;
}

/** Accounting group: can view operational scheduling for billing accuracy. */
const ACCOUNTING_GROUP_MODULES = new Set<ModuleKey>([
  ...SALES_MODULES,
  ...HR_MODULES.filter((k) => k !== 'timesheets'),
  ...STORE_MODULES,
  ...ACCOUNTING_MODULES,
  ...OPERATIONS_MODULES, // Added waves, assignments, mobilization for Accounting visibility
]);

const PAYROLL_OFFICER_BASELINE_MODULES: readonly ModuleKey[] = [
  'worker_payroll',
  'payment_export_batches',
  'timesheets',
];

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

/** HR Officer baseline: แผนกบุคคลทั้งหมด — officer ไม่ approve */
function buildHrOfficerPermissionMap(): Record<string, ModulePermission> {
  return buildPermissionMap(HR_MODULES, OFFICER_NO_APPROVE);
}

/** Payroll Officer baseline: เน้นงานเงินเดือน/ส่งออก + อ่านข้อมูลต้นทางที่เกี่ยวข้อง */
function buildPayrollOfficerPermissionMap(): Record<string, ModulePermission> {
  return buildPermissionMap(PAYROLL_OFFICER_BASELINE_MODULES, OFFICER_NO_APPROVE);
}

/** Seed / profile template — ตรง ROLE_PERMISSION_MATRIX.operation_manager (ไม่รวม office_payroll; approve เฉพาะงวด/สลิป) */
const OPERATION_MANAGER_BASELINE_MODULES: readonly ModuleKey[] = ALL_OPERATION_PILLAR_MODULES.filter(
  (k) => k !== 'office_payroll'
);

function buildOperationManagerBaselinePermissions(): Record<string, ModulePermission> {
  const base = buildPermissionMap(OPERATION_MANAGER_BASELINE_MODULES, P_FULL_NO_APPROVE);
  return {
    ...base,
    worker_payroll: clonePermission(P_OP_MGR_WORKER_PAYROLL),
    payroll_runs: clonePermission(P_OP_MGR_PAYROLL_CYCLE),
    payslips: clonePermission(P_OP_MGR_PAYROLL_CYCLE),
  };
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

  /** เจ้าหน้าที่คลัง: CRUD ใน store — ไม่ approve */
  if (u && isStoreOfficer(u) && STORE_MODULES.includes(moduleKey)) {
    return clonePermission(OFFICER_NO_APPROVE);
  }

  if (level === 'admin' || level === 'manager') {
    if (moduleKey === 'office_payroll' && level === 'manager' && u) {
      const primaryRole = getPrimaryLegacyRole(u);
      const group = getEffectiveAccessGroup(u);
      const accountingOk = primaryRole === 'accounting_manager';
      const operationOk =
        group === 'operation' && operationManagerMayOfficePayroll(primaryRole);
      if (!accountingOk && !operationOk) {
        return clonePermission(NO_ACCESS);
      }
    }
    return clonePermission(FULL_ACCESS);
  }

  if (MANAGEMENT_ONLY_MODULES.has(moduleKey)) {
    return clonePermission(NO_ACCESS);
  }

  if (level === 'viewer') return clonePermission(VIEWER_NO_APPROVE);

  const allowedModules = getAllowedModules(user);

  if (allowedModules.length === 0) {
    return clonePermission(OFFICER_NO_APPROVE);
  }

  return allowedModules.includes(moduleKey)
    ? clonePermission(OFFICER_NO_APPROVE)
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

  const moduleKey = (
    MODULE_KEYS_WITHOUT_DOMAIN_ALIAS.has(rawModuleKey)
      ? rawModuleKey
      : resolvePermissionModuleKey(rawModuleKey)
  ) as ModuleKey;
  if (!MODULE_KEY_SET.has(moduleKey)) {
    return clonePermission(NO_ACCESS);
  }

  /**
   * Operations Manager = pillar เต็ม (ขาย+HR+ปฏิบัติการ+คลัง) ไม่รวมบัญชี/แอดมิน
   * — แถว matrix เป็นหลัก; โมดูลใหม่ที่ยังไม่อยู่ในแถวให้สิทธิ์ P_FULL_NO_APPROVE อัตโนมัติ
   */
  if (isOperationManager(u)) {
    const om = ROLE_PERMISSION_MATRIX.operation_manager;
    const omPerm = om[moduleKey as keyof typeof om];
    if (omPerm !== undefined) {
      return clonePermission(omPerm);
    }
    if (
      !ADMIN_ONLY_MODULES.has(moduleKey) &&
      !ACCOUNTING_MODULE_KEY_SET.has(moduleKey) &&
      moduleKey !== 'client_portal'
    ) {
      return clonePermission(P_FULL_NO_APPROVE);
    }
    return clonePermission(NO_ACCESS);
  }

  const primaryRole = getPrimaryLegacyRole(u) as RoleMatrixKey | null;
  if (primaryRole && primaryRole in ROLE_PERMISSION_MATRIX) {
    const explicit = ROLE_PERMISSION_MATRIX[primaryRole][moduleKey];
    // For roles in the approved matrix, anything unspecified is intentionally denied.
    return clonePermission(explicit ?? NO_ACCESS);
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

/** แยก UI ตามแผนก (สอดคล้องชุดโมดูลตามบทบาท — ไม่ใช่ isOperationGroupMember ทั้งก้อน) */
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

export function canSeeHrPillarUi(
  user: User | null,
  profile?: PermissionProfile | null
): boolean {
  if (!user) return false;
  return HR_PILLAR_UI_KEYS.some((k) => canView(user, k, profile));
}

export function canSeeSalesPillarUi(
  user: User | null,
  profile?: PermissionProfile | null
): boolean {
  if (!user) return false;
  return SALES_PILLAR_UI_KEYS.some((k) => canView(user, k, profile));
}

export function canSeeOperationsPillarUi(
  user: User | null,
  profile?: PermissionProfile | null
): boolean {
  if (!user) return false;
  return OPS_PILLAR_UI_KEYS.some((k) => canView(user, k, profile));
}

export function canSeeStorePillarUi(
  user: User | null,
  profile?: PermissionProfile | null
): boolean {
  if (!user) return false;
  return STORE_PILLAR_UI_KEYS.some((k) => canView(user, k, profile));
}

export function canSeeAccountingPillarUi(
  user: User | null,
  profile?: PermissionProfile | null
): boolean {
  if (!user) return false;
  return ACCOUNTING_PILLAR_UI_KEYS.some((k) => canView(user, k, profile));
}

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
      permissions: buildPermissionMap([...SALES_MODULES, ...OPERATIONS_MODULES], FULL_ACCESS),
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
      permissions: buildPermissionMap(SALES_MODULES, OFFICER_NO_APPROVE),
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
      permissions: buildPermissionMap(ALL_OPERATION_PILLAR_MODULES, FULL_ACCESS),
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
      profileKey: 'payroll_officer',
      profileNameEn: 'Payroll Officer',
      profileNameTh: 'เจ้าหน้าที่เงินเดือน',
      departmentGroup: legacyDeptToDepartmentGroup('hr'),
      primaryRoleTemplateKey: 'payroll_officer',
      department: 'hr',
      level: 'officer',
      isActive: true,
      permissions: buildPayrollOfficerPermissionMap(),
    },

    {
      profileKey: 'operation_manager',
      profileNameEn: 'Operations Manager',
      profileNameTh: 'ผู้จัดการฝ่ายปฏิบัติการ',
      departmentGroup: 'operation',
      primaryRoleTemplateKey: 'operation_manager',
      department: 'operations',
      level: 'manager',
      isActive: true,
      /** สอดคล้อง ROLE_PERMISSION_MATRIX.operation_manager (pillar เต็ม ยกเว้น office_payroll + งวดเงินเดือนแยกตาม matrix) */
      permissions: buildOperationManagerBaselinePermissions(),
    },
    {
      profileKey: 'operation_officer',
      profileNameEn: 'Operations Officer',
      profileNameTh: 'เจ้าหน้าที่ฝ่ายปฏิบัติการ',
      departmentGroup: 'operation',
      primaryRoleTemplateKey: 'operation_officer',
      department: 'operations',
      level: 'officer',
      isActive: true,
      permissions: buildPermissionMap(OPERATIONS_MODULES, OFFICER_NO_APPROVE),
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
      permissions: buildPermissionMap(ACCOUNTING_MODULES, OFFICER_NO_APPROVE),
    },

    {
      profileKey: 'store_manager',
      profileNameEn: 'Store Manager',
      profileNameTh: 'ผู้จัดการคลังสินค้า',
      departmentGroup: 'operation',
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
      departmentGroup: 'operation',
      primaryRoleTemplateKey: 'store_officer',
      department: 'store',
      level: 'officer',
      isActive: true,
      permissions: buildPermissionMap(STORE_MODULES, OFFICER_NO_APPROVE),
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
